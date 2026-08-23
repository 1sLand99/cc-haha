import AppKit
import os
import CoreGraphics
import Foundation

/// Tells an application it holds keyboard focus, without giving it the
/// foreground.
///
/// WHY THIS EXISTS
/// ---------------
/// Chromium/CEF apps route synthesized input by the window an event names, then
/// ignore it unless the app believes it is active. `WindowKeyFocus` buys that
/// belief by making the app genuinely frontmost — measured, and measurably
/// wrong for us: it takes the foreground away from whatever the user is doing,
/// once per click. Automating an app in the background is the entire point of
/// the feature; an implementation that yanks the user's foreground twenty times
/// during a task has not delivered it.
///
/// HOW CODEX DOES IT — and it is not what the folklore says
/// -------------------------------------------------------
/// Its service links ApplicationServices, CoreGraphics and Carbon and does NOT
/// link SkyLight; the window-manager trick of hand-building a 0xf8-byte record
/// for `SLPSPostEventRecordTo` appears nowhere. What
/// `SyntheticAppFocusEnforcer.enforceActiveState(for:)` actually does is build
/// an ordinary AppKit-defined `NSEvent` whose *subtype* is a CPS focus
/// notification, and post it to the target with `CGEventPostToPid` — the same
/// transport we already use for clicks and keystrokes.
///
/// It keeps `applicationIsActive` (reality) beside `applicationBelievesItIsActive`
/// and `applicationBelievesItHasFocus` (what the target was told), and only
/// re-sends when the two disagree. The real foreground is never touched: its
/// `setFrontProcess` calls live solely in the picture-in-picture stream, tagged
/// `causedByUser`, for when the *user* clicks the PIP window.
///
/// So this needs no private symbol at all — `NSEvent.otherEvent`, `.cgEvent`
/// and `CGEventPostToPid` are public. Only the subtype values are undocumented.
enum SyntheticWindowFocus {
    /// CPS notifications, carried as the subtype of a synthesized event.
    ///
    /// Values recovered from the once-initializers in Codex's service. Stored
    /// as `Int32` because `keyFocusReturned` does not fit `Int16` unsigned —
    /// see `subtype`.
    enum Notification: Int32 {
        case appActivated = 1
        // Also the value CPS uses for "new front process"; the meaning comes
        // from which notification the sender is making, not from the number.
        case appDeactivated = 2
        case lostKeyFocus = 0x1000
        case keyFocusTaken = 0x4000
        /// The one that makes a background app act focused.
        case keyFocusReturned = 0x8000

        /// `NSEvent.subtype` is a signed 16-bit field, so 0x8000 travels as the
        /// negative with the same bit pattern. Truncating instead would send
        /// subtype 0 — a different, meaningless notification that the target
        /// accepts and ignores, with no error anywhere.
        var subtype: Int16 { Int16(truncatingIfNeeded: rawValue) }

        /// The event type that carries this notification. NOT the same for all
        /// of them, which is the detail this file originally got wrong.
        ///
        /// Every notification used to be posted on `.appKitDefined` (13). The
        /// activation pair does belong there — Codex hardcodes type 13 with
        /// subtype 1 — but the key-focus family travels on type 21, read out of
        /// the lazily-initialized global its `enforceActiveState` loads the type
        /// from (`mov w9, #0x15`, stored beside the 0x8000 subtype).
        ///
        /// 21 has no name in the public `NSEventType`, yet it is a valid case:
        /// `NSEvent.otherEvent` builds it and `.cgEvent` converts it. On type 13
        /// the same subtype is a notification the target has no handler for —
        /// accepted, ignored, no error, and the only symptom is that background
        /// input never lands. That is what a whole build measured as "24
        /// mutating actions, 1 effect".
        var carrierEventType: NSEvent.EventType? {
            switch self {
            case .appActivated, .appDeactivated:
                return .appKitDefined
            case .lostKeyFocus, .keyFocusTaken, .keyFocusReturned:
                return NSEvent.EventType(rawValue: Self.keyFocusCarrierRawValue)
            }
        }

