# test/ — test suites (build phase)

- Foundry tests for `PqGuardianVault`, with stand-in contracts etched at
  the PQC precompile addresses (0x0a01 / 0x0a02) exactly as the official
  QDayVault suite does: good signature executes, forged signature is
  refused, a signature works once, unproven key is refused, guardrails
  (confidence floor / cooldown / exit cap) hold.
- Model self-test: `python3 ../model/model_service.py --selftest`.
