/**
 * Click Master — Dashboard (MVP)
 * Camera + MediaPipe Hands + Gesture → Actions
 */

import { HandLandmarker, FilesetResolver, DrawingUtils } from "../lib/mediapipe/vision_bundle.mjs";

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
const state = {
  running: false,
  paused: false,
  mode: "mouse", // mouse | magic | keyboard
  handLandmarker: null,
  stream: null,
  lastVideoTime: -1,
  fps: 0,
  frameCount: 0,
  lastFpsTime: performance.now(),
  // Cursor smoothing
  cursorX: 0.5,
  cursorY: 0.5,
  targetX: 0.5,
  targetY: 0.5,
  // Native messaging
  nativeConnected: false,
  lastNativeMove: 0,
  nativeMoveInterval: 32, // ~30 Hz max to the OS
  // Scroll tracking
  lastScrollY: 0.5,
  scrollAccum: 0,
  // Tab swipe tracking
  lastSwipeX: 0.5,
  swipeStartX: 0.5,
  swipeStartTime: 0,
  lastTabSwitch: 0,
  // Pinch / fist state machine
  pinchState: "open", // open | closed
  fistState: "open",
  likeState: "idle",
  // Zoom
  zoomBaseDist: null,
  lastZoomSent: 0,
  currentZoom: 100,
  // Debug
  lastHandedness: "—",
  confidence: 0,
  // Gesture state machine
  currentGesture: null,
  gestureStartTime: 0,
  lastActionTime: 0,
  pinchClosed: false,
  zoomBaseDist: null,
  lastZoomLevel: 1,
  // Cooldowns (ms)
  cooldowns: {
    click: 400,
    rock: 2000,
    like: 1500,
    screenshot: 2500,
    fist: 500,
    palm: 800,
    tab: 900
  }
};

// Thresholds (configurable later)
const THRESH = {
  pinchClose: 0.045,
  pinchOpen: 0.08,
  fistMaxExt: 0.12,
  rockIndex: 0.25,
  rockPinky: 0.25,
  rockMiddle: 0.18,
  likeThumb: 0.25,
  palmOpenMin: 0.22,
  stabilityMs: 180,
  rectMinDist: 0.15
};

// ─────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────
const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const cursorEl = document.getElementById("cursor");
const gestureInd = document.getElementById("gesture-indicator");
const pauseOverlay = document.getElementById("pause-overlay");
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnResume = document.getElementById("btn-resume");
const cameraStatus = document.querySelector("#camera-status .dot");
const trackingStatus = document.querySelector("#tracking-status .dot");
const modeBadge = document.querySelector(".mode-badge");
const lastGestureEl = document.getElementById("last-gesture");
const lastActionEl = document.getElementById("last-action");
const fpsEl = document.getElementById("fps");
const systemStatus = document.getElementById("system-status");
const toasts = document.getElementById("toasts");

// ─────────────────────────────────────────────
// Init MediaPipe
// ─────────────────────────────────────────────
async function initHandLandmarker() {
  systemStatus.textContent = "Cargando MediaPipe…";
  const vision = await FilesetResolver.forVisionTasks(
    chrome.runtime.getURL("lib/mediapipe/wasm")
  );
  state.handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        chrome.runtime.getURL("lib/mediapipe/hand_landmarker.task"),
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.65,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6
  });
  systemStatus.textContent = "MediaPipe listo";
  console.log("[ClickMaster] HandLandmarker ready");
}

// ─────────────────────────────────────────────
// Camera
// ─────────────────────────────────────────────
async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user"
      },
      audio: false
    });
    video.srcObject = state.stream;
    await video.play();

    // Match canvas size
    const resize = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    };
    video.addEventListener("loadedmetadata", resize);
    resize();

    cameraStatus.classList.remove("offline");
    cameraStatus.classList.add("online");
    btnStart.disabled = true;
    btnStop.disabled = false;
    state.running = true;
    systemStatus.textContent = "Cámara activa";
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    systemStatus.textContent = "Error cámara: " + err.message;
    showToast("⚠️ No se pudo abrir la cámara. Probá abrir el Dashboard en una pestaña normal.");
    // Offer full tab fallback
    if (confirm("¿Abrir Click Master en una pestaña completa para usar la cámara?")) {
      chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") });
    }
  }
}

