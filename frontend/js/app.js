/**
 * app.js - screens and wallet handling.
 *
 * Reads (verify page, token balances) go through a plain JSON-RPC provider, so
 * they work without a wallet and cost no gas. Writes (register, distribute)
 * use contract objects connected to the user's wallet signer, so the wallet
 * pops up and the user approves each transaction themselves.
 */
(function () {
  "use strict";

  const { ethers, ALU, ALU_DEPLOYMENT: D } = window;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- state
  // Read-only connection: used by everyone, with or without a wallet.
  const readProvider = new ethers.JsonRpcProvider(D.network.rpcUrl, D.network.chainId, { staticNetwork: true });
  const registryRead = new ethers.Contract(D.registryAddress, D.registryAbi, readProvider);
  const tokenRead = new ethers.Contract(D.tokenAddress, D.tokenAbi, readProvider);

  // Wallet connection (null until the user clicks Connect Wallet).
  const wallet = { account: null, signer: null, registry: null, token: null, onRightNetwork: false };

  // ------------------------------------------------------------- helpers
  /** Build a DOM element safely (text goes in as text, never as HTML). */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) node.append(c);
    return node;
  }

  /** Show a status panel (green / red / grey) inside `target`. */
  function showResult(target, kind, icon, title, message, details) {
    target.className = "result " + (target.classList.contains("small") ? "small " : "") + kind;
    target.hidden = false;
    const body = el("div", {}, el("h3", { text: title }));
    if (message) body.append(el("p", { text: message }));
    if (details) {
      const dl = el("dl");
      for (const [k, v] of details) dl.append(el("dt", { text: k }), el("dd", { text: v }));
      body.append(dl);
    }
    target.replaceChildren(el("div", { class: "icon", "aria-hidden": "true", text: icon }), body);
  }

  function setBanner(message, kind, actionLabel, action) {
    const b = $("banner");
    if (!message) { b.hidden = true; return; }
    b.className = "banner" + (kind ? " " + kind : "");
    b.hidden = false;
    b.replaceChildren(el("span", { text: message }));
    if (actionLabel) {
      const btn = el("button", { class: "btn btn-dark", type: "button", text: actionLabel });
      btn.addEventListener("click", action);
      b.append(btn);
    }
  }

  const fmtDate = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // -------------------------------------------------------------- routing
  const routes = ["verify", "register", "dashboard"];
  function currentRoute() {
    const r = location.hash.replace("#/", "");
    return routes.includes(r) ? r : "verify";
  }
  function renderRoute() {
    const route = currentRoute();
    routes.forEach((r) => {
      $("page-" + r).hidden = r !== route;
      document.querySelector(`[data-route="${r}"]`).classList.toggle("active", r === route);
    });
    if (route === "dashboard") refreshDashboard();
    if (route === "register") refreshRegisterState();
  }
  window.addEventListener("hashchange", renderRoute);

  // --------------------------------------------------------------- wallet
  async function connectWallet() {
    if (!window.ethereum) {
      setBanner(
        "No Web3 wallet found. Install MetaMask (metamask.io) or Coinbase Wallet, then refresh this page. You can still verify logos without one.",
        ""
      );
      return;
    }
    try {
      localStorage.removeItem("aluDisconnected");
      wireWalletEvents();
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      await setupWallet(accounts);
    } catch (err) {
      setBanner(ALU.friendlyError(err), "");
    }
  }

  /** Build the signer and writable contract objects for the connected account. */
  async function setupWallet(accounts) {
    if (!accounts || !accounts.length) return disconnectWallet(false);
    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    const network = await browserProvider.getNetwork();
    wallet.onRightNetwork = Number(network.chainId) === D.network.chainId;
    wallet.account = ethers.getAddress(accounts[0]);
    wallet.signer = await browserProvider.getSigner(accounts[0]);
    // Same ABIs and addresses, but connected to the signer so the wallet signs.
    wallet.registry = new ethers.Contract(D.registryAddress, D.registryAbi, wallet.signer);
    wallet.token = new ethers.Contract(D.tokenAddress, D.tokenAbi, wallet.signer);
    updateNetworkBanner();
    await refreshWalletUI();
    renderRoute();
  }

  function disconnectWallet(remember = true) {
    // A website cannot force MetaMask to disconnect; we simply forget the account.
    if (remember) localStorage.setItem("aluDisconnected", "1");
    Object.assign(wallet, { account: null, signer: null, registry: null, token: null, onRightNetwork: false });
    setBanner(null);
    refreshWalletUI();
    renderRoute();
  }

  function updateNetworkBanner() {
    if (wallet.account && !wallet.onRightNetwork) {
      setBanner(`Your wallet is on the wrong network. Please switch to ${D.network.name} (chain ${D.network.chainId}).`, "", "Switch network", switchNetwork);
    } else {
      setBanner(null);
    }
  }

  async function switchNetwork() {
    const chainIdHex = "0x" + D.network.chainId.toString(16);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (err) {
      if (err && err.code === 4902) {
        // The wallet does not know this network yet: offer to add it.
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId: chainIdHex, chainName: D.network.name, rpcUrls: [D.network.rpcUrl], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }],
          });
        } catch (e) { setBanner(ALU.friendlyError(e), ""); }
      } else {
        setBanner(ALU.friendlyError(err), "");
      }
    }
  }

  async function refreshWalletUI() {
    const connected = !!wallet.account;
    $("connectBtn").hidden = connected;
    $("walletChip").hidden = !connected;
    if (!connected) return;
    $("walletAddr").textContent = ALU.shortAddress(wallet.account);
    $("walletAddr").title = wallet.account;
    $("walletBal").textContent = "…";
    try {
      const bal = await tokenRead.balanceOf(wallet.account);
      $("walletBal").textContent = ALU.formatNumber(bal) + " ALUT";
    } catch {
      $("walletBal").textContent = "ALUT balance unavailable";
    }
  }

  let eventsWired = false;
  function wireWalletEvents() {
    if (eventsWired || !window.ethereum || !window.ethereum.on) return;
    eventsWired = true;
    // Account changed or wallet locked: rebuild (or clear) the connection.
    window.ethereum.on("accountsChanged", (accounts) => {
      if (localStorage.getItem("aluDisconnected")) return;
      accounts.length ? setupWallet(accounts) : disconnectWallet(false);
    });
    // Network changed: simplest safe approach is to re-read the chain and rebuild.
    window.ethereum.on("chainChanged", async () => {
      if (wallet.account) await setupWallet([wallet.account]);
    });
  }

  /** Reconnect silently on page load if the wallet already trusts this site. */
  async function autoConnect() {
    if (!window.ethereum || localStorage.getItem("aluDisconnected")) return;
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      if (accounts.length) await setupWallet(accounts);
    } catch { /* ignore: user can click Connect */ }
  }

  // ------------------------------------------------ shared file-pick helper
  /**
   * Wire a dropzone: preview the image, hash it in the browser, and call
   * onHash(hash, file). Nothing is uploaded anywhere.
   */
  function wireDropzone({ zone, input, preview, text, onHash }) {
    async function handle(file) {
      if (!file) return;
      if (!file.type.startsWith("image/")) { text.textContent = "Please choose an image file."; return; }
      if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
      const url = URL.createObjectURL(file);
      preview.dataset.url = url;
      preview.src = url;
      preview.hidden = false;
      text.textContent = file.name;
      try {
        onHash(await ALU.hashFile(file), file);
      } catch (err) {
        text.textContent = "Could not read that file.";
      }
    }
    input.addEventListener("change", () => handle(input.files[0]));
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag");
      handle(e.dataTransfer.files[0]);
    });
  }

  // ------------------------------------------------------------ VERIFY page
  async function runVerification(hash) {
    const out = $("verifyResult");
    out.className = "result pending";
    out.hidden = false;
    out.replaceChildren(el("p", { text: "Checking the blockchain..." }));
    try {
      const r = await ALU.verifyHash(registryRead, D.logoTokenId, hash);
      if (r.authentic) {
        showResult(out, "ok", "✓", r.title, r.message, [
          ["Registered as", r.asset.name],
          ["Registered on", fmtDate(r.asset.registeredAt)],
          ["Registered by wallet", ALU.shortAddress(r.asset.registeredBy)],
        ]);
      } else {
        showResult(out, "bad", "!", r.title, r.message);
      }
    } catch (err) {
      showResult(out, "bad", "!", "We could not check this logo", ALU.friendlyError(err));
    }
  }

  wireDropzone({
    zone: $("verifyDrop"), input: $("verifyFile"), preview: $("verifyPreview"), text: $("verifyDropText"),
    onHash: (hash) => runVerification(hash),
  });
  $("verifyHashForm").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      runVerification(ALU.toBytes32($("verifyHashInput").value));
    } catch (err) {
      showResult($("verifyResult"), "bad", "!", "That does not look like a hash", err.message);
    }
  });

  // ---------------------------------------------------------- REGISTER page
  function refreshRegisterState() {
    const notice = $("registerNotice");
    const ready = wallet.account && wallet.onRightNetwork;
    notice.hidden = !!ready;
    notice.className = "notice warn";
    notice.textContent = !wallet.account
      ? "Connect your wallet to register an asset. You can still choose a file and see its hash."
      : "Switch your wallet to the " + D.network.name + " network to register an asset.";
    $("registerBtn").disabled = !ready;
  }

  wireDropzone({
    zone: $("regDrop"), input: $("regFile"), preview: $("regPreview"), text: $("regDropText"),
    onHash: (hash, file) => {
      $("regHashShown").textContent = hash;   // B1: show the computed bytes32 hash
      $("regHash").value = hash;              // B2: pre-fill the form
      if (!$("regName").value) $("regName").value = file.name.replace(/\.[^.]+$/, "");
      if (!$("regType").value) $("regType").value = (file.type.split("/")[1] || "").toUpperCase();
      $("registerResult").hidden = true;
    },
  });

  $("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = $("registerResult");
    if (!wallet.account) return connectWallet();
    if (!$("regHash").value) return showResult(out, "bad", "!", "Choose a file first", "Select an image so we can compute its hash.");

    $("registerBtn").disabled = true;
    showResult(out, "pending", "…", "Waiting for your approval", "Confirm the transaction in your wallet.");
    try {
      const { tokenId, txHash } = await ALU.registerAsset(
        wallet.registry,
        { name: $("regName").value, fileType: $("regType").value, hash: $("regHash").value },
        { onSubmitted: () => showResult(out, "pending", "…", "Registering...", "Transaction sent. Waiting for the blockchain to confirm it.") }
      );
      showResult(out, "ok", "✓", "Asset registered! Token ID: " + tokenId.toString(),
        "Your asset is now permanently recorded and the NFT is in your wallet.", [["Transaction", ALU.shortAddress(txHash)]]);
    } catch (err) {
      showResult(out, "bad", "!", "Registration failed", ALU.friendlyError(err));
    } finally {
      refreshRegisterState();
    }
  });

  // -------------------------------------------------------- DASHBOARD page
  let dashboardRun = 0; // lets a newer refresh win if two overlap
  async function refreshDashboard() {
    const run = ++dashboardRun;
    try {
      const s = await ALU.getTokenSummary(tokenRead, wallet.account);
      if (run !== dashboardRun) return;
      $("statSupply").textContent = s.totalSupplyDisplay;
      if (wallet.account) {
        $("statBalance").textContent = ALU.formatNumber(s.balance);
        $("statBalanceNote").textContent = "ALUT in " + ALU.shortAddress(wallet.account);
        $("statPct").textContent = s.percentage + "%";
        $("statPctNote").textContent = "of all shares";
      } else {
        $("statBalance").textContent = "-";
        $("statBalanceNote").textContent = "Connect a wallet";
        $("statPct").textContent = "-";
        $("statPctNote").textContent = "Connect a wallet";
      }

      // Holders table: the owner, the example stakeholders, and the connected wallet.
      const owner = await tokenRead.owner();
      const people = [{ label: "ALU (contract owner)", address: owner }, ...D.holders];
      if (wallet.account && !people.some((p) => p.address.toLowerCase() === wallet.account.toLowerCase())) {
        people.push({ label: "Your wallet", address: wallet.account });
      }
      const rows = await ALU.getHolders(tokenRead, people.map((p) => p.address));
      if (run !== dashboardRun) return;
      $("holdersBody").replaceChildren(...rows.map((r, i) => {
        const isYou = wallet.account && r.address.toLowerCase() === wallet.account.toLowerCase();
        const who = el("td", {}, el("div", { class: "who" }, people[i].label, isYou ? el("span", { class: "you", text: "You" }) : ""),
          el("div", { class: "addr mono", text: ALU.shortAddress(r.address), title: r.address }));
        const bar = el("div", { class: "bar" }, el("i", { style: `width:${Math.min(100, r.exactPercentage)}%` }));
        return el("tr", {}, who,
          el("td", { class: "num", text: ALU.formatNumber(r.balance) }),
          el("td", { class: "num" }, el("div", { text: r.percentage + "%" }), el("div", { class: "tiny muted", text: r.exactPercentage.toFixed(2) + "%" }), bar));
      }));

      // Owner-only form.
      const isOwner = !!wallet.account && owner.toLowerCase() === wallet.account.toLowerCase();
      const canSend = isOwner && wallet.onRightNetwork;
      const notice = $("distNotice");
      notice.className = "notice" + (canSend ? "" : " warn");
      notice.textContent = canSend
        ? "You are the contract owner. You can send ALUT shares to any wallet."
        : !wallet.account ? "Connect the owner's wallet to distribute shares."
        : !isOwner ? "Only the contract owner can distribute shares. This wallet is not the owner."
        : "Switch your wallet to the " + D.network.name + " network.";
      for (const id of ["distTo", "distAmount", "distBtn"]) $(id).disabled = !canSend;
    } catch (err) {
      $("holdersBody").replaceChildren(el("tr", {}, el("td", { colspan: "3", class: "muted", text: ALU.friendlyError(err) })));
    }
  }

  $("distForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = $("distResult");
    const amount = $("distAmount").value.trim();
    $("distBtn").disabled = true;
    showResult(out, "pending", "…", "Waiting for your approval", "Confirm the transaction in your wallet.");
    try {
      await ALU.distributeShares(wallet.token, wallet.account, $("distTo").value.trim(), amount, ethers.isAddress, {
        onSubmitted: () => showResult(out, "pending", "…", "Sending...", "Transaction sent. Waiting for confirmation."),
      });
      showResult(out, "ok", "✓", "Shares sent", `${ALU.formatNumber(amount)} ALUT was sent to ${ALU.shortAddress($("distTo").value.trim())}.`);
      $("distAmount").value = "";
      await Promise.all([refreshDashboard(), refreshWalletUI()]);
    } catch (err) {
      showResult(out, "bad", "!", "Could not send shares", ALU.friendlyError(err));
      $("distBtn").disabled = false;
    }
  });

  // ----------------------------------------------------------------- boot
  $("connectBtn").addEventListener("click", connectWallet);
  $("disconnectBtn").addEventListener("click", () => disconnectWallet(true));
  $("footNet").textContent = D.network.name + " · registry " + ALU.shortAddress(D.registryAddress);

  wireWalletEvents();
  renderRoute();
  autoConnect();

  // A1/A2 sanity check: confirm we can really read both contracts, and say so
  // plainly if the chain is not running (a very common local-dev mistake).
  Promise.all([registryRead.name(), tokenRead.symbol()]).catch(() => {
    setBanner("Cannot reach the blockchain at " + D.network.rpcUrl + ". If you are testing locally, start it with: npx hardhat node, then run the deploy script.", "");
  });
})();
