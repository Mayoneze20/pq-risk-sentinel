/**
 * attack.ts — the break-glass demo.
 *
 * The attacker holds ONLY the agent's classical secp256k1 private key — the
 * very key published in docs/BREAK_GLASS.md. No ML-DSA-87 material is loaded
 * by this script. Every attack is sent as a real transaction from the
 * agent's own EVM account (inside its scoped window), so each failure is
 * preserved on-chain:
 *
 *   1. A decision carrying a *valid classical ECDSA signature* over the exact
 *      decisionMessage bytes -> reverts (BadPqcSignature): the vault wants
 *      ML-DSA-87, and a classical signature is not one.
 *   2. A decision carrying a garbage 4627-byte blob as the "ML-DSA"
 *      signature -> reverts (BadPqcSignature).
 *   3. emergencyWithdraw from the agent account -> reverts (onlyOwner).
 *   4. setPaused from the agent account -> reverts (onlyOwner).
 *
 * Afterwards the legitimate agent runs one real signed decision to show it
 * is completely unaffected.
 *
 * Usage: AGENT_CLASSICAL_KEY=0x… tsx scripts/attack.ts
 *        (without the env var, the operator's local key file is used to
 *        fetch the same key — the script itself never touches PQC material)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createWalletClient,
  http,
  serializeSignature,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import {
  EVM_TX,
  NETWORK,
  ROOT,
  evmChain,
  explorerTx,
  getUnified,
  loadEvidence,
  publicClient,
  saveEvidence,
  withRetry,
} from "./lib.js";
import { runDecision } from "./decide.js";

const artifact = JSON.parse(
  readFileSync(join(ROOT, "out", "PqGuardianVault.sol", "PqGuardianVault.json"), "utf8"),
) as { abi: never };

async function main(): Promise<void> {
  const ev = loadEvidence();
  if (!ev.vault) throw new Error("no vault in evidence.json — run deploy.ts first");
  const vault = ev.vault as Address;
  const pub = publicClient();

  const classicalKey = (process.env.AGENT_CLASSICAL_KEY ??
    (await getUnified("agent")).privateKey) as Hex;
  const attackerAccount = privateKeyToAccount(classicalKey);
  const attacker = createWalletClient({
    account: attackerAccount,
    chain: evmChain,
    transport: http(NETWORK.rpcEvm, { retryCount: 3 }),
  });
  console.log(`attacker controls (classical key only): ${attackerAccount.address}`);

  const fh = "0xab0c987326731b71635645b66004721595a3f3ebac7de31824151ace30bc1803" as Hex; // exit-scenario features
  const nonce = (await pub.readContract({ address: vault, abi: artifact.abi, functionName: "nonce" })) as bigint;
  const block = await pub.getBlockNumber();
  const deadline = block + 200n;
  const message = (await pub.readContract({
    address: vault,
    abi: artifact.abi,
    functionName: "decisionMessage",
    args: [2, 100n, fh, nonce, deadline],
  })) as Hex;

  const attacks: Record<string, unknown>[] = [];
  async function attempt(label: string, send: () => Promise<Hex>): Promise<void> {
    const tx = await withRetry(label, send);
    const receipt = await pub.waitForTransactionReceipt({ hash: tx });
    const status = receipt.status === "success" ? "SUCCESS (unexpected!)" : "reverted (blocked)";
    console.log(`${label}\n  tx: ${tx} -> ${status}`);
    attacks.push({ label, tx, status: receipt.status, explorer: explorerTx(tx) });
  }

  // 1. Valid classical ECDSA signature over the real decision message.
  const ecdsaSig = serializeSignature(await sign({ hash: message, privateKey: classicalKey }));
  await attempt("executeDecision with a classical ECDSA signature over the decision message", () =>
    attacker.writeContract({
      address: vault,
      abi: artifact.abi,
      functionName: "executeDecision",
      args: [2, 100n, fh, deadline, ecdsaSig],
      gas: 1_200_000n,
      ...EVM_TX,
    }),
  );

  // 2. Garbage blob of the right length in place of an ML-DSA signature.
  const garbage = toHex(new Uint8Array(4627).fill(7));
  await attempt("executeDecision with a garbage 4627-byte signature blob", () =>
    attacker.writeContract({
      address: vault,
      abi: artifact.abi,
      functionName: "executeDecision",
      args: [2, 100n, fh, deadline, garbage],
      gas: 1_200_000n,
      ...EVM_TX,
    }),
  );

  // 3 + 4. Owner-only surfaces from the agent account.
  await attempt("emergencyWithdraw from the agent account", () =>
    attacker.writeContract({
      address: vault,
      abi: artifact.abi,
      functionName: "emergencyWithdraw",
      args: [attackerAccount.address],
      gas: 200_000n,
      ...EVM_TX,
    }),
  );
  await attempt("setPaused(true) from the agent account", () =>
    attacker.writeContract({
      address: vault,
      abi: artifact.abi,
      functionName: "setPaused",
      args: [true],
      gas: 200_000n,
      ...EVM_TX,
    }),
  );

  ev.attacks.push(...attacks);
  saveEvidence(ev);

  const blocked = attacks.every((a) => a.status === "reverted");
  console.log(blocked ? "\nAll attacks blocked. The legitimate agent now decides as usual:" : "\nWARNING: an attack did not revert!");
  await runDecision("benign");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