function stopCamera() {
  state.running = false;
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  cursorEl.classList.remove("active");
  cameraStatus.classList.remove("online");
  cameraStatus.classList.add("offline");
  trackingStatus.classList.remove("online");
  trackingStatus.classList.add("offline");
  btnStart.disabled = false;
  btnStop.disabled = true;
  systemStatus.textContent = "Detenido";
}

// ─────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────
function loop() {
  if (!state.running) return;

  const now = performance.now();
  if (video.currentTime !== state.lastVideoTime && video.videoWidth > 0) {
    state.lastVideoTime = video.currentTime;
    const results = state.handLandmarker.detectForVideo(video, now);
    processResults(results, now);
    state.frameCount++;
  }

  // FPS
  if (now - state.lastFpsTime >= 1000) {
    state.fps = state.frameCount;
    state.frameCount = 0;
    state.lastFpsTime = now;
    fpsEl.textContent = state.fps;
  }

  // Smooth cursor
  state.cursorX += (state.targetX - state.cursorX) * 0.35;
  state.cursorY += (state.targetY - state.cursorY) * 0.35;
  updateCursorUI();

  requestAnimationFrame(loop);
}

// ─────────────────────────────────────────────
// Process landmarks → gestures
// ─────────────────────────────────────────────
function processResults(results, now) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!results.landmarks || results.landmarks.length === 0) {
    trackingStatus.classList.remove("online");
    trackingStatus.classList.add("offline");
    gestureInd.classList.add("hidden");
    return;
  }

  trackingStatus.classList.remove("offline");
  trackingStatus.classList.add("online");

  // Draw landmarks (mirrored canvas already)
  const drawingUtils = new DrawingUtils(ctx);
  for (const landmarks of results.landmarks) {
    drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
      color: "#00d4ff",
      lineWidth: 2
    });
    drawingUtils.drawLandmarks(landmarks, {
      color: "#ffd60a",
      lineWidth: 1,
      radius: 3
    });
  }

  if (state.paused) return;

  const hands = results.landmarks;
  const handedness = results.handednesses || [];

  // Primary hand
  const lm = hands[0];
  const handLabel = (handedness[0] && handedness[0][0] && handedness[0][0].categoryName) || "—";
  state.lastHandedness = handLabel;
  state.confidence = (handedness[0] && handedness[0][0] && handedness[0][0].score) || 0;

  const gesture = classifyGesture(lm, hands, now);

  if (gesture) {
    lastGestureEl.textContent = gesture.name;
    gestureInd.textContent = gesture.emoji + " " + gesture.name;
    gestureInd.classList.remove("hidden");
    document.querySelectorAll(".gesture-list li").forEach((li) => {
      li.classList.toggle("active", li.dataset.gesture === gesture.id);
    });
  } else {
    gestureInd.classList.add("hidden");
  }

  // Cursor from index tip
  if (state.mode === "mouse" || state.mode === "magic") {
    const tip = lm[8];
    state.targetX = tip.x;
    state.targetY = tip.y;
    cursorEl.classList.add("active");
  }

  // ── Scroll: index extended, not pinching, vertical movement ──
  if (gesture && gesture.id === "index" && (state.mode === "mouse" || state.mode === "magic")) {
    const tip = lm[8];
    const dy = tip.y - state.lastScrollY;
    state.scrollAccum += dy;
    state.lastScrollY = tip.y;
    if (Math.abs(state.scrollAccum) > 0.012) {
      chrome.runtime.sendMessage({ type: "PAGE_SCROLL", dy: state.scrollAccum * 12 });
      lastActionEl.textContent = state.scrollAccum > 0 ? "Scroll ↓" : "Scroll ↑";
      updateDebug("SCROLL", state.scrollAccum > 0 ? "↓" : "↑");
      state.scrollAccum = 0;
    }
  } else {
    state.lastScrollY = lm[8].y;
    state.scrollAccum = 0;
  }

  // ── Swipe: index + middle extended, horizontal movement ──
  const indexExt = fingerExtended(lm, 8, 6, 5);
  const middleExt = fingerExtended(lm, 12, 10, 9);
  const ringExt = fingerExtended(lm, 16, 14, 13);
  const pinkyExt = fingerExtended(lm, 20, 18, 17);
  const isTwoFinger = indexExt && middleExt && !ringExt && !pinkyExt;

  if (isTwoFinger && (state.mode === "mouse" || state.mode === "magic")) {
    const tip = lm[8];
    const nowMs = performance.now();
    const dx = tip.x - state.lastSwipeX;
    state.lastSwipeX = tip.x;

    if (Math.abs(dx) > 0.01 && state.swipeStartTime === 0) {
      state.swipeStartX = tip.x;
      state.swipeStartTime = nowMs;
    }

    if (state.swipeStartTime > 0) {
      const totalDx = tip.x - state.swipeStartX;
      const elapsed = nowMs - state.swipeStartTime;
      const naturalDx = -totalDx; // mirror correction
      if (elapsed < 600 && Math.abs(naturalDx) > 0.12 && (nowMs - state.lastTabSwitch) > 800) {
        const direction = naturalDx > 0 ? "next" : "prev";
        chrome.runtime.sendMessage({ type: "SWITCH_TAB", direction });
        lastActionEl.textContent = direction === "next" ? "Pestaña siguiente →" : "Pestaña anterior ←";
        showToast(direction === "next" ? "➡️ SIGUIENTE PESTAÑA" : "⬅️ PESTAÑA ANTERIOR");
        updateDebug("SWIPE", direction);
        state.lastTabSwitch = nowMs;
        state.swipeStartTime = 0;
        state.swipeStartX = tip.x;
      } else if (elapsed > 600) {
        // Reset so user can try again
        state.swipeStartTime = 0;
        state.swipeStartX = tip.x;
      }
    }
  } else {
    // Hand left the gesture — fully reset so next swipe works
    state.lastSwipeX = lm[8].x;
    state.swipeStartTime = 0;
    state.swipeStartX = lm[8].x;
  }

  // ── Two-hand zoom ──
  if (hands.length >= 2 && state.mode === "magic") {
    const d = dist(hands[0][8], hands[1][8]);
    if (state.zoomBaseDist == null) state.zoomBaseDist = d;
    const delta = d - state.zoomBaseDist;
    if (Math.abs(delta) > 0.04 && now - state.lastZoomSent > 200) {
      const zoomDelta = delta > 0 ? 0.1 : -0.1;
      chrome.runtime.sendMessage({ type: "SET_ZOOM", delta: zoomDelta }, (res) => {
        if (res && res.zoom) {
          state.currentZoom = res.zoom;
          updateDebug("ZOOM", res.zoom + "%");
        }
      });
      state.zoomBaseDist = d;
      state.lastZoomSent = now;
      lastActionEl.textContent = delta > 0 ? "Zoom in" : "Zoom out";
      showToast(delta > 0 ? "🔍 ZOOM IN" : "🔍 ZOOM OUT");
    }
  } else {
    state.zoomBaseDist = null;
  }

  // Update status card
  const sg = document.getElementById("status-gesture");
  const sa = document.getElementById("status-action");
  const sc = document.getElementById("status-conf");
  if (sg) sg.textContent = gesture ? gesture.emoji + " " + gesture.name : "—";
  if (sa) sa.textContent = gesture ? (gesture.fire ? "Ejecutando…" : "Detectado") : "Esperando mano…";
  if (sc) sc.textContent = "Confianza: " + (state.confidence ? Math.round(state.confidence * 100) + "%" : "—");

  // Execute discrete gestures (skip in calibration)
  if (gesture && gesture.fire && !state.calibrating) {
    executeGesture(gesture, lm, hands, now);
  }

  updateDebugUI(gesture, handLabel);
}

