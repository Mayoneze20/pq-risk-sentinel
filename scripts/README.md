# scripts/ — operator & judge tooling (build phase)

Planned, following the official workshop script shapes:

- `window.ts` — `status | register | open | recovery-code` for the
  deployer and agent accounts (from Workshop 1/2 `scripts/window.ts`).
- `deploy.ts` — deploy `PqGuardianVault` through the open window
  (Foundry script, as in Workshop 2).
- `verify.mjs` — the judges' one-command verifier: re-checks every tx in
  `docs/EVIDENCE.md` against the public REST/EVM endpoints, no keys.
