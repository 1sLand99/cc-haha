import AppKit
import CoreGraphics
import XCTest

@testable import cc_haha_computer_use

/// The point of this type is that automating an app must not cost the user
/// their foreground. The previous implementation made the target genuinely
/// frontmost for every click — measured, `Finder → NeteaseMusic` — which is the
/// opposite of "it works in the background while I do something else".
///
/// Nothing here can prove the target *acts* on the notification; that needs a
/// real app. What is worth pinning is the one value that is undocumented, has
/// no error path, and silently means nothing if it is wrong.
final class SyntheticWindowFocusTests: XCTestCase {
    func testKeyFocusReturnedSurvivesTheSignedSubtypeField() {
        // `NSEvent.subtype` is Int16. 0x8000 does not fit, and the obvious
        // conversions either trap or clamp to 0x7FFF; truncating to the same
        // bit pattern is the only one that sends the notification we mean.
        // Getting this wrong sends subtype 0 — accepted, ignored, no error, and
        // the only symptom is that background clicks stop landing.
        XCTAssertEqual(SyntheticWindowFocus.Notification.keyFocusReturned.subtype, Int16(bitPattern: 0x8000))
        XCTAssertEqual(
            UInt16(bitPattern: SyntheticWindowFocus.Notification.keyFocusReturned.subtype),
            0x8000
        )
    }

    func testTheNotificationValuesMatchTheOnesRecoveredFromCodex() {
        // Recovered from the once-initializers in Codex's CU service. They are
        // not derivable from any header, so a "tidy-up" that renumbers them
        // would be undetectable at runtime.
        XCTAssertEqual(SyntheticWindowFocus.Notification.appActivated.rawValue, 1)
        XCTAssertEqual(SyntheticWindowFocus.Notification.appDeactivated.rawValue, 2)
        XCTAssertEqual(SyntheticWindowFocus.Notification.lostKeyFocus.rawValue, 0x1000)
        XCTAssertEqual(SyntheticWindowFocus.Notification.keyFocusTaken.rawValue, 0x4000)
        XCTAssertEqual(SyntheticWindowFocus.Notification.keyFocusReturned.rawValue, 0x8000)
    }

    func testTheEventIsAppKitDefinedWithTheRightSubtype() throws {
        // The subtype only means a CPS notification on an AppKit-defined event;
        // on any other type it is a different field entirely.
        let event = try XCTUnwrap(
            NSEvent.otherEvent(
                with: .appKitDefined,
                location: .zero,
                modifierFlags: [],
                timestamp: 0,
                windowNumber: 0,
                context: nil,
                subtype: SyntheticWindowFocus.Notification.keyFocusReturned.subtype,
                data1: 0,
                data2: 0
            )
        )
        XCTAssertEqual(event.type, .appKitDefined)
        XCTAssertEqual(event.subtype.rawValue, Int16(bitPattern: 0x8000))
        // Focus is a per-process notification here, not a per-window one.
        XCTAssertEqual(event.windowNumber, 0)
        XCTAssertNotNil(event.cgEvent, "must survive conversion or it cannot be posted")
    }

    func testAnInvalidPidIsRefusedRatherThanBroadcast() {
        // CGEventPostToPid with a nonsense pid is not obviously harmless, and a
        // focus notification aimed at nothing is never something we meant.
        XCTAssertFalse(SyntheticWindowFocus.post(.keyFocusReturned, to: 0))
        XCTAssertFalse(SyntheticWindowFocus.post(.keyFocusReturned, to: -1))
    }

    func testItNeedsNoPrivateSymbols() throws {
        // The whole recipe is NSEvent.otherEvent + .cgEvent + CGEventPostToPid,
        // all public. That is why this survives an OS update that would break
        // the SkyLight event-record trick it replaced — worth a test, because
        // the tempting "improvement" is to reach for the private API again.
        let event = try XCTUnwrap(
            NSEvent.otherEvent(
                with: .appKitDefined, location: .zero, modifierFlags: [],
                timestamp: 0, windowNumber: 0, context: nil,
                subtype: SyntheticWindowFocus.Notification.appDeactivated.subtype,
                data1: 0, data2: 0
            )
        )
        XCTAssertNotNil(event.cgEvent)
    }
}

/// This file used to assert that a coordinate click never takes the
/// foreground. It was written when `WindowKeyFocus` was removed in favour of
/// the synthetic notification, and it did its job: it went red the moment that
/// change was reverted.
///
/// The revert is the right answer. Measured across two sessions on the build
/// that shipped the synthetic path alone: 24 mutating actions produced 1
/// effect, and in the other session the target's traffic lights stayed fully
/// coloured — app active, window key — while nine window-bound clicks were
/// discarded regardless. A feature that never disturbs the user and never works
/// is not the feature.
///
/// So what is protected here is now narrower and honest: every input path must
/// go through one place that makes the target accept input, that place must ask
/// before taking the foreground, and the synthetic notification must not be
/// broadcast at an app that already has focus.
final class InputAcceptanceContractTests: XCTestCase {
    private func source(_ name: String) throws -> String {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/cu-helper")
        return try String(contentsOf: root.appendingPathComponent(name), encoding: .utf8)
    }

    func testEveryInputPathEnsuresTheTargetWillAcceptIt() throws {
        // Keyboard used to inherit whatever focus the last click had left
        // behind. Once clicks stopped taking real foreground, that inheritance
        // was worth nothing, and nine consecutive type_text calls went nowhere
        // while every one returned "Action completed".
        let axAction = try source("AXAction.swift")
        for entry in ["clickPoint", "typeText", "pressKey"] {
            let body = try XCTUnwrap(
                axAction.range(of: "public static func \(entry)").map {
                    String(axAction[$0.lowerBound...].prefix(1200))
                },
                "\(entry) is missing"
            )
            XCTAssertTrue(
                body.contains("ensureTargetAcceptsInput"),
                "\(entry) must ensure the target accepts input before acting"
            )
        }
    }

    func testForegroundIsTakenOnlyWhenTheTargetDoesNotHaveIt() throws {
        // `grantIfNeeded` no-ops when the target is already frontmost. Calling
        // `grant` directly here would re-take the foreground on every single
        // click of a task, which is the behaviour that made the feature
        // unusable alongside the user.
        let axAction = try source("AXAction.swift")
        let ensure = try XCTUnwrap(
            axAction.range(of: "private static func ensureTargetAcceptsInput(pid: pid_t, windowID").map {
                String(axAction[$0.lowerBound...].prefix(900))
            }
        )
        XCTAssertTrue(ensure.contains("WindowKeyFocus.grantIfNeeded"))
        XCTAssertFalse(
            ensure.contains("WindowKeyFocus.grant(") ,
            "must go through grantIfNeeded so an already-focused target is left alone"
        )
    }

    func testTheSyntheticNotificationIsGatedOnRealState() throws {
        // Codex holds `applicationIsActive` beside `applicationBelievesItIsActive`
        // and only re-sends when they disagree. The first version of this file
        // documented that gate and shipped without it — sending "key focus
        // returned to window 0" to an app that already owned a key window, on
        // every click.
        let focus = try source("SyntheticWindowFocus.swift")
        let enforce = try XCTUnwrap(
            focus.range(of: "static func enforceActiveState").map {
                String(focus[$0.lowerBound...].prefix(400))
            }
        )
        XCTAssertTrue(
            enforce.contains("isActiveApplication"),
            "must not tell an already-active app that focus returned"
        )
    }
}
