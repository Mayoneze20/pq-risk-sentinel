/**
 * derive-key.ts — show an account's addresses; with --key, also print its
 * classical secp256k1 private key to stdout (for capture into an env var,
 * the Phase 0.5 pattern). Never writes secrets to disk.
 *
 * Usage: tsx scripts/derive-key.ts <deployer|agent> [--key]
 */
import { getUnified, type AccountName } from "./lib.js";

async function main(): Promise<void> {
  const name = (process.argv[2] ?? "deployer") as AccountName;
  if (name !== "deployer" && name !== "agent") throw new Error("account must be deployer|agent");
  const acc = await getUnified(name);
  console.log(`cosmos: ${acc.cosmos}`);
  console.log(`evm:    ${acc.evm}`);
  console.log(`pqc public key: ${acc.pqc.publicKey.length} bytes`);
  if (process.argv.includes("--key")) {
    console.log(`privateKey: ${acc.privateKey}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
