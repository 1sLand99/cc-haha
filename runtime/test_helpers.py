#!/usr/bin/env python3
"""Tests for win_helper.py.

macOS routes every Computer Use command to the signed native `cu-helper`
daemon — `helperBridge` refuses to fall back to Python — so `mac_helper.py`
was unreachable and has been deleted. This file therefore covers the Windows
helper only.

Most tests here are static (they read the source) rather than executed,
because the runtime deps (pywin32, pyautogui, mss) are Windows-only and CI
runs on macOS. Static coverage is enough for what actually regresses: the
guards getting dropped, inverted, or quietly bypassed.

Usage:
    python -m pytest runtime/test_helpers.py -v
    python runtime/test_helpers.py
"""
from __future__ import annotations

import ast
import json
import subprocess
import sys
import unittest
from pathlib import Path

IS_WINDOWS = sys.platform == "win32"

RUNTIME_DIR = Path(__file__).parent
WIN_HELPER = RUNTIME_DIR / "win_helper.py"
CURSOR_BADGE = RUNTIME_DIR / "win_cursor_badge.py"


def _win_source() -> str:
    return WIN_HELPER.read_text(encoding="utf-8")


class TestKeyMap(unittest.TestCase):
    """KEY_MAP translates macOS key names to Windows ones."""

    def _load_key_map(self, helper_path: Path) -> dict[str, str]:
        source = helper_path.read_text(encoding="utf-8")
        start = source.index("KEY_MAP = {")
        depth = 0
        for i, ch in enumerate(source[start:], start):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        ns: dict = {}
        exec(source[start:end], ns)
        return ns["KEY_MAP"]

    def test_win_key_map_exists(self):
        km = self._load_key_map(WIN_HELPER)
        self.assertIn("cmd", km)
        self.assertIn("ctrl", km)
        # The mapping that matters: a model trained on macOS emits "cmd", and
        # on Windows that has to become "win", not silently stay "cmd".
        self.assertEqual(km["cmd"], "win")

    def test_all_alphabet_keys(self):
        km = self._load_key_map(WIN_HELPER)
        for ch in "abcdefghijklmnopqrstuvwxyz":
            self.assertIn(ch, km)

    def test_all_digit_keys(self):
        km = self._load_key_map(WIN_HELPER)
        for d in "0123456789":
            self.assertIn(d, km)


class TestJSONProtocol(unittest.TestCase):
    def _parse_main_commands(self, helper_path: Path) -> list[str]:
        source = helper_path.read_text(encoding="utf-8")
        commands = []
        for line in source.splitlines():
            stripped = line.strip()
            if stripped.startswith('if command == "'):
                commands.append(stripped.split('"')[1])
        return commands

    def test_expected_commands_exist(self):
        expected = {
            "check_permissions", "list_displays", "get_display_size",
            "screenshot", "resolve_prepare_capture", "zoom",
            "prepare_for_action", "preview_hide_set", "find_window_displays",
            "key", "hold_key", "type", "click", "drag",
            "move_mouse", "scroll", "mouse_down", "mouse_up",
            "cursor_position", "frontmost_app", "app_under_point",
            "list_installed_apps", "list_running_apps", "open_app",
            "read_clipboard", "write_clipboard", "paste_clipboard",
        }
        cmds = set(self._parse_main_commands(WIN_HELPER))
        self.assertFalse(expected - cmds,
                         f"win_helper.py missing commands: {expected - cmds}")

    @unittest.skipUnless(IS_WINDOWS, "requires Windows runtime deps")
    def test_unknown_command_returns_error(self):
        result = subprocess.run(
            [sys.executable, str(WIN_HELPER), "nonexistent_command_xyz"],
            capture_output=True, text=True,
        )
        if result.returncode == 1 and not result.stdout.strip():
            self.skipTest("missing platform deps")
        self.assertEqual(result.returncode, 2)
        parsed = json.loads(result.stdout.strip())
        self.assertFalse(parsed["ok"])
        self.assertEqual(parsed["error"]["code"], "bad_command")


