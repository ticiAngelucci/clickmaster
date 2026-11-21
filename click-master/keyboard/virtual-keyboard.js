/**
 * Air Keyboard (P2 — arquitectura preparada)
 * No implementado en el MVP de 2 horas.
 * El teclado QWERTY + dwell + pinch confirmation irá aquí.
 */

export class VirtualKeyboard {
  constructor() {
    this.visible = false;
    this.layout = "qwerty";
  }

  show() {
    console.log("[Keyboard] Show (not implemented in MVP)");
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }

  /**
   * Highlight key under index tip and confirm with pinch after dwell time.
   */
  update(indexTip, isPinching) {
    // TODO: implement
  }
}
