// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice QoreChain PQC precompiles on qorechain-diana (chain id 9800).
///         Interface shape follows the official Build Before Q-Day workshop
///         (github.com/qorechain/build-before-qday, Apache-2.0); see README
///         credits. Verified live in Phase 0 — see docs/EVIDENCE.md.
interface IQorePQC {
    /// ML-DSA-87 (FIPS 204) verification: 2592-byte key, 4627-byte signature.
    /// NOTE the argument order (pubkey, signature, message) — the TypeScript
    /// SDK helper pqcVerify takes (pubkey, message, signature) instead.
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);

    /// The ML-DSA-87 key an account registered on chain.
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}