class TestMutatingCommandsAreGuarded(unittest.TestCase):
    """Every command that injects input must pass through the guards.

    These are static-source tests on purpose. The failure being guarded against
    is someone adding an eleventh mutating verb and wiring it like the ten that
    came before — at which point it silently has no lease and no reachability
    check. A runtime test would need Windows and would only cover the verbs it
    thought to enumerate; reading the dispatcher catches the new one.
    """

    # Kept as a literal, deliberately duplicating MUTATING_COMMANDS in the
    # helper. If the two drift the test fails, which is the point: the set is
    # a security boundary and should not be edited casually on one side only.
    MUTATING = {
        "click", "drag", "move_mouse", "scroll",
        "mouse_down", "mouse_up",
        "key", "hold_key", "type",
        "paste_clipboard",
    }

    def _module_constant(self, name: str) -> set[str]:
        """Read a module-level frozenset/set constant without importing."""
        tree = ast.parse(_win_source())
        for node in tree.body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id == name:
                        return set(ast.literal_eval(
                            node.value.args[0]
                            if isinstance(node.value, ast.Call)
                            else node.value
                        ))
        raise AssertionError(f"{name} not found in win_helper.py")

    def test_mutating_command_set_matches_this_test(self):
        self.assertEqual(self._module_constant("MUTATING_COMMANDS"), self.MUTATING)

    def test_coordinate_commands_are_a_subset(self):
        coords = self._module_constant("COORDINATE_COMMANDS")
        self.assertTrue(coords <= self.MUTATING)
        # `key`/`type` go wherever focus is and have no point to validate.
        # Asserting their absence keeps someone from "fixing" the coordinate
        # guard by adding them and then dereferencing an x/y that isn't there.
        self.assertNotIn("key", coords)
        self.assertNotIn("type", coords)

    def test_every_mutating_branch_finalizes_the_lease(self):
        """No mutating branch may answer with a bare json_output.

        This is the specific regression: `_finish` is what runs the post-action
        interference check, so a branch that writes its own success response
        reports "Action completed" for input that may have collided with the
        user's own typing.
        """
        source = _win_source()
        start = source.index('    try:\n        command = args.command')
        end = source.index('        error_output(f"Unknown command: {command}"')
        dispatcher = source[start:end]

        blocks = dispatcher.split('if command == "')
        for block in blocks[1:]:
            name = block.split('"')[0]
            if name not in self.MUTATING:
                continue
            body = block.split("if command ==")[0]
            self.assertIn(
                "_finish(lease,", body,
                f'"{name}" must return through _finish so the lease is checked',
            )
            self.assertNotIn(
                'json_output({"ok": True', body,
                f'"{name}" writes its own success response, bypassing the lease',
            )

    def test_guards_run_before_any_injection(self):
        """acquire() must precede the dispatch chain, not follow it."""
        source = _win_source()
        acquire = source.index("lease.acquire()")
        first_branch = source.index('        if command == "check_permissions"')
        self.assertLess(
            acquire, first_branch,
            "the lease must be acquired before any command branch runs",
        )


class TestInterferenceDetection(unittest.TestCase):
    def test_uses_getlastinputinfo_not_an_event_hook(self):
        """The signal must stay permission-free.

        A low-level input hook would read the same events, but installing one
        is exactly the kind of thing that gets an app flagged, and it is not
        needed: GetLastInputInfo answers the only question we ask.
        """
        source = _win_source()
        self.assertIn("GetLastInputInfo", source)
        self.assertNotIn("SetWindowsHookEx", source)

    def test_distinguishes_did_not_run_from_outcome_unknown(self):
        """The two interference verdicts must stay distinct.

        Collapsing them is a real hazard: `user_interference` means nothing
        happened and a retry is safe, while `user_interference_result_unknown`
        means input already went out and a retry could double-apply it. On a
        play/pause toggle those differ by exactly one wrong outcome.
        """
        source = _win_source()
        self.assertIn('"user_interference"', source)
        self.assertIn('user_interference_result_unknown', source)

        acquire_start = source.index("    def acquire(self)")
        acquire_body = source[acquire_start:source.index("    def finalize(self)")]
        self.assertNotIn("result_unknown", acquire_body,
                         "a pre-action refusal means nothing ran; the outcome is known")

        finalize_body = source[source.index("    def finalize(self)"):]
        finalize_body = finalize_body[:finalize_body.index("\n\n\n")]
        self.assertIn("result_unknown", finalize_body,
                      "post-action interference leaves the outcome unknown")

    def test_counter_read_failure_does_not_block_actions(self):
        """An unreadable counter must fail open, not brick the feature.

        Precedent from the macOS side: an earlier build required an Input
        Monitoring grant that onboarding never asked for, so every mutating
        action failed on a correctly set-up machine. A safety layer that turns
        the product off is not safety.
        """
        source = _win_source()
        fn_start = source.index("def last_physical_input_tick()")
        body = source[fn_start:source.index("class UserInterference")]
        self.assertIn("return 0", body)
        # And the comparisons must treat 0 as "no reading", never as a tick
        # value that happens to differ from the next one.
        self.assertIn("if before and after and before != after:", source)

    def test_synthetic_input_must_not_trip_the_detector(self):
        """Documented invariant: SendInput does not advance GetLastInputInfo.

        If this ever stopped holding, every agent action would abort itself and
        the feature would look randomly broken. Pinning the claim in a test
        keeps it from being quietly deleted as a stale comment.
        """
        source = _win_source()
        self.assertIn("is NOT advanced by", source)