// ─────────────────────────────────────────────
// Gesture detection
// ─────────────────────────────────────────────
function fingerExtended(lm, tipIdx, pipIdx, mcpIdx) {
  // Simple: tip is further from wrist than pip
  const wrist = lm[0];
  const tip = lm[tipIdx];
  const pip = lm[pipIdx];
  const tipDist = dist(wrist, tip);
  const pipDist = dist(wrist, pip);
  return tipDist > pipDist * 1.15;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

function countExtended(lm) {
  let n = 0;
  // Index 8-6-5, Middle 12-10-9, Ring 16-14-13, Pinky 20-18-17, Thumb special
  if (fingerExtended(lm, 8, 6, 5)) n++;
  if (fingerExtended(lm, 12, 10, 9)) n++;
  if (fingerExtended(lm, 16, 14, 13)) n++;
  if (fingerExtended(lm, 20, 18, 17)) n++;
  // Thumb: compare tip 4 with ip 3 relative to wrist
  const thumbTip = lm[4];
  const thumbIp = lm[3];
  if (dist(lm[0], thumbTip) > dist(lm[0], thumbIp) * 1.1) n++;
  return n;
}

function classifyGesture(lm, allHands, now) {
  const indexExt = fingerExtended(lm, 8, 6, 5);
  const middleExt = fingerExtended(lm, 12, 10, 9);
  const ringExt = fingerExtended(lm, 16, 14, 13);
  const pinkyExt = fingerExtended(lm, 20, 18, 17);
  const thumbExt = dist(lm[0], lm[4]) > dist(lm[0], lm[3]) * 1.18;

  const pinchDist = dist(lm[4], lm[8]);
  const extendedCount = countExtended(lm);

  // Priority 1: Pinch (thumb-index close) — state machine
  if (pinchDist < THRESH.pinchClose) {
    if (state.pinchState === "open") {
      state.pinchState = "closed";
      return { id: "pinch", name: "PINCH", emoji: "🤏", fire: true };
    }
    return { id: "pinch", name: "PINCH", emoji: "🤏", fire: false };
  } else if (pinchDist > THRESH.pinchOpen) {
    state.pinchState = "open";
  }

  // Priority 2: Like (thumb up, others folded) — before fist
  if (thumbExt && !indexExt && !middleExt && !ringExt && !pinkyExt) {
    if (state.likeState !== "fired") {
      state.likeState = "fired";
      return { id: "like", name: "LIKE", emoji: "👍", fire: true };
    }
    return { id: "like", name: "LIKE", emoji: "👍", fire: false };
  } else {
    state.likeState = "idle";
  }

  // Priority 3: Fist (all folded) — right click, state machine
  if (extendedCount <= 1 && pinchDist > THRESH.pinchOpen && !thumbExt) {
    if (state.fistState === "open") {
      state.fistState = "closed";
      return { id: "fist", name: "FIST", emoji: "✊", fire: true };
    }
    return { id: "fist", name: "FIST", emoji: "✊", fire: false };
  } else {
    state.fistState = "open";
  }

  // Priority 4: Rock
  if (indexExt && pinkyExt && !middleExt && !ringExt) {
    return confirmGesture("rock", "ROCK", "🤘", now);
  }

  // Priority 5: Palm (pause)
  if (extendedCount >= 4 && pinchDist > 0.15) {
    return confirmGesture("palm", "PALM", "🖐️", now);
  }

  // Priority 6: Two-hand rectangle (screenshot)
  if (allHands.length >= 2) {
    const lm2 = allHands[1];
    if (
      fingerExtended(lm, 8, 6, 5) &&
      fingerExtended(lm2, 8, 6, 5) &&
      dist(lm[0], lm2[0]) > THRESH.rectMinDist
    ) {
      return confirmGesture("rect", "RECT", "▭", now);
    }
  }

  // Priority 7: Index only → cursor + scroll
  if (indexExt && !middleExt && !ringExt && !pinkyExt) {
    return { id: "index", name: "INDEX", emoji: "☝️", fire: false };
  }

  return null;
}

function confirmGesture(id, name, emoji, now) {
  if (state.currentGesture !== id) {
    state.currentGesture = id;
    state.gestureStartTime = now;
    return { id, name, emoji, fire: false };
  }
  const stable = now - state.gestureStartTime >= (THRESH.stabilityMs || 180);
  const cooled = now - state.lastActionTime >= (state.cooldowns[id] || 600);
  return {
    id,
    name,
    emoji,
    fire: stable && cooled
  };
}

// ─────────────────────────────────────────────
// Execute actions
// ─────────────────────────────────────────────
function executeGesture(gesture, lm, allHands, now) {
  state.lastActionTime = now;
  state.currentGesture = null;

  switch (gesture.id) {
    case "pinch":
      if (state.mode === "keyboard") {
        if (kbHoverKey && performance.now() - kbLastPinch > 400) {
          chrome.runtime.sendMessage({ type: "KB_TYPE", key: kbHoverKey });
          kbLastPinch = performance.now();
          showToast("⌨️ " + kbHoverKey);
        }
      } else if (state.mode === "mouse" || state.mode === "magic") {
        doLeftClick();
      }
      break;
    case "fist":
      if (state.mode === "mouse") doRightClick();
      break;
    case "rock":
      if (state.mode === "magic" || state.mode === "mouse") openSpotify();
      break;
    case "like":
      if (state.mode === "magic") doLike();
      break;
    case "palm":
      pauseSystem();
      break;
    case "rect":
      if (state.mode === "magic") takeScreenshot();
      break;
  }
}

function updateDebug(action, detail) {
  const el = document.getElementById("dbg-action");
  if (el) el.textContent = action + (detail ? " " + detail : "");
  const hist = document.getElementById("dbg-history");
  if (hist) {
    const li = document.createElement("li");
    li.textContent = new Date().toLocaleTimeString() + " — " + action + (detail ? " " + detail : "");
    hist.prepend(li);
    while (hist.children.length > 8) hist.removeChild(hist.lastChild);
  }
}

function updateDebugUI(gesture, handLabel) {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set("dbg-camera", state.running ? "ACTIVE" : "OFF");
  set("dbg-tracking", "TRACKING");
  set("dbg-hand", handLabel);
  set("dbg-gesture", gesture ? gesture.name : "—");
  set("dbg-conf", state.confidence ? Math.round(state.confidence * 100) + "%" : "—");
  set("dbg-mode", state.mode.toUpperCase());
  set("dbg-cursor", cursorEl.classList.contains("active") ? "ACTIVE" : "OFF");
  set("dbg-zoom", state.currentZoom + "%");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const t = tabs[0];
    const pageEl = document.getElementById("status-page");
    if (t && t.url && (t.url.startsWith("http://") || t.url.startsWith("https://"))) {
      set("dbg-tab", (t.title || "").slice(0, 24));
      if (pageEl) pageEl.textContent = "Controlando: " + (t.title || t.url).slice(0, 40);
    } else {
      set("dbg-tab", "—");
      if (pageEl) pageEl.textContent = "Abrí una página web (Google, YouTube…) para controlarla";
    }
  });
}

