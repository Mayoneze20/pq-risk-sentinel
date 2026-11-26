/**
 * decide.ts — the agent loop, one decision at a time.
 *
 *   1. The model (model/model_service.py) scores a market scenario and emits
 *      a decision JSON: action, confidence, features, featuresHash.
 *   2. This script reads the vault's current nonce, fetches the exact
 *      decisionMessage bytes from the contract, and signs them with the
 *      agent's ML-DSA-87 secret key (SDK pqcSign).
 *   3. The signed decision is relayed to executeDecision by the deployer
 *      (anyone may relay; only the signature authorises).
 *   4. The outcome (executed / ignored + reason) is decoded from the logs
 *      and recorded in evidence.json.
 *
 * Usage: tsx scripts/decide.ts <benign|pause|exit>
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pqcSign } from "@qorechain/sdk";
import {
  decodeEventLog,
  hexToBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  EVM_TX,
  ROOT,
  explorerTx,
  getUnified,
  loadEvidence,
  publicClient,
  saveEvidence,
  walletClient,
  withRetry,
} from "./lib.js";

const artifact = JSON.parse(
  readFileSync(join(ROOT, "out", "PqGuardianVault.sol", "PqGuardianVault.json"), "utf8"),
) as { abi: never };

export interface ModelDecision {
  scenario: string;
  action: string;
  actionUint: number;
  confidence: number;
  risk: number;
  features: Record<string, number>;
  featuresHash: Hex;
}

export function runModel(scenario: string): ModelDecision {
  const out = execFileSync(
    "python3",
    [join(ROOT, "model", "model_service.py"), "--decide", "--scenario", scenario],
    { encoding: "utf8" },
  );
  return JSON.parse(out) as ModelDecision;
}

export async function runDecision(scenario: string): Promise<Record<string, unknown>> {
  const ev = loadEvidence();
  if (!ev.vault) throw new Error("no vault in evidence.json — run deploy.ts first");
  const vault = ev.vault as Address;
  const pub = publicClient();
  const wallet = await walletClient("deployer");

  const decision = runModel(scenario);
  const nonce = (await withRetry("read nonce", () =>
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "nonce" }),
  )) as bigint;
  const block = await withRetry("block number", () => pub.getBlockNumber());
  const deadline = block + 200n;

  const message = (await withRetry("decisionMessage", () =>
    pub.readContract({
      address: vault,
      abi: artifact.abi,
      functionName: "decisionMessage",
      args: [decision.actionUint, BigInt(decision.confidence), decision.featuresHash, nonce, deadline],
    }),
  )) as Hex;

  const agent = await getUnified("agent");
  const signature = toHex(pqcSign(agent.pqc.secretKey, hexToBytes(message)));

  const tx = await withRetry(`executeDecision(${scenario})`, () =>
    wallet.writeContract({
      address: vault,
      abi: artifact.abi,
      functionName: "executeDecision",
      args: [decision.actionUint, BigInt(decision.confidence), decision.featuresHash, deadline, signature],
      gas: 1_500_000n,
      ...EVM_TX,
    }),
  );
  const receipt = await pub.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error(`executeDecision reverted: ${tx}`);

  let outcome = "executed";
  let moved = 0n;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: artifact.abi, data: log.data, topics: log.topics }) as unknown as {
        eventName: string;
        args: Record<string, unknown>;
      };
      if (decoded.eventName === "DecisionIgnored") outcome = `ignored: ${String(decoded.args.reason)}`;
      if (decoded.eventName === "ExitedToSafe") moved = decoded.args.amount as bigint;
    } catch {
      /* not a vault event */
    }
  }

  const record: Record<string, unknown> = {
    scenario,
    action: decision.action,
    actionUint: decision.actionUint,
    confidence: decision.confidence,
    risk: decision.risk,
    features: decision.features,
    featuresHash: decision.featuresHash,
    nonce: Number(nonce),
    deadlineBlock: Number(deadline),
    signature,
    tx,
    block: Number(receipt.blockNumber),
    outcome,
    movedQor: moved ? Number(moved) / 1e18 : 0,
    explorer: explorerTx(tx),
  };
  ev.decisions.push(record);
  saveEvidence(ev);
  console.log(
    `[${scenario}] ${decision.action} conf=${decision.confidence} risk=${decision.risk} -> ${outcome}` +
      (moved ? ` (moved ${record.movedQor} QOR)` : "") +
      `\n  tx: ${tx}`,
  );
  return record;
}

async function main(): Promise<void> {
  const scenario = process.argv[2] ?? "benign";
  await runDecision(scenario);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
