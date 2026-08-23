#!/usr/bin/env python3
"""Windows Computer Use helper.

Uses win32gui / win32api / win32process / psutil / pyperclip / screeninfo /
pyautogui to provide, on Windows, the JSON command protocol the native macOS
`cu-helper` daemon speaks. macOS is native-only — there is no Python path there
— so this is the sole implementation of that protocol in Python.

One difference is not an implementation detail and shapes everything below:
macOS delivers input with `CGEvent.postToPid`, straight into the target
process, leaving the real cursor and the foreground app alone. Windows has no
equivalent. `pyautogui` bottoms out in `SendInput`, which injects into the one
system-wide input stream and warps the one real cursor. The agent therefore
shares the mouse and keyboard with the user, and cannot verify that anything
it sent arrived.

Hence the two mechanisms that have no macOS counterpart:

  * `ForegroundLease` aborts when physical input overlaps an action, because
    interleaved streams produce clicks neither party intended.
  * `ensure_point_on_screen` / `ensure_target_window_reachable` refuse to send
    at all when delivery is already known to be impossible.

Both exist because `SendInput` reports success unconditionally, and "Action
completed" for input that went nowhere is worse than an error.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
from io import BytesIO
from pathlib import Path
from typing import Any

import mss
from PIL import Image

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
os.environ.setdefault("PYAUTOGUI_HIDE_SUPPORT_PROMPT", "1")

import pyautogui  # noqa: E402

# The desktop app decodes helper stdout as UTF-8. On Windows, redirected Python
# stdout defaults to the active ANSI code page (for example GBK), which mangles
# localized app names from the registry. Force UTF-8 at process start so JSON
# responses stay stable regardless of the user's system locale.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="strict")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

# ---------------------------------------------------------------------------
# Key mapping — Windows uses 'win' instead of 'command'
# ---------------------------------------------------------------------------
KEY_MAP = {
    "a": "a", "b": "b", "c": "c", "d": "d", "e": "e",
    "f": "f", "g": "g", "h": "h", "i": "i", "j": "j",
    "k": "k", "l": "l", "m": "m", "n": "n", "o": "o",
    "p": "p", "q": "q", "r": "r", "s": "s", "t": "t",
    "u": "u", "v": "v", "w": "w", "x": "x", "y": "y",
    "z": "z",
    "0": "0", "1": "1", "2": "2", "3": "3", "4": "4",
    "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
    # Modifier keys — map macOS names to Windows equivalents
    "cmd": "win",
    "command": "win",
    "meta": "win",
    "super": "win",
    "ctrl": "ctrl",
    "control": "ctrl",
    "shift": "shift",
    "alt": "alt",
    "option": "alt",
    "opt": "alt",
    "fn": "fn",
    # Navigation / editing
    "escape": "esc",
    "esc": "esc",
    "enter": "enter",
    "return": "enter",
    "tab": "tab",
    "space": "space",
    "backspace": "backspace",
    "delete": "delete",
    "forwarddelete": "delete",
    "up": "up",
    "down": "down",
    "left": "left",
    "right": "right",
    "home": "home",
    "end": "end",
    "pageup": "pageup",
    "pagedown": "pagedown",
    "capslock": "capslock",
    # Function keys
    "f1": "f1", "f2": "f2", "f3": "f3", "f4": "f4",
    "f5": "f5", "f6": "f6", "f7": "f7", "f8": "f8",
    "f9": "f9", "f10": "f10", "f11": "f11", "f12": "f12",
    # Symbols
    "-": "-", "=": "=", "[": "[", "]": "]", "\\": "\\",
    ";": ";", "'": "'", ",": ",", ".": ".", "/": "/", "`": "`",
}


def normalize_key(name: str) -> str:
    key = name.strip().lower()
    if key not in KEY_MAP:
        raise ValueError(f"Unsupported key: {name}")
    return KEY_MAP[key]


# ---------------------------------------------------------------------------
# JSON output helpers
# ---------------------------------------------------------------------------

def json_output(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def error_output(message: str, code: str = "runtime_error") -> None:
    json_output({"ok": False, "error": {"code": code, "message": message}})


def bool_env(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value not in {"0", "false", "False", ""}


# ---------------------------------------------------------------------------
# Display / Monitor helpers (via screeninfo + ctypes)
# ---------------------------------------------------------------------------

def get_displays() -> list[dict[str, Any]]:
    """Enumerate monitors via screeninfo, with DPI scale from ctypes."""
    from screeninfo import get_monitors

    displays: list[dict[str, Any]] = []
    for idx, m in enumerate(get_monitors()):
        scale_factor = _get_monitor_scale(m)
        name = m.name or f"Display {idx + 1}"
        displays.append({
            "id": idx,
            "displayId": idx,
            "width": m.width,
            "height": m.height,
            "scaleFactor": scale_factor,
            "originX": m.x,
            "originY": m.y,
            "isPrimary": m.is_primary if hasattr(m, "is_primary") else (idx == 0),
            "name": name,
            "label": name,
        })
    return displays


def _get_monitor_scale(monitor: Any) -> float:
    """Get the DPI scale factor for a monitor. Returns 1.0 on failure."""
    try:
        import ctypes
        # SetProcessDPIAware so we get real pixel values
        ctypes.windll.user32.SetProcessDPIAware()
        # Get DPI for the primary — simplified; per-monitor DPI is complex
        hdc = ctypes.windll.user32.GetDC(0)
        dpi = ctypes.windll.gdi32.GetDeviceCaps(hdc, 88)  # LOGPIXELSX
        ctypes.windll.user32.ReleaseDC(0, hdc)
        return dpi / 96.0
    except Exception:
        return 1.0


def choose_display(display_id: int | None) -> dict[str, Any]:
    displays = get_displays()
    if not displays:
        raise RuntimeError("No active displays found")
    if display_id is None:
        for display in displays:
            if display["isPrimary"]:
                return display
        return displays[0]
    for display in displays:
        if display["displayId"] == display_id or display["id"] == display_id:
            return display
    raise RuntimeError(f"Unknown display: {display_id}")


# ---------------------------------------------------------------------------
# Screen capture (mss)
# ---------------------------------------------------------------------------

def capture_display(display_id: int | None, resize: tuple[int, int] | None = None) -> dict[str, Any]:
    display = choose_display(display_id)
    monitor = {
        "left": display["originX"],
        "top": display["originY"],
        "width": display["width"],
        "height": display["height"],
    }
    with mss.mss() as sct:
        raw = sct.grab(monitor)
        image = Image.frombytes("RGB", raw.size, raw.rgb)
    if resize:
        image = image.resize(resize, Image.Resampling.LANCZOS)
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=75, optimize=True)
    base64_data = base64.b64encode(buffer.getvalue()).decode("ascii")
    return {
        "base64": base64_data,
        "width": image.width,
        "height": image.height,
        "displayWidth": display["width"],
        "displayHeight": display["height"],
        "displayId": display["displayId"],
        "originX": display["originX"],
        "originY": display["originY"],
        "display": display,
    }


def capture_region(region: dict[str, int], resize: tuple[int, int] | None = None) -> dict[str, Any]:
    with mss.mss() as sct:
        raw = sct.grab(region)
        image = Image.frombytes("RGB", raw.size, raw.rgb)
    if resize:
        image = image.resize(resize, Image.Resampling.LANCZOS)
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=75, optimize=True)
    base64_data = base64.b64encode(buffer.getvalue()).decode("ascii")
    return {"base64": base64_data, "width": image.width, "height": image.height}


# ---------------------------------------------------------------------------
# Window management (win32gui)
# ---------------------------------------------------------------------------

def list_windows() -> list[dict[str, Any]]:
    """List visible on-screen windows with their bounds."""
    import win32gui

    results: list[dict[str, Any]] = []

    def _enum_cb(hwnd: int, _: Any) -> None:
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd)
        try:
            left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        except Exception:
            return
        width = right - left
        height = bottom - top
        if width <= 1 or height <= 1:
            return
        # Get the process name as owner
        owner = _get_window_process_name(hwnd)
        results.append({
            "ownerName": owner,
            "title": title,
            "bounds": {"x": left, "y": top, "width": width, "height": height},
        })

    win32gui.EnumWindows(_enum_cb, None)
    return results


def _get_window_process_name(hwnd: int) -> str:
    """Get the exe name of the process owning a window handle."""
    try:
        import win32process
        import psutil
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        proc = psutil.Process(pid)
        return proc.name()
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Application management
# ---------------------------------------------------------------------------

def _get_exe_path_for_pid(pid: int) -> str | None:
    try:
        import psutil
        return psutil.Process(pid).exe()
    except Exception:
        return None


def installed_apps() -> list[dict[str, Any]]:
    """List installed programs from Windows registry and Start Menu shortcuts."""
    import winreg

    results: dict[str, dict[str, Any]] = {}
    reg_paths = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]

    for hive, sub_key in reg_paths:
        try:
            key = winreg.OpenKey(hive, sub_key)
        except OSError:
            continue
        try:
            i = 0
            while True:
                try:
                    name = winreg.EnumKey(key, i)
                    i += 1
                except OSError:
                    break
                try:
                    app_key = winreg.OpenKey(key, name)
                except OSError:
                    continue
                try:
                    display_name = winreg.QueryValueEx(app_key, "DisplayName")[0]
                except OSError:
                    winreg.CloseKey(app_key)
                    continue
                # Use the registry key name as a stable identifier (like bundleId)
                try:
                    install_location = winreg.QueryValueEx(app_key, "InstallLocation")[0]
                except OSError:
                    install_location = ""
                try:
                    display_icon = winreg.QueryValueEx(app_key, "DisplayIcon")[0]
                except OSError:
                    display_icon = ""
                normalized_icon = str(display_icon).split(",")[0].strip().strip('"')
                normalized_install_location = str(install_location).strip().strip('"')

                bundle_id = name
                for candidate in (normalized_icon, normalized_install_location):
                    if not candidate:
                        continue
                    candidate_path = Path(candidate)
                    if candidate_path.suffix.lower() == ".exe":
                        bundle_id = candidate_path.stem
                        break

                app_path = normalized_icon or normalized_install_location or ""
                if bundle_id not in results:
                    results[bundle_id] = {
                        "bundleId": bundle_id,
                        "displayName": str(display_name),
                        "path": app_path,
                    }
                winreg.CloseKey(app_key)
        finally:
            winreg.CloseKey(key)

    return sorted(results.values(), key=lambda item: item["displayName"].lower())


def running_apps() -> list[dict[str, Any]]:
    """List running GUI applications."""
    import psutil

    apps: list[dict[str, Any]] = []
    seen: set[str] = set()

    for proc in psutil.process_iter(["pid", "name", "exe"]):
        try:
            name = proc.info["name"] or ""
            exe_path = proc.info["exe"] or ""
            if not name or name in seen:
                continue
            # Skip system/background processes (no window)
            if not exe_path:
                continue
            seen.add(name)
            # Use exe name (without .exe) as bundleId
            bundle_id = Path(exe_path).stem if exe_path else name
            apps.append({"bundleId": bundle_id, "displayName": name})
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    return sorted(apps, key=lambda item: item["displayName"].lower())


def app_display_name(bundle_id: str) -> str | None:
    """Find display name for a given bundleId (exe stem or registry key)."""
    import psutil
    for proc in psutil.process_iter(["name", "exe"]):
        try:
            exe = proc.info["exe"] or ""
            if exe and Path(exe).stem == bundle_id:
                return proc.info["name"]
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return None


def frontmost_app() -> dict[str, str] | None:
    """Get the currently focused (foreground) application."""
    import win32gui
    import win32process
    import psutil

    hwnd = win32gui.GetForegroundWindow()
    if not hwnd:
        return None
    try:
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        proc = psutil.Process(pid)
        exe_path = proc.exe()
        return {
            "bundleId": Path(exe_path).stem,
            "displayName": proc.name(),
        }
    except Exception:
        return None


def app_under_point(x: int, y: int) -> dict[str, str] | None:
    """Find the app whose window is under the given screen coordinate."""
    import win32gui
    import win32process
    import psutil

    hwnd = win32gui.WindowFromPoint((x, y))
    if not hwnd:
        return frontmost_app()
    # Walk up to the top-level owner
    root = win32gui.GetAncestor(hwnd, 3)  # GA_ROOTOWNER = 3
    if root:
        hwnd = root
    try:
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        proc = psutil.Process(pid)
        exe_path = proc.exe()
        return {
            "bundleId": Path(exe_path).stem,
            "displayName": proc.name(),
        }
    except Exception:
        return frontmost_app()


def find_window_displays(bundle_ids: list[str]) -> list[dict[str, Any]]:
    """For each bundleId, find which display(s) its windows are on."""
    if not bundle_ids:
        return []

    displays = get_displays()
    windows = list_windows()

    # Build exe-stem -> ownerName mapping
    names_by_bundle: dict[str, str | None] = {}
    for bid in bundle_ids:
        names_by_bundle[bid] = app_display_name(bid)

    result = []
    for bundle_id in bundle_ids:
        target_name = names_by_bundle.get(bundle_id)
        display_ids: set[int] = set()
        for window in windows:
            owner = window["ownerName"]
            if not owner:
                continue
            # Match by exe name
            owner_stem = Path(owner).stem if owner.endswith(".exe") else owner
            if target_name and owner != target_name and owner_stem != bundle_id:
                continue
            if not target_name and owner_stem != bundle_id and owner != bundle_id:
                continue
            # Check which displays this window overlaps
            wx = window["bounds"]["x"]
            wy = window["bounds"]["y"]
            ww = window["bounds"]["width"]
            wh = window["bounds"]["height"]
            for display in displays:
                dx = display["originX"]
                dy = display["originY"]
                dw = display["width"]
                dh = display["height"]
                # Check rectangle intersection
                if wx < dx + dw and wx + ww > dx and wy < dy + dh and wy + wh > dy:
                    display_ids.add(int(display["displayId"]))
        result.append({"bundleId": bundle_id, "displayIds": sorted(display_ids)})
    return result


def open_app(bundle_id: str) -> None:
    """Open an application by its bundleId (exe path or program name)."""
    # Try to find the exe path from registry
    import winreg
    exe_path = None

    reg_paths = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]
    for hive, sub_key in reg_paths:
        try:
            key = winreg.OpenKey(hive, sub_key)
            i = 0
            while True:
                try:
                    name = winreg.EnumKey(key, i)
                    i += 1
                except OSError:
                    break
                try:
                    app_key = winreg.OpenKey(key, name)
                except OSError:
                    continue
                try:
                    display_icon = winreg.QueryValueEx(app_key, "DisplayIcon")[0]
                except OSError:
                    display_icon = ""
                try:
                    install_location = winreg.QueryValueEx(app_key, "InstallLocation")[0]
                except OSError:
                    install_location = ""

                normalized_icon = str(display_icon).split(",")[0].strip().strip('"')
                normalized_install_location = str(install_location).strip().strip('"')

                derived_bundle_id = name
                for candidate in (normalized_icon, normalized_install_location):
                    if not candidate:
                        continue
                    candidate_path = Path(candidate)
                    if candidate_path.suffix.lower() == ".exe":
                        derived_bundle_id = candidate_path.stem
                        break

                if name == bundle_id or derived_bundle_id == bundle_id:
                    exe_path = normalized_icon or normalized_install_location or None
                    winreg.CloseKey(app_key)
                    break
                winreg.CloseKey(app_key)
            winreg.CloseKey(key)
            if exe_path:
                break
        except OSError:
            continue

    if exe_path and Path(exe_path).exists():
        os.startfile(exe_path)
    else:
        # Fallback: try to run it directly
        try:
            subprocess.Popen([bundle_id], shell=True)
        except Exception:
            raise RuntimeError(f"App not found for identifier: {bundle_id}")


# ---------------------------------------------------------------------------
# Clipboard (pyperclip — cross-platform)
# ---------------------------------------------------------------------------

def read_clipboard() -> str:
    import pyperclip
    try:
        return pyperclip.paste() or ""
    except Exception:
        return ""


def write_clipboard(text: str) -> None:
    import pyperclip
    pyperclip.copy(text)


def paste_clipboard() -> None:
    pyautogui.hotkey("ctrl", "v", interval=0.02)


# ---------------------------------------------------------------------------
# Physical input interference detection
# ---------------------------------------------------------------------------
#
# Why this exists at all, and why it is stricter than the macOS version.
#
# On macOS the helper posts events straight into the target process with
# `CGEvent.postToPid`, so agent input and human input never share a channel:
# the epoch monitor there is a safety net for an unlikely race.
#
# Windows has no such API. `pyautogui` bottoms out in `SendInput`, which
# injects into the ONE system-wide input stream and warps the ONE real cursor.
# The agent and the user are therefore holding the same mouse. If the user
# reaches for it mid-action the two streams interleave, and the resulting
# click lands somewhere neither of them intended. Detection is not a nicety
# here — it is the only thing standing between "the agent typed into the wrong
# window" and an abort.
#
# `GetLastInputInfo` is the right signal for this: it reports the tick of the
# last PHYSICAL input event, requires no privileges and no TCC-style grant,
# and — measured, and asserted by test_helpers.py — is NOT advanced by
# `SendInput` injection, so the agent cannot trip its own detector.

import ctypes
from ctypes import wintypes


class _LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def last_physical_input_tick() -> int:
    """Tick count of the last physical keyboard/mouse event.

    Returns 0 when unavailable so callers fail OPEN on the read itself: a
    helper that refused to act because it could not query an optional Win32
    counter would be broken in a much more visible way than one that acted.
    Interference is only ever reported on two SUCCESSFUL reads that differ.
    """
    try:
        info = _LASTINPUTINFO()
        info.cbSize = ctypes.sizeof(_LASTINPUTINFO)
        if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
            return 0
        return int(info.dwTime)
    except Exception:
        return 0


class UserInterference(RuntimeError):
    """The user touched the physical mouse or keyboard during an action."""

    def __init__(self, message: str, code: str = "user_interference") -> None:
        super().__init__(message)
        self.code = code


def _foreground_window_pid() -> int | None:
    try:
        import win32gui
        import win32process
        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return None
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        return int(pid)
    except Exception:
        return None


class ForegroundLease:
    """Guards one mutating action against concurrent physical input.

    Evidence is sampled in a fixed order — tick, foreground identity, tick —
    both before and after the action, so a single observation cannot straddle
    a change it fails to notice. Same shape as `ForegroundLease.swift`.

    The asymmetry between the two failure modes is deliberate and is the whole
    point of the class:

      * interference BEFORE the action  -> `user_interference`. Nothing ran.
        The caller may safely retry.
      * interference DURING the action  -> `user_interference_result_unknown`.
        Injection already went into the shared input stream and we cannot know
        how much of it landed, or where. Retrying could double-apply it. The
        error says so rather than guessing.
    """

    def __init__(self) -> None:
        self.tick: int = 0
        self.pid: int | None = None

    def acquire(self) -> None:
        before = last_physical_input_tick()
        pid = _foreground_window_pid()
        after = last_physical_input_tick()
        if before and after and before != after:
            raise UserInterference(
                "The user was typing or moving the mouse, so the action was "
                "not sent. Nothing has changed; it is safe to try again."
            )
        self.tick = after
        self.pid = pid

    def finalize(self) -> None:
        before = last_physical_input_tick()
        pid = _foreground_window_pid()
        after = last_physical_input_tick()

        if before and after and before != after:
            raise UserInterference(
                "The user used the mouse or keyboard while this action was "
                "running. Because Windows shares one input stream between you "
                "and the user, the two may have interleaved and the result is "
                "UNKNOWN. Do not repeat the action — take a screenshot and "
                "read the current state before deciding anything.",
                code="user_interference_result_unknown",
            )

        if self.tick and after and self.tick != after:
            raise UserInterference(
                "The user used the mouse or keyboard while this action was "
                "running. The result is UNKNOWN — do not repeat the action; "
                "take a screenshot and read the current state first.",
                code="user_interference_result_unknown",
            )

        # A foreground change without any physical input is the target app (or
        # a background app) stealing activation, not the user. Worth reporting,
        # because everything typed after it went somewhere unintended.
        if self.pid is not None and pid is not None and self.pid != pid:
            raise UserInterference(
                "The foreground application changed while this action was "
                "running, so input may have gone to the wrong window. The "
                "result is UNKNOWN — take a screenshot before continuing.",
                code="user_interference_result_unknown",
            )


# ---------------------------------------------------------------------------
# Permissions — Windows doesn't have macOS-style TCC
# ---------------------------------------------------------------------------

def check_permissions() -> dict[str, bool | None]:
    """Windows does not require explicit accessibility/screen-recording
    permissions like macOS TCC. Always report as granted."""
    return {
        "accessibility": True,
        "screenRecording": True,
    }


# ---------------------------------------------------------------------------
# Delivery preconditions — refuse rather than report a lie
# ---------------------------------------------------------------------------
#
# `SendInput` always "succeeds": it returns the number of events inserted into
# the input stream, never whether anything acted on them. Click a point behind
# another window and the click lands on THAT window; click a point off-screen
# and it lands nowhere. Either way pyautogui returns cleanly and the helper
# would answer "Action completed".
#
# That specific lie has burned us before on macOS — a session typed into a
# minimized window for a full turn because every action reported success. The
# fix there was to refuse instead of guessing, and the same rule applies here.

class DeliveryRefused(RuntimeError):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


def _virtual_screen_rect() -> tuple[int, int, int, int] | None:
    """(left, top, right, bottom) across all monitors, or None if unavailable."""
    try:
        user32 = ctypes.windll.user32
        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN = 76, 77
        SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN = 78, 79
        left = user32.GetSystemMetrics(SM_XVIRTUALSCREEN)
        top = user32.GetSystemMetrics(SM_YVIRTUALSCREEN)
        width = user32.GetSystemMetrics(SM_CXVIRTUALSCREEN)
        height = user32.GetSystemMetrics(SM_CYVIRTUALSCREEN)
        if width <= 0 or height <= 0:
            return None
        return (left, top, left + width, top + height)
    except Exception:
        return None


def ensure_point_on_screen(x: int, y: int) -> None:
    """Refuse coordinates outside every monitor.

    Fails OPEN when the metrics are unreadable: an unreadable metric is our
    problem, not the caller's, and blocking every action on it would be worse
    than the miss it prevents.
    """
    rect = _virtual_screen_rect()
    if rect is None:
        return
    left, top, right, bottom = rect
    if left <= x < right and top <= y < bottom:
        return
    raise DeliveryRefused(
        f"The point ({x}, {y}) is outside every display "
        f"(virtual screen is {left},{top} to {right},{bottom}), so the action "
        "was not sent. Take a screenshot to get current coordinates.",
        code="point_outside_display",
    )


def _window_is_interactable(hwnd: int) -> tuple[bool, str]:
    """(ok, reason) — whether synthetic input can reach this window at all."""
    try:
        import win32gui
        if not win32gui.IsWindow(hwnd):
            return False, "the window no longer exists"
        if not win32gui.IsWindowVisible(hwnd):
            return False, "the window is hidden"
        try:
            import win32con
            placement = win32gui.GetWindowPlacement(hwnd)
            if placement and placement[1] == win32con.SW_SHOWMINIMIZED:
                return False, "the window is minimized"
        except Exception:
            pass
        rect = win32gui.GetWindowRect(hwnd)
        if rect[2] - rect[0] <= 0 or rect[3] - rect[1] <= 0:
            return False, "the window has no on-screen area"
        return True, ""
    except Exception:
        # Unreadable window state fails open, same reasoning as above.
        return True, ""


def _windows_for_bundle(bundle_id: str) -> list[int]:
    """Every top-level HWND owned by a process whose exe stem matches.

    Enumerates directly rather than reusing `list_windows()`, which filters out
    invisible and zero-area windows — precisely the states this guard needs to
    SEE in order to refuse. Reusing it would make the guard match nothing and
    silently pass, which is the failure mode it was written to prevent.
    """
    try:
        import win32gui
        import win32process
        import psutil
    except Exception:
        return []

    wanted = bundle_id.strip().lower()
    if not wanted:
        return []

    pids: set[int] = set()
    try:
        for proc in psutil.process_iter(["pid", "name", "exe"]):
            try:
                exe_path = proc.info.get("exe") or ""
                name = proc.info.get("name") or ""
                stem = Path(exe_path).stem if exe_path else Path(name).stem
                if stem and stem.lower() == wanted:
                    pids.add(int(proc.info["pid"]))
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    except Exception:
        return []

    if not pids:
        return []

    handles: list[int] = []

    def _collect(hwnd: int, _: Any) -> None:
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            if int(pid) in pids:
                handles.append(int(hwnd))
        except Exception:
            return

    try:
        win32gui.EnumWindows(_collect, None)
    except Exception:
        return []
    return handles


def ensure_target_window_reachable(bundle_id: str | None) -> None:
    """Refuse when the named app has no window that input could reach.

    A minimized window is the case that matters: on Windows it has no client
    area to hit-test against, so a coordinate click is guaranteed to land on
    whatever is underneath it. Reporting success there is exactly the lie this
    guard exists to prevent.

    Fails OPEN when the app owns no top-level windows at all — that is a
    different failure (wrong app name, app not running) which the caller's own
    resolution step reports with a better message than this one could.
    """
    if not bundle_id:
        return

    handles = _windows_for_bundle(bundle_id)
    if not handles:
        return

    reasons: list[str] = []
    for hwnd in handles:
        ok, reason = _window_is_interactable(hwnd)
        if ok:
            return
        if reason:
            reasons.append(reason)

    detail = reasons[0] if reasons else "it has no on-screen window"
    raise DeliveryRefused(
        f"The target app has no window that input can reach — {detail}. "
        "The action was NOT sent. Restore the window and try again.",
        code="target_window_offscreen",
    )


# ---------------------------------------------------------------------------
# Input actions (pyautogui → SendInput)
# ---------------------------------------------------------------------------

def click(x: int, y: int, button: str, count: int, modifiers: list[str] | None) -> None:
    pyautogui.moveTo(x, y)
    if modifiers:
        normalized = [normalize_key(m) for m in modifiers]
        for key in normalized:
            pyautogui.keyDown(key)
        try:
            pyautogui.click(x=x, y=y, button=button, clicks=count, interval=0.08)
        finally:
            for key in reversed(normalized):
                pyautogui.keyUp(key)
    else:
        pyautogui.click(x=x, y=y, button=button, clicks=count, interval=0.08)


def scroll(x: int, y: int, delta_x: int, delta_y: int) -> None:
    pyautogui.moveTo(x, y)
    if delta_y:
        pyautogui.scroll(int(delta_y), x=x, y=y)
    if delta_x:
        pyautogui.hscroll(int(delta_x), x=x, y=y)


def key_action(sequence: str, repeat: int = 1) -> None:
    parts = [normalize_key(part) for part in sequence.split("+") if part.strip()]
    for _ in range(max(1, repeat)):
        if len(parts) == 1:
            pyautogui.press(parts[0])
        else:
            pyautogui.hotkey(*parts, interval=0.02)
        time.sleep(0.01)


def hold_keys(keys: list[str], duration_ms: int) -> None:
    normalized = [normalize_key(k) for k in keys]
    for key in normalized:
        pyautogui.keyDown(key)
    try:
        time.sleep(max(duration_ms, 0) / 1000)
    finally:
        for key in reversed(normalized):
            pyautogui.keyUp(key)


def type_text(text: str) -> None:
    pyautogui.write(text, interval=0.008)


# ---------------------------------------------------------------------------
# Main dispatcher — the command protocol the native macOS daemon also speaks
# ---------------------------------------------------------------------------

# Commands that inject into the shared Windows input stream. Kept as one set
# rather than as a guard call inside each branch, because the branches are the
# easy place to forget one — and a forgotten branch is silently unguarded, the
# exact class of bug this whole pass exists to remove.
#
# Mirrors `CommandForegroundPolicy.leasedCommands` on the macOS side.
MUTATING_COMMANDS = frozenset({
    "click", "drag", "move_mouse", "scroll",
    "mouse_down", "mouse_up",
    "key", "hold_key", "type",
    "paste_clipboard",
})

# The subset that targets a screen coordinate, and so needs the point itself to
# be reachable. `key`/`type` go to whatever holds focus and have no coordinate
# to check.
COORDINATE_COMMANDS = frozenset({"click", "drag", "move_mouse", "scroll"})


def _coordinate_of(command: str, payload: dict[str, Any]) -> tuple[int, int] | None:
    if command not in COORDINATE_COMMANDS:
        return None
    if command == "drag":
        target = payload.get("to") or {}
        if "x" in target and "y" in target:
            return int(target["x"]), int(target["y"])
        return None
    if "x" in payload and "y" in payload:
        return int(payload["x"]), int(payload["y"])
    return None


def _finish(lease: "ForegroundLease | None", result: Any) -> int:
    """Emit the success response for a mutating command, after the lease agrees.

    The check runs BEFORE the response is written, and that ordering is the
    whole point: once `{"ok": true}` reaches the caller the action is reported
    as done, and no later discovery can take that back. A helper that injected
    input, then noticed the user had been typing throughout, and still answered
    "Action completed" would be lying with a straight face.
    """
    if lease is not None:
        lease.finalize()
    json_output({"ok": True, "result": result})
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command")
    parser.add_argument("--payload", default="{}")
    args = parser.parse_args()
    payload = json.loads(args.payload)

    lease: ForegroundLease | None = None

    try:
        command = args.command

        if command in MUTATING_COMMANDS:
            point = _coordinate_of(command, payload)
            if point is not None:
                ensure_point_on_screen(point[0], point[1])
            ensure_target_window_reachable(
                payload.get("bundleId") or payload.get("app")
            )
            lease = ForegroundLease()
            lease.acquire()
        if command == "check_permissions":
            perms = check_permissions()
            json_output({"ok": True, "result": perms})
            return 0
        if command == "list_displays":
            json_output({"ok": True, "result": get_displays()})
            return 0
        if command == "get_display_size":
            json_output({"ok": True, "result": choose_display(payload.get("displayId"))})
            return 0
        if command == "screenshot":
            resize = None
            if payload.get("targetWidth") and payload.get("targetHeight"):
                resize = (int(payload["targetWidth"]), int(payload["targetHeight"]))
            result = capture_display(payload.get("displayId"), resize)
            json_output({"ok": True, "result": result})
            return 0
        if command == "resolve_prepare_capture":
            resize = None
            if payload.get("targetWidth") and payload.get("targetHeight"):
                resize = (int(payload["targetWidth"]), int(payload["targetHeight"]))
            result = capture_display(payload.get("preferredDisplayId"), resize)
            result["hidden"] = []
            result["resolvedDisplayId"] = result["displayId"]
            json_output({"ok": True, "result": result})
            return 0
        if command == "zoom":
            resize = None
            if payload.get("targetWidth") and payload.get("targetHeight"):
                resize = (int(payload["targetWidth"]), int(payload["targetHeight"]))
            region = {
                "left": int(payload["x"]),
                "top": int(payload["y"]),
                "width": int(payload["width"]),
                "height": int(payload["height"]),
            }
            json_output({"ok": True, "result": capture_region(region, resize)})
            return 0
        if command == "prepare_for_action":
            json_output({"ok": True, "result": []})
            return 0
        if command == "preview_hide_set":
            json_output({"ok": True, "result": []})
            return 0
        if command == "find_window_displays":
            json_output({"ok": True, "result": find_window_displays(list(payload.get("bundleIds") or []))})
            return 0
        if command == "key":
            key_action(str(payload["keySequence"]), int(payload.get("repeat") or 1))
            return _finish(lease, True)
        if command == "hold_key":
            hold_keys(list(payload.get("keyNames") or []), int(payload.get("durationMs") or 0))
            return _finish(lease, True)
        if command == "type":
            type_text(str(payload.get("text") or ""))
            return _finish(lease, True)
        if command == "click":
            click(int(payload["x"]), int(payload["y"]), str(payload.get("button") or "left"), int(payload.get("count") or 1), payload.get("modifiers"))
            return _finish(lease, True)
        if command == "drag":
            from_point = payload.get("from")
            if from_point:
                pyautogui.moveTo(int(from_point["x"]), int(from_point["y"]))
            pyautogui.dragTo(int(payload["to"]["x"]), int(payload["to"]["y"]), duration=0.2, button="left")
            return _finish(lease, True)
        if command == "move_mouse":
            pyautogui.moveTo(int(payload["x"]), int(payload["y"]))
            return _finish(lease, True)
        if command == "scroll":
            scroll(int(payload["x"]), int(payload["y"]), int(payload.get("deltaX") or 0), int(payload.get("deltaY") or 0))
            return _finish(lease, True)
        if command == "mouse_down":
            pyautogui.mouseDown(button="left")
            return _finish(lease, True)
        if command == "mouse_up":
            pyautogui.mouseUp(button="left")
            return _finish(lease, True)
        if command == "cursor_position":
            x, y = pyautogui.position()
            json_output({"ok": True, "result": {"x": int(x), "y": int(y)}})
            return 0
        if command == "frontmost_app":
            json_output({"ok": True, "result": frontmost_app()})
            return 0
        if command == "app_under_point":
            json_output({"ok": True, "result": app_under_point(int(payload["x"]), int(payload["y"]))})
            return 0
        if command == "list_installed_apps":
            json_output({"ok": True, "result": installed_apps()})
            return 0
        if command == "list_running_apps":
            json_output({"ok": True, "result": running_apps()})
            return 0
        if command == "open_app":
            open_app(str(payload["bundleId"]))
            json_output({"ok": True, "result": True})
            return 0
        if command == "read_clipboard":
            json_output({"ok": True, "result": read_clipboard()})
            return 0
        if command == "write_clipboard":
            write_clipboard(str(payload.get("text") or ""))
            json_output({"ok": True, "result": True})
            return 0
        if command == "paste_clipboard":
            paste_clipboard()
            return _finish(lease, True)
        error_output(f"Unknown command: {command}", code="bad_command")
        return 2
    except (UserInterference, DeliveryRefused) as exc:
        # A deliberate refusal, not a crash. The code travels so the caller can
        # tell "did not run, safe to retry" apart from "ran, outcome unknown" —
        # collapsing both into a generic error is how a model ends up repeating
        # a toggle it already flipped.
        error_output(str(exc), code=exc.code)
        return 1
    except Exception as exc:
        error_output(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
