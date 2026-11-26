# AI usage disclosure

This project was built **with an AI coding agent** (Chloe, a Muse-based
agent operated by Tajima), openly and by design — the fest's Best AI-Native
award is a target, not a risk.

## How the work is divided

- **The human (Tajima)** chose the track and concept, approved the design,
  owns all accounts and registrations, and reviews milestone evidence.
- **The AI agent** wrote the contract, model service, agent loop, tests and
  documentation; ran the testnet deployments from throwaway testnet
  accounts; and kept the evidence log.
- **In the product itself**, an AI model (a transparent, documented
  heuristic scorer — not an LLM) makes the risk decisions. Its weights and
  features are published in `model/model_service.py`; the chain, not the
  model, enforces the guardrails.

## Workflow actually used

- The vault is a port of the same team's Reactive "AI Risk Sentinel"
  (Solidity, built 2026-11-24 for the Reactive Omni Buildathon); the port —
  guardrail parity fixes, the PQC precompile integration, the test suite —
  was written for this fest.
- Account flows (PQC key registration, EVM authorisation windows, hybrid
  signing) follow the official Build Before Q-Day workshops (Apache-2.0),
  driven through `@qorechain/sdk` 0.14.
- Every deployment, decision and attack in `docs/EVIDENCE.md` was executed
  by the agent loop and scripts in this repository, and can be re-checked
  with `npm run verify` — no trust in this disclosure required.

## Verification

Nothing in this repo asks to be trusted: every claim links to a testnet
transaction in `docs/EVIDENCE.md`, and `npm run verify` re-checks them with
no keys and one command.
