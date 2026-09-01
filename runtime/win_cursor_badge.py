#!/usr/bin/env python3
"""Windows agent-activity badge — a click-through marker that follows the cursor.

WHY THIS IS NOT THE macOS VIRTUAL CURSOR
----------------------------------------
On macOS the helper never moves the real pointer: `CGEvent.postToPid` carries
the click coordinate as metadata, so the drawn cursor IS the only cursor the
user sees move. It is a *replacement*.

Windows has no per-process event delivery. `pyautogui` bottoms out in
`SendInput`, which warps the one real cursor the user's hand is also on. We
cannot avoid that, so drawing a second fake pointer would be actively harmful:
two pointers, one of them a lie, with no way to tell which one the OS is
actually going to click with.

So this badge is an *annotation*, not a replacement. It rides just off the real
cursor and answers exactly one question the user cannot otherwise answer:
"is this thing moving because of me, or because of the agent?" On Windows that
question has real stakes — the agent is holding the user's mouse, and the user
needs to know before they grab it back mid-action.

Runs as its own process because the Windows helper is a stateless one-shot CLI:
every command exits, so nothing in it can own a window across actions.

The window is WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE — it never
takes focus, never appears in the taskbar or Alt-Tab, and passes every click
through to whatever is underneath. It cannot intercept the input it exists to
describe.

Usage:
    python win_cursor_badge.py --label "Claude"      # runs until stdin closes
"""
from __future__ import annotations

import argparse
import ctypes
import sys
import threading
from ctypes import wintypes

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
kernel32 = ctypes.windll.kernel32

WS_EX_LAYERED = 0x00080000
WS_EX_TRANSPARENT = 0x00000020
WS_EX_TOPMOST = 0x00000008
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_NOACTIVATE = 0x08000000
WS_POPUP = 0x80000000

SW_SHOWNOACTIVATE = 4
HWND_TOPMOST = wintypes.HWND(-1)
SWP_NOACTIVATE = 0x0010
SWP_NOSIZE = 0x0001
SWP_NOZORDER = 0x0004

LWA_COLORKEY = 0x00000001
LWA_ALPHA = 0x00000002

WM_DESTROY = 0x0002
WM_CLOSE = 0x0010
WM_PAINT = 0x000F

# Leave enough room for the default label at common Windows text scales. The
# original 132px width clipped "Claude is controlling" on a 100%-scale display.
BADGE_W = 168
BADGE_H = 30
CURSOR_OFFSET_X = 18
CURSOR_OFFSET_Y = 18

# Chroma key: pixels of this exact colour become fully transparent. Picked to
# be a colour nothing in the badge draws, so only the intended shape shows.
TRANSPARENT_KEY = 0x00FF00FF


class POINT(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]


class PAINTSTRUCT(ctypes.Structure):
    _fields_ = [
        ("hdc", wintypes.HDC),
        ("fErase", wintypes.BOOL),
        ("rcPaint", RECT),
        ("fRestore", wintypes.BOOL),
        ("fIncUpdate", wintypes.BOOL),
        ("rgbReserved", ctypes.c_byte * 32),
    ]


LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(
    LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
)


class WNDCLASS(ctypes.Structure):
    _fields_ = [
        ("style", wintypes.UINT),
        ("lpfnWndProc", WNDPROC),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", wintypes.HINSTANCE),
        ("hIcon", wintypes.HICON),
        ("hCursor", wintypes.HANDLE),
        ("hbrBackground", wintypes.HBRUSH),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
    ]