function doLeftClick() {
  cursorEl.classList.add("clicking");
  setTimeout(() => cursorEl.classList.remove("clicking"), 150);
  lastActionEl.textContent = "Click izquierdo";
  showToast("🖱️ CLICK");
  updateDebug("LEFT CLICK", "");

  // Always send to the active page
  chrome.runtime.sendMessage({ type: "PAGE_CLICK", button: "left" });

  if (state.nativeConnected) {
    chrome.runtime.sendMessage({ type: "NATIVE_CLICK", button: "left" });
  }
  console.log("[ClickMaster] Left click at", state.cursorX, state.cursorY);
}

function doRightClick() {
  lastActionEl.textContent = "Click derecho";
  showToast("🖱️ RIGHT CLICK");
  updateDebug("RIGHT CLICK", "");

  chrome.runtime.sendMessage({ type: "PAGE_CLICK", button: "right" });

  if (state.nativeConnected) {
    chrome.runtime.sendMessage({ type: "NATIVE_CLICK", button: "right" });
  }
  console.log("[ClickMaster] Right click");
}

function openSpotify() {
  lastActionEl.textContent = "Abrir Spotify";
  showToast("🤘 SPOTIFY ACTIVATED");
  chrome.runtime.sendMessage({ type: "OPEN_SPOTIFY" });
}

