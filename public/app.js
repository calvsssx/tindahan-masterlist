(function () {
  "use strict";

  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat(["#"]);
  const POLL_INTERVAL_MS = 8000;

  let items = [];
  let activeLetter = "ALL";
  // Bumped every time a new auth attempt starts (initial check, sign-in,
  // sign-up, sign-out). Any in-flight attempt whose epoch no longer matches
  // the current one is stale and must not touch the UI — this is what
  // prevents the "main page, then back to login, then main page again"
  // flicker when two auth checks happen to overlap.
  let authEpoch = 0;
  let searchTerm = "";
  let editingId = null;   // id currently being edited, null = adding new
  let pendingDeleteId = null;

  // ---------- Backend API helpers ----------
  // The browser never talks to Supabase directly and never sees any key.
  // Every call goes to our own /api/* serverless functions, which hold the
  // Supabase URL/anon key as server-side environment variables only.
  class AuthRequiredError extends Error {}

  async function apiFetch(path, options = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (res.status === 401) {
      throw new AuthRequiredError("Not signed in");
    }
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      // no body
    }
    if (!res.ok) {
      throw new Error((body && body.error) || `Request failed (${res.status})`);
    }
    return body;
  }

  async function fetchItemsFromServer() {
    const body = await apiFetch("/api/items");
    const list = body.items || [];
    list.forEach(migrateHistory);
    return list;
  }

  async function upsertItemRemote(item) {
    try {
      await apiFetch("/api/items", { method: "POST", body: JSON.stringify(item) });
    } catch (e) {
      if (e instanceof AuthRequiredError) { showAuthScreen(); return; }
      console.error("Save failed", e);
      showToast("Couldn't save that change — check your connection");
    }
  }

  async function deleteItemRemote(id) {
    try {
      await apiFetch(`/api/items?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (e) {
      if (e instanceof AuthRequiredError) { showAuthScreen(); return; }
      console.error("Delete failed", e);
      showToast("Couldn't delete that item — check your connection");
    }
  }

  async function resetOnServer() {
    try {
      const body = await apiFetch("/api/items/reset", { method: "POST" });
      const list = body.items || [];
      list.forEach(migrateHistory);
      return list;
    } catch (e) {
      if (e instanceof AuthRequiredError) { showAuthScreen(); return null; }
      console.error("Reset failed", e);
      showToast("Reset failed — check your connection");
      return null;
    }
  }

  // Ensure every item has a priceHistory array. Items coming from the
  // original spreadsheet (or older saved data) get a single "original
  // list" entry with no date, since we don't know when those prices
  // were actually set.
  function migrateHistory(it) {
    if (!Array.isArray(it.priceHistory) || it.priceHistory.length === 0) {
      it.priceHistory = [{
        date: null,
        unitPrice: it.unitPrice,
        wholesalePrice: it.wholesalePrice,
        retailPrice: it.retailPrice,
      }];
    }
    return it;
  }

  // ---------- Polling sync ----------
  // No direct-to-browser realtime anymore (that would require shipping a
  // key for the WebSocket handshake). Instead, poll our own API every few
  // seconds and only apply/re-render if something actually changed and no
  // overlay is currently open (so we don't yank the list out from under
  // someone mid-edit).
  let pollTimer = null;
  function isAnyOverlayOpen() {
    return !!document.querySelector(".overlay.show");
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      if (isAnyOverlayOpen()) return;
      if (document.hidden) return; // don't poll a backgrounded tab
      try {
        const fresh = await fetchItemsFromServer();
        if (JSON.stringify(fresh) !== JSON.stringify(items)) {
          items = fresh;
          render();
        }
      } catch (e) {
        if (e instanceof AuthRequiredError) {
          ++authEpoch;
          stopPolling();
          showAuthScreen();
        }
        // Silently ignore transient network errors on poll.
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function nextId() {
    return items.reduce((max, it) => Math.max(max, it.id), 0) + 1;
  }

  function letterOf(name) {
    const c = (name || "").trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : "#";
  }

  function pricesEqual(a, b) {
    const norm = (v) => (v === undefined || v === "" ? null : v);
    return norm(a.unitPrice) === norm(b.unitPrice) &&
           norm(a.wholesalePrice) === norm(b.wholesalePrice) &&
           norm(a.retailPrice) === norm(b.retailPrice);
  }

  // ---------- Formatting ----------
  function fmtPrice(v) {
    if (v === null || v === undefined || v === "" || isNaN(v)) return null;
    return "₱" + Number(v).toFixed(2).replace(/\.00$/, ".00");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/`/g, "&#96;");
  }

  // ---------- Filtering ----------
  function getFiltered() {
    let list = items.slice();
    if (activeLetter !== "ALL") {
      list = list.filter((it) => it.category === activeLetter);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter((it) => it.name.toLowerCase().includes(q));
    }
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return list;
  }

  // ---------- Rendering ----------
  function renderAZChips() {
    const wrap = document.getElementById("azScroll");
    const counts = {};
    items.forEach((it) => { counts[it.category] = (counts[it.category] || 0) + 1; });

    let html = `<button class="chip all ${activeLetter === "ALL" ? "active" : ""}" data-letter="ALL">All</button>`;
    LETTERS.forEach((L) => {
      if (!counts[L]) return;
      html += `<button class="chip ${activeLetter === L ? "active" : ""}" data-letter="${L}">${L}</button>`;
    });
    wrap.innerHTML = html;

    wrap.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeLetter = btn.dataset.letter;
        searchTerm = document.getElementById("search").value = searchTerm; // keep search as-is
        render();
      });
    });
  }

  function priceTagHtml(label, value) {
    const f = fmtPrice(value);
    if (f === null) {
      return `<div class="price-tag empty"><span class="lbl">${label}</span>—</div>`;
    }
    return `<div class="price-tag"><span class="lbl">${label}</span>${f}</div>`;
  }

  function renderList() {
    const container = document.getElementById("list");
    const filtered = getFiltered();

    document.getElementById("itemCountHeader").textContent = items.length;

    const clearBtn = document.getElementById("clearFiltersBtn");
    const hasFilters = activeLetter !== "ALL" || searchTerm.trim() !== "";
    clearBtn.style.display = hasFilters ? "inline" : "none";

    const countLabel = document.getElementById("resultCount");
    countLabel.textContent = hasFilters
      ? `${filtered.length} of ${items.length} items`
      : `${items.length} item${items.length === 1 ? "" : "s"} total`;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <h3>${items.length === 0 ? "Your list is empty" : "No items match"}</h3>
          <p>${items.length === 0 ? "Tap the + button to add your first item." : "Try a different search term or letter."}</p>
        </div>`;
      return;
    }

    // Group by letter only when viewing "All" with no active search collapsing groups oddly.
    let html = "";
    let lastLetter = null;
    const groupHeadings = activeLetter === "ALL";

    filtered.forEach((it) => {
      const L = it.category;
      if (groupHeadings && L !== lastLetter) {
        html += `<div class="letter-heading">${escapeHtml(L)}</div>`;
        lastLetter = L;
      }
      html += `
        <div class="card" data-id="${it.id}">
          <div class="card-main">
            <p class="card-name">${escapeHtml(it.name)}</p>
            <div class="card-sub">
              <span>Unit: <b>${fmtPrice(it.unitPrice) || "—"}</b></span>
              <span>Wholesale: <b>${fmtPrice(it.wholesalePrice) || "—"}</b></span>
            </div>
          </div>
          <div class="card-footer">
            ${priceTagHtml("Retail", it.retailPrice)}
            <div class="card-actions">
              <button class="mini-btn edit" data-action="edit" data-id="${it.id}" aria-label="Edit ${escapeHtml(it.name)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button class="mini-btn del" data-action="delete" data-id="${it.id}" aria-label="Delete ${escapeHtml(it.name)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
              </button>
            </div>
          </div>
        </div>`;
    });

    container.innerHTML = html;

    container.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditSheet(Number(btn.dataset.id));
      });
    });
    container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openDeleteConfirm(Number(btn.dataset.id));
      });
    });
    container.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("click", () => openDetailSheet(Number(card.dataset.id)));
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "button");
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetailSheet(Number(card.dataset.id));
        }
      });
    });
  }

  function render() {
    renderAZChips();
    renderList();
  }

  // ---------- Item detail / price history ----------
  function formatHistoryDate(iso) {
    if (!iso) return "Original list";
    const d = new Date(iso);
    const datePart = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const timePart = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return `${datePart} · ${timePart}`;
  }

  function deltaHtml(curr, prev) {
    if (prev === null || prev === undefined || curr === null || curr === undefined) return "";
    const diff = curr - prev;
    if (Math.abs(diff) < 0.005) return "";
    const up = diff > 0;
    const arrow = up
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
    return `<span class="delta ${up ? "up" : "down"}">${arrow}${fmtPrice(Math.abs(diff))}</span>`;
  }

  function historyPriceRow(entry, prevEntry) {
    const parts = [
      ["Unit", entry.unitPrice, prevEntry ? prevEntry.unitPrice : null],
      ["Wholesale", entry.wholesalePrice, prevEntry ? prevEntry.wholesalePrice : null],
      ["Retail", entry.retailPrice, prevEntry ? prevEntry.retailPrice : null],
    ];
    return parts.map(([label, val, prevVal]) => {
      const f = fmtPrice(val);
      return `<span class="hp"><span class="k">${label}</span> ${f || "—"} ${deltaHtml(val, prevVal)}</span>`;
    }).join("");
  }

  function openDetailSheet(id) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    migrateHistory(it);

    document.getElementById("detailCategory").textContent = it.category;
    document.getElementById("detailName").textContent = it.name;
    document.getElementById("detailPrices").innerHTML = `
      <div class="detail-price-box"><span class="lbl">Unit</span><span class="val">${fmtPrice(it.unitPrice) || "—"}</span></div>
      <div class="detail-price-box"><span class="lbl">Wholesale</span><span class="val">${fmtPrice(it.wholesalePrice) || "—"}</span></div>
      <div class="detail-price-box retail"><span class="lbl">Retail</span><span class="val">${fmtPrice(it.retailPrice) || "—"}</span></div>
    `;

    const historyEl = document.getElementById("historyList");
    const hist = it.priceHistory.slice().reverse(); // latest first
    if (hist.length <= 1) {
      historyEl.innerHTML = `<div class="history-empty">No price changes recorded yet. Whenever you edit this item's prices, the change will show up here.</div>`;
    } else {
      let html = '<div class="history-list">';
      hist.forEach((entry, idx) => {
        const isLatest = idx === 0;
        const prevEntry = hist[idx + 1] || null; // chronologically earlier entry
        html += `
          <div class="history-item ${isLatest ? "latest" : ""}">
            <div class="history-date">${formatHistoryDate(entry.date)}${isLatest ? '<span class="badge">Current</span>' : ""}</div>
            <div class="history-prices">${historyPriceRow(entry, prevEntry)}</div>
          </div>`;
      });
      html += "</div>";
      historyEl.innerHTML = html;
    }

    document.getElementById("detailEditBtn").onclick = () => {
      closeOverlay("detailOverlay");
      openEditSheet(id);
    };
    showOverlay("detailOverlay");
  }

  // ---------- Add / Edit sheet ----------
  function populateCategorySelect() {
    const sel = document.getElementById("fCategory");
    sel.innerHTML = LETTERS.map((L) => `<option value="${L}">${L === "#" ? "# (starts with a number)" : L}</option>`).join("");
  }

  function openAddSheet() {
    editingId = null;
    document.getElementById("sheetTitle").textContent = "Add item";
    document.getElementById("saveBtn").textContent = "Save item";
    document.getElementById("itemForm").reset();
    document.getElementById("fCategory").value = "A";
    showOverlay("editOverlay");
    setTimeout(() => document.getElementById("fName").focus(), 50);
  }

  function openEditSheet(id) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    editingId = id;
    document.getElementById("sheetTitle").textContent = "Edit item";
    document.getElementById("saveBtn").textContent = "Save changes";
    document.getElementById("fName").value = it.name;
    document.getElementById("fCategory").value = it.category;
    document.getElementById("fUnit").value = it.unitPrice ?? "";
    document.getElementById("fWholesale").value = it.wholesalePrice ?? "";
    document.getElementById("fRetail").value = it.retailPrice ?? "";
    showOverlay("editOverlay");
    setTimeout(() => document.getElementById("fName").focus(), 50);
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    const name = document.getElementById("fName").value.trim();
    if (!name) return;
    const category = document.getElementById("fCategory").value || letterOf(name);
    const unitPrice = parseNumOrNull(document.getElementById("fUnit").value);
    const wholesalePrice = parseNumOrNull(document.getElementById("fWholesale").value);
    const retailPrice = parseNumOrNull(document.getElementById("fRetail").value);
    const newPrices = { unitPrice, wholesalePrice, retailPrice };

    let savedItem = null;
    if (editingId === null) {
      savedItem = {
        id: nextId(),
        name,
        category,
        unitPrice,
        wholesalePrice,
        retailPrice,
        priceHistory: [{ date: new Date().toISOString(), ...newPrices }],
      };
      items.push(savedItem);
      showToast(`Added "${name}"`);
    } else {
      const it = items.find((x) => x.id === editingId);
      if (it) {
        migrateHistory(it);
        const last = it.priceHistory[it.priceHistory.length - 1];
        if (!pricesEqual(last, newPrices)) {
          it.priceHistory.push({ date: new Date().toISOString(), ...newPrices });
        }
        it.name = name;
        it.category = category;
        it.unitPrice = unitPrice;
        it.wholesalePrice = wholesalePrice;
        it.retailPrice = retailPrice;
        savedItem = it;
        showToast(`Saved "${name}"`);
      }
    }
    if (savedItem) upsertItemRemote(savedItem);
    closeOverlay("editOverlay");
    render();
  }

  function parseNumOrNull(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : Math.round(n * 100) / 100;
  }

  // ---------- Delete ----------
  function openDeleteConfirm(id) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    pendingDeleteId = id;
    document.getElementById("deleteItemName").textContent = it.name;
    showOverlay("deleteOverlay");
  }

  function confirmDelete() {
    if (pendingDeleteId === null) return;
    const it = items.find((x) => x.id === pendingDeleteId);
    const deletedId = pendingDeleteId;
    items = items.filter((x) => x.id !== pendingDeleteId);
    deleteItemRemote(deletedId);
    closeOverlay("deleteOverlay");
    pendingDeleteId = null;
    render();
    if (it) showToast(`Deleted "${it.name}"`);
  }

  // ---------- Reset ----------
  function openResetConfirm() {
    showOverlay("resetOverlay");
  }

  async function confirmReset() {
    const btn = document.getElementById("confirmResetBtn");
    btn.disabled = true;
    const fresh = await resetOnServer();
    btn.disabled = false;
    if (!fresh) return; // error toast already shown
    items = fresh;
    closeOverlay("resetOverlay");
    activeLetter = "ALL";
    searchTerm = "";
    document.getElementById("search").value = "";
    render();
    showToast("Restored the original list");
  }

  // ---------- Overlay helpers ----------
  function showOverlay(id) {
    document.getElementById(id).classList.add("show");
  }
  function closeOverlay(id) {
    document.getElementById(id).classList.remove("show");
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- Auth ----------
  function hideSplash() {
    const s = document.getElementById("splashScreen");
    if (s) s.style.display = "none";
  }

  function showAuthScreen(errorMsg) {
    stopPolling();
    hideSplash();
    document.getElementById("appRoot").style.display = "none";
    document.getElementById("authScreen").style.display = "flex";
    closeOverlay("signupOverlay");
    const errEl = document.getElementById("authError");
    if (errorMsg) {
      errEl.textContent = errorMsg;
      errEl.style.display = "block";
    } else {
      errEl.style.display = "none";
    }
  }

  // Loads the list (which doubles as our "am I signed in?" check via the
  // HttpOnly session cookie) and only switches the UI over to the main app
  // once that's confirmed — never optimistically, so a failure never shows
  // a flash of the main view before bouncing back to the sign-in screen.
  // While this runs, the neutral splash screen is shown (not the sign-in
  // form), so a signed-in user reopening the tab never sees a login prompt
  // they might needlessly re-submit.
  // `myEpoch` lets a caller mark this attempt as "current"; if a newer
  // attempt has started by the time this one finishes, its result is
  // discarded instead of fighting the newer one for control of the screen.
  async function startApp(myEpoch) {
    let list;
    try {
      list = await fetchItemsFromServer();
    } catch (e) {
      if (myEpoch !== undefined && myEpoch !== authEpoch) return;
      if (e instanceof AuthRequiredError) { showAuthScreen(); return; }
      showAuthScreen("Couldn't load the list — " + e.message);
      return;
    }
    if (myEpoch !== undefined && myEpoch !== authEpoch) return;

    items = list;
    hideSplash();
    document.getElementById("authScreen").style.display = "none";
    document.getElementById("appRoot").style.display = "block";
    populateCategorySelect();
    render();
    startPolling();
  }

  function openSignupOverlay() {
    document.getElementById("signupForm").reset();
    document.getElementById("signupError").style.display = "none";
    showOverlay("signupOverlay");
  }

  function showSignupError(msg) {
    const errEl = document.getElementById("signupError");
    errEl.textContent = msg;
    errEl.style.display = "block";
  }

  async function handleSignIn(e) {
    e.preventDefault();
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    const btn = document.getElementById("signInBtn");
    btn.disabled = true;
    const myEpoch = ++authEpoch;
    try {
      await apiFetch("/api/auth/signin", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (myEpoch !== authEpoch) return;
      await startApp(myEpoch);
    } catch (e) {
      if (myEpoch !== authEpoch) return;
      showAuthScreen(e.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function handleSignUp(e) {
    e.preventDefault();
    const name = document.getElementById("suName").value.trim();
    const email = document.getElementById("suEmail").value.trim();
    const password = document.getElementById("suPassword").value;
    const inviteCode = document.getElementById("suInvite").value.trim();

    const btn = document.getElementById("signupSubmitBtn");
    btn.disabled = true;
    const myEpoch = ++authEpoch;
    let result;
    try {
      result = await apiFetch("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ name, email, password, inviteCode }),
      });
    } catch (e) {
      showSignupError(e.message);
      btn.disabled = false;
      return;
    }
    btn.disabled = false;
    if (myEpoch !== authEpoch) return;

    if (result.signedIn) {
      closeOverlay("signupOverlay");
      await startApp(myEpoch);
      return;
    }
    closeOverlay("signupOverlay");
    showAuthScreen("Account created! Check your email to confirm, then sign in below.");
  }

  async function handleSignOut() {
    ++authEpoch;
    try {
      await apiFetch("/api/auth/signout", { method: "POST" });
    } catch (e) {
      // ignore — clear the UI regardless
    }
    showAuthScreen();
  }

  // ---------- Init ----------
  async function init() {
    document.getElementById("authForm").addEventListener("submit", handleSignIn);
    document.getElementById("openSignupBtn").addEventListener("click", openSignupOverlay);
    document.getElementById("signupForm").addEventListener("submit", handleSignUp);
    document.getElementById("signupCancelBtn").addEventListener("click", () => closeOverlay("signupOverlay"));
    document.getElementById("signupOverlay").addEventListener("click", (e) => {
      if (e.target.id === "signupOverlay") closeOverlay("signupOverlay");
    });
    document.getElementById("logoutBtn").addEventListener("click", handleSignOut);

    // Try loading the list right away — it doubles as our "am I already
    // signed in?" check via the HttpOnly session cookie, without a separate
    // /api/auth/me round trip first (which used to double up the token
    // refresh and could race with a manual sign-in).
    await startApp(++authEpoch);

    // If the tab was hidden during the initial check and is still on the
    // sign-in screen when the user comes back, quietly re-check once — a
    // session established in another tab will then advance this one.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      const onAuthScreen = document.getElementById("authScreen").style.display !== "none";
      if (onAuthScreen && !document.querySelector(".overlay.show")) {
        startApp(++authEpoch);
      }
    });

    document.getElementById("search").addEventListener("input", (e) => {
      searchTerm = e.target.value;
      renderList();
      updateAZActiveOnly();
    });

    document.getElementById("clearFiltersBtn").addEventListener("click", () => {
      activeLetter = "ALL";
      searchTerm = "";
      document.getElementById("search").value = "";
      render();
    });

    document.getElementById("addFab").addEventListener("click", openAddSheet);
    document.getElementById("itemForm").addEventListener("submit", handleFormSubmit);
    document.getElementById("cancelBtn").addEventListener("click", () => closeOverlay("editOverlay"));
    document.getElementById("editOverlay").addEventListener("click", (e) => {
      if (e.target.id === "editOverlay") closeOverlay("editOverlay");
    });

    document.getElementById("detailCloseBtn").addEventListener("click", () => closeOverlay("detailOverlay"));
    document.getElementById("detailOverlay").addEventListener("click", (e) => {
      if (e.target.id === "detailOverlay") closeOverlay("detailOverlay");
    });

    document.getElementById("cancelDeleteBtn").addEventListener("click", () => closeOverlay("deleteOverlay"));
    document.getElementById("confirmDeleteBtn").addEventListener("click", confirmDelete);
    document.getElementById("deleteOverlay").addEventListener("click", (e) => {
      if (e.target.id === "deleteOverlay") closeOverlay("deleteOverlay");
    });

    document.getElementById("resetBtn").addEventListener("click", openResetConfirm);
    document.getElementById("cancelResetBtn").addEventListener("click", () => closeOverlay("resetOverlay"));
    document.getElementById("confirmResetBtn").addEventListener("click", confirmReset);
    document.getElementById("resetOverlay").addEventListener("click", (e) => {
      if (e.target.id === "resetOverlay") closeOverlay("resetOverlay");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        ["editOverlay", "deleteOverlay", "resetOverlay", "detailOverlay", "signupOverlay"].forEach(closeOverlay);
      }
      // Ctrl + Shift + A → Add new item
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") {
        const tag = document.activeElement?.tagName;

        // Don't trigger while typing
        if (tag === "INPUT" || tag === "TEXTAREA") {
          return;
        }

        e.preventDefault();
        document.getElementById("addFab")?.click();
      }
    });

    render();
  }

  function updateAZActiveOnly() {
    // re-render chip active state without rebuilding whole list scroll position
    document.querySelectorAll(".chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.letter === activeLetter);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
