// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ALULogoToken (ALUT)
 * @notice ERC-20 tokens representing fractional ownership shares of the ALU logo.
 *         The fixed supply of 1,000,000 tokens is minted to the original owner.
 * @dev Decimals are set to 0 so one token is one indivisible share and
 *      1 token = 0.0001% ownership.
 */
contract ALULogoToken is ERC20, Ownable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000;

    /// @param logoOwner Wallet that receives all tokens and becomes contract owner.
    constructor(address logoOwner) ERC20("ALU Logo Token", "ALUT") Ownable(logoOwner) {
        _mint(logoOwner, TOTAL_SUPPLY);
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    /**
     * @notice Transfer shares from the owner to a stakeholder (owner only).
     * @param recipient Wallet receiving the shares.
     * @param amount    Number of ALUT tokens; must be greater than zero.
     */
    function distributeShares(address recipient, uint256 amount) external onlyOwner {
        require(amount > 0, "Amount must be greater than zero");
        _transfer(owner(), recipient, amount);
    }

    /// @notice Ownership of `account` as a whole-number percentage of total supply.
    function ownershipPercentage(address account) external view returns (uint256) {
        return (balanceOf(account) * 100) / totalSupply();
    }
}