        /// Undocumented, so it is read back rather than assumed: a future SDK
        /// that stops accepting it makes `carrierEventType` nil and `post`
        /// return false, instead of trapping on a force-unwrap.
        static let keyFocusCarrierRawValue: UInt = 21
    }

    /// Post a CPS focus notification to `pid`.
    ///
    /// Returns false only when AppKit refuses to build the event or convert it,
    /// which does not happen in practice; there is no delivery receipt to check.
    @discardableResult
    static func post(_ notification: Notification, to pid: pid_t) -> Bool {
        guard pid > 0,
              let carrier = notification.carrierEventType,
              let event = NSEvent.otherEvent(
                  with: carrier,
                  location: .zero,
                  modifierFlags: [],
                  timestamp: 0,
                  windowNumber: 0,
                  context: nil,
                  subtype: notification.subtype,
                  data1: 0,
                  data2: 0
              ),
              let cgEvent = event.cgEvent
        else { return false }

        cgEvent.postToPid(pid)
        return true
    }

    /// Make `pid` behave as a focused application for the actions that follow,
    /// leaving the user's foreground exactly where it was.
    ///
    /// Sent ONLY when the target is not already the active application. Codex
    /// gates it the same way — its enforcer holds `applicationIsActive` beside
    /// `applicationBelievesItIsActive` and re-sends only when the two disagree —
    /// and the first version of this file described that gate in its own
    /// documentation while shipping without it.
    ///
    /// Sending it unconditionally is not a harmless extra. The notification
    /// names `windowNumber: 0`, so telling an app that already owns a key
    /// window that "key focus returned" to no window at all is at best noise
    /// and quite possibly an instruction to let go of it. Measured on a session
    /// where the target's traffic lights stayed fully coloured — the app was
    /// active and its window was key throughout — and every one of nine
    /// window-bound clicks was discarded anyway.
    /// Both halves are required, and sending one was the other half of the bug.
    ///
    /// Codex's enforcer tracks two separate beliefs — `applicationBelievesItIsActive`
    /// and `applicationBelievesItHasFocus` — and its `enforceActiveState` posts
    /// two notifications to establish them: the key-focus one, then
    /// `appActivated` (hardcoded type 13, subtype 1). This only ever sent the
    /// first. Telling a window that focus returned, to an application that does
    /// not believe it is active, leaves the input routing exactly where it was.
    ///
    /// Order matches the reference: focus, then activation.
    @discardableResult
    static func enforceActiveState(pid: pid_t) -> Bool {
        guard !isActiveApplication(pid) else { return false }
        let focused = post(.keyFocusReturned, to: pid)
        let activated = post(.appActivated, to: pid)
        let posted = focused || activated
        if posted { enforced.withLock { $0.insert(pid) } }
        return posted
    }

    /// Reality, as opposed to what the target has been told.
    private static func isActiveApplication(_ pid: pid_t) -> Bool {
        NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
    }

    /// Tell every app we lied to that it is no longer active.
    ///
    /// Scoped to the session, not the action: re-sending per click would cancel
    /// the focus we just established before the target's run loop had used it,
    /// and Codex tears its enforcer down the same way — at
    /// `deactivateFocusEnforcer`, not after each event.
    ///
    /// Without this the belief outlives its usefulness. The target goes on
    /// acting focused long after we stop driving it: a caret keeps blinking in
    /// an app the user is not in, and the next real click there arrives at a
    /// window that never learned it had lost focus.
    static func relinquishAll() {
        let pids = enforced.withLock { pids -> Set<pid_t> in
            defer { pids.removeAll() }
            return pids
        }
        for pid in pids { post(.appDeactivated, to: pid) }
    }

    /// Targets currently told they are focused. Written from the daemon's
    /// request queue and read on teardown, so it needs the lock.
    private static let enforced = OSAllocatedUnfairLock(initialState: Set<pid_t>())
}
