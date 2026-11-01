require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { SEPOLIA_RPC_URL, SEPOLIA_PRIVATE_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    sepolia: {
      url: SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: SEPOLIA_PRIVATE_KEY ? [SEPOLIA_PRIVATE_KEY] : [],
    },
  },
};
