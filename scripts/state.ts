/**
 * state.ts — print the vault's current on-chain state; with --record, also
 * store it as finalState in evidence.json.
 *
 * Usage: tsx scripts/state.ts [--record]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther, type Address } from "viem";
import { ROOT, loadEvidence, publicClient, saveEvidence } from "./lib.js";

const artifact = JSON.parse(
  readFileSync(join(ROOT, "out", "PqGuardianVault.sol", "PqGuardianVault.json"), "utf8"),
) as { abi: never };

async function main(): Promise<void> {
  const ev = loadEvidence();
  if (!ev.vault) throw new Error("no vault in evidence.json");
  const vault = ev.vault as Address;
  const pub = publicClient();
  const [paused, nonce, actionsTaken, totalExited, balance, minConf, cooldown, capBps] = await Promise.all([
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "paused" }),
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "nonce" }),
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "actionsTaken" }),
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "totalExited" }),
    pub.getBalance({ address: vault }),
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "minConfidence" }),
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "cooldownSeconds" }),
    pub.readContract({ address: vault, abi: artifact.abi, functionName: "maxExitBpsPerAction" }),
  ]);
  const state = {
    paused: paused as boolean,
    nonce: Number(nonce as bigint),
    actionsTaken: Number(actionsTaken as bigint),
    totalExitedQor: Number(formatEther(totalExited as bigint)),
    vaultBalanceQor: Number(formatEther(balance)),
    guardrails: {
      minConfidence: Number(minConf as bigint),
      cooldownSeconds: Number(cooldown as bigint),
      maxExitBpsPerAction: Number(capBps as bigint),
    },
  };
  console.log(JSON.stringify(state, null, 2));
  if (process.argv.includes("--record")) {
    ev.finalState = state;
    saveEvidence(ev);
    console.log("recorded as finalState in evidence.json");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
