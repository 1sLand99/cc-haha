import CoreGraphics
import Foundation

/// Decides what to do when the app being driven is buried under other windows.
///
/// A fully covered Chromium window stops drawing, so the screenshot freezes
/// while every action still reports success. That combination is worse than an
/// error: on a real session the model went three and a half minutes on one
/// stale image and then reported a song playing that the final capture plainly
/// showed paused. The state has to be recoverable, and when it is not, said out
/// loud.
///
/// The judgement this encodes is where to stop. Raising the window once is
/// helping — the user asked for this app to be driven, and a window that cannot
/// render cannot be driven. Raising it every time it gets covered is fighting
/// the user for their own screen, and the second burial is the signal that they
/// meant it.
///
/// What is NOT on the table is activating the application. A raise reorders a
/// window; activation takes the user's foreground, and driving an app while
/// they work in another one is the entire feature. When a raise is not enough
/// to uncover the window, this says so and stops — a stalled turn is a cheaper
/// price than the user's screen. See `AXAction.raiseWindow`.
enum TargetVisibilityPolicy {
    enum Action: Equatable {
        /// Visible enough to keep rendering. Say nothing.
        case proceed
        /// Bring it back and tell the model what happened, so a screenshot that
        /// changes for no apparent reason is explained.
        case raiseAndNotify
        /// Covered again after we already recovered it once. Leave the user's
        /// windows alone and downgrade the screenshot's credibility instead.
        case warnOnly
    }

    /// - Parameters:
    ///   - isFullyCovered: from `WindowGeometry.isFullyCovered`.
    ///   - hasRecoveredBefore: whether this session already raised this target.
    static func decide(
        isFullyCovered: Bool,
        hasRecoveredBefore: Bool
    ) -> Action {
        guard isFullyCovered else { return .proceed }
        return hasRecoveredBefore ? .warnOnly : .raiseAndNotify
    }

    /// Fail closed when the target window is fully covered.
    ///
    /// A fully covered Chromium/CEF window stops drawing, and synthetic input
    /// delivered to it cannot be verified. Continuing to report "Action
    /// completed" in that state is worse than an error, because the caller has
    /// no way to know whether the action landed. This guard is called before
    /// every mutating command.
    static func ensureRenderableForMutation(
        pid: pid_t,
        frontmostWindow: (pid_t) -> WindowGeometry.Window? = { WindowGeometry.frontmostWindow(pid: $0) },
        isFullyCovered: (CGWindowID) -> Bool = { WindowGeometry.isFullyCovered(windowID: $0) }
    ) throws {
        guard let window = frontmostWindow(pid) else { return }
        guard isFullyCovered(window.id) else { return }
        throw CUError(
            "window_occluded",
            """
            The target app's window is completely covered by other windows, so the \
            action was not sent. Input cannot reliably reach an occluded Chromium/CEF \
            window. Uncover the window and try again.
            """
        )
    }

    static let raisedNotice = """
    NOTE: This app's window was completely covered by other windows, which stops \
    it redrawing — the screenshot would have been frozen at whatever it last \
    painted. It has been brought back to the front once so the state you are \
    shown is live. Expect the picture to look different from the previous turn \
    for that reason alone.
    """

    static let coveredAgainNotice = """
    NOTE: This app's window is completely covered by other windows again. It was \
    already restored once this session, so it has been left alone — putting it \
    back a second time would be taking the screen from the user, who evidently \
    wants it covered.

    \(staleCaptureWarning)
    """

    /// Said when the raise ran and the window is still buried.
    ///
    /// The honest report of a limit, not a failure to try. Only activating the
    /// application would clear this, and that takes the user's foreground —
    /// which is the one thing the feature exists to avoid.
    static let couldNotUncoverNotice = """
    NOTE: This app's window is completely covered by other windows. Raising the \
    window did not clear it, and it has been left there: getting above another \
    application's windows would mean activating this app and taking the \
    foreground away from whatever the user is doing.

    \(staleCaptureWarning)
    """

    /// Shared by both covered cases: the screenshot is stale and mutating
    /// actions are refused.
    ///
    /// The first version of this ended with "ask the user to leave it visible",
    /// and that is what the model did — it stopped one action into a three-step
    /// task and handed the job back. A user who asks for automation is not
    /// asking to be consulted about window management halfway through.
    ///
    /// The failure this file was written for is the opposite one: a session that
    /// read a frozen image, pressed play four times, and reported a song playing
    /// that the capture showed paused. Both are avoidable at once, because the
    /// engine now fails closed: mutating actions are not attempted while the
    /// window is fully covered. The model can still read the AX tree and report
    /// what it sees, but it cannot change state through an occluded window.
    private static let staleCaptureWarning = """
    Treat the screenshot as possibly STALE: a covered window stops redrawing, so \
    it may show what the app last painted rather than what is true now.

    Mutating actions are refused while the window stays fully covered, because \
    input cannot reliably reach an occluded Chromium/CEF window and its effect \
    cannot be verified. Uncover the window to continue.
    """

    /// Said when a mutating action produced a byte-identical capture.
    ///
    /// Which sentence depends on coverage, because we know the answer and the
    /// model does not. The first draft offered both possibilities — "the action
    /// missed, or the window is not repainting, you cannot tell" — while the
    /// window was demonstrably repainting the whole time. The model spent four
    /// minutes chasing the explanation we had handed it and never revisited the
    /// true one. An engine that can check a thing must not offer it as a
    /// mystery.
    ///
    /// - Parameter windowIsCovered: whether the target is fully buried, i.e.
    ///   whether "it stopped repainting" is actually on the table.
    static func identicalCaptureNotice(windowIsCovered: Bool) -> String {
        let cause = windowIsCovered
            ? """
              The window is also fully covered right now, so it may have stopped \
              repainting: this image can be older than it looks. Mutating actions \
              are refused while the window is covered, so the picture will stay \
              frozen until it is uncovered.
              """
            : """
              The window is visible and repainting, so this is not a stale \
              image — the action genuinely changed nothing.
              """
        return """
        NOTE: This screenshot is byte-for-byte identical to the previous one, \
        taken after an action that should have changed something. \(cause)

        Do not repeat the same action. If it is a toggle such as play/pause, a \
        second press undoes the first — one session pressed play four times on \
        unchanging pictures and finished paused. Continue the task, and report \
        what you did and what you could not confirm.
        """
    }
}
