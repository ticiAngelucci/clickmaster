/**
 * Click Master — Content script (all pages)
 * Virtual cursor + click + scroll on the real page
 */

(function () {
  if (window.__CLICK_MASTER_INJECTED__) return;
  window.__CLICK_MASTER_INJECTED__ = true;

  // Virtual cursor
  const cursor = document.createElement("div");
  cursor.id = "click-master-cursor";
  cursor.style.cssText = `
    position: fixed;
    width: 32px;
    height: 32px;
    border: 3px solid #ffd60a;
    border-radius: 50%;
    background: rgba(255, 214, 10, 0.35);
    pointer-events: none;
    z-index: 2147483647;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 16px #ffd60a, 0 0 4px #000;
    display: none;
  `;
  document.documentElement.appendChild(cursor);

  // Small label
  const label = document.createElement("div");
  label.id = "click-master-label";
  label.textContent = "CLICK MASTER";
  label.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 2147483647;
    background: rgba(0,0,0,0.7);
    color: #ffd60a;
    font: 700 10px system-ui;
    padding: 2px 6px;
    border-radius: 6px;
    display: none;
  `;
  document.documentElement.appendChild(label);

  let currentX = window.innerWidth / 2;
  let currentY = window.innerHeight / 2;
  let visible = false;

  function showCursor() {
    if (!visible) {
      cursor.style.display = "block";
      label.style.display = "block";
      visible = true;
    }
  }

  function moveCursor(x, y) {
    currentX = x * window.innerWidth;
    currentY = y * window.innerHeight;
    cursor.style.left = currentX + "px";
    cursor.style.top = currentY + "px";
    label.style.left = (currentX + 18) + "px";
    label.style.top = (currentY - 10) + "px";
    showCursor();
  }

  function flashClick() {
    cursor.style.background = "rgba(0, 230, 118, 0.6)";
    cursor.style.borderColor = "#00e676";
    cursor.style.transform = "translate(-50%, -50%) scale(0.7)";
    setTimeout(() => {
      cursor.style.background = "rgba(255, 214, 10, 0.25)";
      cursor.style.borderColor = "#ffd60a";
      cursor.style.transform = "translate(-50%, -50%)";
    }, 140);
  }

  function performClick(button = "left") {
    const el = document.elementFromPoint(currentX, currentY);
    if (!el) return;

    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: currentX,
      clientY: currentY,
      button: button === "right" ? 2 : 0,
      buttons: button === "right" ? 2 : 1
    };

    el.dispatchEvent(new MouseEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));

    if (button === "right") {
      el.dispatchEvent(new MouseEvent("contextmenu", { ...opts, button: 2 }));
    }

    // Also try focus for inputs
    if (el.focus && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
      el.focus();
    }

    flashClick();
  }

  function performScroll(dy) {
    const amount = Math.round(dy * 120);
    window.scrollBy({ top: amount, behavior: "auto" });

    const el = document.elementFromPoint(currentX, currentY);
    if (el && el !== document.body && el !== document.documentElement) {
      let node = el;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          node.scrollHeight > node.clientHeight + 10
        ) {
          node.scrollBy({ top: amount, behavior: "auto" });
          break;
        }
        node = node.parentElement;
      }
    }
  }

  function hideCursor() {
    cursor.style.display = "none";
    label.style.display = "none";
    visible = false;
  }

  // ── Air Keyboard on the page ──
  let kbOverlay = null;
  let kbInput = null;
  let kbSelector = null;
  let kbHoverKey = null;

  function createKeyboard() {
    if (kbOverlay) return;
    kbOverlay = document.createElement("div");
    kbOverlay.id = "cm-keyboard";
    kbOverlay.style.cssText = `
      position: fixed; inset: 20px; z-index: 2147483646;
      background: rgba(10,14,23,0.95); border: 2px solid #00a3ff;
      border-radius: 16px; padding: 16px; display: flex; flex-direction: column;
      font-family: system-ui, sans-serif; color: #fff;
    `;
    kbOverlay.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:12px;letter-spacing:1px;color:#8b9cb3">
        <span>AIR KEYBOARD</span><span id="cm-kb-preview" style="color:#ffd60a;font-weight:700"></span>
      </div>
      <input id="cm-kb-input" style="width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#0a1220;color:#fff;font-size:18px;margin-bottom:12px" placeholder="Escribí acá…" readonly>
      <div id="cm-kb-rows" style="display:flex;flex-direction:column;gap:8px;flex:1;justify-content:center"></div>
      <p style="text-align:center;font-size:12px;color:#8b9cb3;margin-top:8px">☝️ Apuntá · 👌 Pinch para escribir</p>
    `;
    document.documentElement.appendChild(kbOverlay);

    kbInput = kbOverlay.querySelector("#cm-kb-input");
    const rows = kbOverlay.querySelector("#cm-kb-rows");
    const layout = [
      ["1","2","3","4","5","6","7","8","9","0"],
      ["Q","W","E","R","T","Y","U","I","O","P"],
      ["A","S","D","F","G","H","J","K","L"],
      ["Z","X","C","V","B","N","M",",","."],
      ["SPACE","BACK","ENTER"]
    ];
    layout.forEach(row => {
      const div = document.createElement("div");
      div.style.cssText = "display:flex;gap:6px;justify-content:center";
      row.forEach(key => {
        const k = document.createElement("div");
        k.className = "cm-key";
        k.dataset.key = key;
        k.textContent = key === "SPACE" ? "␣" : key === "BACK" ? "⌫" : key === "ENTER" ? "↵" : key;
        k.style.cssText = `
          min-width:${key.length > 1 ? 70 : 48}px; height:52px; display:flex; align-items:center; justify-content:center;
          background:#151e2e; border:2px solid rgba(255,255,255,0.1); border-radius:8px;
          font-weight:800; font-size:16px; cursor:pointer;
        `;
        div.appendChild(k);
      });
      rows.appendChild(div);
    });

    kbSelector = document.createElement("div");
    kbSelector.style.cssText = `
      position:fixed; width:26px; height:26px; border:3px solid #ffd60a; border-radius:50%;
      background:rgba(255,214,10,0.3); pointer-events:none; z-index:2147483647;
      transform:translate(-50%,-50%); box-shadow:0 0 12px #ffd60a; display:none;
    `;
    document.documentElement.appendChild(kbSelector);
  }

  function showKeyboard() {
    createKeyboard();
    kbOverlay.style.display = "flex";
    kbSelector.style.display = "block";
  }

  function hideKeyboard() {
    if (kbOverlay) kbOverlay.style.display = "none";
    if (kbSelector) kbSelector.style.display = "none";
  }

  function pointKeyboard(x, y) {
    if (!kbOverlay || kbOverlay.style.display === "none") return;
    const rect = kbOverlay.getBoundingClientRect();
    const px = rect.left + x * rect.width;
    const py = rect.top + y * rect.height;
    kbSelector.style.left = px + "px";
    kbSelector.style.top = py + "px";
    kbSelector.style.display = "block";

    document.querySelectorAll(".cm-key").forEach(k => {
      k.style.borderColor = "rgba(255,255,255,0.1)";
      k.style.background = "#151e2e";
      k.style.transform = "";
    });
    kbHoverKey = null;
    const el = document.elementFromPoint(px, py);
    const key = el?.closest?.(".cm-key");
    if (key) {
      key.style.borderColor = "#ffd60a";
      key.style.background = "rgba(255,214,10,0.25)";
      key.style.transform = "scale(1.08)";
      kbHoverKey = key.dataset.key;
      const prev = document.getElementById("cm-kb-preview");
      if (prev) prev.textContent = "→ " + kbHoverKey;
    }
  }

  function typeOnPage(key) {
    if (!kbInput) return;
    if (key === "BACK") kbInput.value = kbInput.value.slice(0, -1);
    else if (key === "SPACE") kbInput.value += " ";
    else if (key === "ENTER") kbInput.value += "\n";
    else kbInput.value += key;
  }

  // Messages from background / dashboard
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "PAGE_MOVE") {
      moveCursor(message.x, message.y);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "PAGE_CLICK") {
      performClick(message.button || "left");
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "PAGE_SCROLL") {
      performScroll(message.dy || 0);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "PAGE_HIDE_CURSOR") {
      hideCursor();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "SHOW_KEYBOARD") {
      showKeyboard();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "HIDE_KEYBOARD") {
      hideKeyboard();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "KB_POINT") {
      pointKeyboard(message.x, message.y);
      sendResponse({ ok: true, key: kbHoverKey });
      return false;
    }
    if (message.type === "KB_TYPE") {
      typeOnPage(message.key);
      sendResponse({ ok: true });
      return false;
    }

    // Legacy Instagram like
    if (message.type === "PERFORM_LIKE") {
      sendResponse({ ok: false, message: "Use page click instead" });
      return false;
    }

    return false;
  });

  console.log("[ClickMaster] Page control content script loaded");
})();
