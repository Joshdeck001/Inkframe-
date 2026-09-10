/**
 * Real, no-guessing capability detection — checked once when the popup
 * opens, never assumed from a browser-name/user-agent sniff. If a
 * WebExtension API this popup genuinely depends on isn't present, the
 * user sees an honest "this browser doesn't support X" message instead
 * of a silent failure or a fabricated "it should work" claim. Every API
 * checked here (storage.local, scripting.executeScript, tabs.query,
 * runtime) is a standard WebExtension API — not Chrome-specific — so
 * this same check behaves correctly on any standards-based browser,
 * not just the ones this extension has actually been tested against.
 */
function detectBrowserCapabilities() {
  const hasChrome = typeof chrome !== "undefined";
  return {
    supportsStorage: hasChrome && !!chrome.storage && !!chrome.storage.local,
    supportsScripting: hasChrome && !!chrome.scripting && typeof chrome.scripting.executeScript === "function",
    supportsTabs: hasChrome && !!chrome.tabs && typeof chrome.tabs.query === "function",
    supportsRuntime: hasChrome && !!chrome.runtime,
  };
}

const REQUIRED_CAPABILITIES = ["supportsStorage", "supportsScripting", "supportsTabs", "supportsRuntime"];

const CAPABILITY_LABEL = {
  supportsStorage: "local storage (chrome.storage.local)",
  supportsScripting: "script injection (chrome.scripting)",
  supportsTabs: "tab access (chrome.tabs)",
  supportsRuntime: "extension runtime (chrome.runtime)",
};

/** Returns the missing capability keys — an empty array means this browser can run InkframeScout. */
function missingRequiredCapabilities() {
  const caps = detectBrowserCapabilities();
  return REQUIRED_CAPABILITIES.filter((key) => !caps[key]);
}

function describeMissingCapabilities(missing) {
  return missing.map((key) => CAPABILITY_LABEL[key] || key).join(", ");
}

/** A rough, best-effort device/browser signal for the device registration list in Settings — never used to gate functionality, only to label a connection honestly. */
function detectDeviceInfo() {
  const ua = navigator.userAgent || "";
  const isMobile = /Android|iPhone|iPad|Mobile/i.test(ua);
  let browserName = "Unknown";
  if (/Firefox\//.test(ua)) browserName = "Firefox";
  else if (/Edg\//.test(ua)) browserName = "Edge";
  else if (/OPR\//.test(ua) || /Opera/.test(ua)) browserName = "Opera";
  else if (/Kiwi/.test(ua)) browserName = "Kiwi";
  else if (/Chrome\//.test(ua)) browserName = "Chrome";
  else if (/Safari\//.test(ua)) browserName = "Safari";
  const versionMatch = ua.match(/(?:Firefox|Edg|OPR|Chrome|Version)\/([\d.]+)/);
  return {
    device_type: isMobile ? "mobile" : "desktop",
    browser_name: browserName,
    browser_version: versionMatch ? versionMatch[1] : null,
  };
}
