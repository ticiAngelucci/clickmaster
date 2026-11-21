/**
 * Click Master — Service Worker (Manifest V3)
 * Handles browser actions + Native Messaging bridge for global cursor.
 */

const NATIVE_HOST = "com.clickmaster.host";

let nativePort = null;
let nativeReady = false;
let lastNativeError = null;

// ─────────────────────────────────────────────
// Native Messaging
// ─────────────────────────────────────────────
function connectNative() {
  if (nativePort) {
    try {
      nativePort.disconnect();
    } catch (_) {}
    nativePort = null;
    nativeReady = false;
  }

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);

    nativePort.onMessage.addListener((msg) => {
      if (msg.type === "ready" || msg.type === "pong") {
        nativeReady = true;
        lastNativeError = null;
        console.log("[ClickMaster] Native host ready", msg);
        broadcastToDashboards({ type: "NATIVE_STATUS", connected: true, screen: msg.screen });
      } else if (msg.ok === false) {
        console.warn("[ClickMaster] Native error:", msg.error);
        lastNativeError = msg.error;
      }
    });

    nativePort.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError?.message || "disconnected";
      console.warn("[ClickMaster] Native host disconnected:", err);
      nativePort = null;
      nativeReady = false;
      lastNativeError = err;
      broadcastToDashboards({ type: "NATIVE_STATUS", connected: false, error: err });
    });

    // Handshake
    nativePort.postMessage({ type: "ping" });
  } catch (e) {
    console.error("[ClickMaster] Failed to connect native host:", e);
    lastNativeError = String(e);
    nativeReady = false;
  }
}

function sendToNative(msg) {
  if (!nativePort || !nativeReady) {
    return false;
  }
  try {
    nativePort.postMessage(msg);
    return true;
  } catch (e) {
    console.warn("[ClickMaster] sendToNative failed:", e);
    return false;
  }
}

function broadcastToDashboards(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// Open side panel when clicking the extension icon
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
      // Fallback: open dashboard tab
      chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") });
    });
  }
});

// Inject content script into existing tabs on install/startup
async function injectIntoAllTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  for (const tab of tabs) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/page-control.js"]
      });
    } catch (_) {}
  }
}

// Re-inject on every navigation so new pages always have the cursor
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
    chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/page-control.js"]
    }).catch(() => {});
  }
});

// Inject immediately when user switches to a tab
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
      await chrome.scripting.executeScript({
        target: { tabId: activeInfo.tabId },
        files: ["content/page-control.js"]
      });
    }
  } catch (_) {}
});

// Enable side panel for all sites
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[ClickMaster] Extension installed/updated");
  injectIntoAllTabs();
  connectNative();
});

chrome.runtime.onStartup.addListener(() => {
  injectIntoAllTabs();
  connectNative();
});

// Also try on service-worker wake
connectNative();

// ─────────────────────────────────────────────
// Message router
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ── Native cursor commands ──
  if (message.type === "NATIVE_MOVE") {
    const ok = sendToNative({ type: "move", x: message.x, y: message.y });
    sendResponse({ ok, nativeReady });
    return false;
  }

  if (message.type === "NATIVE_CLICK") {
    const ok = sendToNative({ type: "click", button: message.button || "left" });
    sendResponse({ ok, nativeReady });
    return false;
  }

  if (message.type === "NATIVE_SCROLL") {
    const ok = sendToNative({ type: "scroll", dx: message.dx || 0, dy: message.dy || 0 });
    sendResponse({ ok, nativeReady });
    return false;
  }

  if (message.type === "NATIVE_STATUS") {
    sendResponse({
      connected: nativeReady,
      error: lastNativeError
    });
    return false;
  }

  if (message.type === "NATIVE_RECONNECT") {
    connectNative();
    sendResponse({ ok: true });
    return false;
  }

  // ── Page control (virtual cursor on real pages) ──
  if (message.type === "PAGE_MOVE" || message.type === "PAGE_CLICK" || message.type === "PAGE_SCROLL" || message.type === "PAGE_HIDE_CURSOR" ||
      message.type === "SHOW_KEYBOARD" || message.type === "HIDE_KEYBOARD" || message.type === "KB_POINT" || message.type === "KB_TYPE") {
    (async () => {
      // Prefer the active tab if it's a normal web page
      let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      let tab = tabs[0];

      const isWeb = (t) => t && t.url && (t.url.startsWith("http://") || t.url.startsWith("https://"));

      if (!isWeb(tab)) {
        // Active tab is extension/chrome — find the most recent normal tab
        const all = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
        tab = all.find(t => t.active) || all[0];
      }

      if (!tab || !tab.id) {
        sendResponse({ ok: false, error: "no_web_tab" });
        return;
      }

      try {
        await chrome.tabs.sendMessage(tab.id, message);
        sendResponse({ ok: true, tabId: tab.id });
      } catch (e) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content/page-control.js"]
          });
          await chrome.tabs.sendMessage(tab.id, message);
          sendResponse({ ok: true, injected: true, tabId: tab.id });
        } catch (err2) {
          sendResponse({ ok: false, error: String(err2) });
        }
      }
    })();
    return true;
  }

  if (message.type === "SWITCH_TAB") {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      if (!tabs.length) {
        sendResponse({ ok: false });
        return;
      }
      const active = tabs.findIndex((t) => t.active);
      let next = active;
      if (message.direction === "next") next = (active + 1) % tabs.length;
      else if (message.direction === "prev") next = (active - 1 + tabs.length) % tabs.length;
      if (next !== active && next >= 0) {
        chrome.tabs.update(tabs[next].id, { active: true });
        sendResponse({ ok: true, index: next });
      } else {
        sendResponse({ ok: false, reason: "same_tab" });
      }
    });
    return true;
  }

  if (message.type === "SET_ZOOM") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        sendResponse({ ok: false });
        return;
      }
      chrome.tabs.getZoom(tabs[0].id, (current) => {
        const next = Math.min(3, Math.max(0.3, current + (message.delta || 0)));
        chrome.tabs.setZoom(tabs[0].id, next);
        sendResponse({ ok: true, zoom: Math.round(next * 100) });
      });
    });
    return true;
  }

  // ── Browser actions ──
  if (message.type === "OPEN_SPOTIFY") {
    chrome.tabs.create({ url: "https://open.spotify.com/" });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "TAKE_SCREENSHOT") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      chrome.downloads.download({
        url: dataUrl,
        filename: `click-master-screenshot-${Date.now()}.png`,
        saveAs: false
      });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "DO_LIKE") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        sendResponse({ ok: false, error: "No active tab" });
        return;
      }
      const tab = tabs[0];
      if (!tab.url || !tab.url.includes("instagram.com")) {
        sendResponse({ ok: false, error: "Not on Instagram" });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "PERFORM_LIKE" }, (res) => {
        sendResponse(res || { ok: false });
      });
    });
    return true;
  }

  if (message.type === "SET_ZOOM") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.getZoom(tabs[0].id, (current) => {
          const next = Math.min(3, Math.max(0.3, current + (message.delta || 0)));
          chrome.tabs.setZoom(tabs[0].id, next);
          sendResponse({ ok: true, zoom: next });
        });
      }
    });
    return true;
  }

  return false;
});