function doLike() {
  lastActionEl.textContent = "Like";
  showToast("👍 LIKE DETECTED");
  chrome.runtime.sendMessage({ type: "DO_LIKE" });
}

function takeScreenshot() {
  lastActionEl.textContent = "Screenshot";
  showToast("📸 SCREENSHOT CAPTURED");
  chrome.runtime.sendMessage({ type: "TAKE_SCREENSHOT" });
}

function pauseSystem() {
  state.paused = true;
  pauseOverlay.classList.remove("hidden");
  lastActionEl.textContent = "Pausado";
  showToast("⏸️ GESTURE CONTROL PAUSED");
}

function resumeSystem() {
  state.paused = false;
  pauseOverlay.classList.add("hidden");
  systemStatus.textContent = "Activo";
}

// ─────────────────────────────────────────────
// Cursor UI
// ─────────────────────────────────────────────
function updateCursorUI() {
  if (!cursorEl.classList.contains("active")) return;
  // Map normalized coords to the camera-wrapper size
  const wrapper = document.querySelector(".camera-wrapper");
  const rect = wrapper.getBoundingClientRect();
  // Because video is mirrored, x is already correct for display
  const x = state.cursorX * rect.width;
  const y = state.cursorY * rect.height;
  cursorEl.style.left = `${x}px`;
  cursorEl.style.top = `${y}px`;

  // Always send to the active page (virtual cursor)
  const now = performance.now();
  if (now - state.lastNativeMove >= state.nativeMoveInterval) {
    state.lastNativeMove = now;
    chrome.runtime.sendMessage({
      type: "PAGE_MOVE",
      x: state.cursorX,
      y: state.cursorY
    });

    // Also to native host if connected
    if (state.nativeConnected && (state.mode === "mouse" || state.mode === "magic")) {
      chrome.runtime.sendMessage({
        type: "NATIVE_MOVE",
        x: state.cursorX,
        y: state.cursorY
      });
    }
  }
}

