// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IQorePQC} from "./IQorePQC.sol";

/// @title PqGuardianVault — PQ Risk Sentinel
/// @notice A testnet vault guarded by an AI risk agent whose decisions are
///         worthless unless they carry the agent's ML-DSA-87 signature,
///         verified in-contract by the QoreChain PQC precompiles.
///
///         Port of the Reactive "AI Risk Sentinel" GuardianVault guardrails
///         (confidence floor, cooldown, per-action exit cap, staleness) with
///         the ECDSA-oracle trust replaced by post-quantum signatures:
///
///           - The agent watches a testnet market and scores manipulation
///             patterns off chain (see model/model_service.py).
///           - A decision (hold / pause / exit + confidence + features hash)
///             is signed with the agent's ML-DSA-87 key. Anyone may relay it;
///             only the signature authorises it.
///           - The agent's registered key is read from the chain registry
///             (precompile 0x0a02) on every execution, so an on-chain key
///             rotation is picked up automatically.
///
///         Guardrail semantics (mirroring the Reactive reference):
///           - A decision below the confidence floor is ignored
///             (DecisionIgnored), never reverted.
///           - Protective actions (Pause, Exit) share one cooldown; a
///             decision arriving inside the cooldown is ignored
///             (DecisionIgnored), never reverted.
///           - actionsTaken counts executed protective actions only.
///
///         Break-glass property: the agent's classical secp256k1 private key
///         is PUBLISHED in the README during judging. It buys an attacker
///         nothing: this vault demands the ML-DSA-87 signature, the EVM lane
///         admits the agent's transactions only inside a hybrid-signed
///         authorisation window, and the agent's native account carries a
///         chain-enforced spending rule scoped to this vault.
contract PqGuardianVault {
    IQorePQC internal constant PQC_VERIFY = IQorePQC(0x0000000000000000000000000000000000000a01);
    IQorePQC internal constant PQC_KEYS = IQorePQC(0x0000000000000000000000000000000000000a02);

    enum Action {
        Hold,
        Pause,
        Exit
    }

    /// The QoreChain account whose registered ML-DSA-87 key signs decisions.
    address public immutable agent;
    address public owner;
    address public safeAddress;

    bool public paused;

    // Guardrails (owner-tunable) — ported from the Reactive GuardianVault.
    uint256 public minConfidence = 60; // 0..100
    uint256 public cooldownSeconds = 300;
    uint256 public maxExitBpsPerAction = 5000; // 50%
    uint256 public lastActionAt;
    uint256 public totalExited;
    uint256 public actionsTaken;

    /// Increases with every verified decision (executed or ignored), so a
    /// signature works exactly once.
    uint256 public nonce;

    event Deposited(address indexed from, uint256 amount);
    event PausedSet(bool paused, address by);
    event DecisionExecuted(uint256 indexed nonce, Action action, uint256 confidence, bytes32 featuresHash, uint256 amountMoved);
    event DecisionIgnored(uint256 indexed nonce, string reason);
    event ExitedToSafe(uint256 indexed nonce, uint256 amount);
    event GuardrailsUpdated(uint256 minConfidence, uint256 cooldownSeconds, uint256 maxExitBpsPerAction);
    event SafeAddressUpdated(address indexed safeAddress);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Withdrawn(address indexed to, uint256 amount);

    error AgentKeyNotRegistered();
    error AgentKeyNotProven();
    error BadPqcSignature();
    error DecisionExpired();
    error TransferFailed();

    modifier onlyOwner() {
        require(msg.sender == owner, "onlyOwner");
        _;
    }

    constructor(address agent_, address safeAddress_) payable {
        require(agent_ != address(0) && safeAddress_ != address(0), "zero address");
        agent = agent_;
        safeAddress = safeAddress_;
        owner = msg.sender;
        if (msg.value > 0) emit Deposited(msg.sender, msg.value);
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    /// The exact bytes the agent signs for a decision.
    function decisionMessage(Action action, uint256 confidence, bytes32 featuresHash, uint256 nonce_, uint256 deadlineBlock)
        public
        view
        returns (bytes memory)
    {
        return abi.encodePacked("PqGuardianVault:decision:v1", block.chainid, address(this), uint8(action), confidence, featuresHash, nonce_, deadlineBlock);
    }

    /// Execute a signed model decision under the guardrails. Anyone may relay.
    function executeDecision(
        Action action,
        uint256 confidence,
        bytes32 featuresHash,
        uint256 deadlineBlock,
        bytes calldata mldsaSignature
    ) external {
        if (block.number > deadlineBlock) revert DecisionExpired();

        (bool registered,, bytes memory pubkey, bool proven) = PQC_KEYS.pqcKeyStatus(agent);
        if (!registered || pubkey.length == 0) revert AgentKeyNotRegistered();
        if (!proven) revert AgentKeyNotProven();

        uint256 n = nonce;
        bytes memory message = decisionMessage(action, confidence, featuresHash, n, deadlineBlock);
        if (!PQC_VERIFY.pqcVerify(pubkey, mldsaSignature, message)) revert BadPqcSignature();
        nonce = n + 1;

        // Guardrail 1: confidence floor. Ignored, not reverted.
        if (confidence < minConfidence) {
            emit DecisionIgnored(n, "confidence below floor");
            return;
        }

        bool protective = action == Action.Pause || action == Action.Exit;

        // Guardrail 2: shared cooldown over protective actions. Ignored,
        // not reverted.
        if (protective && block.timestamp < lastActionAt + cooldownSeconds) {
            emit DecisionIgnored(n, "cooldown");
            return;
        }

        uint256 moved = 0;
        if (action == Action.Pause) {
            paused = true;
            lastActionAt = block.timestamp;
            emit PausedSet(true, msg.sender);
        } else if (action == Action.Exit) {
            // Guardrail 3: per-action exit cap. Exit stays available while
            // paused — it is the escape hatch that moves funds to safety.
            uint256 cap = (address(this).balance * maxExitBpsPerAction) / 10_000;
            moved = cap;
            lastActionAt = block.timestamp;
            totalExited += moved;
            (bool ok,) = safeAddress.call{value: moved}("");
            if (!ok) revert TransferFailed();
            emit ExitedToSafe(n, moved);
        } else {
            // Hold: the model says the risk is gone.
            if (paused) {
                paused = false;
                emit PausedSet(false, msg.sender);
            }
        }
        if (protective) actionsTaken += 1;
        emit DecisionExecuted(n, action, confidence, featuresHash, moved);
    }

    // --- Owner override (the human always has the final word) ---

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p, msg.sender);
    }

    /// Tune the guardrails. This vault's staleness model is the signed
    /// deadline block, so the tunables are the floor, the cooldown and the
    /// per-action exit cap.
    function setGuardrails(uint256 minConfidence_, uint256 cooldownSeconds_, uint256 maxExitBpsPerAction_)
        external
        onlyOwner
    {
        require(minConfidence_ <= 100, "confidence > 100");
        require(maxExitBpsPerAction_ <= 10_000, "cap > 100%");
        minConfidence = minConfidence_;
        cooldownSeconds = cooldownSeconds_;
        maxExitBpsPerAction = maxExitBpsPerAction_;
        emit GuardrailsUpdated(minConfidence_, cooldownSeconds_, maxExitBpsPerAction_);
    }

    function setSafeAddress(address safeAddress_) external onlyOwner {
        require(safeAddress_ != address(0), "zero address");
        safeAddress = safeAddress_;
        emit SafeAddressUpdated(safeAddress_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// Owner withdrawal of a chosen amount — blocked while the vault is
    /// paused (the Reactive reference's rule: a pause means hands off).
    function withdraw(uint256 amount, address payable to) external onlyOwner {
        require(!paused, "paused");
        require(to != address(0), "zero address");
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(to, amount);
    }

    /// Works even while paused — the last-resort drain to the owner.
    function emergencyWithdraw(address payable to) external onlyOwner {
        (bool ok,) = to.call{value: address(this).balance}("");
        if (!ok) revert TransferFailed();
    }
}
