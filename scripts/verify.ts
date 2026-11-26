/**
 * verify.ts — the judge script. One command, no keys, read-only.
 *
 * Re-checks every headline claim of this submission against the live chain:
 *   1. the vault contract exists at the recorded address;
 *   2. the agent's ML-DSA-87 key is registered AND possession-proven in the
 *      chain registry (precompile 0x0a02), 2592 bytes;
 *   3. every recorded decision transaction succeeded, and its ML-DSA-87
 *      signature re-verifies locally (SDK pqcVerify) over the exact bytes
 *      the contract's decisionMessage() reconstructs today;
 *   4. every break-glass attack transaction is on-chain and reverted;
 *   5. the deploy and guardrail-tuning transactions succeeded;
 *   6. the vault's live state is consistent with the recorded history
 *      (nonce, actionsTaken, totalExited, unpaused at rest).
 *
 * Usage: npm run verify        (exit code 0 = all checks pass)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pqcVerify } from "@qorechain/sdk";
import {
  formatEther,
  hexToBytes,
  type Address,
  type Hex,
} from "viem";
import { ROOT, loadEvidence, publicClient, withRetry } from "./lib.js";

const artifact = JSON.parse(
  readFileSync(join(ROOT, "out", "PqGuardianVault.sol", "PqGuardianVault.json"), "utf8"),
) as { abi: never };

const PQC_KEYS = "0x0000000000000000000000000000000000000a02" as Address;
const pqcAbi = [
  {
    type: "function",
    name: "pqcKeyStatus",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "algorithmId", type: "uint8" },
      { name: "pubkey", type: "bytes" },
      { name: "possessionProven", type: "bool" },
    ],
  },
] as const;

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  const ev = loadEvidence();
  if (!ev.vault || !ev.agent) throw new Error("evidence.json has no vault/agent — nothing to verify");
  const vault = ev.vault as Address;
  const agent = ev.agent as Address;
  const pub = publicClient();

  console.log(`Verifying PQ Risk Sentinel on qorechain-diana (chain ${ev.chainIdEvm})`);
  console.log(`vault: ${vault}\nagent: ${agent}\n`);

  // 1. Code exists.
  const code = await withRetry("getCode", () => pub.getCode({ address: vault }));
  check("vault contract is deployed", Boolean(code && code !== "0x"), `${code ? code.length / 2 - 1 : 0} bytes`);

  // 2. Agent key registered + proven.
  const status = (await withRetry("pqcKeyStatus", () =>
    pub.readContract({ address: PQC_KEYS, abi: pqcAbi, functionName: "pqcKeyStatus", args: [agent] }),
  )) as unknown as [boolean, number, Hex, boolean];
  const [registered, , pubkey, proven] = status;
  check("agent ML-DSA-87 key is registered", registered);
  check("agent key possession is proven", proven);
  check("registered pubkey is a full ML-DSA-87 key", hexToBytes(pubkey).length === 2592, "2592 bytes");

  // 3. Decisions: receipts + signature re-verification.
  let executedProtective = 0;
  let exitedWei = 0n;
  for (const d of ev.decisions) {
    const label = `decision #${d.nonce} (${d.scenario}/${d.action})`;
    const receipt = await withRetry(`receipt ${d.tx}`, () => pub.getTransactionReceipt({ hash: d.tx as Hex }));
    check(`${label} tx succeeded`, receipt.status === "success", String(d.tx));
    const message = (await withRetry(`message ${d.nonce}`, () =>
      pub.readContract({
        address: vault,
        abi: artifact.abi,
        functionName: "decisionMessage",
        args: [d.actionUint as number, BigInt(d.confidence as number), d.featuresHash as Hex, BigInt(d.nonce as number), BigInt(d.deadlineBlock as number)],
      }),
    )) as Hex;
    const ok = pqcVerify(hexToBytes(pubkey), hexToBytes(message), hexToBytes(d.signature as Hex));
    check(`${label} ML-DSA-87 signature re-verifies`, ok);
    if (d.outcome === "executed" && (d.action === "pause" || d.action === "exit")) executedProtective++;
    if (d.action === "exit" && d.outcome === "executed") exitedWei += BigInt(Math.round(Number(d.movedQor ?? 0) * 1e18));
  }

  // 4. Attacks reverted.
  for (const a of ev.attacks) {
    const receipt = await withRetry(`attack receipt ${a.tx}`, () => pub.getTransactionReceipt({ hash: a.tx as Hex }));
    check(`attack blocked: ${a.label}`, receipt.status === "reverted", String(a.tx));
  }

  // 5. Setup steps succeeded.
  for (const s of ev.steps) {
    const receipt = await withRetry(`step receipt ${s.tx}`, () => pub.getTransactionReceipt({ hash: s.tx as Hex }));
    check(`step succeeded: ${s.label}`, receipt.status === "success", String(s.tx));
    if (s.kind === "deploy") {
      check("deploy tx created the recorded vault", receipt.contractAddress?.toLowerCase() === vault.toLowerCase());
    }
  }

  // 6. Live state consistency.
  const [nonce, actionsTaken, totalExited, paused] = await Promise.all([
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "nonce" }),
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "actionsTaken" }),
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "totalExited" }),
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "paused" }),
  ]);
  check("vault nonce equals the number of recorded decisions", Number(nonce as bigint) === ev.decisions.length, `nonce=${nonce}`);
  check("actionsTaken equals executed protective decisions", Number(actionsTaken as bigint) === executedProtective, `actionsTaken=${actionsTaken}`);
  check("totalExited equals the recorded exits", (totalExited as bigint) === exitedWei, `${formatEther(totalExited as bigint)} QOR`);
  check("vault is unpaused at rest", paused === false);

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
