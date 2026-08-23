import CoreGraphics
import XCTest

@testable import cc_haha_computer_use

/// A fully covered Chromium window stops drawing while every action still
/// reports success. Measured on one real session: 22 captures, 6 distinct
/// images, the first 17 identical while the model clicked and typed through
/// them — and a final report claiming a song was playing that the last capture
/// showed paused, with the wrong title in the bar.
///
/// So coverage is not cosmetic, and it is worth being exact about.
final class WindowCoverageTests: XCTestCase {
    private let target = CGRect(x: 100, y: 100, width: 400, height: 300)

    func testAnUncoveredWindowIsNotCovered() {
        XCTAssertFalse(WindowGeometry.isCovered(target, by: []))
    }

    func testOneWindowLargerThanTheTargetCoversIt() {
        let big = CGRect(x: 0, y: 0, width: 1000, height: 800)
        XCTAssertTrue(WindowGeometry.isCovered(target, by: [big]))
    }

    func testAWindowOverlappingPartOfItDoesNotCount() {
        // Half covered still renders — Chromium only stops when nothing of the
        // window is visible, so a partial overlap must not trigger a recovery
        // that takes the screen away from the user for no reason.
        let half = CGRect(x: 100, y: 100, width: 400, height: 150)
        XCTAssertFalse(WindowGeometry.isCovered(target, by: [half]))
    }

    func testTwoWindowsCoveringDifferentHalvesCoverItTogether() {
        // The case a naive "does any single window contain it" check gets
        // wrong, and the common one: an editor over the top, a terminal below.
        let top = CGRect(x: 50, y: 50, width: 600, height: 200)
        let bottom = CGRect(x: 50, y: 250, width: 600, height: 300)
        XCTAssertTrue(WindowGeometry.isCovered(target, by: [top, bottom]))
    }

    func testTwoWindowsWithAHorizontalGapDoNotCoverIt() {
        // A sliver of the target shows between them, so it keeps painting.
        let top = CGRect(x: 50, y: 50, width: 600, height: 100)      // to y=150
        let bottom = CGRect(x: 50, y: 200, width: 600, height: 400)  // from y=200
        XCTAssertFalse(WindowGeometry.isCovered(target, by: [top, bottom]))
    }

    func testTwoWindowsSideBySideCoverItTogether() {
        let left = CGRect(x: 0, y: 0, width: 300, height: 800)
        let right = CGRect(x: 300, y: 0, width: 700, height: 800)
        XCTAssertTrue(WindowGeometry.isCovered(target, by: [left, right]))
    }

    func testSideBySideWindowsWithAVerticalGapDoNotCoverIt() {
        let left = CGRect(x: 0, y: 0, width: 250, height: 800)     // to x=250
        let right = CGRect(x: 300, y: 0, width: 700, height: 800)  // from x=300
        XCTAssertFalse(WindowGeometry.isCovered(target, by: [left, right]))
    }

    func testManySmallWindowsThatDoNotAddUpDoNotCoverIt() {
        let scraps = (0..<5).map { CGRect(x: 100 + $0 * 80, y: 100, width: 40, height: 300) }
        XCTAssertFalse(WindowGeometry.isCovered(target, by: scraps))
    }
}

final class TargetVisibilityPolicyTests: XCTestCase {
    func testAVisibleTargetIsLeftAlone() {
        XCTAssertEqual(
            TargetVisibilityPolicy.decide(isFullyCovered: false, hasRecoveredBefore: false),
            .proceed
        )
        // Even after a recovery, visible means silent: a notice on every
        // subsequent turn would be noise the model learns to skip.
        XCTAssertEqual(
            TargetVisibilityPolicy.decide(isFullyCovered: false, hasRecoveredBefore: true),
            .proceed
        )
    }

    func testTheFirstBurialIsRecovered() {
        // A window that cannot render cannot be driven, and the user asked for
        // it to be driven. Raising it once is honouring the request.
        XCTAssertEqual(
            TargetVisibilityPolicy.decide(isFullyCovered: true, hasRecoveredBefore: false),
            .raiseAndNotify
        )
    }