def _configure_win32() -> None:
    """Declare every Win32 signature that carries a pointer-sized value.

    ctypes otherwise assumes ``c_int`` arguments and return values. That is
    only 32 bits on 64-bit Windows, so HWND, WPARAM, LPARAM, and LRESULT values
    are truncated before the badge's window procedure can use them.
    """
    kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetModuleHandleW.restype = wintypes.HINSTANCE

    user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASS)]
    user32.RegisterClassW.restype = wintypes.WORD
    user32.CreateWindowExW.argtypes = [
        wintypes.DWORD,
        wintypes.LPCWSTR,
        wintypes.LPCWSTR,
        wintypes.DWORD,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.HWND,
        wintypes.HANDLE,
        wintypes.HINSTANCE,
        wintypes.LPVOID,
    ]
    user32.CreateWindowExW.restype = wintypes.HWND
    user32.DefWindowProcW.argtypes = [
        wintypes.HWND,
        wintypes.UINT,
        wintypes.WPARAM,
        wintypes.LPARAM,
    ]
    user32.DefWindowProcW.restype = LRESULT
    user32.DestroyWindow.argtypes = [wintypes.HWND]
    user32.DestroyWindow.restype = wintypes.BOOL
    user32.PostQuitMessage.argtypes = [ctypes.c_int]
    user32.PostQuitMessage.restype = None
    user32.PostMessageW.argtypes = [
        wintypes.HWND,
        wintypes.UINT,
        wintypes.WPARAM,
        wintypes.LPARAM,
    ]
    user32.PostMessageW.restype = wintypes.BOOL
    user32.GetMessageW.argtypes = [
        ctypes.POINTER(wintypes.MSG),
        wintypes.HWND,
        wintypes.UINT,
        wintypes.UINT,
    ]
    user32.GetMessageW.restype = wintypes.BOOL
    user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
    user32.TranslateMessage.restype = wintypes.BOOL
    user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
    user32.DispatchMessageW.restype = LRESULT

    user32.BeginPaint.argtypes = [wintypes.HWND, ctypes.POINTER(PAINTSTRUCT)]
    user32.BeginPaint.restype = wintypes.HDC
    user32.EndPaint.argtypes = [wintypes.HWND, ctypes.POINTER(PAINTSTRUCT)]
    user32.EndPaint.restype = wintypes.BOOL
    user32.FillRect.argtypes = [
        wintypes.HDC,
        ctypes.POINTER(RECT),
        wintypes.HBRUSH,
    ]
    user32.FillRect.restype = ctypes.c_int
    user32.DrawTextW.argtypes = [
        wintypes.HDC,
        wintypes.LPCWSTR,
        ctypes.c_int,
        ctypes.POINTER(RECT),
        wintypes.UINT,
    ]
    user32.DrawTextW.restype = ctypes.c_int
    user32.SetLayeredWindowAttributes.argtypes = [
        wintypes.HWND,
        wintypes.DWORD,
        wintypes.BYTE,
        wintypes.DWORD,
    ]
    user32.SetLayeredWindowAttributes.restype = wintypes.BOOL
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.ShowWindow.restype = wintypes.BOOL
    user32.GetCursorPos.argtypes = [ctypes.POINTER(POINT)]
    user32.GetCursorPos.restype = wintypes.BOOL
    user32.SetWindowPos.argtypes = [
        wintypes.HWND,
        wintypes.HWND,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.UINT,
    ]
    user32.SetWindowPos.restype = wintypes.BOOL

    gdi32.CreateSolidBrush.argtypes = [wintypes.DWORD]
    gdi32.CreateSolidBrush.restype = wintypes.HBRUSH
    gdi32.DeleteObject.argtypes = [wintypes.HANDLE]
    gdi32.DeleteObject.restype = wintypes.BOOL
    gdi32.SetBkMode.argtypes = [wintypes.HDC, ctypes.c_int]
    gdi32.SetBkMode.restype = ctypes.c_int
    gdi32.SetTextColor.argtypes = [wintypes.HDC, wintypes.DWORD]
    gdi32.SetTextColor.restype = wintypes.DWORD


_configure_win32()


