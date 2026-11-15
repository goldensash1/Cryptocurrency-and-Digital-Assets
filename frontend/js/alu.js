/**
 * alu.js - the dApp's logic layer (no DOM code in here).
 *
 * Everything the interface does with the blockchain or with files lives in
 * this one file: hashing, verifying, registering, reading token balances and
 * distributing shares. app.js only draws the screens and calls these helpers.
 *
 * Keeping it free of DOM code means the exact same functions run in the
 * browser (loaded with a <script> tag, exposed as window.ALU) and inside the
 * Hardhat test file (loaded with require), which is how the five frontend
 * integration tests exercise the real frontend code.
 *
 * Contract objects (ethers.Contract instances) are passed in as arguments, so
 * nothing here cares whether they are connected to a wallet or a plain RPC.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ALU = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const BYTES32_RE = /^0x[0-9a-f]{64}$/;

  /** An error whose message is already written for the end user (shown as-is). */
  class UserError extends Error {}

  // ---------------------------------------------------------------- hashing

  /**
   * Normalise a hash string to a lowercase 0x-prefixed bytes32 value.
   * Accepts 64 hex characters with or without the 0x prefix and ignores
   * surrounding whitespace. Throws a user-readable Error otherwise.
   */
  function toBytes32(input) {
    let h = String(input || "").trim().toLowerCase();
    if (h.startsWith("0x")) h = h.slice(2);
    if (!/^[0-9a-f]{64}$/.test(h)) {
      throw new UserError("That is not a valid SHA-256 hash. It should be 64 characters (0-9 and a-f).");
    }
    return "0x" + h;
  }

  /**
   * SHA-256 of a File/Blob, computed locally with the Web Crypto API.
   * The file's bytes never leave the machine. Returns a bytes32 string
   * ("0x" + 64 hex characters) ready to pass to the smart contract.
   */
  async function hashFile(file) {
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    return "0x" + hex;
  }

  // ------------------------------------------------------------- formatting

  /** 0x1234...abcd */
  function shortAddress(address) {
    return address ? address.slice(0, 6) + "..." + address.slice(-4) : "";
  }

  /** 1000000 -> "1,000,000" */
  function formatNumber(n) {
    return Number(n).toLocaleString("en-US");
  }

  // --------------------------------------------------------- error handling

  /**
   * Turn the many shapes of wallet / RPC / revert errors into one short
   * sentence a non-technical person can act on.
   */
  function friendlyError(err) {
    if (err instanceof UserError) return err.message;
    const text = [err && err.reason, err && err.shortMessage, err && err.message, err && err.info && err.info.error && err.info.error.message]
      .filter(Boolean)
      .join(" | ");
    if (err && (err.code === "ACTION_REJECTED" || err.code === 4001 || /user rejected|user denied/i.test(text))) {
      return "You cancelled the request in your wallet. Nothing was sent.";
    }
    if (/duplicate content hash|already registered/i.test(text)) {
      return "This logo has already been registered. Each file can only be registered once.";
    }
    if (/OwnableUnauthorizedAccount/i.test(text)) {
      return "Only the contract owner can distribute ALUT tokens. Your wallet is not the owner.";
    }
    if (/ERC20InsufficientBalance|insufficient balance/i.test(text)) {
      return "The owner does not have enough ALUT tokens for that amount.";
    }
    if (/insufficient funds/i.test(text)) {
      return "Your wallet does not have enough ETH to pay the network fee.";
    }
    if (/Amount must be greater than zero/i.test(text)) return "Amount must be greater than zero.";
    if (/ERC721NonexistentToken/i.test(text)) return "No logo has been registered under that ID yet.";
    if (/could not detect network|failed to fetch|ECONNREFUSED|NETWORK_ERROR|network error/i.test(text)) {
      return "Cannot reach the blockchain. Check that the network is running and try again.";
    }
    return (err && (err.reason || err.shortMessage || err.message)) || "Something went wrong.";
  }

  // ----------------------------------------------------------- verification

  /**
   * Ask the registry whether `hash` matches the logo registered as `tokenId`.
   * This is a free read-only call (no wallet, no gas).
   *
   * @returns {{authentic: boolean, title: string, message: string, asset: object|null}}
   *   `asset` holds the registered name, date and wallet when authentic.
   */
  async function verifyHash(registry, tokenId, hash) {
    const contentHash = toBytes32(hash);
    const [authentic] = await registry.verifyLogoIntegrity(tokenId, contentHash);
    if (!authentic) {
      return {
        authentic: false,
        title: "Warning: This logo has been modified",
        message: "This file does not match the official ALU logo. Do not trust it.",
        asset: null,
      };
    }
    const a = await registry.getAsset(tokenId);
    return {
      authentic: true,
      title: "Logo Verified: This is the authentic ALU logo",
      message: "This file is an exact match for the logo ALU registered on the blockchain.",
      asset: {
        name: a.name,
        fileType: a.fileType,
        registeredBy: a.registeredBy,
        registeredAt: new Date(Number(a.registeredAt) * 1000),
      },
    };
  }

  /** Convenience: hash a file in the browser, then verify it. */
  async function verifyFile(registry, tokenId, file) {
    const hash = await hashFile(file);
    return { hash, ...(await verifyHash(registry, tokenId, hash)) };
  }

  // ----------------------------------------------------------- registration

  /**
   * Register a new asset (sends a transaction; the wallet asks the user to
   * approve it). Returns the new token ID read from the AssetRegistered event.
   *
   * @param {ethers.Contract} registry  Contract connected to a signer.
   * @param {object} callbacks          Optional { onSubmitted(txHash) }.
   */
  async function registerAsset(registry, { name, fileType, hash }, callbacks = {}) {
    if (!name || !name.trim()) throw new UserError("Please enter an asset name.");
    if (!fileType || !fileType.trim()) throw new UserError("Please enter a file type, for example PNG.");
    const contentHash = toBytes32(hash);

    // Friendly pre-check so we do not make the user pay gas for a revert.
    if (await registry.hashRegistered(contentHash)) {
      throw new UserError("This logo has already been registered. Each file can only be registered once.");
    }

    const tx = await registry.registerAsset(name.trim(), fileType.trim(), contentHash);
    if (callbacks.onSubmitted) callbacks.onSubmitted(tx.hash);
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try { return registry.interface.parseLog(log); } catch { return null; }
      })
      .find((parsed) => parsed && parsed.name === "AssetRegistered");
    if (!event) throw new Error("Transaction confirmed but no registration event was found.");
    return { tokenId: event.args.tokenId, txHash: receipt.hash };
  }

  // ------------------------------------------------------------ token reads

  /**
   * Total supply plus (optionally) the balance and ownership percentage of
   * `account`, all read from the ALULogoToken contract.
   */
  async function getTokenSummary(token, account) {
    const totalSupply = await token.totalSupply();
    const summary = {
      totalSupply: totalSupply.toString(),
      totalSupplyDisplay: formatNumber(totalSupply),
      balance: null,
      percentage: null,
    };
    if (account) {
      summary.balance = (await token.balanceOf(account)).toString();
      summary.percentage = (await token.ownershipPercentage(account)).toString();
    }
    return summary;
  }

  /** Balance and ownership % for each address (used for the holders table). */
  async function getHolders(token, addresses) {
    const supply = await token.totalSupply();
    return Promise.all(
      addresses.map(async (address) => {
        const balance = await token.balanceOf(address);
        const whole = await token.ownershipPercentage(address);
        const exact = supply === 0n ? 0 : Number((balance * 1000000n) / supply) / 10000;
        return { address, balance: balance.toString(), percentage: whole.toString(), exactPercentage: exact };
      })
    );
  }

  // ----------------------------------------------------------- distribution

  /**
   * Check a distribution request before sending it. Returns an error string,
   * or null when the request is valid.
   */
  function validateDistribution({ isOwner, recipient, amount, ownerBalance, isAddress }) {
    if (!isOwner) return "Only the contract owner can distribute ALUT tokens.";
    if (!isAddress(recipient)) return "Please enter a valid recipient wallet address.";
    let amt;
    try { amt = BigInt(amount); } catch { return "Amount must be a whole number of tokens."; }
    if (amt <= 0n) return "Amount must be greater than zero.";
    if (amt > BigInt(ownerBalance)) {
      return "Insufficient balance: the owner only holds " + formatNumber(ownerBalance) + " ALUT.";
    }
    return null;
  }

  /**
   * Validate and send ALUT tokens from the owner to `recipient`.
   * Throws Error with a readable message if validation fails; otherwise sends
   * the transaction (the wallet asks the owner to approve) and waits for it.
   *
   * @param {ethers.Contract} token  ALULogoToken connected to a signer.
   * @param {string} account         The connected wallet address.
   * @param {Function} isAddress     ethers.isAddress (injected so this file has no ethers import).
   */
  async function distributeShares(token, account, recipient, amount, isAddress, callbacks = {}) {
    const owner = await token.owner();
    const ownerBalance = await token.balanceOf(owner);
    const problem = validateDistribution({
      isOwner: owner.toLowerCase() === String(account).toLowerCase(),
      recipient,
      amount,
      ownerBalance,
      isAddress,
    });
    if (problem) throw new UserError(problem);

    const tx = await token.distributeShares(recipient, BigInt(amount));
    if (callbacks.onSubmitted) callbacks.onSubmitted(tx.hash);
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  }

  return {
    BYTES32_RE,
    UserError,
    toBytes32,
    hashFile,
    shortAddress,
    formatNumber,
    friendlyError,
    verifyHash,
    verifyFile,
    registerAsset,
    getTokenSummary,
    getHolders,
    validateDistribution,
    distributeShares,
  };
});