    func testTheSecondBurialIsNotFought() {
        // The whole judgement of this file: covering it again is the user
        // saying they want their screen. Taking it back would be the automation
        // arguing with them, once per turn, for as long as the task runs.
        XCTAssertEqual(
            TargetVisibilityPolicy.decide(isFullyCovered: true, hasRecoveredBefore: true),
            .warnOnly
        )
    }

    func testTheWarningRemovesTheScreenshotsAuthorityRatherThanJustDescribingIt() {
        // "The window is covered" alone leaves the model free to keep reading
        // the picture — which is what produced a confident report of a song
        // playing that the capture showed paused. The notice has to say the
        // image cannot settle the question, and that mutating actions are refused.
        //
        // Both covered outcomes carry it. `couldNotUncoverNotice` is the newer
        // one and the easier to get wrong: it reads as "we tried and it is
        // fine", when the screenshot behind it is exactly as untrustworthy.
        for notice in [
            TargetVisibilityPolicy.coveredAgainNotice,
            TargetVisibilityPolicy.couldNotUncoverNotice,
        ] {
            XCTAssertTrue(notice.contains("STALE"))
            XCTAssertTrue(
                notice.contains("Mutating actions are refused"),
                "a covered window must not invite the model to act blindly"
            )
            XCTAssertTrue(
                notice.contains("cannot reliably reach"),
                "the reason for refusal must be stated"
            )
        }
    }

    /// A covered window must not end the task by asking the user to manage it.
    ///
    /// The first version of these notices closed with "ask the user to leave it
    /// visible", and the model obeyed: it stopped after one action of a
    /// three-step instruction and handed the job back. Stopping to consult the
    /// user about window management is the automation failing, and it is a very
    /// easy sentence to reintroduce while tightening the honesty language —
    /// which is the half of this that keeps pulling the other way.
    ///
    /// The current contract is different: the engine fails closed, so the
    /// notice explains *why* actions are refused and tells the user to uncover
    /// the window. It must not ask the model to ask the user.
    func testACoveredWindowDoesNotTurnIntoAQuestionForTheUser() {
        for notice in [
            TargetVisibilityPolicy.coveredAgainNotice,
            TargetVisibilityPolicy.couldNotUncoverNotice,
        ] {
            XCTAssertTrue(
                notice.contains("Uncover the window to continue"),
                "the user needs a concrete next step, not a stalled turn"
            )
            // The exact shape of the sentence that caused it: an instruction to
            // put the question to the user. Kept as a literal because the
            // failure was literal.
            XCTAssertFalse(
                notice.lowercased().contains("ask the user to"),
                "handing window management back to the user abandons the task"
            )
        }
    }

    /// Honesty now means: the picture is stale and mutating actions are refused.
    ///
    /// The old notice claimed input did not depend on visibility; measured
    /// behavior under occlusion showed it does for Chromium/CEF windows. The
    /// replacement must not revive that claim.
    func testTheModelIsToldActionsAreRefusedWhileCovered() {
        for notice in [
            TargetVisibilityPolicy.coveredAgainNotice,
            TargetVisibilityPolicy.couldNotUncoverNotice,
        ] {
            XCTAssertTrue(notice.contains("Mutating actions are refused"))
            XCTAssertFalse(
                notice.contains("Input does not depend on visibility"),
                "old claim contradicted by measured occlusion behavior"
            )
            XCTAssertFalse(
                notice.contains("Carry on with the task"),
                "the engine now fails closed, so the model must not be told to proceed"
            )
        }
    }

    func testTheRaisedNoticeIsTheOnlyOneThatClaimsALiveScreenshot() {
        // Telling the model the picture is live when the window is still buried
        // is the failure this whole file exists to prevent, and the three
        // notices are one careless copy-paste apart.
        XCTAssertTrue(TargetVisibilityPolicy.raisedNotice.contains("live"))
        XCTAssertFalse(TargetVisibilityPolicy.couldNotUncoverNotice.contains("state you are shown is live"))
        XCTAssertFalse(TargetVisibilityPolicy.coveredAgainNotice.contains("state you are shown is live"))
    }

