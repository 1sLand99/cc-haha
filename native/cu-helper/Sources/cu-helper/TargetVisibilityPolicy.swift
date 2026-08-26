import Foundation

/// Explains a repeated window capture without turning ordinary occlusion into
/// an input failure.
///
/// ScreenCaptureKit captures a target window independently of the desktop's
/// stacking order, and all fallback input is addressed to the target process
/// and window. Another app covering the target is therefore not a reason to
/// raise it, activate it, or reject a mutation. A byte-identical capture is
/// still useful evidence, but only about pixels: it cannot prove that an action
/// failed, and it must never stop background automation.
enum TargetVisibilityPolicy {
    static let coveredCaptureNotice = """
    NOTE: Another application fully covers the target window. The screenshot \
    is captured from that window rather than from the visible desktop, but it \
    may be stale if the target paused its renderer while covered. Coverage does \
    not block Accessibility actions or app- and window-targeted input; continue \
    the task without activating or raising the target just to expose it.
    """

    static func identicalCaptureNotice(windowIsCovered: Bool) -> String {
        let cause = windowIsCovered
            ? """
              The target window is covered, so this image may be older than it \
              looks if that app paused its renderer. Coverage does not block \
              app- and window-targeted input.
              """
            : """
              The target window is not fully covered, so coverage does not \
              explain the identical pixels, and no visible pixel change was \
              observed.
              """

        return """
        NOTE: This screenshot is byte-for-byte identical to the previous one. \
        \(cause)

        Do not blindly repeat the same toggle: a second play/pause press can \
        undo the first. Re-read the accessibility state, use a semantic action \
        when one is available, or continue with a different app-targeted step.
        """
    }
}
