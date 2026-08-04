import XCTest
@testable import cc_haha_computer_use

final class AppTargetResolverTests: XCTestCase {
    private let calculator = AppTargetCandidate(
        pid: 42,
        bundleIdentifier: "com.apple.calculator",
        bundleURL: URL(fileURLWithPath: "/System/Applications/Calculator.app"),
        localizedName: "计算器",
        executableName: "Calculator"
    )

    private let installedCalculator = InstalledAppTarget(
        bundleIdentifier: "com.apple.calculator",
        displayName: "Calculator",
        bundleURL: URL(fileURLWithPath: "/System/Applications/Calculator.app")
    )

    func testEnglishAppBasenameMatchesLocalizedRunningApp() throws {
        let result = try AppTargetResolver.match(identifier: "Calculator", candidates: [calculator])
        XCTAssertEqual(result.pid, 42)
    }

    func testBundleIDAndFullPathMatch() throws {
        XCTAssertEqual(try AppTargetResolver.match(identifier: "com.apple.calculator", candidates: [calculator]).pid, 42)
        XCTAssertEqual(try AppTargetResolver.match(identifier: "/System/Applications/Calculator.app", candidates: [calculator]).pid, 42)
    }

    func testAmbiguousNameFailsClosed() {
        let duplicate = AppTargetCandidate(
            pid: 43,
            bundleIdentifier: calculator.bundleIdentifier,
            bundleURL: calculator.bundleURL,
            localizedName: calculator.localizedName,
            executableName: calculator.executableName
        )
        XCTAssertThrowsError(try AppTargetResolver.match(identifier: "Calculator", candidates: [calculator, duplicate])) {
            XCTAssertEqual(($0 as? CUError)?.code, "ambiguous_target")
        }
    }

    func testExplicitInvalidPIDFailsClosedInsteadOfFallingBack() {
        let invalidPIDs: [JSONValue] = [
            .int(0),
            .int(-1),
            .int(Int(pid_t.max) + 1),
            .double(42),
            .string("42"),
            .bool(true),
            .null,
        ]

        for invalidPID in invalidPIDs {
            let payload = JSONValue.object([
                "pid": invalidPID,
                "bundleId": .string(calculator.bundleIdentifier),
                "app": .string("Calculator"),
            ])

            XCTAssertThrowsError(try AppTargetResolver.selector(payload: payload)) {
                XCTAssertEqual(($0 as? CUError)?.code, "bad_payload")
            }
        }
    }

    func testExplicitPIDMustIdentifyARunningCandidate() throws {
        let selector = try AppTargetResolver.selector(payload: .object([
            "pid": .int(43),
            "bundleId": .string(calculator.bundleIdentifier),
            "app": .string("Calculator"),
        ]))

        XCTAssertThrowsError(
            try AppTargetResolver.resolve(selector: selector, candidates: [calculator])
        ) {
            XCTAssertEqual(($0 as? CUError)?.code, "target_not_running")
        }
    }

    func testSelectorPrecedenceIsPIDThenBundleIDThenApp() throws {
        XCTAssertEqual(
            try AppTargetResolver.selector(payload: .object([
                "pid": .int(42),
                "bundleId": .string("com.example.bundle"),
                "app": .string("Example"),
            ])),
            .pid(42)
        )
        XCTAssertEqual(
            try AppTargetResolver.selector(payload: .object([
                "bundleId": .string("com.example.bundle"),
                "app": .string("Example"),
            ])),
            .bundleIdentifier("com.example.bundle")
        )
        XCTAssertEqual(
            try AppTargetResolver.selector(payload: .object([
                "app": .string("Example"),
            ])),
            .app("Example")
        )
    }

    func testNotRunningBundleIDRemainsTheLaunchIdentifier() throws {
        let selector = try AppTargetResolver.selector(payload: .object([
            "bundleId": .string("com.example.authoritative"),
            "app": .string("Lower Priority App"),
        ]))

        XCTAssertNil(try AppTargetResolver.resolve(selector: selector, candidates: []))
        XCTAssertEqual(selector?.launchIdentifier, "com.example.authoritative")
    }

    func testResolveWithoutLaunchingPrefersExactRunningProcess() throws {
        let result = try AppTargetResolver.resolveWithoutLaunching(
            selector: .app("Calculator"),
            runningCandidates: [calculator],
            installedCandidates: [installedCalculator]
        )

        XCTAssertEqual(result, .running(ResolvedAppTarget(
            pid: calculator.pid,
            bundleIdentifier: calculator.bundleIdentifier,
            bundleURL: calculator.bundleURL
        )))
    }

    func testResolveWithoutLaunchingReturnsExactInstalledApp() throws {
        for selector in [
            AppTargetSelector.app("Calculator"),
            .bundleIdentifier("com.apple.calculator"),
            .app("/System/Applications/Calculator.app"),
        ] {
            XCTAssertEqual(
                try AppTargetResolver.resolveWithoutLaunching(
                    selector: selector,
                    runningCandidates: [],
                    installedCandidates: [installedCalculator]
                ),
                .installed(installedCalculator)
            )
        }
    }

    func testResolveWithoutLaunchingFailsClosedForAmbiguousInstalledName() {
        let duplicateName = InstalledAppTarget(
            bundleIdentifier: "com.example.other-calculator",
            displayName: "Calculator",
            bundleURL: URL(fileURLWithPath: "/Applications/Calculator.app")
        )

        XCTAssertThrowsError(
            try AppTargetResolver.resolveWithoutLaunching(
                selector: .app("Calculator"),
                runningCandidates: [],
                installedCandidates: [installedCalculator, duplicateName]
            )
        ) {
            XCTAssertEqual(($0 as? CUError)?.code, "ambiguous_target")
        }
    }

    func testResolveWithoutLaunchingDoesNotTurnMissingPIDIntoInstalledApp() {
        XCTAssertThrowsError(
            try AppTargetResolver.resolveWithoutLaunching(
                selector: .pid(9_999),
                runningCandidates: [],
                installedCandidates: [installedCalculator]
            )
        ) {
            XCTAssertEqual(($0 as? CUError)?.code, "target_not_running")
        }
    }

    func testRequiredSelectorFailsClosedWhenTargetIsMissing() {
        XCTAssertThrowsError(
            try AppTargetResolver.requiredSelector(payload: .object([:]))
        ) {
            XCTAssertEqual(($0 as? CUError)?.code, "no_target")
        }
    }

    @MainActor
    func testBackgroundLaunchConfigurationDoesNotActivate() {
        XCTAssertFalse(AppTargetResolver.openConfiguration(activate: false).activates)
        XCTAssertTrue(AppTargetResolver.openConfiguration(activate: true).activates)
    }
}
