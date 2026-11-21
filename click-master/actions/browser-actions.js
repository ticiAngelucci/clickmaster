/**
 * Browser-level actions via messaging to service worker
 */

export function openSpotify() {
  return chrome.runtime.sendMessage({ type: "OPEN_SPOTIFY" });
}

export function takeScreenshot() {
  return chrome.runtime.sendMessage({ type: "TAKE_SCREENSHOT" });
}

export function setZoom(delta) {
  return chrome.runtime.sendMessage({ type: "SET_ZOOM", delta });
}

export function doLike() {
  return chrome.runtime.sendMessage({ type: "DO_LIKE" });
}
