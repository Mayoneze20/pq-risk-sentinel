# Break-glass: the agent's classical key, published on purpose

The PQ Risk Sentinel agent account is:

- EVM: `0xa851B3AF4c9F639B5B9ba4b7c63b32be0798b346`
- Cosmos: `qor14pgm8t6vna3ekkum5jmuvwejhcre3v6x8pzzpa`

Its **classical secp256k1 private key** is:

```
0x5cb7c357e3601c01cc13487cb471e465ccb72e8d0bd158e752c36cf0b0ce05aa
```

Yes, really. Take it. Import it, drain the account's pocket change, sign
whatever you like with it. Then try to move the vault's funds.

You will fail, and the failure is the product:

- `PqGuardianVault.executeDecision` authorises decisions **only** with the
  agent's ML-DSA-87 signature, verified in-contract by the QoreChain PQC
  precompiles against the key registered on chain. A classical ECDSA
  signature over the exact decision bytes — which this key produces
  perfectly well — is rejected with `BadPqcSignature`.
- The owner surface (`setPaused`, `withdraw`, `emergencyWithdraw`,
  guardrail setters) belongs to a different account entirely; the agent's
  classical key is not the owner key.
- On the native lane, the agent's transactions are admitted only inside a
  hybrid-signed authorisation window and under a chain-enforced spending
  rule; the classical key alone cannot even open that window.

## Reproduce it

```bash
AGENT_CLASSICAL_KEY=0x5cb7c357e3601c01cc13487cb471e465ccb72e8d0bd158e752c36cf0b0ce05aa npm run attack
```

Every attack is sent as a real transaction and reverts on chain; the hashes
are in [EVIDENCE.md](EVIDENCE.md). After the attacks, the legitimate agent —
using the ML-DSA-87 key that never leaves its signer — executes its next
decision as if nothing happened.

## Why this is safe to publish

The account is a throwaway **testnet** account holding testnet QOR with no
real-world value, created for this competition. The property being
demonstrated is the point of QoreChain's hybrid design: classical-key
compromise, the exact failure mode a quantum attacker (or an ordinary thief)
exploits, does not compromise a post-quantum-authorised vault.
