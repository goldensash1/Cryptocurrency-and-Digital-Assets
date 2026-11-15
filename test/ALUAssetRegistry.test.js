const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
// The real frontend logic (frontend/js/alu.js) is imported so these tests exercise
// exactly the code the browser runs.
const ALU = require("../frontend/js/alu.js");

const LOGO_HASH =
  "0x" + crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "..", "alu-logo.png"))).digest("hex");
const FAKE_HASH = "0x" + "ab".repeat(32);

describe("ALU Logo system", function () {
  let registry, token, owner, alice;

  beforeEach(async function () {
    [owner, alice] = await ethers.getSigners();
    registry = await ethers.deployContract("ALUAssetRegistry");
    token = await ethers.deployContract("ALULogoToken", [owner.address]);
  });

  describe("ALUAssetRegistry (ERC-721)", function () {
    it("registers the ALU logo and returns a token ID", async function () {
      const id = await registry.registerAsset.staticCall("ALU Official Logo", "image/png", LOGO_HASH);
      expect(id).to.equal(1n);
      await expect(registry.registerAsset("ALU Official Logo", "image/png", LOGO_HASH))
        .to.emit(registry, "AssetRegistered")
        .withArgs(1n, owner.address, LOGO_HASH, "ALU Official Logo");
      expect(await registry.ownerOf(1n)).to.equal(owner.address);
    });

    it("rejects registering the same hash twice", async function () {
      await registry.registerAsset("ALU Official Logo", "image/png", LOGO_HASH);
      await expect(
        registry.connect(alice).registerAsset("Copy", "image/png", LOGO_HASH)
      ).to.be.revertedWith("Asset already registered: duplicate content hash");
    });

    it("verifyLogoIntegrity returns true for the correct hash", async function () {
      await registry.registerAsset("ALU Official Logo", "image/png", LOGO_HASH);
      const [ok, msg] = await registry.verifyLogoIntegrity(1, LOGO_HASH);
      expect(ok).to.equal(true);
      expect(msg).to.equal("Logo is authentic.");
    });

    it("verifyLogoIntegrity returns false for an incorrect hash", async function () {
      await registry.registerAsset("ALU Official Logo", "image/png", LOGO_HASH);
      const [ok, msg] = await registry.verifyLogoIntegrity(1, FAKE_HASH);
      expect(ok).to.equal(false);
      expect(msg).to.equal("Warning: logo does not match.");
    });

    it("getAsset returns the correct name and file type", async function () {
      await registry.registerAsset("ALU Official Logo", "image/png", LOGO_HASH);
      const asset = await registry.getAsset(1);
      expect(asset.name).to.equal("ALU Official Logo");
      expect(asset.fileType).to.equal("image/png");
      expect(asset.contentHash).to.equal(LOGO_HASH);
      expect(asset.registeredBy).to.equal(owner.address);
      expect(asset.registeredAt).to.be.gt(0n);
    });
  });

  describe("ALULogoToken (ERC-20)", function () {
    it("mints the full 1,000,000 ALUT supply to the logo owner", async function () {
      expect(await token.name()).to.equal("ALU Logo Token");
      expect(await token.symbol()).to.equal("ALUT");
      expect(await token.totalSupply()).to.equal(1_000_000n);
      expect(await token.balanceOf(owner.address)).to.equal(1_000_000n);
    });

    it("distributeShares transfers tokens to a recipient (owner only)", async function () {
      await token.distributeShares(alice.address, 100_000n);
      expect(await token.balanceOf(alice.address)).to.equal(100_000n);
      expect(await token.balanceOf(owner.address)).to.equal(900_000n);
      await expect(token.distributeShares(alice.address, 0n)).to.be.revertedWith(
        "Amount must be greater than zero"
      );
      await expect(token.connect(alice).distributeShares(alice.address, 1n))
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("ownershipPercentage returns the correct percentage", async function () {
      await token.distributeShares(alice.address, 500_000n);
      expect(await token.ownershipPercentage(alice.address)).to.equal(50n);
      expect(await token.ownershipPercentage(owner.address)).to.equal(50n);
    });
  });
  // ---------------------------------------------------------------------
  // Frontend integration tests: they call the same functions that the dApp
  // screens call (frontend/js/alu.js) against freshly deployed contracts.
  // ---------------------------------------------------------------------
  describe("Frontend integration (frontend/js/alu.js)", function () {
    it("reads the total ALUT supply from the contract and displays 1,000,000", async function () {
      const summary = await ALU.getTokenSummary(token, owner.address);
      expect(summary.totalSupplyDisplay).to.equal("1,000,000");
      expect(summary.balance).to.equal("1000000");
      expect(summary.percentage).to.equal("100");
    });

    it("hashing a file returns the correct SHA-256 in bytes32 format", async function () {
      const bytes = fs.readFileSync(path.join(__dirname, "..", "alu-logo.png"));
      const file = new File([bytes], "alu-logo.png", { type: "image/png" });
      const hash = await ALU.hashFile(file);
      expect(hash).to.match(ALU.BYTES32_RE);       // 0x + 64 lowercase hex chars
      expect(hash).to.equal(LOGO_HASH);            // matches Node's independent SHA-256
      expect(ethers.dataLength(hash)).to.equal(32); // really a bytes32
    });

    it("shows a verification success result for the correct ALU logo hash", async function () {
      await registry.registerAsset("ALU Official Logo", "image/png", LOGO_HASH);
      const result = await ALU.verifyHash(registry, 1, LOGO_HASH);
      expect(result.authentic).to.equal(true);
      expect(result.title).to.equal("Logo Verified: This is the authentic ALU logo");
      expect(result.asset.name).to.equal("ALU Official Logo");
      expect(result.asset.registeredBy).to.equal(owner.address);
    });

    it("shows a verification failure result for an incorrect hash", async function () {
      await registry.registerAsset("ALU Official Logo", "image/png", LOGO_HASH);
      const result = await ALU.verifyHash(registry, 1, FAKE_HASH);
      expect(result.authentic).to.equal(false);
      expect(result.title).to.equal("Warning: This logo has been modified");
      expect(result.asset).to.equal(null);
    });

    it("distributeShares updates the recipient's balance after a successful transfer", async function () {
      expect(await token.balanceOf(alice.address)).to.equal(0n);
      await ALU.distributeShares(token, owner.address, alice.address, "25000", ethers.isAddress);
      expect(await token.balanceOf(alice.address)).to.equal(25000n);
      expect(await token.balanceOf(owner.address)).to.equal(975000n);
      // the dashboard summary for the recipient reflects the new balance
      const summary = await ALU.getTokenSummary(token, alice.address);
      expect(summary.balance).to.equal("25000");
      // a non-owner is stopped with a readable message before anything is sent
      await expect(
        ALU.distributeShares(token.connect(alice), alice.address, alice.address, "1", ethers.isAddress)
      ).to.be.rejectedWith("Only the contract owner can distribute ALUT tokens.");
    });
  });
});
