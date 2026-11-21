#!/usr/bin/env python3
"""
Click Master — Native Host Installer

Usage:
  python install_host.py --extension-id <YOUR_EXTENSION_ID>

Finds the absolute path of click_master_host.py, writes the host manifest
with the correct path + extension ID, and registers it for the current OS.
"""

import argparse
import json
import os
import platform
import shutil
import sys

HOST_NAME = "com.clickmaster.host"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
HOST_SCRIPT = os.path.join(SCRIPT_DIR, "click_master_host.py")
MANIFEST_SRC = os.path.join(SCRIPT_DIR, "com.clickmaster.host.json")


def get_manifest_dir():
    system = platform.system()
    if system == "Windows":
        # Prefer HKCU so no admin is required
        return os.path.join(
            os.environ.get("LOCALAPPDATA", ""),
            "Google", "Chrome", "User Data", "NativeMessagingHosts"
        )
    elif system == "Darwin":
        return os.path.expanduser(
            "~/Library/Application Support/Google/Chrome/NativeMessagingHosts"
        )
    else:  # Linux
        return os.path.expanduser(
            "~/.config/google-chrome/NativeMessagingHosts"
        )


def make_executable():
    if platform.system() != "Windows":
        os.chmod(HOST_SCRIPT, 0o755)


def write_manifest(extension_id: str) -> str:
    with open(MANIFEST_SRC, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Absolute path to the Python script
    # On Windows Chrome expects a .bat or .exe launcher sometimes;
    # we create a small .bat that calls python.
    if platform.system() == "Windows":
        bat_path = os.path.join(SCRIPT_DIR, "click_master_host.bat")
        with open(bat_path, "w", encoding="utf-8") as bat:
            bat.write(f'@echo off\npython "{HOST_SCRIPT}" %*\n')
        data["path"] = bat_path.replace("/", "\\")
    else:
        data["path"] = HOST_SCRIPT

    data["allowed_origins"] = [f"chrome-extension://{extension_id}/"]

    dest_dir = get_manifest_dir()
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, f"{HOST_NAME}.json")

    with open(dest_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    return dest_path


def register_windows_registry(manifest_path: str):
    """Write HKCU registry key so Chrome finds the host."""
    try:
        import winreg
        key_path = rf"Software\Google\Chrome\NativeMessagingHosts\{HOST_NAME}"
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path) as key:
            winreg.SetValueEx(key, None, 0, winreg.REG_SZ, manifest_path)
        print(f"  Registry key written: HKCU\\{key_path}")
    except Exception as e:
        print(f"  WARNING: could not write registry key: {e}")
        print("  You may need to create it manually.")


def main():
    parser = argparse.ArgumentParser(description="Install Click Master native host")
    parser.add_argument(
        "--extension-id",
        required=True,
        help="Extension ID from chrome://extensions (32-char string)"
    )
    args = parser.parse_args()

    if not os.path.isfile(HOST_SCRIPT):
        print(f"ERROR: host script not found at {HOST_SCRIPT}")
        sys.exit(1)

    print("=== Click Master Native Host Installer ===\n")
    print(f"Host script : {HOST_SCRIPT}")
    print(f"Extension ID: {args.extension_id}")

    # Check pynput
    try:
        import pynput  # noqa: F401
        print("pynput     : OK")
    except ImportError:
        print("pynput     : MISSING")
        print("\nInstall it first:")
        print("  pip install pynput")
        sys.exit(1)

    make_executable()
    dest = write_manifest(args.extension_id)
    print(f"\nManifest written to:\n  {dest}")

    if platform.system() == "Windows":
        register_windows_registry(dest)

    print("\n✅ Done. Restart Chrome completely, then open the Click Master Dashboard.")
    print("   In the Dashboard you should see 'Native host connected' in the status bar.")


if __name__ == "__main__":
    main()
