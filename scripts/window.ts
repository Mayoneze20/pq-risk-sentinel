/**
 * window.ts — inspect or open the EVM authorisation window of an account.
 *
 * Usage:
 *   tsx scripts/window.ts <deployer|agent> status
 *   tsx scripts/window.ts <deployer|agent> open [blocks] [maxTxs] [extraValueQor]
 */
import {
  evmAddress,
  openWindow,
  pqcRegistered,
  windowStatus,
  type AccountName,
} from "./lib.js";

async function main(): Promise<void> {
  const name = (process.argv[2] ?? "deployer") as AccountName;
  const cmd = process.argv[3] ?? "status";
  if (name !== "deployer" && name !== "agent") throw new Error("account must be deployer|agent");

  if (cmd === "status") {
    const [addr, reg, w] = await Promise.all([evmAddress(name), pqcRegistered(name), windowStatus(name)]);
    console.log(`${name}: ${addr}`);
    console.log(`  PQC key registered: ${reg}`);
    console.log(
      w.found
        ? `  window: ${w.live ? "LIVE" : "not usable"}; ${w.remainingBlocks} blocks, ${w.remainingTxs} txs, ${w.remainingValue} uqor left`
        : "  window: none",
    );
    return;
  }

  if (cmd === "open") {
    const blocks = BigInt(process.argv[4] ?? "3000");
    const maxTxs = BigInt(process.argv[5] ?? "30");
    const extraValueUqor = BigInt(Math.round(Number(process.argv[6] ?? "0") * 1_000_000));
    const gasPerTx = BigInt(process.argv[7] ?? "3000000");
    const hash = await openWindow(name, { blocks, maxTxs, extraValueUqor, gasPerTx });
    console.log(`opened: ${hash}`);
    const w = await windowStatus(name);
    console.log(`  window now: ${w.remainingBlocks} blocks, ${w.remainingTxs} txs, ${w.remainingValue} uqor`);
    return;
  }

  throw new Error(`unknown command "${cmd}" (status|open)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
