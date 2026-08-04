import CoreGraphics
import XCTest
@testable import cc_haha_computer_use

final class CursorMotionStateTests: XCTestCase {
    func testStartingGlideDoesNotJumpCurrentPositionToDestination() {
        var motion = CursorMotionState(position: CGPoint(x: 0, y: 0))

        motion.startGlide(to: CGPoint(x: 100, y: 0))

        XCTAssertEqual(motion.position, CGPoint(x: 0, y: 0))
        XCTAssertEqual(motion.destination, CGPoint(x: 100, y: 0))
    }

    func testFirstTickLandsBetweenSourceAndDestination() {
        var motion = CursorMotionState(position: CGPoint(x: 0, y: 0))
        motion.startGlide(to: CGPoint(x: 100, y: 0))

        motion.tick(deltaTime: 1.0 / 60.0)

        XCTAssertGreaterThan(motion.position.x, 0)
        XCTAssertLessThan(motion.position.x, 100)
        XCTAssertEqual(motion.position.y, 0, accuracy: 0.001)
    }

    func testRedirectStartsFromCurrentAnimatedPointAndReplacesDestination() {
        var motion = CursorMotionState(position: CGPoint(x: 0, y: 0))
        motion.startGlide(to: CGPoint(x: 100, y: 0))
        motion.tick(deltaTime: 1.0 / 60.0)
        let redirectPoint = motion.position

        motion.startGlide(to: CGPoint(x: -100, y: 0))

        XCTAssertEqual(motion.position, redirectPoint)
        XCTAssertEqual(motion.destination, CGPoint(x: -100, y: 0))
    }

    @MainActor
    func testBackgroundActionSnapsAndWaitsZero() async {
        let decision = OverlayPolicy.decision(
            targetPid: 41,
            frontmostPid: 99,
            overlayRequested: true,
            targetWindowExposed: false
        )
        var events: [String] = []

        await CursorActionTiming.perform(
            decision: decision,
            startGlide: { events.append("glide") },
            snap: { events.append("snap") },
            sleep: { _ in events.append("sleep") }
        )

        XCTAssertEqual(events, ["snap"])
    }

    @MainActor
    func testForegroundActionStartsGlideBeforeShortDelayWithoutAwaitingCompletion() async {
        let decision = OverlayPolicy.decision(
            targetPid: 41,
            frontmostPid: 41,
            overlayRequested: true,
            targetWindowExposed: false
        )
        var events: [String] = []
        var sleptFor: TimeInterval?

        await CursorActionTiming.perform(
            decision: decision,
            startGlide: { events.append("glide-started") },
            snap: { events.append("snap") },
            sleep: { delay in
                sleptFor = delay
                events.append("short-delay")
            }
        )

        XCTAssertEqual(events, ["glide-started", "short-delay"])
        XCTAssertEqual(sleptFor, decision.actionDelay)
    }

    @MainActor
    func testIndexedActionRechecksStalenessAfterCursorDelayBeforeMutation() async {
        var events: [String] = []

        await CursorIndexedActionGate.perform(
            moveForAction: { events.append("move-delay-finished") },
            recheckStaleness: { events.append("stale-rechecked") },
            mutate: { events.append("mutated") }
        )

        XCTAssertEqual(events, ["move-delay-finished", "stale-rechecked", "mutated"])
    }

    @MainActor
    func testIndexedActionDoesNotMutateWhenPostDelayStalenessCheckFails() async {
        enum ExpectedError: Error { case stale }
        var mutated = false

        do {
            try await CursorIndexedActionGate.perform(
                moveForAction: {},
                recheckStaleness: { throw ExpectedError.stale },
                mutate: { mutated = true }
            )
            XCTFail("expected stale recheck to fail")
        } catch ExpectedError.stale {
            XCTAssertFalse(mutated)
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }
}
