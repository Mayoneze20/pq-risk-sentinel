/**
 * demo.ts — the live demo: three model decisions against the deployed vault.
 *
 *   pause scenario -> vault pauses (protective action 1)
 *   exit  scenario -> after the cooldown, 50% of the vault moves to safe
 *   hold  scenario -> the model stands down; the vault unpauses
 *
 * Final vault state is recorded in evidence.json.
 *
 * Usage: tsx scripts/demo.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther, type Address } from "viem";
import { ROOT, loadEvidence, publicClient, saveEvidence } from "./lib.js";
import { runDecision } from "./decide.js";

const artifact = JSON.parse(
  readFileSync(join(ROOT, "out", "PqGuardianVault.sol", "PqGuardianVault.json"), "utf8"),
) as { abi: never };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const ev = loadEvidence();
  if (!ev.vault) throw new Error("no vault in evidence.json — run deploy.ts first");
  const vault = ev.vault as Address;
  const pub = publicClient();

  await runDecision("pause");
  console.log("waiting out the 30 s guardrail cooldown…");
  await sleep(40_000);
  await runDecision("exit");
  await runDecision("benign");

  const [paused, nonce, actionsTaken, totalExited, balance] = await Promise.all([
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "paused" }),
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "nonce" }),
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "actionsTaken" }),
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "totalExited" }),
    pub.getBalance({ address: vault }),
  ]);
  ev.finalState = {
    paused: paused as boolean,
    nonce: Number(nonce as bigint),
    actionsTaken: Number(actionsTaken as bigint),
    totalExitedQor: Number(formatEther(totalExited as bigint)),
    vaultBalanceQor: Number(formatEther(balance)),
  };
  saveEvidence(ev);
  console.log(`final state: ${JSON.stringify(ev.finalState)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
