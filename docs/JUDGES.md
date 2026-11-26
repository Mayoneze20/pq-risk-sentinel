# For the judges

## The 60-second version

An AI model scores market-manipulation patterns and issues hold/pause/exit
decisions for a testnet vault. Decisions are authorised **only** by the
agent's ML-DSA-87 signature, verified in-contract by the PQC precompiles
(0x0a01/0x0a02) against the agent's on-chain registered key. The agent's
classical private key is published in `docs/BREAK_GLASS.md` — steal it, try
the attacks yourself, watch them revert.

- Vault: `0x04fcffc3f069038018c8a9719b88902d3091f7da` (qorechain-diana, EVM 9800)
- Agent: `0xa851B3AF4c9F639B5B9ba4b7c63b32be0798b346`

## Verify — one command, no keys

```bash
npm install && npm run verify
```

23 read-only checks against the live chain: contract exists; agent key
registered + possession-proven (2592-byte pubkey); every decision tx
succeeded **and its ML-DSA-87 signature re-verifies locally** over the bytes
`decisionMessage()` reconstructs; every attack tx is on-chain and reverted;
deploy/guardrail txs succeeded; live vault state matches the recorded
history (nonce 4, actionsTaken 2, totalExited 5 QOR, unpaused).

## The live story (all hashes in EVIDENCE.md)

1. **Pause** — wash-burst scenario (risk 62.5, confidence 68): vault paused.
2. **Exit** — pump scenario (risk 88.3, confidence 65), after the cooldown:
   5 QOR (the 50% cap) moved to the safe address.
3. **Hold** — benign flow (risk 12.9, confidence 69): vault unpaused.
4. **Break-glass** — 4 attack transactions from the agent's own account
   holding only its published classical key: all reverted
   (`BadPqcSignature` ×2, `onlyOwner` ×2).
5. **Agent unaffected** — a further signed Hold executed immediately after.

## Run the tests

```bash
forge test                    # 19/19: guardrails, forged/tampered/replayed
                              # signatures, expiry, cooldown ignores,
                              # cap maths, owner surface
python3 model/model_service.py --selftest   # 4/4 synthetic markets
```

## Reproduce the demo

The deployment is live; the demo scripts re-run against it (they consume
vault nonces, so the recorded evidence stays the canonical run):

```bash
npm run demo     # pause -> (cooldown) -> exit -> hold
npm run attack   # needs AGENT_CLASSICAL_KEY from docs/BREAK_GLASS.md
```

## Design choices worth noticing

- **Key read from the registry on every execution** — rotate the agent's
  on-chain PQC key and the vault follows automatically; no vault redeploy.
- **Ignored, not reverted** — sub-floor and in-cooldown decisions emit
  `DecisionIgnored` with a reason and consume their nonce: the model's
  track record is fully on chain, including its mistakes.
- **Exit works while paused** — pause freezes the owner too (`withdraw`
  reverts while paused), but the escape hatch to the safe address must
  never be frozen.
- **The model is not an LLM** — published heuristic weights, reproducible
  scores, SHA-256 feature fingerprints on chain. The "AI" that is hard to
  fake here is the signature, not the prose.
