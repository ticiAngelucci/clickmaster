#!/usr/bin/env python3
"""
Click Master — Native Messaging Host
Receives cursor coordinates and click commands from the Chrome extension
and moves the system mouse using pynput.

Protocol (stdin/stdout, length-prefixed JSON):
  Incoming:  { "type": "move", "x": 0.5, "y": 0.3 }   # normalized 0-1
             { "type": "click", "button": "left" }
             { "type": "click", "button": "right" }
             { "type": "scroll", "dx": 0, "dy": -3 }
             { "type": "ping" }

  Outgoing:  { "ok": true, "type": "..." }
             { "ok": false, "error": "..." }
"""

import sys
import json
import struct
import platform

try:
    from pynput.mouse import Controller, Button
except ImportError:
    sys.stderr.write(
        "ERROR: pynput is required. Install with:\n"
        "  pip install pynput\n"
    )
    sys.exit(1)

mouse = Controller()
SCREEN_W = None
SCREEN_H = None


def get_screen_size():
    """Return (width, height) of the primary screen."""
    global SCREEN_W, SCREEN_H
    if SCREEN_W is not None:
        return SCREEN_W, SCREEN_H

    system = platform.system()
    try:
        if system == "Windows":
            import ctypes
            user32 = ctypes.windll.user32
            SCREEN_W = user32.GetSystemMetrics(0)
            SCREEN_H = user32.GetSystemMetrics(1)
        elif system == "Darwin":
            # macOS
            from AppKit import NSScreen
            frame = NSScreen.mainScreen().frame()
            SCREEN_W = int(frame.size.width)
            SCREEN_H = int(frame.size.height)
        else:
            # Linux / X11
            from Xlib import display
            d = display.Display()
            screen = d.screen()
            SCREEN_W = screen.width_in_pixels
            SCREEN_H = screen.height_in_pixels
            d.close()
    except Exception:
        # Fallback: assume a common resolution; still better than crashing
        SCREEN_W, SCREEN_H = 1920, 1080

    return SCREEN_W, SCREEN_H


def read_message():
    """Read a single length-prefixed JSON message from stdin."""
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len or len(raw_len) < 4:
        return None
    msg_len = struct.unpack("<I", raw_len)[0]
    data = sys.stdin.buffer.read(msg_len)
    if not data:
        return None
    return json.loads(data.decode("utf-8"))


def send_message(obj):
    """Write a length-prefixed JSON message to stdout."""
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def handle(msg):
    msg_type = msg.get("type")

    if msg_type == "ping":
        w, h = get_screen_size()
        return {"ok": True, "type": "pong", "screen": {"w": w, "h": h}}

    if msg_type == "move":
        x_norm = float(msg.get("x", 0.5))
        y_norm = float(msg.get("y", 0.5))
        # Clamp
        x_norm = max(0.0, min(1.0, x_norm))
        y_norm = max(0.0, min(1.0, y_norm))
        w, h = get_screen_size()
        # Note: video is mirrored, so we invert X for natural feel
        # (user moves hand left → cursor goes left on screen)
        px = int((1.0 - x_norm) * (w - 1))
        py = int(y_norm * (h - 1))
        mouse.position = (px, py)
        return {"ok": True, "type": "move", "x": px, "y": py}

    if msg_type == "click":
        button = msg.get("button", "left")
        if button == "right":
            mouse.click(Button.right, 1)
        else:
            mouse.click(Button.left, 1)
        return {"ok": True, "type": "click", "button": button}

    if msg_type == "scroll":
        dx = int(msg.get("dx", 0))
        dy = int(msg.get("dy", 0))
        mouse.scroll(dx, dy)
        return {"ok": True, "type": "scroll"}

    return {"ok": False, "error": f"Unknown type: {msg_type}"}


def main():
    # Warm up screen size
    get_screen_size()
    send_message({"ok": True, "type": "ready", "platform": platform.system()})

    while True:
        try:
            msg = read_message()
            if msg is None:
                break
            reply = handle(msg)
            send_message(reply)
        except Exception as e:
            try:
                send_message({"ok": False, "error": str(e)})
            except Exception:
                break


if __name__ == "__main__":
    main()
