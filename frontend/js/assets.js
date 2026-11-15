/**
 * assets.js - the My Assets page.
 *
 * The blockchain stores each asset's name, type, owner and SHA-256 fingerprint,
 * but not the file itself. The file stays in this browser (IndexedDB), saved when
 * the user registers it. Every view and download re-hashes the stored file and
 * checks it against the on-chain fingerprint, so a changed file is never passed off
 * as the registered one.
 */
(function () {
  "use strict";
  const { ALU } = window;
  const $ = (id) => document.getElementById(id);

  function el(tag, props = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
    }
    for (const c of children) n.append(c);
    return n;
  }

  // ------------------------------------------------------------ file store
  let dbPromise;
  function db() {
    dbPromise = dbPromise || new Promise((resolve, reject) => {
      const req = indexedDB.open("aluAssets", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function idb(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = fn(d.transaction("files", mode).objectStore("files"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  const saveFile = (hash, file) => idb("readwrite", (s) => s.put({ blob: file, fileName: file.name, mime: file.type, savedAt: Date.now() }, hash.toLowerCase())).catch(() => {});
  const getFile = (hash) => idb("readonly", (s) => s.get(hash.toLowerCase())).catch(() => undefined);

  const fmtDate = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  function extOf(asset, stored) {
    const t = (stored && stored.mime) || asset.fileType || "";
    const e = (t.split("/")[1] || t).toLowerCase().replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "");
    return e || "bin";
  }
  const safeName = (s) => s.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "asset";

  // -------------------------------------------------------------- loading
  async function listAssets(registry) {
    const out = [];
    for (let id = 1; id < 500; id++) {
      let owner;
      try { owner = await registry.ownerOf(id); } catch { break; }
      const a = await registry.getAsset(id);
      out.push({ id, owner, name: a.name, fileType: a.fileType, hash: a.contentHash, registeredBy: a.registeredBy, registeredAt: new Date(Number(a.registeredAt) * 1000) });
    }
    return out;
  }

  const urls = [];
  let run = 0;
  async function refresh(registry, account) {
    const my = ++run;
    const grid = $("assetGrid");
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    const showAll = $("assetsAll").checked;
    $("assetsNotice").hidden = !!account || showAll;
    if (!account && !showAll) {
      grid.replaceChildren();
      $("assetsCount").textContent = "";
      return;
    }
    grid.replaceChildren(el("p", { class: "muted", text: "Loading assets from the blockchain..." }));
    try {
      let list = await listAssets(registry);
      if (my !== run) return;
      const mine = (a) => account && a.owner.toLowerCase() === account.toLowerCase();
      if (!showAll) list = list.filter(mine);
      $("assetsCount").textContent = list.length + (list.length === 1 ? " asset" : " assets");
      if (!list.length) {
        grid.replaceChildren(el("p", { class: "muted", text: "No assets owned by this wallet yet. Register one on the Register page." }));
        return;
      }
      const cards = [];
      for (const a of list) cards.push(await card(a, mine(a), registry));
      if (my === run) grid.replaceChildren(...cards);
    } catch (err) {
      grid.replaceChildren(el("p", { class: "muted", text: "Could not load assets: " + ALU.friendlyError(err) }));
    }
  }

  async function card(a, isMine, registry) {
    let stored = await getFile(a.hash);
    if (!stored && a.hash.toLowerCase() === String(window.ALU_DEPLOYMENT.logoHash).toLowerCase()) {
      // The official logo ships with the site: restore it automatically if its hash matches.
      try {
        const blob = await (await fetch("assets/alu-logo.png")).blob();
        const file = new File([blob], "alu-logo.png", { type: "image/png" });
        if ((await ALU.hashFile(file)).toLowerCase() === a.hash.toLowerCase()) {
          await saveFile(a.hash, file);
          stored = await getFile(a.hash);
        }
      } catch { /* fall back to Attach file */ }
    }
    const thumb = el("div", { class: "asset-thumb" });
    let url = null;
    if (stored) {
      url = URL.createObjectURL(stored.blob); urls.push(url);
      thumb.append(el("img", { src: url, alt: a.name }));
    } else {
      thumb.append(el("span", { class: "muted tiny", text: "No local copy yet. Attach the original file to view or download it." }));
    }
    const actions = el("div", { class: "asset-actions" });
    const status = el("div", { class: "tiny asset-status" });
    if (stored) {
      const view = el("button", { class: "btn btn-dark", type: "button", text: "View" });
      const dl = el("button", { class: "btn btn-primary", type: "button", text: "Download" });
      view.addEventListener("click", () => run2(async () => { await check(stored, a); openViewer(url, a); window.Ledger && Ledger.log("asset", "Viewed asset #" + a.id + " (" + a.name + "), hash matches the blockchain"); }, status));
      dl.addEventListener("click", () => run2(async () => {
        await check(stored, a);
        const link = el("a", { href: url, download: safeName(a.name) + "." + extOf(a, stored) });
        document.body.append(link); link.click(); link.remove();
        window.Ledger && Ledger.log("asset", "Downloaded asset #" + a.id + " (" + a.name + "), hash verified against the blockchain");
      }, status));
      actions.append(view, dl);
    } else {
      const input = el("input", { type: "file", accept: "image/*", hidden: "" });
      const attach = el("button", { class: "btn btn-dark", type: "button", text: "Attach file" });
      attach.addEventListener("click", () => input.click());
      input.addEventListener("change", () => run2(async () => {
        const f = input.files[0];
        if (!f) return;
        const hash = await ALU.hashFile(f);
        if (hash.toLowerCase() !== a.hash.toLowerCase()) throw new Error("That file does not match asset #" + a.id + ". Its fingerprint differs from the one on the blockchain.");
        await saveFile(a.hash, f);
        window.Ledger && Ledger.log("asset", "Attached file for asset #" + a.id + " (" + a.name + "), hash matches the blockchain");
        await refresh(registry, isMine ? a.owner : null);
      }, status));
      actions.append(attach, input);
    }
    return el("div", { class: "asset-card" }, thumb,
      el("div", { class: "asset-body" },
        el("div", { class: "asset-title" }, el("strong", { text: a.name }), el("span", { class: "tag Register", text: "NFT #" + a.id })),
        isMine ? el("span", { class: "you", text: "You own this" }) : el("div", { class: "tiny muted", text: "Owner " + ALU.shortAddress(a.owner) }),
        el("div", { class: "tiny muted", text: a.fileType + " · registered " + fmtDate(a.registeredAt) }),
        el("div", { class: "mono tiny muted", text: "SHA-256 " + a.hash.slice(0, 12) + "..." + a.hash.slice(-6), title: a.hash }),
        actions, status));
  }

  async function check(stored, a) {
    const hash = await ALU.hashFile(stored.blob);
    if (hash.toLowerCase() !== a.hash.toLowerCase()) throw new Error("The stored file no longer matches the blockchain fingerprint, so it was not opened.");
  }
  async function run2(fn, statusEl) {
    statusEl.className = "tiny asset-status";
    statusEl.textContent = "Checking against the blockchain...";
    try { await fn(); statusEl.classList.add("ok"); statusEl.textContent = "✓ Verified: file matches the on-chain fingerprint"; }
    catch (err) { statusEl.classList.add("bad"); statusEl.textContent = err.message || String(err); }
  }

  function openViewer(url, a) {
    $("viewerImg").src = url;
    $("viewerImg").alt = a.name;
    $("viewerTitle").textContent = a.name + " (NFT #" + a.id + ")";
    $("viewer").hidden = false;
  }
  $("viewerClose").addEventListener("click", () => ($("viewer").hidden = true));
  $("viewer").addEventListener("click", (e) => { if (e.target === $("viewer")) $("viewer").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("viewer").hidden = true; });

  window.Assets = { saveFile, refresh };
})();