// ─────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────
function showToast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  toasts.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// Mode switching
document.querySelectorAll(".mode-card").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-card").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.mode = btn.dataset.mode;
    const badge = document.querySelector(".mode-badge");
    if (badge) badge.textContent = state.mode.toUpperCase();
    systemStatus.textContent = "Modo " + state.mode;
    renderGuide();
    const sm = document.getElementById("status-mode");
    if (sm) sm.textContent = "Modo: " + state.mode.toUpperCase();
    const kb = document.getElementById("air-keyboard");
    if (kb) kb.classList.add("hidden"); // always hide local keyboard
    if (state.mode === "keyboard") {
      chrome.runtime.sendMessage({ type: "SHOW_KEYBOARD" });
    } else {
      chrome.runtime.sendMessage({ type: "HIDE_KEYBOARD" });
    }
  });
});

// Buttons
btnStart.addEventListener("click", async () => {
  if (!state.handLandmarker) {
    await initHandLandmarker();
  }
  await startCamera();
  btnStart.textContent = "RUNNING";
});

btnStop.addEventListener("click", () => {
  stopCamera();
  btnStart.textContent = "START CLICK MASTER";
});
btnResume.addEventListener("click", resumeSystem);

// Minimize camera
document.getElementById("btn-minimize-cam")?.addEventListener("click", () => {
  document.getElementById("camera-wrapper")?.classList.toggle("minimized");
});

