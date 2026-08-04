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
        // image cannot settle the question, and block the completion claim.
        let notice = TargetVisibilityPolicy.coveredAgainNotice
        XCTAssertTrue(notice.contains("STALE"))
        XCTAssertTrue(notice.contains("Do not conclude an action worked"))
        XCTAssertTrue(notice.contains("do not report the task complete"))
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
}
