/**
 * Minimal service worker — InkframeScout does no background scanning or
 * polling, so there's little for this to do. It only opens a short
 * welcome/setup screen on install so a new user immediately sees how to
 * connect, and it isn't required for any of the popup's own
 * functionality (the popup talks to the InkFrame API directly).
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.action.openPopup?.().catch(() => {
      // openPopup isn't available in every browser context — harmless if it fails,
      // the user can just click the toolbar icon themselves.
    });
  }
});