class TestDeliveryGuards(unittest.TestCase):
    def test_offscreen_point_is_refused(self):
        source = _win_source()
        self.assertIn("point_outside_display", source)
        self.assertIn("def ensure_point_on_screen", source)

    def test_unreachable_window_is_refused(self):
        source = _win_source()
        self.assertIn("target_window_offscreen", source)
        self.assertIn("def ensure_target_window_reachable", source)

    def test_reachability_check_sees_minimized_windows(self):
        """It must NOT reuse list_windows().

        `list_windows()` filters out invisible and zero-area windows — exactly
        the states the guard needs to observe in order to refuse. An earlier
        draft of this guard did reuse it, matched nothing, and passed
        everything. The enumeration has to be its own.
        """
        tree = ast.parse(_win_source())
        fn = next(
            node for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef) and node.name == "_windows_for_bundle"
        )
        # Walk the AST rather than the text, so the explanatory docstring
        # (which names list_windows to say why it is NOT used) cannot satisfy
        # or break the assertion.
        called = {
            n.func.id for n in ast.walk(fn)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
        }
        self.assertNotIn("list_windows", called)

        source = _win_source()
        body = source[source.index("def _windows_for_bundle"):
                      source.index("def ensure_target_window_reachable")]
        self.assertIn("EnumWindows", body)
        self.assertIn("SW_SHOWMINIMIZED", source)

    def test_refusals_carry_a_machine_readable_code(self):
        source = _win_source()
        self.assertIn("class DeliveryRefused", source)
        self.assertIn("error_output(str(exc), code=exc.code)", source)

    def test_refusal_says_the_action_was_not_sent(self):
        """The message must state that nothing happened.

        "Could not reach the window" reads like a warning attached to an action
        that still went out. The model needs to know the action did not happen,
        or it will assume it did and move on.
        """
        source = _win_source()
        self.assertIn("was NOT sent", source)


class TestCursorBadge(unittest.TestCase):
    """The Windows badge annotates the real cursor; it does not replace it."""

    def test_badge_script_exists(self):
        self.assertTrue(CURSOR_BADGE.exists())

    def test_badge_is_click_through_and_never_takes_focus(self):
        """Any of these missing turns the badge into an obstacle.

        Without WS_EX_TRANSPARENT it eats the clicks it is meant to describe;
        without WS_EX_NOACTIVATE it steals focus from the app being driven —
        which would break the very action it is annotating.
        """
        source = CURSOR_BADGE.read_text(encoding="utf-8")
        tree = ast.parse(source)

        create = next(
            node for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef) and node.name == "create"
        )
        # Read the names actually combined into the window's ex-style, not
        # merely the ones defined somewhere in the file. A constant can be
        # defined and then left out of CreateWindowExW — which is exactly how
        # a click-through window quietly becomes a click-eating one.
        used = {
            n.id for n in ast.walk(create)
            if isinstance(n, ast.Name)
        }
        for style in ("WS_EX_LAYERED", "WS_EX_TRANSPARENT",
                      "WS_EX_NOACTIVATE", "WS_EX_TOOLWINDOW"):
            self.assertIn(
                style, used,
                f"{style} must be passed to CreateWindowExW, not just defined",
            )
        self.assertIn("SW_SHOWNOACTIVATE", used)

    def test_badge_does_not_draw_a_second_pointer(self):
        """Windows has one real cursor and SendInput moves it.

        Drawing a fake pointer alongside it would show the user two cursors,
        one of which is a lie about where the click will land. The macOS design
        does not transfer, and the source says so explicitly.
        """
        source = CURSOR_BADGE.read_text(encoding="utf-8")
        self.assertIn("annotation", source.lower())

    def test_badge_exits_with_its_parent(self):
        """An orphaned badge is worse than none.

        It would sit on screen claiming the agent is controlling the mouse
        after the agent is gone. Tying it to stdin covers the parent being
        killed, not just exiting cleanly.
        """
        source = CURSOR_BADGE.read_text(encoding="utf-8")
        self.assertIn("stdin", source)


class TestPermissions(unittest.TestCase):
    def test_check_permissions_always_granted(self):
        """Windows has no TCC equivalent for input injection or capture."""
        source = _win_source()
        start = source.index("def check_permissions()")
        body = source[start:start + 400]
        self.assertIn('"accessibility": True', body)
        self.assertIn('"screenRecording": True', body)


class TestSourceIntegrity(unittest.TestCase):
    def test_helper_parses(self):
        ast.parse(_win_source())

    def test_badge_parses(self):
        ast.parse(CURSOR_BADGE.read_text(encoding="utf-8"))

    def test_retired_mac_helper_is_not_referenced(self):
        """macOS is native-only; a lingering reference invites a false fallback."""
        self.assertFalse((RUNTIME_DIR / "mac_helper.py").exists())
        self.assertNotIn("mac_helper", _win_source())


if __name__ == "__main__":
    unittest.main(verbosity=2)
