/**
 * Shared helpers for the PQ Risk Sentinel scripts.
 *
 * Patterns proven in Phase 0 / 0.5 (see ../../LOG.md):
 *  - native-lane broadcasts via EthNativeSigner + StargateClient, hybrid mode;
 *  - EVM authorisation windows via openEvmWindowMsg, sized with evmWindowCost;
 *  - EVM-lane transactions via viem from the account's classical key, inside a
 *    live window (gas <= 3,000,000, fee cap 250 gwei — the window sizing).
 *
 * Secrets: mnemonics are read from ../keys/<name>.mnemonic at runtime and are
 * never printed or written anywhere by this library.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StargateClient } from "@cosmjs/stargate";
import {
  EthNativeSigner,
  deriveUnifiedAccount,
  fetchPqcStatus,
  openEvmWindowMsg,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { evmWindowCost, evmWindowStatus } from "@qorechain/evm";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const NETWORK = {
  chainIdCosmos: "qorechain-diana",
  chainIdEvm: 9800,
  rest: "https://api-testnet.qore.host",
  rpcCosmos: "https://rpc-testnet.qore.host",
  rpcEvm: "https://evm-testnet.qore.host",
  explorer: "https://explore.qore.network",
} as const;

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const KEYS_DIR = join(ROOT, "..", "keys");
export const EVIDENCE_PATH = join(ROOT, "evidence.json");

export type AccountName = "deployer" | "agent";

const unifiedCache = new Map<AccountName, Promise<UnifiedAccount>>();

export function loadMnemonic(name: AccountName): string {
  return readFileSync(join(KEYS_DIR, `${name}.mnemonic`), "utf8").trim();
}

export function getUnified(name: AccountName): Promise<UnifiedAccount> {
  let p = unifiedCache.get(name);
  if (!p) {
    p = deriveUnifiedAccount(loadMnemonic(name), 0);
    unifiedCache.set(name, p);
  }
  return p;
}

/** Native-lane fee used by every workshop script: hybrid txs are large. */
export const NATIVE_FEE = {
  amount: [{ denom: "uqor", amount: "100000" }],
  gas: "800000",
} as const;

async function accountSequence(address: string): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const res = await fetch(`${NETWORK.rest}/cosmos/auth/v1beta1/accounts/${address}`);
  if (!res.ok) throw new Error(`account query failed: HTTP ${res.status} for ${address}`);
  const body = (await res.json()) as { account?: Record<string, unknown> };
  const acc = (body.account?.base_account ?? body.account ?? {}) as Record<string, string>;
  return { accountNumber: BigInt(acc.account_number ?? "0"), sequence: BigInt(acc.sequence ?? "0") };
}

/** Broadcast native-lane messages, hybrid-signed (secp256k1 + ML-DSA-87). */
export async function broadcastNative(
  name: AccountName,
  messages: Parameters<EthNativeSigner["sign"]>[0]["messages"],
  mode: "hybrid" | "classical" = "hybrid",
): Promise<string> {
  const acc = await getUnified(name);
  const { accountNumber, sequence } = await accountSequence(acc.cosmos);
  const signer = new EthNativeSigner(acc, { signMode: mode, rest: NETWORK.rest });
  const transport = await StargateClient.connect(NETWORK.rpcCosmos);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: NETWORK.chainIdCosmos,
      accountNumber,
      sequence,
      fee: { amount: [...NATIVE_FEE.amount], gas: NATIVE_FEE.gas },
      messages,
    });
    if (res.code !== 0) {
      throw new Error(`native tx failed (code ${res.code}): ${res.rawLog ?? ""}`);
    }
    return res.transactionHash;
  } finally {
    transport.disconnect();
  }
}

export interface WindowInfo {
  found: boolean;
  live: boolean;
  remainingBlocks: bigint;
  remainingTxs: bigint;
  remainingValue: bigint;
}

