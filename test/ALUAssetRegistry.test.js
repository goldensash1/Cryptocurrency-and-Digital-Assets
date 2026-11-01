const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
});
