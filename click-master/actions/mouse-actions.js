/**
 * Mouse-related actions
 *
 * When Native Messaging host is connected:
 *   - NATIVE_MOVE / NATIVE_CLICK go through the service worker → host → OS cursor
 * When not connected:
 *   - Only the visual cursor inside the Dashboard is updated
 */

export function moveCursor(x, y) {
  return chrome.runtime.sendMessage({ type: "NATIVE_MOVE", x, y });
}

export function leftClick() {
  return chrome.runtime.sendMessage({ type: "NATIVE_CLICK", button: "left" });
}

export function rightClick() {
  return chrome.runtime.sendMessage({ type: "NATIVE_CLICK", button: "right" });
}

export function scroll(dx, dy) {
  return chrome.runtime.sendMessage({ type: "NATIVE_SCROLL", dx, dy });
}