// Gesture guides
const GUIDES = {
  mouse: [
    { emoji: "☝️", name: "Cursor", how: "Levantá solo el índice y movelo.", action: "Mueve el cursor amarillo en la pestaña activa." },
    { emoji: "👌", name: "Click izquierdo", how: "Juntá pulgar e índice y soltá rápido.", action: "Click en el elemento bajo el cursor." },
    { emoji: "✊", name: "Click derecho", how: "Cerrá el puño.", action: "Click derecho (el menú nativo puede no abrirse)." },
    { emoji: "☝️↕", name: "Scroll", how: "Índice levantado y mové la mano arriba/abajo.", action: "Desplaza la página." },
    { emoji: "✌️↔", name: "Cambiar pestaña", how: "Índice + medio levantados y deslizá al costado.", action: "Siguiente o anterior pestaña." },
    { emoji: "🖐️", name: "Pausa", how: "Abrí la palma.", action: "Pausa el control de gestos." }
  ],
  magic: [
    { emoji: "🤘", name: "Spotify", how: "Índice y meñique levantados.", action: "Abre Spotify Web." },
    { emoji: "👍", name: "Like", how: "Pulgar arriba, resto plegado.", action: "Intenta dar like (Instagram)." },
    { emoji: "✌️", name: "Nueva pestaña", how: "Índice y medio levantados.", action: "Abre una pestaña nueva." },
    { emoji: "🙌", name: "Screenshot", how: "Dos manos con índices extendidos formando un rectángulo.", action: "Captura PNG de la pestaña." },
    { emoji: "🤏🤏", name: "Zoom", how: "Separá o acercá las dos manos.", action: "Aumenta o reduce el zoom." },
    { emoji: "🖐️", name: "Pausa", how: "Palma abierta.", action: "Pausa el control." }
  ],
  keyboard: [
    { emoji: "☝️", name: "Apuntar", how: "Índice sobre una tecla.", action: "Resalta la tecla." },
    { emoji: "👌", name: "Confirmar", how: "Pinch sobre la tecla resaltada.", action: "Escribe el carácter." },
    { emoji: "⌫", name: "Borrar", how: "Apuntá a BACK y pinch.", action: "Borra el último carácter." }
  ]
};

function renderGuide() {
  const list = document.getElementById("guide-list");
  if (!list) return;
  const items = GUIDES[state.mode] || GUIDES.mouse;
  list.innerHTML = items.map(g => `
    <div class="guide-item">
      <span>${g.emoji}</span>
      <div><strong>${g.name}</strong><span>${g.how}</span></div>
    </div>
  `).join("");
}

// Onboarding
function showOnboarding() {
  document.getElementById("onboarding")?.classList.remove("hidden");
}
function hideOnboarding() {
  document.getElementById("onboarding")?.classList.add("hidden");
  chrome.storage?.local.set({ onboarded: true });
}
document.querySelectorAll(".next-step").forEach(btn => {
  btn.addEventListener("click", () => {
    const step = btn.closest(".modal-step");
    const next = step?.nextElementSibling;
    if (next && next.classList.contains("modal-step")) {
      step.classList.add("hidden");
      next.classList.remove("hidden");
    }
  });
});
document.getElementById("btn-finish-onboarding")?.addEventListener("click", hideOnboarding);

// Guide modal
document.getElementById("btn-guide")?.addEventListener("click", () => {
  const content = document.getElementById("guide-content");
  const items = [...GUIDES.mouse, ...GUIDES.magic];
  content.innerHTML = items.map(g => `
    <div class="guide-card">
      <h4>${g.emoji} ${g.name}</h4>
      <p><strong>Cómo:</strong> ${g.how}</p>
      <p><strong>Qué hace:</strong> ${g.action}</p>
    </div>
  `).join("");
  document.getElementById("guide-modal")?.classList.remove("hidden");
});
document.getElementById("btn-close-guide")?.addEventListener("click", () => {
  document.getElementById("guide-modal")?.classList.add("hidden");
});

