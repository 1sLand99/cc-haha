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

    Treat the screenshot as possibly STALE: a covered window stops redrawing, so \
    it may show what the app last painted rather than what is true now. Do not \
    conclude an action worked, or failed, from this picture, and do not report \
    the task complete on the strength of it. Say the window is covered and ask \
    the user to leave it visible.
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
              repainting: this image can be older than it looks, and it cannot \
              settle whether the action worked.
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
        unchanging pictures and finished paused. Change approach, or tell the \
        user what you tried and what you saw.
        """
    }
}
