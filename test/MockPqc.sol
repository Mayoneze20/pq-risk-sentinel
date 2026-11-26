// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Test stand-in for the QoreChain PQC precompiles (0x0a01 / 0x0a02).
/// Etched at both addresses in the test setup. A "valid" signature
/// is defined as the 32-byte value
/// keccak256(abi.encodePacked(pubkey, message))
/// which stands in for a real ML-DSA-87 verification: only a signer
/// who knows the construction AND the exact message can produce it,
/// and any tampering with the message invalidates it — the same
/// properties the vault's guardrail tests rely on.
contract MockPqc {
    mapping(address => bytes) internal _pubkeys;
    mapping(address => bool) internal _registered;
    mapping(address => bool) internal _proven;

    function seedKey(address account, bytes memory pubkey, bool proven_) external {
        _pubkeys[account] = pubkey;
        _registered[account] = true;
        _proven[account] = proven_;
    }

    function clearKey(address account) external {
        delete _pubkeys[account];
        delete _registered[account];
        delete _proven[account];
    }

    // --- 0x0a02 surface ---
    function pqcKeyStatus(address account) external view returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven) {
        return (_registered[account], 1, _pubkeys[account], _proven[account]);
    }

    // --- 0x0a01 surface ---
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message) external pure returns (bool valid) {
        return signature.length == 32 && bytes32(signature) == keccak256(abi.encodePacked(pubkey, message));
    }
}
