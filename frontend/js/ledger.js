/**
 * ledger.js - the Ledger page.
 *
 * 1. On-chain ledger: every AssetRegistered and ALUT Transfer event is read straight
 *    from the blockchain, with its block number, block hash, parent hash and tx hash.
 * 2. Activity log: every step taken in this browser is appended to a hash-chained
 *    list (each entry stores the SHA-256 of the previous entry), so editing or
 *    deleting an old entry is detected.
 */
(function () {
  "use strict";
  const { ethers, ALU, ALU_DEPLOYMENT: D } = window;
  const $ = (id) => document.getElementById(id);
  const KEY = "aluLedger:" + D.network.chainId + ":" + D.registryAddress;
  const ZERO = "0".repeat(64);
  const explorer = D.network.chainId === 11155111 ? "https://sepolia.etherscan.io" : null;

  function el(tag, props = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
    }
    for (const c of children) n.append(c);
    return n;
  }
  const short = (h) => (h ? h.slice(0, 10) + "..." + h.slice(-6) : "");
  const fmtTime = (ms) => new Date(ms).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  function txLink(hash) {
    if (!hash) return el("span", { class: "muted", text: "-" });
    if (!explorer) return el("span", { class: "mono", text: short(hash), title: hash });
    return el("a", { class: "mono", href: explorer + "/tx/" + hash, target: "_blank", rel: "noopener", text: short(hash), title: hash });
  }

  // ------------------------------------------------ session activity log
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const save = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ } };
  let entries = load();
  let queue = Promise.resolve();

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  const payload = (e) => JSON.stringify([e.n, e.time, e.kind, e.message, e.tx || "", e.prev]);

  function log(kind, message, tx) {
    queue = queue.then(async () => {
      const prev = entries.length ? entries[entries.length - 1].hash : ZERO;
      const e = { n: entries.length + 1, time: Date.now(), kind, message, tx: tx || "", prev };
      e.hash = await sha256(payload(e));
      entries.push(e);
      save(entries);
      if (!$("page-ledger").hidden) await renderLog();
    }).catch(() => {});
    return queue;
  }

  async function verifyLog() {
    let prev = ZERO;
    for (const e of entries) {
      if (e.prev !== prev || (await sha256(payload(e))) !== e.hash) return e.n;
      prev = e.hash;
    }
    return 0;
  }

  async function renderLog() {
    const bad = await verifyLog();
    const badge = $("logIntegrity");
    badge.className = "pill " + (bad ? "bad" : "ok");
    badge.textContent = entries.length === 0 ? "No entries yet" : bad ? "Chain broken at entry #" + bad : "Chain intact: " + entries.length + " entries verified";
    const body = $("logBody");
    if (!entries.length) {
      body.replaceChildren(el("tr", {}, el("td", { colspan: "6", class: "muted", text: "Nothing logged yet. Connect a wallet, verify a logo or register an asset and every step appears here." })));
      return;
    }
    body.replaceChildren(...entries.slice().reverse().map((e) => el("tr", {},
      el("td", { class: "num", text: "#" + e.n }),
      el("td", { class: "tiny", text: fmtTime(e.time) }),
      el("td", {}, el("span", { class: "tag " + e.kind, text: e.kind })),
      el("td", { text: e.message }),
      el("td", {}, txLink(e.tx)),
      el("td", { class: "mono tiny", text: short(e.hash), title: "entry hash " + e.hash + "\nprevious " + e.prev }))));
  }

  function exportLog() {
    const blob = new Blob([JSON.stringify({ network: D.network, registry: D.registryAddress, token: D.tokenAddress, entries }, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "alu-ledger.json" });
    document.body.append(a); a.click(); a.remove();
  }

  // --------------------------------------------------- on-chain ledger
  const STEP = 3000;           // public RPCs cap the log range per request
  let chainRun = 0;

  async function fetchEvents(contract, filter, from, to) {
    const out = [];
    for (let s = from; s <= to; s += STEP) out.push(...(await contract.queryFilter(filter, s, Math.min(s + STEP - 1, to))));
    return out;
  }

  async function refreshChain(provider, registry, token) {
    const run = ++chainRun;
    const body = $("chainBody");
    $("chainStatus").textContent = "Reading blocks from " + D.network.name + "...";
    try {
      const head = await provider.getBlockNumber();
      const from = Math.max(0, D.deployBlock || 0);
      const [regs, trs] = await Promise.all([
        fetchEvents(registry, registry.filters.AssetRegistered(), from, head),
        fetchEvents(token, token.filters.Transfer(), from, head),
      ]);
      const items = [
        ...regs.map((l) => ({ l, type: "Register", detail: `Asset "${l.args.name}" registered as NFT #${l.args.tokenId} by ${ALU.shortAddress(l.args.registeredBy)}`, extra: l.args.contentHash })),
        ...trs.map((l) => {
          const mint = l.args.from === ethers.ZeroAddress;
          return { l, type: mint ? "Mint" : "Transfer", detail: `${ALU.formatNumber(l.args.value)} ALUT ${mint ? "minted to" : ALU.shortAddress(l.args.from) + " →"} ${ALU.shortAddress(l.args.to)}` };
        }),
      ].sort((a, b) => b.l.blockNumber - a.l.blockNumber || b.l.index - a.l.index);

      const blocks = new Map(), receipts = new Map();
      await Promise.all([...new Set(items.map((i) => i.l.blockNumber))].map(async (n) => blocks.set(n, await provider.getBlock(n))));
      await Promise.all([...new Set(items.map((i) => i.l.transactionHash))].map(async (h) => receipts.set(h, await provider.getTransactionReceipt(h))));
      if (run !== chainRun) return;

      $("lgHead").textContent = head.toLocaleString("en-GB");
      $("lgTx").textContent = new Set(items.map((i) => i.l.transactionHash)).size;
      $("lgEvents").textContent = items.length;
      $("chainStatus").textContent = "Live from " + D.network.name + " (chain " + D.network.chainId + "), blocks " + from.toLocaleString("en-GB") + " to " + head.toLocaleString("en-GB") + ". Read-only: nothing here can be edited.";
      if (!items.length) { body.replaceChildren(el("tr", {}, el("td", { colspan: "6", class: "muted", text: "No transactions found." }))); return; }
      body.replaceChildren(...items.map((i) => {
        const b = blocks.get(i.l.blockNumber), r = receipts.get(i.l.transactionHash);
        const blk = explorer ? el("a", { href: explorer + "/block/" + i.l.blockNumber, target: "_blank", rel: "noopener", text: "#" + i.l.blockNumber }) : el("span", { text: "#" + i.l.blockNumber });
        return el("tr", {},
          el("td", { class: "num" }, blk),
          el("td", { class: "tiny", text: fmtTime(b.timestamp * 1000) }),
          el("td", {}, el("span", { class: "tag " + i.type, text: i.type })),
          el("td", {}, el("div", { text: i.detail }), i.extra ? el("div", { class: "mono tiny muted", text: "content hash " + short(i.extra), title: i.extra }) : ""),
          el("td", {}, txLink(i.l.transactionHash), el("div", { class: "tiny muted", text: (r.status === 1 ? "Success" : "Failed") + " · gas " + r.gasUsed.toLocaleString("en-GB") })),
          el("td", { class: "mono tiny" }, el("div", { text: "hash " + short(b.hash), title: b.hash }), el("div", { class: "muted", text: "parent " + short(b.parentHash), title: b.parentHash })));
      }));
    } catch (err) {
      $("chainStatus").textContent = "";
      body.replaceChildren(el("tr", {}, el("td", { colspan: "6", class: "muted", text: "Could not read the blockchain right now (" + ALU.friendlyError(err) + "). Press Refresh to retry." })));
    }
  }

  $("exportLog").addEventListener("click", exportLog);
  window.Ledger = { log, renderLog, refreshChain };
})();
