/**
 * Configurable thresholds and gesture definitions
 */
export const GESTURE_CONFIG = {
  stabilityMs: 180,
  cooldowns: {
    click: 400,
    rock: 2000,
    like: 1500,
    screenshot: 2500,
    fist: 500,
    palm: 800,
    zoom: 100
  },
  thresholds: {
    pinchClose: 0.045,
    pinchOpen: 0.08,
    fistMaxExt: 0.12,
    rockIndex: 0.25,
    rockPinky: 0.25,
    likeThumb: 0.25,
    palmOpenMin: 0.22,
    rectMinDist: 0.15
  },
  gestures: [
    { id: "index", name: "Cursor", emoji: "☝️", action: "move_cursor", modes: ["mouse", "magic"] },
    { id: "pinch", name: "Click izquierdo", emoji: "🤏", action: "left_click", modes: ["mouse", "magic"] },
    { id: "fist", name: "Click derecho", emoji: "✊", action: "right_click", modes: ["mouse"] },
    { id: "rock", name: "Spotify", emoji: "🤘", action: "open_spotify", modes: ["magic", "mouse"] },
    { id: "zoom", name: "Zoom", emoji: "🔍", action: "zoom", modes: ["magic"] },
    { id: "rect", name: "Screenshot", emoji: "▭", action: "screenshot", modes: ["magic"] },
    { id: "like", name: "Like", emoji: "👍", action: "like", modes: ["magic"] },
    { id: "palm", name: "Pausar", emoji: "🖐️", action: "pause", modes: ["mouse", "magic", "keyboard"] }
  ]
};