    /// Source guard: recovering visibility must never cost the user their
    /// foreground.
    ///
    /// `raiseWindow` used to fall back to `NSRunningApplication.activate` when
    /// the raise was not enough, reasoning that a window which cannot repaint
    /// cannot be driven. It is a genuinely tempting trade — it buys a live
    /// screenshot for one steal — and it is the trade that makes background
    /// automation not background. The stalled turn is the intended cost.
    func testUncoveringNeverActivatesTheApplication() throws {
        let source = try String(
            contentsOfFile: URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("Sources/cu-helper/AXAction.swift")
                .path,
            encoding: .utf8
        )
        let body = try XCTUnwrap(
            source.range(of: "public static func raiseWindow").map {
                String(source[$0.lowerBound...].prefix(900))
            },
            "raiseWindow is missing"
        )
        XCTAssertFalse(
            body.contains("NSRunningApplication"),
            "raising a buried window must not activate its application"
        )
        XCTAssertFalse(
            body.contains(".activate("),
            "raising a buried window must not activate its application"
        )
    }

    func testTheIdenticalCaptureNoticeNamesTheToggleTrap() {
        // Repeating a click on a stale picture is normally harmless; on a
        // play/pause control it undoes the previous press. One session pressed
        // play four times and finished paused.
        for covered in [true, false] {
            let notice = TargetVisibilityPolicy.identicalCaptureNotice(windowIsCovered: covered)
            XCTAssertTrue(notice.contains("byte-for-byte identical"))
            XCTAssertTrue(notice.contains("toggle"))
            XCTAssertTrue(notice.contains("undoes the first"))
        }
    }

    func testAVisibleWindowIsToldTheActionMissedRatherThanOfferedAnExcuse() {
        // The first draft said "the action missed OR the window is not
        // repainting — you cannot tell". The window was repainting the whole
        // time, and the model spent four minutes chasing the possibility we had
        // handed it. Coverage is something we compute, so it must not be
        // presented to the model as an open question.
        let visible = TargetVisibilityPolicy.identicalCaptureNotice(windowIsCovered: false)
        XCTAssertTrue(visible.contains("genuinely changed nothing"))
        XCTAssertFalse(visible.contains("stopped repainting"))

        let covered = TargetVisibilityPolicy.identicalCaptureNotice(windowIsCovered: true)
        XCTAssertTrue(covered.contains("stopped repainting"))
        XCTAssertFalse(covered.contains("genuinely changed nothing"))
    }

    /// Mutating actions must fail closed when the target is fully covered.
    func testEnsureRenderableForMutationThrowsWhenCovered() throws {
        let window = WindowGeometry.Window(
            id: 123,
            bounds: CGRect(x: 0, y: 0, width: 100, height: 100),
            ownerPid: 42
        )
        XCTAssertThrowsError(
            try TargetVisibilityPolicy.ensureRenderableForMutation(
                pid: 42,
                frontmostWindow: { _ in window },
                isFullyCovered: { _ in true }
            )
        ) { error in
            let cuError = error as? CUError
            XCTAssertEqual(cuError?.code, "window_occluded")
        }
    }

    func testEnsureRenderableForMutationPassesWhenVisible() {
        let window = WindowGeometry.Window(
            id: 123,
            bounds: CGRect(x: 0, y: 0, width: 100, height: 100),
            ownerPid: 42
        )
        XCTAssertNoThrow(
            try TargetVisibilityPolicy.ensureRenderableForMutation(
                pid: 42,
                frontmostWindow: { _ in window },
                isFullyCovered: { _ in false }
            )
        )
    }

    func testEnsureRenderableForMutationPassesWhenNoWindow() {
        // No on-screen window is a different failure path (e.g. minimized); the
        // occlusion guard only fires when we can prove the window is covered.
        XCTAssertNoThrow(
            try TargetVisibilityPolicy.ensureRenderableForMutation(
                pid: 42,
                frontmostWindow: { _ in nil },
                isFullyCovered: { _ in true }
            )
        )
    }
}
