// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PqGuardianVault} from "../contracts/PqGuardianVault.sol";
import {MockPqc} from "./MockPqc.sol";

contract PqGuardianVaultTest is Test {
    address internal constant PQC_VERIFY_ADDR = 0x0000000000000000000000000000000000000a01;
    address internal constant PQC_KEYS_ADDR = 0x0000000000000000000000000000000000000a02;

    address internal agent = address(0xA6E7);
    address internal safe = address(0x5AFE);
    address internal safe2 = address(0x5AF2);
    address internal stranger = address(0xBADD);

    bytes internal agentPubkey = bytes("pq-risk-sentinel-agent-ml-dsa-87-pubkey");

    PqGuardianVault internal vault;
    bytes32 internal fh = bytes32(uint256(0xFEA7));

    function setUp() public {
        MockPqc mock = new MockPqc();
        vm.etch(PQC_VERIFY_ADDR, address(mock).code);
        vm.etch(PQC_KEYS_ADDR, address(mock).code);
        MockPqc(PQC_KEYS_ADDR).seedKey(agent, agentPubkey, true);

        vault = new PqGuardianVault{value: 10 ether}(agent, safe);
        vm.warp(1_000_000); // a realistic timestamp so cooldown maths is sane
    }

    // --- signing helper: mirrors the mock's validity construction ---------
    function sign(PqGuardianVault.Action action, uint256 confidence, uint256 nonce_, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes memory message = vault.decisionMessage(action, confidence, fh, nonce_, deadline);
        return abi.encodePacked(keccak256(abi.encodePacked(agentPubkey, message)));
    }

    function deadline() internal view returns (uint256) {
        return block.number + 100;
    }

    function exec(PqGuardianVault.Action action, uint256 confidence) internal {
        vault.executeDecision(action, confidence, fh, deadline(), sign(action, confidence, vault.nonce(), deadline()));
    }

    // --- happy paths --------------------------------------------------------

    function test_PauseExecutes() public {
        vm.expectEmit(true, false, false, true);
        emit PqGuardianVault.DecisionExecuted(0, PqGuardianVault.Action.Pause, 80, fh, 0);
        exec(PqGuardianVault.Action.Pause, 80);
        assertTrue(vault.paused());
        assertEq(vault.actionsTaken(), 1);
        assertEq(vault.nonce(), 1);
    }

    function test_HoldUnpausesAndDoesNotCountAsProtective() public {
        exec(PqGuardianVault.Action.Pause, 80);
        vm.warp(block.timestamp + 400); // past any cooldown (Hold ignores it anyway)
        exec(PqGuardianVault.Action.Hold, 90);
        assertFalse(vault.paused());
        assertEq(vault.actionsTaken(), 1, "hold must not increment actionsTaken");
    }

    function test_ExitMovesCapToSafe() public {
        uint256 safeBefore = safe.balance;
        exec(PqGuardianVault.Action.Exit, 90);
        assertEq(safe.balance - safeBefore, 5 ether, "50% cap of 10 ether");
        assertEq(address(vault).balance, 5 ether);
        assertEq(vault.totalExited(), 5 ether);
        assertEq(vault.actionsTaken(), 1);
    }

    // --- signature / registry guardrails ------------------------------------

    function test_ForgedSignatureReverts() public {
        bytes memory bad = abi.encodePacked(keccak256("not the signature"));
        vm.expectRevert(PqGuardianVault.BadPqcSignature.selector);
        vault.executeDecision(PqGuardianVault.Action.Pause, 80, fh, deadline(), bad);
    }

    function test_TamperedDecisionReverts() public {
        // Signature is over confidence=80; submitting confidence=81 changes
        // the signed message, so verification must fail.
        bytes memory sig = sign(PqGuardianVault.Action.Pause, 80, 0, deadline());
        vm.expectRevert(PqGuardianVault.BadPqcSignature.selector);
        vault.executeDecision(PqGuardianVault.Action.Pause, 81, fh, deadline(), sig);
    }

    function test_SignatureCannotBeReplayed() public {
        bytes memory sig = sign(PqGuardianVault.Action.Pause, 80, 0, deadline());
        vault.executeDecision(PqGuardianVault.Action.Pause, 80, fh, deadline(), sig);
        vm.expectRevert(PqGuardianVault.BadPqcSignature.selector);
        vault.executeDecision(PqGuardianVault.Action.Pause, 80, fh, deadline(), sig);
    }

    function test_UnregisteredAgentReverts() public {
        PqGuardianVault v2 = new PqGuardianVault(stranger, safe);
        bytes memory sig = abi.encodePacked(keccak256("anything"));
        vm.expectRevert(PqGuardianVault.AgentKeyNotRegistered.selector);
        v2.executeDecision(PqGuardianVault.Action.Pause, 80, fh, deadline(), sig);
    }

    function test_UnprovenAgentReverts() public {
        MockPqc(PQC_KEYS_ADDR).seedKey(agent, agentPubkey, false);
        bytes memory sig = sign(PqGuardianVault.Action.Pause, 80, 0, deadline());
        vm.expectRevert(PqGuardianVault.AgentKeyNotProven.selector);
        vault.executeDecision(PqGuardianVault.Action.Pause, 80, fh, deadline(), sig);
    }

    function test_ExpiredDecisionReverts() public {
        uint256 past = block.number; // deadline == current block is fine; go one under via roll
        vm.roll(block.number + 10);
        bytes memory sig = sign(PqGuardianVault.Action.Pause, 80, 0, past);
        vm.expectRevert(PqGuardianVault.DecisionExpired.selector);
        vault.executeDecision(PqGuardianVault.Action.Pause, 80, fh, past, sig);
    }

    // --- guardrail ignores (no revert, no action counted) -------------------

    function test_ConfidenceFloorIgnored() public {
        vm.expectEmit(true, false, false, true);
        emit PqGuardianVault.DecisionIgnored(0, "confidence below floor");
        exec(PqGuardianVault.Action.Pause, 59);
        assertFalse(vault.paused());
        assertEq(vault.actionsTaken(), 0);
        assertEq(vault.nonce(), 1, "nonce is consumed even for ignored decisions");
    }

    function test_CooldownIgnoresSecondProtectiveAction() public {
        exec(PqGuardianVault.Action.Pause, 80); // protective action at t
        vm.warp(block.timestamp + 100); // inside the 300 s cooldown
        vm.expectEmit(true, false, false, true);
        emit PqGuardianVault.DecisionIgnored(1, "cooldown");
        exec(PqGuardianVault.Action.Exit, 90);
        assertEq(address(vault).balance, 10 ether, "exit must not have moved funds");
        assertEq(vault.actionsTaken(), 1);
        // After the cooldown, the same kind of decision executes.
        vm.warp(block.timestamp + 250);
        exec(PqGuardianVault.Action.Exit, 90);
        assertEq(address(vault).balance, 5 ether);
        assertEq(vault.actionsTaken(), 2);
    }

    function test_CooldownAlsoAppliesToPause() public {
        exec(PqGuardianVault.Action.Exit, 90); // protective action at t
        vm.warp(block.timestamp + 60);
        exec(PqGuardianVault.Action.Pause, 80); // inside cooldown -> ignored
        assertFalse(vault.paused());
        assertEq(vault.actionsTaken(), 1);
    }

    // --- owner surface --------------------------------------------------------

    function test_SetGuardrails() public {
        vm.expectEmit(false, false, false, true);
        emit PqGuardianVault.GuardrailsUpdated(70, 120, 2500);
        vault.setGuardrails(70, 120, 2500);
        assertEq(vault.minConfidence(), 70);
        assertEq(vault.cooldownSeconds(), 120);
        assertEq(vault.maxExitBpsPerAction(), 2500);
        // New cap applies: 25% of 10 ether.
        exec(PqGuardianVault.Action.Exit, 90);
        assertEq(address(vault).balance, 7.5 ether);
    }

    function test_SetGuardrailsRejectsNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert("onlyOwner");
        vault.setGuardrails(1, 1, 1);
    }

    function test_SetSafeAddress() public {
        vault.setSafeAddress(safe2);
        assertEq(vault.safeAddress(), safe2);
        exec(PqGuardianVault.Action.Exit, 90);
        assertEq(safe2.balance, 5 ether);
    }

    function test_TransferOwnership() public {
        vault.transferOwnership(stranger);
        assertEq(vault.owner(), stranger);
        vm.expectRevert("onlyOwner");
        vault.setPaused(true); // old owner lost the right
        vm.prank(stranger);
        vault.setPaused(true); // new owner has it
        assertTrue(vault.paused());
    }

    function test_WithdrawBlockedWhilePaused() public {
        vault.setPaused(true);
        vm.expectRevert("paused");
        vault.withdraw(1 ether, payable(safe));
        vault.setPaused(false);
        uint256 before = safe.balance;
        vault.withdraw(1 ether, payable(safe));
        assertEq(safe.balance - before, 1 ether);
    }

    function test_EmergencyWithdrawWorksWhilePaused() public {
        vault.setPaused(true);
        uint256 before = safe.balance;
        vault.emergencyWithdraw(payable(safe));
        assertEq(safe.balance - before, 10 ether);
        assertEq(address(vault).balance, 0);
    }

    function test_OwnerFunctionsRejectStrangers() public {
        vm.startPrank(stranger);
        vm.expectRevert("onlyOwner");
        vault.setPaused(true);
        vm.expectRevert("onlyOwner");
        vault.withdraw(1 ether, payable(stranger));
        vm.expectRevert("onlyOwner");
        vault.emergencyWithdraw(payable(stranger));
        vm.expectRevert("onlyOwner");
        vault.setSafeAddress(stranger);
        vm.expectRevert("onlyOwner");
        vault.transferOwnership(stranger);
        vm.stopPrank();
    }
}