class CursorBadge:
    def __init__(self, label: str) -> None:
        self.label = label
        self.hwnd: int | None = None
        self._stop = threading.Event()
        # Held on the instance because ctypes does not keep the trampoline
        # alive on its own; letting it be collected turns the next window
        # message into a crash inside the message pump.
        self._wndproc = WNDPROC(self._on_message)

    def _on_message(self, hwnd, msg, wparam, lparam):
        if msg == WM_PAINT:
            self._paint(hwnd)
            return 0
        if msg == WM_CLOSE:
            user32.DestroyWindow(hwnd)
            return 0
        if msg == WM_DESTROY:
            user32.PostQuitMessage(0)
            return 0
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def _paint(self, hwnd: int) -> None:
        ps = PAINTSTRUCT()
        hdc = user32.BeginPaint(hwnd, ctypes.byref(ps))
        try:
            rect = RECT(0, 0, BADGE_W, BADGE_H)

            # Fill with the chroma key first: everything we do not draw over
            # becomes transparent, which is what gives the badge its shape.
            key_brush = gdi32.CreateSolidBrush(TRANSPARENT_KEY)
            user32.FillRect(hdc, ctypes.byref(rect), key_brush)
            gdi32.DeleteObject(key_brush)

            body = RECT(0, 0, BADGE_W, BADGE_H)
            bg = gdi32.CreateSolidBrush(0x00734B23)  # BGR: a muted blue
            user32.FillRect(hdc, ctypes.byref(body), bg)
            gdi32.DeleteObject(bg)

            gdi32.SetBkMode(hdc, 1)  # TRANSPARENT
            gdi32.SetTextColor(hdc, 0x00FFFFFF)
            text = f"  {self.label} is controlling"
            user32.DrawTextW(
                hdc, text, len(text), ctypes.byref(body),
                0x00000004 | 0x00000100,  # DT_VCENTER | DT_SINGLELINE
            )
        finally:
            user32.EndPaint(hwnd, ctypes.byref(ps))

    def create(self) -> None:
        hinst = kernel32.GetModuleHandleW(None)
        class_name = "CcHahaAgentCursorBadge"

        wc = WNDCLASS()
        wc.lpfnWndProc = self._wndproc
        wc.hInstance = hinst
        wc.lpszClassName = class_name
        wc.hbrBackground = 0
        wc.hCursor = 0
        user32.RegisterClassW(ctypes.byref(wc))

        self.hwnd = user32.CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST
            | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            class_name, None, WS_POPUP,
            0, 0, BADGE_W, BADGE_H,
            None, None, hinst, None,
        )
        if not self.hwnd:
            raise OSError("CreateWindowExW failed for the cursor badge")

        user32.SetLayeredWindowAttributes(
            self.hwnd, TRANSPARENT_KEY, 225, LWA_COLORKEY | LWA_ALPHA
        )
        user32.ShowWindow(self.hwnd, SW_SHOWNOACTIVATE)

    def _follow_cursor(self) -> None:
        """Reposition the badge next to the real pointer, ~60fps."""
        pt = POINT()
        while not self._stop.is_set():
            try:
                if user32.GetCursorPos(ctypes.byref(pt)) and self.hwnd:
                    user32.SetWindowPos(
                        self.hwnd, HWND_TOPMOST,
                        pt.x + CURSOR_OFFSET_X, pt.y + CURSOR_OFFSET_Y,
                        0, 0, SWP_NOACTIVATE | SWP_NOSIZE,
                    )
            except Exception:
                # The badge is advisory. It must never be the reason an action
                # fails, so every error here is swallowed and the loop retries.
                pass
            self._stop.wait(0.016)

    def _wait_for_stdin_close(self) -> None:
        """Exit when the parent goes away.

        The badge outliving its parent would leave a permanent 'the agent is
        controlling your mouse' claim on screen with nothing behind it. Reading
        stdin to EOF ties this process's lifetime to the parent's, including
        the case where the parent is killed rather than exiting cleanly.
        """
        try:
            for _ in sys.stdin:
                pass
        except Exception:
            pass
        self.stop()

    def stop(self) -> None:
        self._stop.set()
        if self.hwnd:
            user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)

    def run(self) -> int:
        self.create()
        threading.Thread(target=self._follow_cursor, daemon=True).start()
        threading.Thread(target=self._wait_for_stdin_close, daemon=True).start()

        msg = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))
        return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default="Claude")
    args = parser.parse_args()
    if sys.platform != "win32":
        print("win_cursor_badge.py is Windows-only", file=sys.stderr)
        return 1
    return CursorBadge(args.label).run()


if __name__ == "__main__":
    raise SystemExit(main())