export async function windowStatus(name: AccountName): Promise<WindowInfo> {
  const acc = await getUnified(name);
  const w = await evmWindowStatus({ rest: NETWORK.rest, address: acc.cosmos });
  return {
    found: w.found,
    live: w.live,
    remainingBlocks: BigInt(w.remainingBlocks ?? 0),
    remainingTxs: BigInt(w.remainingTxs ?? 0),
    remainingValue: BigInt(w.remainingValue ?? 0),
  };
}

export async function pqcRegistered(name: AccountName): Promise<boolean> {
  const acc = await getUnified(name);
  const st = await fetchPqcStatus({ rest: NETWORK.rest, address: acc.cosmos });
  return Boolean(st.registered);
}

/**
 * Open (or top up) an EVM authorisation window for the account.
 * Sizing follows the workshop formula: each admitted tx may reserve
 * gas-limit x fee-cap; we size for 3,000,000 gas at a 250 gwei cap and add
 * `extraValueUqor` headroom for value-carrying transactions (deploys).
 */
export async function openWindow(
  name: AccountName,
  opts: { blocks?: bigint; maxTxs?: bigint; extraValueUqor?: bigint; gasPerTx?: bigint } = {},
): Promise<string> {
  const acc = await getUnified(name);
  const blocks = opts.blocks ?? 3000n;
  const maxTxs = opts.maxTxs ?? 30n;
  const perTx = evmWindowCost({ gas: opts.gasPerTx ?? 3_000_000n, maxFeePerGas: 250_000_000_000n });
  const maxValue = perTx * maxTxs + (opts.extraValueUqor ?? 0n);
  const msg = openEvmWindowMsg({ sender: acc.cosmos, blocks, maxTxs, maxValue });
  const hash = await broadcastNative(name, [msg], "hybrid");
  return hash;
}

// ---------------------------------------------------------------------------
// EVM lane (viem)
// ---------------------------------------------------------------------------

export const evmChain = {
  id: NETWORK.chainIdEvm,
  name: "QoreChain Diana Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [NETWORK.rpcEvm] } },
} as const;

/** Fee settings that stay inside the window reservation (see header). */
export const EVM_TX = {
  maxFeePerGas: 250_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
} as const;

export function publicClient() {
  return createPublicClient({ chain: evmChain, transport: http(NETWORK.rpcEvm, { retryCount: 3 }) });
}

export async function walletClient(name: AccountName) {
  const acc = await getUnified(name);
  const account = privateKeyToAccount(acc.privateKey as Hex);
  return createWalletClient({ account, chain: evmChain, transport: http(NETWORK.rpcEvm, { retryCount: 3 }) });
}

export async function evmAddress(name: AccountName): Promise<Address> {
  const acc = await getUnified(name);
  return acc.evm as Address;
}

/** Retry a flaky public-RPC call a few times (the endpoint drops ~1 in N). */
export async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error(`${label} failed after ${tries} tries: ${last instanceof Error ? last.message : String(last)}`);
}

// ---------------------------------------------------------------------------
// Evidence recording
// ---------------------------------------------------------------------------

export interface Evidence {
  network: string;
  chainIdEvm: number;
  vault?: string;
  agent?: string;
  safe?: string;
  owner?: string;
  steps: Record<string, unknown>[];
  decisions: Record<string, unknown>[];
  attacks: Record<string, unknown>[];
  [k: string]: unknown;
}

export function loadEvidence(): Evidence {
  if (existsSync(EVIDENCE_PATH)) {
    return JSON.parse(readFileSync(EVIDENCE_PATH, "utf8")) as Evidence;
  }
  return {
    network: NETWORK.chainIdCosmos,
    chainIdEvm: NETWORK.chainIdEvm,
    steps: [],
    decisions: [],
    attacks: [],
  };
}

export function saveEvidence(ev: Evidence): void {
  writeFileSync(EVIDENCE_PATH, JSON.stringify(ev, null, 2) + "\n");
}

export function explorerTx(hash: string): string {
  return `${NETWORK.explorer}/tx/${hash}`;
}
