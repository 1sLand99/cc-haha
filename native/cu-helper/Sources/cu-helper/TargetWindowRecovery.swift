import AppKit

/// Makes an explicitly authorized app actionable when macOS has removed all of
/// its windows from the current on-screen window list.
///
/// Ordinary background windows stay untouched. Recovery is reserved for the
/// three states that cannot be reached by window-bound input: a hidden app, a
/// minimized window, or a window on another Space. `activateAllWindows` is the
/// public native equivalent of the user choosing the exact app in the Dock; it
/// can unhide/restore the app and move macOS to its Space without a shell or
/// AppleScript fallback.
@MainActor
enum TargetWindowRecovery {
    enum Outcome: Equatable {
        case alreadyOnScreen
        case recovered
    }

    struct Runtime {
        var currentIdentity: (pid_t) -> AXTreeProcessIdentity?
        var hasOnScreenWindow: (pid_t) -> Bool
        var activateAllWindows: (pid_t) -> Bool
        var pause: () async throws -> Void
        var attempts: Int = 20

        @MainActor static let live = Runtime(
            currentIdentity: { AXTree.currentProcessIdentity(pid: $0) },
            hasOnScreenWindow: { WindowGeometry.hasWindowOnScreen(pid: $0) },
            activateAllWindows: { pid in
                guard let application = NSRunningApplication(processIdentifier: pid),
                      !application.isTerminated else { return false }
                // `activate` normally unhides as part of activation. Sending an
                // explicit unhide first also covers apps whose reopen handling is
                // delayed; the on-screen verification below is still authoritative.
                if application.isHidden { _ = application.unhide() }
                return application.activate(options: [.activateAllWindows])
            },
            pause: { try await Task.sleep(for: .milliseconds(100)) }
        )
    }

    static func recoverIfNeeded(
        target: ProvenProcessTarget,
        runtime: Runtime = .live
    ) async throws -> Outcome {
        try validateIdentity(target, runtime: runtime)
        if runtime.hasOnScreenWindow(target.pid) {
            return .alreadyOnScreen
        }

        let activationAccepted = runtime.activateAllWindows(target.pid)

        // The request is asynchronous and AppKit explicitly says acceptance is
        // not proof of activation. Check once immediately, then yield the main
        // run loop for a bounded Space/window transition.
        try validateIdentity(target, runtime: runtime)
        if runtime.hasOnScreenWindow(target.pid) {
            return .recovered
        }
        for _ in 0..<max(0, runtime.attempts) {
            try Task.checkCancellation()
            try await runtime.pause()
            try validateIdentity(target, runtime: runtime)
            if runtime.hasOnScreenWindow(target.pid) {
                return .recovered
            }
        }

        let reason = activationAccepted
            ? "macOS accepted activation, but no target window appeared on screen"
            : "macOS refused the target app activation request"
        throw CUError(
            "target_window_offscreen",
            "Computer Use could not restore the explicitly selected app: \(reason). No state snapshot was published."
        )
    }

    private static func validateIdentity(
        _ target: ProvenProcessTarget,
        runtime: Runtime
    ) throws {
        guard runtime.currentIdentity(target.pid) == target.identity else {
            throw CUError(
                "stale_process",
                "The target process changed while restoring its window. No state snapshot was published."
            )
        }
    }
}
