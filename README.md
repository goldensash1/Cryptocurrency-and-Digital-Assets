# ALU Logo Protection on Ethereum

This project registers the official ALU logo on a (local) Ethereum blockchain and tokenises its ownership.
`ALUAssetRegistry` (ERC-721) mints one NFT that permanently records the logo's SHA-256 fingerprint, who registered it and when, and lets anyone check whether a file is authentic. `ALULogoToken` (ERC-20, symbol ALUT) issues 1,000,000 fungible tokens that represent ownership shares of that logo; the registry proves *what* the asset is, the token divides *who owns* it.

## Logo hash (SHA-256 of `alu-logo.png`)

```
727b0a610a5e22c083efc8b467c1580cad4b2626d8a6171d686a99d6a220a560
```

Verify yourself: `shasum -a 256 alu-logo.png` (macOS/Linux) or `certutil -hashfile alu-logo.png SHA256` (Windows).

## Versions

- Solidity 0.8.28 (optimizer on, 200 runs)
- Hardhat 2.29.1 (+ @nomicfoundation/hardhat-toolbox 5.0.0)
- OpenZeppelin Contracts 5.1.0
- Node.js 24 (18+ should work)

## Instructions

```bash
npm install                                 # install dependencies
npx hardhat compile                         # compile contracts
npx hardhat test                            # run the 8 automated tests
npx hardhat node                            # terminal 1: start local blockchain (prints 20 test wallets)
npx hardhat run scripts/deploy.js --network localhost   # terminal 2: deploy + register the logo
npx hardhat run scripts/deploy.js           # or deploy to the in-process Hardhat network
```

## Project layout

- `contracts/ALUAssetRegistry.sol` – ERC-721 registry (`registerAsset`, `verifyLogoIntegrity`, `getAsset`)
- `contracts/ALULogoToken.sol` – ERC-20 shares (`distributeShares`, `ownershipPercentage`)
- `scripts/deploy.js` – deploys both, registers the logo using the hash computed from `alu-logo.png`
- `test/ALUAssetRegistry.test.js` – 8 tests (5 registry, 3 token)

## Problems encountered and fixes

- `npm install` failed with an `ERESOLVE` peer-dependency error because `hardhat-toolbox` needed a newer Hardhat 2.x than the one I first pinned (2.22). Fix: install `hardhat@^2.28`. Also, `npx hardhat` without a local install pulls Hardhat 3, which has a different config format, so always install locally.
- The first compile appeared to hang: Hardhat was downloading the 0.8.28 compiler. It completes once downloaded.
- OpenZeppelin 5 changed APIs: `Ownable` now requires an initial owner in the constructor and there is no `Counters` library, so a plain `uint256` counter is used; `_requireOwned` replaces `_exists`; access errors are custom errors (`OwnableUnauthorizedAccount`), tested with `revertedWithCustomError`.
- ALUT uses 0 decimals so "1,000,000 tokens" is exactly 1,000,000 base units and percentages are exact whole numbers.