// Settings
document.getElementById("btn-settings")?.addEventListener("click", () => {
  document.getElementById("settings-modal")?.classList.remove("hidden");
});
document.getElementById("btn-close-settings")?.addEventListener("click", () => {
  document.getElementById("settings-modal")?.classList.add("hidden");
});
document.getElementById("btn-save-settings")?.addEventListener("click", () => {
  const s = {
    cursor: parseFloat(document.getElementById("set-cursor").value),
    scroll: parseInt(document.getElementById("set-scroll").value, 10),
    stability: parseInt(document.getElementById("set-stability").value, 10),
    debug: document.getElementById("set-debug").checked,
    landmarks: document.getElementById("set-landmarks").checked
  };
  chrome.storage?.local.set({ settings: s });
  THRESH.stabilityMs = s.stability;
  document.getElementById("debug-panel")?.classList.toggle("hidden", !s.debug);
  document.getElementById("settings-modal")?.classList.add("hidden");
  showToast("Configuración guardada");
});
document.getElementById("btn-restart-tutorial")?.addEventListener("click", () => {
  document.getElementById("settings-modal")?.classList.add("hidden");
  document.querySelectorAll(".modal-step").forEach((s, i) => s.classList.toggle("hidden", i !== 0));
  showOnboarding();
});

// Calibration mode flag (during onboarding step 4)
state.calibrating = false;
const onboarding = document.getElementById("onboarding");
const observer = new MutationObserver(() => {
  const step4 = document.querySelector('.modal-step[data-step="4"]');
  state.calibrating = onboarding && !onboarding.classList.contains("hidden") && step4 && !step4.classList.contains("hidden");
  const cr = document.getElementById("calib-result");
  if (state.calibrating && cr) cr.textContent = lastGestureEl?.textContent || "Esperando gesto…";
});
if (onboarding) observer.observe(onboarding, { attributes: true, subtree: true, attributeFilter: ["class"] });

// Boot
chrome.storage?.local.get(["onboarded", "settings"], (res) => {
  if (!res.onboarded) showOnboarding();
  if (res.settings) {
    if (res.settings.stability) THRESH.stabilityMs = res.settings.stability;
    if (res.settings.debug) document.getElementById("debug-panel")?.classList.remove("hidden");
  }
});
renderGuide();
console.log("[ClickMaster] Dashboard loaded");
systemStatus.textContent = "Listo — pulsá START";

// ─────────────────────────────────────────────
// Air Keyboard
// ─────────────────────────────────────────────
const KB_LAYOUT = [
  ["1","2","3","4","5","6","7","8","9","0"],
  ["Q","W","E","R","T","Y","U","I","O","P"],
  ["A","S","D","F","G","H","J","K","L"],
  ["Z","X","C","V","B","N","M",",","."],
  ["SPACE","BACK","ENTER"]
];

function buildKeyboard() {
  const rows = document.getElementById("kb-rows");
  if (!rows) return;
  rows.innerHTML = "";
  KB_LAYOUT.forEach(row => {
    const div = document.createElement("div");
    div.className = "kb-row";
    row.forEach(key => {
      const btn = document.createElement("div");
      btn.className = "kb-key" + (key.length > 1 ? " wide" : "");
      btn.dataset.key = key;
      btn.textContent = key === "SPACE" ? "␣" : key === "BACK" ? "⌫" : key === "ENTER" ? "↵" : key;
      div.appendChild(btn);
    });
    rows.appendChild(div);
  });
}

let kbHoverKey = null;
let kbLastPinch = 0;

function updateKeyboardPointer() {
  if (state.mode !== "keyboard" || !state.running) return;
  chrome.runtime.sendMessage({
    type: "KB_POINT",
    x: state.cursorX,
    y: state.cursorY
  }, (res) => {
    if (res && res.key) kbHoverKey = res.key;
  });
}

function typeKey(key) {
  const input = document.getElementById("kb-input");
  if (!input) return;
  if (key === "BACK") input.value = input.value.slice(0, -1);
  else if (key === "SPACE") input.value += " ";
  else if (key === "ENTER") input.value += "\n";
  else input.value += key;
  showToast("⌨️ " + key);
  lastActionEl.textContent = "Tecla: " + key;
}

// Hook into the main loop via a light interval
setInterval(() => {
  if (state.mode === "keyboard" && state.running) updateKeyboardPointer();
}, 50);

buildKeyboard();

