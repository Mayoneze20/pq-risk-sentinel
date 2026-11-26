// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AIOracle} from "./AIOracle.sol";

/// @title GuardianVault — demo vault on Base Sepolia, protected by AI decisions.
/// @notice Holds testnet ETH deposits. Anyone may trigger `actOnDecision` for a
///         fresh AIOracle decision; the vault then acts under hard guardrails
///         that the model cannot override:
///           - confidence must reach `minConfidence`;
///           - protective actions are rate-limited by `cooldownSeconds`;
///           - a single Exit moves at most `maxExitBpsPerAction` of the balance
///             to the pre-set `safeAddress`;
///           - decisions older than `decisionMaxAge` are ignored.
///         The owner always has the final word: manual pause/unpause and an
///         emergency withdrawal that works even while paused.
contract GuardianVault {
    AIOracle public immutable oracle;

    address public owner;
    address public safeAddress;

    bool public paused;

    // Guardrails (owner-tunable).
    uint256 public minConfidence = 60; // 0..100
    uint256 public cooldownSeconds = 300;
    uint256 public maxExitBpsPerAction = 5000; // 50%
    uint256 public decisionMaxAge = 3600; // seconds

    uint256 public lastActionAt;
    uint256 public totalExited;
    uint256 public actionsTaken;

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event PausedSet(bool paused, address by);
    event DecisionActed(
        uint256 indexed decisionId,
        AIOracle.Action action,
        uint256 confidence,
        uint256 amountMoved
    );
    event DecisionIgnored(uint256 indexed decisionId, string reason);
    event ExitedToSafe(uint256 indexed decisionId, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "onlyOwner");
        _;
    }

    constructor(address _oracle, address _safeAddress) {
        require(_safeAddress != address(0), "zero safe address");
        oracle = AIOracle(_oracle);
        owner = msg.sender;
        safeAddress = _safeAddress;
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    function deposit() external payable {
        require(msg.value > 0, "no value");
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Owner withdrawal — blocked while paused (that is the protection
    ///         working as intended). Use emergencyWithdraw for the override.
    function withdraw(uint256 amount) external onlyOwner {
        require(!paused, "vault paused by sentinel");
        require(amount <= address(this).balance, "insufficient balance");
        (bool ok, ) = payable(owner).call{value: amount}("");
        require(ok, "transfer failed");
        emit Withdrawn(owner, amount);
    }

    /// @notice Owner override: always works, even while paused.
    function emergencyWithdraw(uint256 amount) external onlyOwner {
        require(amount <= address(this).balance, "insufficient balance");
        (bool ok, ) = payable(owner).call{value: amount}("");
        require(ok, "transfer failed");
        emit Withdrawn(owner, amount);
    }

    /// @notice Act on one oracle decision. Permissionless to call; every guard
    ///         is enforced here, in the contract, not by the caller.
    function actOnDecision(uint256 decisionId) external {
        AIOracle.Decision memory d = oracle.getDecision(decisionId);
        require(!d.executed, "decision already executed");
        require(block.timestamp <= d.timestamp + decisionMaxAge, "decision stale");

        // Consume the decision exactly once, whatever the outcome below.
        oracle.markExecuted(decisionId);

        if (d.confidence < minConfidence) {
            emit DecisionIgnored(decisionId, "confidence below threshold");
            return;
        }
        if (d.action == AIOracle.Action.Hold) {
            emit DecisionActed(decisionId, d.action, d.confidence, 0);
            return;
        }
        if (block.timestamp < lastActionAt + cooldownSeconds) {
            emit DecisionIgnored(decisionId, "cooldown");
            return;
        }

        lastActionAt = block.timestamp;
        actionsTaken++;

        if (d.action == AIOracle.Action.Pause) {
            paused = true;
            emit PausedSet(true, address(this));
            emit DecisionActed(decisionId, d.action, d.confidence, 0);
        } else {
            // Exit: move a capped share of the balance to the safe address.
            uint256 amount = (address(this).balance * maxExitBpsPerAction) / 10000;
            if (amount > 0) {
                (bool ok, ) = payable(safeAddress).call{value: amount}("");
                require(ok, "exit transfer failed");
                totalExited += amount;
                emit ExitedToSafe(decisionId, amount);
            }
            emit DecisionActed(decisionId, d.action, d.confidence, amount);
        }
    }

    // --- Owner controls ------------------------------------------------------

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused, msg.sender);
    }

    function setSafeAddress(address _safeAddress) external onlyOwner {
        require(_safeAddress != address(0), "zero address");
        safeAddress = _safeAddress;
    }

    function setGuardrails(
        uint256 _minConfidence,
        uint256 _cooldownSeconds,
        uint256 _maxExitBpsPerAction,
        uint256 _decisionMaxAge
    ) external onlyOwner {
        require(_minConfidence <= 100, "confidence > 100");
        require(_maxExitBpsPerAction <= 10000, "bps > 10000");
        minConfidence = _minConfidence;
        cooldownSeconds = _cooldownSeconds;
        maxExitBpsPerAction = _maxExitBpsPerAction;
        decisionMaxAge = _decisionMaxAge;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }
}
