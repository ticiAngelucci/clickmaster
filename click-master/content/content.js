/**
 * Click Master — Content script (Instagram adapter)
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PERFORM_LIKE") {
    const result = tryLikeOnInstagram();
    sendResponse(result);
    return true;
  }
  return false;
});

function tryLikeOnInstagram() {
  // Prefer the visible post's like button using accessible attributes
  // Instagram uses SVG with aria-label "Like" / "Me gusta" / "Unlike"
  const candidates = [
    ...document.querySelectorAll('svg[aria-label="Like"], svg[aria-label="Me gusta"]'),
    ...document.querySelectorAll('button[aria-label="Like"], button[aria-label="Me gusta"]'),
    ...document.querySelectorAll('[aria-label="Like"], [aria-label="Me gusta"]')
  ];

  // Find the first that is not already liked (no "Unlike")
  for (const el of candidates) {
    const label = (el.getAttribute("aria-label") || "").toLowerCase();
    if (label.includes("unlike") || label.includes("ya no me gusta")) continue;

    // Prefer the button or the closest clickable parent
    const clickable = el.closest("button, div[role='button']") || el;
    try {
      clickable.click();
      return { ok: true, message: "Like executed" };
    } catch (e) {
      console.warn("[ClickMaster] Click failed", e);
    }
  }

  // Fallback: look for heart icons that are not filled
  const hearts = document.querySelectorAll('svg[aria-label*="ike"], svg[aria-label*="gusta"]');
  if (hearts.length === 0) {
    return {
      ok: false,
      message: "No se encontró botón de Like. ¿Estás en un post de Instagram?"
    };
  }

  return {
    ok: false,
    message: "Like no disponible o ya estaba dado. Instagram puede haber cambiado la UI."
  };
}

console.log("[ClickMaster] Instagram content script loaded");
