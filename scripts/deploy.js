const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// SHA-256 of the real logo file, computed at deploy time.
function logoHash() {
  const file = fs.readFileSync(path.join(__dirname, "..", "alu-logo.png"));
  return "0x" + crypto.createHash("sha256").update(file).digest("hex");
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // 1. ERC-721 registry, then register the logo straight away.
  const registry = await hre.ethers.deployContract("ALUAssetRegistry");
  await registry.waitForDeployment();
  console.log("ALUAssetRegistry deployed to:", await registry.getAddress());

  const hash = logoHash();
  const tx = await registry.registerAsset("ALU Official Logo", "image/png", hash);
  await tx.wait();
  console.log("ALU logo registered as token ID 1");
  console.log("SHA-256 content hash:", hash);

  // 2. ERC-20 share token; the deployer is the logo owner and gets all 1,000,000 ALUT.
  const token = await hre.ethers.deployContract("ALULogoToken", [deployer.address]);
  await token.waitForDeployment();
  console.log("ALULogoToken deployed to:", await token.getAddress());
  console.log("Owner ALUT balance:", (await token.balanceOf(deployer.address)).toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
