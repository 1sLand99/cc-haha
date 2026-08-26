import AppKit
import CoreGraphics
import os
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
    private let processA = AXTreeProcessIdentity(
        bundleID: "com.example.target",
        executablePath: "/Applications/Target.app/Contents/MacOS/Target",
        launchTime: 1
    )

    private func beliefTarget(
        processIdentity: AXTreeProcessIdentity? = nil
    ) -> SyntheticWindowFocus.BeliefTarget {
        SyntheticWindowFocus.BeliefTarget(
            processIdentity: processIdentity ?? processA
        )
    }

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

    /// The carrier event type is not the same for every notification, and this
    /// test used to assert that it was.
    ///
    /// Everything here posted on `.appKitDefined` (13), which is right for the
    /// activation pair and wrong for the key-focus family — Codex's
    /// `enforceActiveState` loads type 21 from the same lazily-initialized
    /// global that holds the 0x8000 subtype, and hardcodes 13 only for
    /// `appActivated`. On the wrong carrier the subtype names nothing the
    /// target handles: accepted, ignored, no error, and background input simply
    /// never lands.
    func testEachNotificationTravelsOnItsOwnCarrierType() {
        XCTAssertEqual(SyntheticWindowFocus.Notification.appActivated.carrierEventType, .appKitDefined)
        XCTAssertEqual(SyntheticWindowFocus.Notification.appDeactivated.carrierEventType, .appKitDefined)
        for keyFocus: SyntheticWindowFocus.Notification in [.keyFocusReturned, .keyFocusTaken, .lostKeyFocus] {
            XCTAssertEqual(
                keyFocus.carrierEventType?.rawValue,
                21,
                "the key-focus family does not travel on .appKitDefined"
            )
        }
    }

    func testTheKeyFocusCarrierIsAcceptedByAppKit() throws {
        // 21 has no name in the public NSEventType, so the thing worth pinning
        // is that AppKit still builds and converts it. If an OS update ever
        // rejects it, this fails here rather than silently degrading into
        // clicks that go nowhere.
        let carrier = try XCTUnwrap(
            SyntheticWindowFocus.Notification.keyFocusReturned.carrierEventType,
            "NSEvent.EventType no longer accepts the key-focus carrier"
        )
        let event = try XCTUnwrap(
            NSEvent.otherEvent(
                with: carrier,
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
        XCTAssertEqual(event.type.rawValue, 21)
        XCTAssertEqual(event.subtype.rawValue, Int16(bitPattern: 0x8000))
        // Focus is a per-process notification here, not a per-window one — the
        // reference passes windowNumber 0 on both sends.
        XCTAssertEqual(event.windowNumber, 0)
        XCTAssertNotNil(event.cgEvent, "must survive conversion or it cannot be posted")
    }

    func testAnInvalidPidIsRefusedRatherThanBroadcast() {
        // CGEventPostToPid with a nonsense pid is not obviously harmless, and a
        // focus notification aimed at nothing is never something we meant.
        XCTAssertFalse(SyntheticWindowFocus.post(.keyFocusReturned, to: 0))
        XCTAssertFalse(SyntheticWindowFocus.post(.keyFocusReturned, to: -1))
    }

    func testEnforcementPostsOneCompletePairForTheSameTarget() {
        var state = SyntheticWindowFocus.BeliefState()
        let target = beliefTarget()
        let sent = OSAllocatedUnfairLock(
            initialState: [SyntheticWindowFocus.Notification]()
        )
        let runtime = SyntheticWindowFocus.EnforcementRuntime(
            applicationIsActive: false,
            target: target,
            post: { notification, _ in
                sent.withLock { $0.append(notification) }
                return true
            }
        )

        XCTAssertTrue(SyntheticWindowFocus.enforceActiveState(
            pid: 42,
            state: &state,
            runtime: runtime
        ))
        XCTAssertEqual(sent.withLock { $0 }, [.keyFocusReturned, .appActivated])

        // click -> type_text is one focus transaction. Re-establishing focus
        // between those actions can reset the CEF control the click selected.
        XCTAssertFalse(SyntheticWindowFocus.enforceActiveState(
            pid: 42,
            state: &state,
            runtime: runtime
        ))
        XCTAssertEqual(sent.withLock { $0 }, [.keyFocusReturned, .appActivated])
        XCTAssertEqual(state.syntheticallyActive, [42: target])
    }

    func testPartialEnforcementIsWithdrawnAndCanRetry() {
        struct PostingState: Sendable {
            var sent: [SyntheticWindowFocus.Notification] = []
            var failActivation = true
        }

        var state = SyntheticWindowFocus.BeliefState()
        let target = beliefTarget()
        let posting = OSAllocatedUnfairLock(initialState: PostingState())
        let runtime = SyntheticWindowFocus.EnforcementRuntime(
            applicationIsActive: false,
            target: target,
            post: { notification, _ in
                posting.withLock { state in
                    state.sent.append(notification)
                    if notification == .appActivated, state.failActivation {
                        state.failActivation = false
                        return false
                    }
                    return true
                }
            }
        )

        XCTAssertFalse(SyntheticWindowFocus.enforceActiveState(
            pid: 42,
            state: &state,
            runtime: runtime
        ))
        XCTAssertEqual(
            posting.withLock { $0.sent },
            [.keyFocusReturned, .appActivated, .lostKeyFocus, .appDeactivated]
        )
        XCTAssertTrue(state.syntheticallyActive.isEmpty)

        posting.withLock { $0.sent.removeAll() }
        XCTAssertTrue(SyntheticWindowFocus.enforceActiveState(
            pid: 42,
            state: &state,
            runtime: runtime
        ))
        XCTAssertEqual(
            posting.withLock { $0.sent },
            [.keyFocusReturned, .appActivated]
        )
        XCTAssertEqual(state.syntheticallyActive, [42: target])
    }

    /// A click followed by type_text is one focus transaction, not two.
    /// Re-sending keyFocusReturned to window 0 between them can clear the CEF
    /// field the click just focused.
    func testSyntheticBeliefIsEstablishedOnlyOnceUntilReleased() {
        var state = SyntheticWindowFocus.BeliefState()
        let target = beliefTarget()

        XCTAssertTrue(state.beginEnforcement(
            pid: 42,
            applicationIsActive: false,
            target: target
        ))
        XCTAssertFalse(state.beginEnforcement(
            pid: 42,
            applicationIsActive: false,
            target: target
        ))
        XCTAssertEqual(state.syntheticallyActive, [42: target])

        XCTAssertEqual(state.drain(), [42: target])
        XCTAssertTrue(state.syntheticallyActive.isEmpty)
        XCTAssertTrue(state.beginEnforcement(
            pid: 42,
            applicationIsActive: false,
            target: target
        ))
    }

    func testRealActivationSupersedesSyntheticBelief() {
        var state = SyntheticWindowFocus.BeliefState()
        let target = beliefTarget()

        XCTAssertTrue(state.beginEnforcement(
            pid: 42,
            applicationIsActive: false,
            target: target
        ))
        state.observeRealActivation(pid: 42)
        XCTAssertTrue(state.syntheticallyActive.isEmpty)

        // Once the app is background again, it needs a fresh pair.
        XCTAssertTrue(state.beginEnforcement(
            pid: 42,
            applicationIsActive: false,
            target: target
        ))
        XCTAssertFalse(state.beginEnforcement(
            pid: 42,
            applicationIsActive: true,
            target: target
        ))
        state.cancelEnforcement(pid: 42)
        XCTAssertTrue(state.syntheticallyActive.isEmpty)
    }

    func testOnlyAProcessLifetimeChangeRequiresFreshBelief() {
        var state = SyntheticWindowFocus.BeliefState()
        let originalProcess = beliefTarget()
        let relaunchedProcess = AXTreeProcessIdentity(
            bundleID: processA.bundleID,
            executablePath: processA.executablePath,
            launchTime: 2
        )
        let relaunched = beliefTarget(
            processIdentity: relaunchedProcess
        )

        XCTAssertTrue(state.beginEnforcement(
            pid: 42,
            applicationIsActive: false,
            target: originalProcess
        ))
        XCTAssertFalse(state.beginEnforcement(
            pid: 42,
            applicationIsActive: false,
            target: originalProcess
        ))
        XCTAssertTrue(state.beginEnforcement(
            pid: 42,
            applicationIsActive: false,
            target: relaunched
        ))
        XCTAssertEqual(state.syntheticallyActive[42], relaunched)
    }

    func testTeardownWithdrawsFocusBeforeActivationBelief() throws {
        let source = try String(
            contentsOfFile: URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("Sources/cu-helper/SyntheticWindowFocus.swift")
                .path,
            encoding: .utf8
        )
        let body = try XCTUnwrap(
            source.range(of: "static func relinquishAll").map {
                String(source[$0.lowerBound...].prefix(1_000))
            }
        )
        let lostFocus = try XCTUnwrap(body.range(of: "post(.lostKeyFocus"))
        let deactivated = try XCTUnwrap(body.range(of: "post(.appDeactivated"))
        XCTAssertLessThan(lostFocus.lowerBound, deactivated.lowerBound)
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

/// Driving an app must not cost the user their foreground.
///
/// This assertion has been made, reverted, and now made again, so the reasoning
/// is worth keeping in full.
///
/// It was first written when `WindowKeyFocus` was replaced by the synthetic
/// notification, and it went red when that change was reverted. The revert had
/// evidence: across two sessions on the notification-only build, 24 mutating
/// actions produced 1 effect, and nine window-bound clicks were discarded in
/// another.
///
/// That second session is what eventually voided the evidence. Its capture
/// showed the target's traffic lights fully coloured — the app was active and
/// its window was key, which is the entire state a foreground grant exists to
/// produce — and the clicks were dropped anyway. Focus could not have been the
/// variable.
///
/// The real defect was in the events themselves, and it was present in every
/// one of those sessions: the leading move of a click claimed `clickState 1`,
/// and the press and release carried different event numbers, so AppKit had no
/// reason to read them as one click (`MouseClickStateTests`). Single clicks
/// registered as hover. Double clicks worked, because the second press/release
/// pair got through — which is why the failure looked intermittent rather than
/// total. A foreground grant plus an 800ms settle raised the odds a malformed
/// click survived, and so read as the cure.
///
/// With the events fixed, the grant is not paying for the foreground it costs.
/// What is protected here: every input path goes through one place that makes
/// the target accept input, that place takes the foreground from nobody, and
/// the synthetic notification is not broadcast at an app that already has
/// focus.
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

    func testNoInputPathTakesTheUsersForeground() throws {
        // A source guard because the effect is not observable from a unit test:
        // `WindowKeyFocus` calls a private CPS symbol, and whether the
        // foreground moved is a property of the running window server. What can
        // be pinned is that no input path asks for it.
        //
        // Deliberately covers `grantIfNeeded` as well as `grant`. Gating the
        // grant on "only when the target is not already frontmost" sounds
        // considerate and is not: the case it fires in — the target is in the
        // background — is exactly the case the feature exists for.
        for file in ["AXAction.swift", "Injection.swift"] {
            // Comments are excluded on purpose. Both files explain at length
            // why the grant is gone and name it while doing so; a guard that
            // cannot tell prose from a call site would forbid documenting its
            // own reasoning, and the obvious way out of that is to weaken the
            // guard. A real call never sits on a line that opens with `//`.
            let body = try source(file)
                .split(separator: "\n", omittingEmptySubsequences: false)
                .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }
                .joined(separator: "\n")
            XCTAssertFalse(
                body.contains("WindowKeyFocus.grant"),
                "\(file) must not pull the target to the foreground to deliver input. "
                    + "If a real-machine regression genuinely needs this back, measure it "
                    + "with a SINGLE click on a control that needs a complete click — a "
                    + "text field focuses on the press alone and cannot tell the two apart."
            )
        }
    }

    /// `focusForClick` used to consist of nothing but the foreground grant: it
    /// never sent the notification the AX path relies on. Removing the grant
    /// without adding one would have left the decomposed mouse commands doing
    /// no focus work at all — silently, since nothing here reports delivery.
    func testTheDecomposedMousePathStillPreparesItsTarget() throws {
        let injection = try source("Injection.swift")
        let focus = try XCTUnwrap(
            injection.range(of: "private static func focusForClick").map {
                String(injection[$0.lowerBound...].prefix(400))
            },
            "focusForClick is missing"
        )
        XCTAssertTrue(
            focus.contains("SyntheticWindowFocus.enforceActiveState"),
            "the decomposed mouse path must tell its target it has focus"
        )
    }

    func testTheSyntheticNotificationIsGatedOnRealState() throws {
        // Codex holds `applicationIsActive` beside `applicationBelievesItIsActive`
        // and only re-sends when they disagree. The first version of this file
        // documented that gate and shipped without it — sending "key focus
        // returned to window 0" to an app that already owned a key window, on
        // every click.
        var state = SyntheticWindowFocus.BeliefState()
        let sent = OSAllocatedUnfairLock(
            initialState: [SyntheticWindowFocus.Notification]()
        )
        let activeRuntime = SyntheticWindowFocus.EnforcementRuntime(
            applicationIsActive: true,
            target: SyntheticWindowFocus.BeliefTarget(processIdentity: nil),
            post: { notification, _ in
                sent.withLock { $0.append(notification) }
                return true
            }
        )

        XCTAssertFalse(SyntheticWindowFocus.enforceActiveState(
            pid: 42,
            state: &state,
            runtime: activeRuntime
        ))
        XCTAssertTrue(sent.withLock { $0 }.isEmpty)
        XCTAssertTrue(state.syntheticallyActive.isEmpty)

        let backgroundRuntime = SyntheticWindowFocus.EnforcementRuntime(
            applicationIsActive: false,
            target: activeRuntime.target,
            post: activeRuntime.post
        )
        XCTAssertTrue(SyntheticWindowFocus.enforceActiveState(
            pid: 42,
            state: &state,
            runtime: backgroundRuntime
        ))
        XCTAssertFalse(SyntheticWindowFocus.enforceActiveState(
            pid: 42,
            state: &state,
            runtime: backgroundRuntime
        ))
        XCTAssertEqual(
            sent.withLock { $0 },
            [.keyFocusReturned, .appActivated]
        )
    }
}
