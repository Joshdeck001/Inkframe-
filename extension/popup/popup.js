/**
 * All InkframeScout API calls are made from here (or, equivalently, from
 * the background service worker — this app makes them directly from the
 * popup since there's no need for persistent background state). Every
 * request carries the connection token as a bearer credential; the
 * server resolves the owning user from it, never from anything this
 * popup claims about itself.
 */

const SUPPORTED_HOSTS = ["amazon.", "play.google.com", "kobo.com"];

const els = {
  setupView: document.getElementById("setup-view"),
  connectedView: document.getElementById("connected-view"),
  apiBaseUrl: document.getElementById("api-base-url"),
  connectionCode: document.getElementById("connection-code"),
  connectBtn: document.getElementById("connect-btn"),
  setupError: document.getElementById("setup-error"),
  clipsToday: document.getElementById("clips-today"),
  unassignedClips: document.getElementById("unassigned-clips"),
  pageStatus: document.getElementById("page-status"),
  snapshotSelect: document.getElementById("snapshot-select"),
  newSnapshotBtn: document.getElementById("new-snapshot-btn"),
  clipBtn: document.getElementById("clip-btn"),
  clipResult: document.getElementById("clip-result"),
  openInkframeBtn: document.getElementById("open-inkframe-btn"),
  disconnectBtn: document.getElementById("disconnect-btn"),
};

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

async function getStoredAuth() {
  const { apiBaseUrl, token } = await chrome.storage.local.get(["apiBaseUrl", "token"]);
  return { apiBaseUrl, token };
}

function isSupportedUrl(url) {
  try {
    const host = new URL(url).hostname;
    return SUPPORTED_HOSTS.some((h) => host.includes(h));
  } catch {
    return false;
  }
}

async function init() {
  const { apiBaseUrl, token } = await getStoredAuth();
  if (!apiBaseUrl || !token) {
    els.setupView.hidden = false;
    return;
  }
  els.connectedView.hidden = false;
  await refreshStatus(apiBaseUrl, token);
  await refreshSnapshots(apiBaseUrl, token);
  await checkCurrentTab();
}

async function refreshStatus(apiBaseUrl, token) {
  try {
    const res = await fetch(`${apiBaseUrl}/api/inkframescout/status`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error("status check failed");
    const json = await res.json();
    els.clipsToday.textContent = json.clips_today ?? "—";
    els.unassignedClips.textContent = json.unassigned_clips ?? "—";
  } catch {
    els.clipsToday.textContent = "—";
    els.unassignedClips.textContent = "—";
  }
}

async function refreshSnapshots(apiBaseUrl, token) {
  try {
    const res = await fetch(`${apiBaseUrl}/api/inkframescout/snapshots`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error("could not load snapshots");
    const json = await res.json();
    const previouslySelected = els.snapshotSelect.value;
    els.snapshotSelect.innerHTML = '<option value="">No snapshot — clip on its own</option>';
    for (const snap of json.snapshots || []) {
      const opt = document.createElement("option");
      opt.value = snap.id;
      opt.textContent = `${snap.label} (${snap.clip_count})`;
      els.snapshotSelect.appendChild(opt);
    }
    if (previouslySelected && [...els.snapshotSelect.options].some((o) => o.value === previouslySelected)) {
      els.snapshotSelect.value = previouslySelected;
    }
  } catch {
    // Non-fatal — clipping still works without a snapshot selected.
  }
}

async function checkCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && isSupportedUrl(tab.url)) {
    els.pageStatus.textContent = "This page is supported — ready to clip.";
    els.pageStatus.classList.add("supported");
    els.clipBtn.disabled = false;
  } else {
    els.pageStatus.textContent = "Not a supported book page (Amazon, Google Play Books, or Kobo).";
    els.pageStatus.classList.remove("supported");
    els.clipBtn.disabled = true;
  }
}

els.connectBtn.addEventListener("click", async () => {
  els.setupError.hidden = true;
  const apiBaseUrl = els.apiBaseUrl.value.trim().replace(/\/$/, "");
  const code = els.connectionCode.value.trim();
  if (!apiBaseUrl || !code) {
    showError(els.setupError, "Enter your InkFrame URL and paste the connection code.");
    return;
  }
  els.connectBtn.disabled = true;
  els.connectBtn.textContent = "Connecting…";
  try {
    const res = await fetch(`${apiBaseUrl}/api/inkframescout/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not verify that code.");
    await chrome.storage.local.set({ apiBaseUrl, token: code });
    els.setupView.hidden = true;
    els.connectedView.hidden = false;
    await refreshStatus(apiBaseUrl, code);
    await refreshSnapshots(apiBaseUrl, code);
    await checkCurrentTab();
  } catch (e) {
    showError(els.setupError, e.message || "Could not connect.");
  } finally {
    els.connectBtn.disabled = false;
    els.connectBtn.textContent = "Connect";
  }
});

els.newSnapshotBtn.addEventListener("click", async () => {
  const { apiBaseUrl, token } = await getStoredAuth();
  if (!apiBaseUrl || !token) return;
  const label = window.prompt("Name this snapshot (e.g. \"Cozy mystery comps — Sept\"):");
  if (!label || !label.trim()) return;
  try {
    const res = await fetch(`${apiBaseUrl}/api/inkframescout/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ label: label.trim() }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not create snapshot.");
    await refreshSnapshots(apiBaseUrl, token);
    els.snapshotSelect.value = json.snapshot.id;
  } catch (e) {
    els.clipResult.textContent = e.message || "Could not create snapshot.";
    els.clipResult.className = "result error";
    els.clipResult.hidden = false;
  }
});

els.clipBtn.addEventListener("click", async () => {
  els.clipResult.hidden = true;
  const { apiBaseUrl, token } = await getStoredAuth();
  if (!apiBaseUrl || !token) return;

  els.clipBtn.disabled = true;
  els.clipBtn.textContent = "Reading this page…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab.");

    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/extract.js"] });
    const extracted = injection?.result;
    if (!extracted || extracted.error) throw new Error(extracted?.error || "Could not read this page.");

    const snapshotId = els.snapshotSelect.value || null;
    const res = await fetch(`${apiBaseUrl}/api/inkframescout/observations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...extracted, snapshot_id: snapshotId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not save this clip.");

    els.clipResult.textContent = `✓ Saved "${extracted.title}" — review it in InkFrame Research.`;
    els.clipResult.className = "result success";
    els.clipResult.hidden = false;
    await refreshStatus(apiBaseUrl, token);
    await refreshSnapshots(apiBaseUrl, token);
  } catch (e) {
    els.clipResult.textContent = e.message || "Could not clip this page.";
    els.clipResult.className = "result error";
    els.clipResult.hidden = false;
  } finally {
    els.clipBtn.disabled = false;
    els.clipBtn.textContent = "Clip This Book";
  }
});

els.openInkframeBtn.addEventListener("click", async () => {
  const { apiBaseUrl } = await getStoredAuth();
  if (apiBaseUrl) chrome.tabs.create({ url: `${apiBaseUrl}/research` });
});

els.disconnectBtn.addEventListener("click", async () => {
  const { apiBaseUrl, token } = await getStoredAuth();
  if (apiBaseUrl && token) {
    try {
      await fetch(`${apiBaseUrl}/api/inkframescout/revoke`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    } catch {
      // Revocation on the server is best-effort here — clearing local storage below
      // still disconnects this browser even if the request failed.
    }
  }
  await chrome.storage.local.remove(["apiBaseUrl", "token"]);
  els.connectedView.hidden = true;
  els.setupView.hidden = false;
});

init();
