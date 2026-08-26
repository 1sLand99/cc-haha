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
    struct BeliefTarget: Equatable, Sendable {
        let processIdentity: AXTreeProcessIdentity?
    }

    /// Session-scoped belief about process lifetimes that have already
    /// received the synthetic focus + activation pair.
    ///
    /// Keeping this state is load-bearing for Chromium/CEF text entry. A click
    /// establishes in-app focus on a field; blindly posting another
    /// `keyFocusReturned` to window 0 before `type_text` can reset that field
    /// focus. Codex keeps the same distinction between real application state
    /// and what the target has already been told.
    struct BeliefState {
        private(set) var syntheticallyActive: [pid_t: BeliefTarget] = [:]

        /// Reserve the one establishment send for `pid`.
        ///
        /// Seeing the process genuinely active clears the synthetic belief so
        /// a later background transition can establish it again.
        mutating func beginEnforcement(
            pid: pid_t,
            applicationIsActive: Bool,
            target: BeliefTarget
        ) -> Bool {
            if applicationIsActive {
                observeRealActivation(pid: pid)
                return false
            }
            guard syntheticallyActive[pid] != target else { return false }
            syntheticallyActive[pid] = target
            return true
        }

        mutating func observeRealActivation(pid: pid_t) {
            syntheticallyActive.removeValue(forKey: pid)
        }

        mutating func cancelEnforcement(
            pid: pid_t,
            expectedTarget: BeliefTarget? = nil
        ) {
            if let expectedTarget,
               syntheticallyActive[pid] != expectedTarget {
                return
            }
            syntheticallyActive.removeValue(forKey: pid)
        }

        mutating func drain() -> [pid_t: BeliefTarget] {
            defer { syntheticallyActive.removeAll() }
            return syntheticallyActive
        }
    }

    struct EnforcementRuntime: Sendable {
        let applicationIsActive: Bool
        let target: BeliefTarget
        let post: @Sendable (Notification, pid_t) -> Bool
    }

    /// CPS notifications, carried as the subtype of a synthesized event.
    ///
    /// Values recovered from the once-initializers in Codex's service. Stored
    /// as `Int32` because `keyFocusReturned` does not fit `Int16` unsigned —
    /// see `subtype`.
    enum Notification: Int32, Sendable {
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
        // Register before reserving belief so a real activation that happens
        // later is observed even when no CU request runs while the app is
        // actually frontmost.
        _ = applicationLifecycleObserver
        let runtime = EnforcementRuntime(
            applicationIsActive: isActiveApplication(pid),
            target: BeliefTarget(
                processIdentity: currentProcessIdentity(pid: pid)
            ),
            post: { notification, targetPid in
                post(notification, to: targetPid)
            }
        )
        let reserved = beliefs.withLock { state in
            state.beginEnforcement(
                pid: pid,
                applicationIsActive: runtime.applicationIsActive,
                target: runtime.target
            )
        }
        guard reserved else { return false }
        guard postEnforcementPair(pid: pid, runtime: runtime) else {
            beliefs.withLock {
                $0.cancelEnforcement(
                    pid: pid,
                    expectedTarget: runtime.target
                )
            }
            return false
        }
        return true
    }

    /// Testable transition used by the live wrapper above. Keeping the
    /// notification sink beside the belief mutation lets tests drive the same
    /// success, deduplication and rollback path production uses.
    @discardableResult
    static func enforceActiveState(
        pid: pid_t,
        state: inout BeliefState,
        runtime: EnforcementRuntime
    ) -> Bool {
        guard state.beginEnforcement(
            pid: pid,
            applicationIsActive: runtime.applicationIsActive,
            target: runtime.target
        ) else { return false }

        guard postEnforcementPair(pid: pid, runtime: runtime) else {
            state.cancelEnforcement(pid: pid, expectedTarget: runtime.target)
            return false
        }
        return true
    }

    /// Post outside the belief lock. AppKit event construction and delivery
    /// are external calls; keeping an unfair lock held across them risks
    /// re-entrancy and makes every other focus transition wait unnecessarily.
    private static func postEnforcementPair(
        pid: pid_t,
        runtime: EnforcementRuntime
    ) -> Bool {
        let focused = runtime.post(.keyFocusReturned, pid)
        let activated = runtime.post(.appActivated, pid)
        guard focused && activated else {
            if focused || activated {
                // Do not leave a half-established belief behind when AppKit
                // could construct only one side of the pair.
                if focused { _ = runtime.post(.lostKeyFocus, pid) }
                _ = runtime.post(.appDeactivated, pid)
            }
            return false
        }
        return true
    }

    /// Reality, as opposed to what the target has been told.
    private static func isActiveApplication(_ pid: pid_t) -> Bool {
        NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
    }

    private static func currentProcessIdentity(pid: pid_t) -> AXTreeProcessIdentity? {
        guard let application = NSRunningApplication(processIdentifier: pid) else {
            return nil
        }
        return AXTreeProcessIdentity(
            bundleID: application.bundleIdentifier,
            executablePath: application.executableURL?.path,
            launchTime: application.launchDate?.timeIntervalSinceReferenceDate
        )
    }

    private static func observeRealActivation(pid: pid_t) {
        beliefs.withLock { $0.observeRealActivation(pid: pid) }
    }

    /// NSWorkspace is the observable edge the old PID-only cache lacked. If a
    /// user brings a synthetic target to the real foreground and then leaves
    /// it, the real deactivate invalidates what the app was told. Clearing the
    /// belief on activation makes the next background request establish a new
    /// pair instead of trusting stale session state.
    private final class ApplicationLifecycleObserver: @unchecked Sendable {
        private let activationToken: NSObjectProtocol

        init() {
            activationToken = NSWorkspace.shared.notificationCenter.addObserver(
                forName: NSWorkspace.didActivateApplicationNotification,
                object: nil,
                queue: .main
            ) { notification in
                let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey]
                    as? NSRunningApplication
                guard let pid = application?.processIdentifier,
                      NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
                else { return }
                SyntheticWindowFocus.observeRealActivation(pid: pid)
            }
        }

        deinit {
            NSWorkspace.shared.notificationCenter.removeObserver(activationToken)
        }
    }

    private static let applicationLifecycleObserver = ApplicationLifecycleObserver()

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
        let targets = beliefs.withLock { $0.drain() }
        for (pid, target) in targets {
            // Do not aim teardown at a recycled PID, or tell an app the user is
            // genuinely using that it lost focus.
            guard !isActiveApplication(pid),
                  currentProcessIdentity(pid: pid) == target.processIdentity
            else { continue }
            post(.lostKeyFocus, to: pid)
            post(.appDeactivated, to: pid)
        }
    }

    /// Written from the daemon's request queue and read on teardown. The lock
    /// also makes the reserve-before-send transition atomic if a future caller
    /// reaches it off the main actor.
    private static let beliefs = OSAllocatedUnfairLock(initialState: BeliefState())
}
