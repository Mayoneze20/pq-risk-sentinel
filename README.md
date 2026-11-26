# PQ Risk Sentinel

**An AI risk agent guards a vault — and only its post-quantum signature can move it.**

Built for the **PQ AI Agents** track of *Build Before Q-Day* (QoreChain
Developer Fest), on the `qorechain-diana` testnet.

- **Vault:** `0x04fcffc3f069038018c8a9719b88902d3091f7da`
- **Agent:** `0xa851B3AF4c9F639B5B9ba4b7c63b32be0798b346`
- **Verify every claim in one command:** `npm run verify` → 23 checks, all read-only
- **Full evidence:** [docs/EVIDENCE.md](docs/EVIDENCE.md)
- **Festival project page:** https://build.qorechain.io/ja/p/pq-risk-sentinel
- **Demo video (2:27):** https://youtu.be/SIWqmL1R3wo

## The idea

An off-chain AI model watches a market, scores manipulation-like patterns
(wash trading, one-way pumps, whale concentration), and issues
**hold / pause / exit** decisions for a vault. In the classical design — this
project is a port of an EVM "AI Risk Sentinel" built the day before — those
decisions are authorised by an ECDSA signature. Here, the ECDSA key is
**published in the README** (see [docs/BREAK_GLASS.md](docs/BREAK_GLASS.md))
and worthless: the vault accepts a decision only with the agent's
**ML-DSA-87** signature, verified *inside the contract* by QoreChain's PQC
precompiles against the key the agent registered on chain.

Quantum attacker with the classical key? Nothing. Ordinary thief with the
classical key? Nothing. The post-quantum half is the only half that talks to
the vault.

## How it works

```
market feed ──► model (Python) ──► decision {action, confidence, features}
                                        │  featuresHash = SHA-256(features)
                                        ▼
agent (TypeScript) ── reads vault nonce + decisionMessage() from chain
                   ── signs the message with ML-DSA-87 (SDK pqcSign)
                   ── relays executeDecision (anyone may relay)
                                        ▼
PqGuardianVault ── pqcKeyStatus(0x0a02): agent key registered + proven?
                ── pqcVerify(0x0a01): signature valid over the message?
                ── guardrails: confidence floor · shared cooldown ·
                   50%-per-action exit cap · signed deadline block
                ── executes: pause the vault / move the capped share to the
                   safe address / stand down — or ignores the decision,
                   on the record, with a reason
```

### The model

Transparent heuristics, published weights (`model/model_service.py`):
`risk = 100 × (0.30·price_impact + 0.25·volume_spike + 0.25·concentration + 0.20·roundtrip)`;
risk ≥ 75 → exit, 50–74 → pause, < 50 → hold. Confidence grows with sample
size and with the score's distance from the action boundaries — the vault's
confidence floor consumes exactly that number. No LLM, no black box: every
feature of every live decision is in [docs/EVIDENCE.md](docs/EVIDENCE.md).

### The guardrails (contract-side, owner-tunable)

| Guardrail | Behaviour |
|---|---|
| Confidence floor (60) | Below it, a verified decision is *ignored* (`DecisionIgnored`), never reverted |
| Cooldown (300 s default; 30 s in the live demo) | Shared by Pause and Exit; a decision inside it is ignored, on the record |
| Exit cap (50% / action) | An exit moves at most half the vault to the fixed safe address |
| Deadline block | Signed into every decision; expired decisions revert |
| Nonce | Every verified decision consumes one; signatures cannot replay |
| Owner override | `setPaused`, guardrail setters, `withdraw` (blocked while paused), `emergencyWithdraw` (always available) |

`actionsTaken` counts executed protective actions only.

## Live on testnet

The vault is deployed and the full story already happened on chain
([evidence](docs/EVIDENCE.md)): the model **paused** the vault on a
wash-trading pattern, **exited** 50% (5 QOR) to the safe address on a pump
pattern after the cooldown, and **stood down** on benign flow. Then the
break-glass attacks ran: four real transactions from an attacker holding the
agent's published classical key — all reverted — and the agent decided again,
unaffected. The system is left live and at rest (unpaused, 5 QOR in the
vault) for judging.

## Run it

```bash
npm install
npm run model:selftest   # model scoring core, 4 synthetic markets
forge install foundry-rs/forge-std   # once: fetch the test dependency into lib/
forge test               # vault suite (19 tests, etched PQC precompiles)
npm run verify           # judge script: re-checks all on-chain claims
npm run demo             # live: pause -> exit -> hold against the vault
npm run attack           # live: break-glass attacks with the published key
npm run state            # live: current vault state
```

Deployment and window management live in `scripts/` (`deploy.ts`,
`window.ts`, `decide.ts`). Operator keys stay **outside** this repository
(`../keys/`, testnet throwaway accounts only).

## Layout

- `contracts/PqGuardianVault.sol` — the vault; `contracts/IQorePQC.sol` — precompile interface
- `model/model_service.py` — the scoring model + demo scenarios (stdlib only)
- `scripts/` — window/deploy/agent-loop/demo/attack/verify tooling (TypeScript, `@qorechain/sdk` 0.14 + viem)
- `test/` — Foundry suite with an etched `MockPqc` stand-in
- `docs/` — [JUDGES](docs/JUDGES.md) · [EVIDENCE](docs/EVIDENCE.md) · [THREAT_MODEL](docs/THREAT_MODEL.md) · [BREAK_GLASS](docs/BREAK_GLASS.md)
- `AI_USAGE.md` — how this was built, disclosed honestly

## Credits

The vault pattern and account flow build on the official *Build Before
Q-Day* workshops (github.com/qorechain/build-before-qday, Apache-2.0). The
guardrail design is a port of the same author's Reactive "AI Risk Sentinel"
(DoraHacks Reactive Omni Buildathon, Nov 2026), with the oracle's ECDSA
trust replaced by ML-DSA-87.

License: MIT (see `LICENSE`).
