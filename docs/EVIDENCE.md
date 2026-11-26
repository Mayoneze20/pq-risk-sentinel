# Evidence — every claim, on chain

Network: `qorechain-diana` (testnet), EVM chain ID 9800. Explorer links need the explorer's **Testnet** view.

- Vault: `0x04fcffc3f069038018c8a9719b88902d3091f7da`
- Agent (ML-DSA-87 signer): `0xa851B3AF4c9F639B5B9ba4b7c63b32be0798b346`
- Owner / safe address: `0x041B5af8e90544ADD0C185cB0d776F2A3dc5847E`

Re-check everything with one read-only command: `npm run verify` (23 checks; see JUDGES.md).

## Setup

| Step | Tx | Block |
|---|---|---|
| PqGuardianVault deployed, funded 10 QOR | [`0x80a05e655bedce10…`](https://explore.qore.network/tx/0x80a05e655bedce105de0d69b13e6e22571ff8b65c2a541a087e45875f7f9d545) | 10724797 |
| setGuardrails(minConfidence=60, cooldownSeconds=30, maxExitBps=5000) | [`0x2a8c45c4d350db43…`](https://explore.qore.network/tx/0x2a8c45c4d350db4339a2ec8ab4dcc704bcfe9aa2272eee9b7ae2e572a44cc6ae) | 10724798 |

## Agent decisions (ML-DSA-87 signed, guardrail-enforced)

| # | Scenario → action | Risk | Conf | Outcome | Tx |
|---|---|---|---|---|---|
| 0 | pause → pause | 62.5 | 68 | executed | [`0x6d106f7e1fae3d7c…`](https://explore.qore.network/tx/0x6d106f7e1fae3d7cca1349835682b5495dd7e0ee797275ab67bffab070bdf619) |
| 1 | exit → exit | 88.33 | 65 | executed, moved 5 QOR | [`0x104d0e74e2f97e8e…`](https://explore.qore.network/tx/0x104d0e74e2f97e8e6f06d163c649e27f6b24a4d18a9706049027e907cae7ce64) |
| 2 | benign → hold | 12.92 | 69 | executed | [`0x1625027639a3bf0b…`](https://explore.qore.network/tx/0x1625027639a3bf0b5fbdcb0d9d6ec60c678df150fcc318c595d5449c27e0c790) |
| 3 | benign → hold | 12.92 | 69 | executed | [`0xc80597d933a4f2ea…`](https://explore.qore.network/tx/0xc80597d933a4f2ea302a627ebf072b3a70fabbf0af91e5a186e2d03dd91d63c0) |

Each signature re-verifies locally against the registered pubkey and the contract's own `decisionMessage()` bytes — `npm run verify` does exactly this.

## Break-glass attacks (attacker holds the agent's published classical key)

| Attack | Result | Tx |
|---|---|---|
| executeDecision with a classical ECDSA signature over the decision message | reverted | [`0x542d3373b49f1207…`](https://explore.qore.network/tx/0x542d3373b49f1207bf40ed4c76315a3296b98103bae2501cfd76e6f430d20c09) |
| executeDecision with a garbage 4627-byte signature blob | reverted | [`0x02e6686573464e7d…`](https://explore.qore.network/tx/0x02e6686573464e7dd65c81f4ad31c6164a19c539c980f607d28172bdb2268abc) |
| emergencyWithdraw from the agent account | reverted | [`0x2f2a99155eb3763e…`](https://explore.qore.network/tx/0x2f2a99155eb3763e86f1398fa4fdf40e07c3b8b04505b0feafd451a4d0cdafce) |
| setPaused(true) from the agent account | reverted | [`0xc292522a9820de79…`](https://explore.qore.network/tx/0xc292522a9820de799903901f492fb7fd30551fa425e5869cfa38a5bb695af93f) |

## Final on-chain state

- paused: **false**, nonce: **4**, actionsTaken: **2**, totalExited: **5 QOR**, vault balance: **5 QOR**
- guardrails: minConfidence 60, cooldown 30 s, exit cap 5000 bps/action

## Prior phases (workshop path proof, same accounts)

- ML-DSA-87 key registration, EVM window, QDayVault deploy, forged-signature rejection and a real agent-signed withdrawal were proven end-to-end in Phases 0/0.5 — see the project build log (LOG.md, kept outside this repo).
