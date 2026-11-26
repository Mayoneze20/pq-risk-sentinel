/**
 * deploy.ts — deploy PqGuardianVault to qorechain-diana and record evidence.
 *
 *   - broadcaster: the deployer EVM account, inside its live window;
 *   - constructor: agent = agent account, safeAddress = deployer (the human
 *     owner's address is where exited funds land);
 *   - funds the vault with 10 QOR;
 *   - then tunes the guardrails for the live demo (cooldown 300 s -> 30 s)
 *     through the owner setter — itself part of the recorded evidence.
 *
 * Usage: tsx scripts/deploy.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEther, type Address, type Hex } from "viem";
import {
  EVM_TX,
  ROOT,
  evmAddress,
  explorerTx,
  loadEvidence,
  publicClient,
  saveEvidence,
  walletClient,
  withRetry,
} from "./lib.js";

async function main(): Promise<void> {
  const artifact = JSON.parse(
    readFileSync(join(ROOT, "out", "PqGuardianVault.sol", "PqGuardianVault.json"), "utf8"),
  ) as { abi: unknown[]; bytecode: { object: Hex } };

  const agent = await evmAddress("agent");
  const deployer = await evmAddress("deployer");
  const wallet = await walletClient("deployer");
  const pub = publicClient();

  console.log(`deploying PqGuardianVault (agent=${agent}, safe=${deployer}, fund=10 QOR)…`);
  const deployHash = await withRetry("deploy", () =>
    wallet.deployContract({
      abi: artifact.abi as never,
      bytecode: artifact.bytecode.object,
      args: [agent, deployer],
      value: parseEther("10"),
      gas: 3_000_000n,
      ...EVM_TX,
    }),
  );
  const receipt = await pub.waitForTransactionReceipt({ hash: deployHash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`deploy failed: ${deployHash} status=${receipt.status}`);
  }
  const vault = receipt.contractAddress as Address;
  console.log(`vault: ${vault}`);
  console.log(`deploy tx: ${deployHash} (block ${receipt.blockNumber})`);

  // Owner retune for the live demo: cooldown 300 s -> 30 s, floor/cap unchanged.
  const tuneHash = await withRetry("setGuardrails", () =>
    wallet.writeContract({
      address: vault,
      abi: artifact.abi as never,
      functionName: "setGuardrails",
      args: [60n, 30n, 5000n],
      gas: 200_000n,
      ...EVM_TX,
    }),
  );
  const tuneReceipt = await pub.waitForTransactionReceipt({ hash: tuneHash });
  if (tuneReceipt.status !== "success") throw new Error(`setGuardrails failed: ${tuneHash}`);
  console.log(`setGuardrails(60, 30, 5000) tx: ${tuneHash} (block ${tuneReceipt.blockNumber})`);

  const ev = loadEvidence();
  ev.vault = vault;
  ev.agent = agent;
  ev.safe = deployer;
  ev.owner = deployer;
  ev.steps.push(
    { kind: "deploy", label: "PqGuardianVault deployed, funded 10 QOR", tx: deployHash, block: Number(receipt.blockNumber), explorer: explorerTx(deployHash) },
    { kind: "owner", label: "setGuardrails(minConfidence=60, cooldownSeconds=30, maxExitBps=5000)", tx: tuneHash, block: Number(tuneReceipt.blockNumber), explorer: explorerTx(tuneHash) },
  );
  saveEvidence(ev);
  console.log("recorded in evidence.json");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
