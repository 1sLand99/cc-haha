import XCTest
@testable import cc_haha_computer_use

final class DaemonOverlayTargetTests: XCTestCase {
    private let textEditIdentity = AXTreeProcessIdentity(
        bundleID: "com.apple.TextEdit",
        executablePath: "/System/Applications/TextEdit.app/Contents/MacOS/TextEdit",
        launchTime: 100
    )

    func testExplicitBackgroundPIDWinsRegardlessOfCandidateOrder() throws {
        let frontmostHost = AppTargetCandidate(
            pid: 900,
            bundleIdentifier: "dev.cchaha.host",
            bundleURL: URL(fileURLWithPath: "/Applications/Claude Code Haha.app"),
            localizedName: "Claude Code Haha",
            executableName: "Claude Code Haha"
        )
        let backgroundTarget = AppTargetCandidate(
            pid: 4321,
            bundleIdentifier: "com.apple.TextEdit",
            bundleURL: URL(fileURLWithPath: "/System/Applications/TextEdit.app"),
            localizedName: "TextEdit",
            executableName: "TextEdit"
        )

        let target = try XCTUnwrap(DaemonOverlayTargetResolver.resolve(
            payload: .object(["pid": .int(4321)]),
            candidates: [frontmostHost, backgroundTarget],
            currentIdentity: { pid in
                pid == 4321 ? self.textEditIdentity : nil
            }
        ))

        XCTAssertEqual(target.pid, 4321)
        XCTAssertEqual(target.identity, textEditIdentity)
    }

    func testOmittedTargetNeverFallsBackToFrontmost() throws {
        let host = AppTargetCandidate(
            pid: 900,
            bundleIdentifier: "dev.cchaha.host",
            bundleURL: URL(fileURLWithPath: "/Applications/Claude Code Haha.app"),
            localizedName: "Claude Code Haha",
            executableName: "Claude Code Haha"
        )

        XCTAssertNil(try DaemonOverlayTargetResolver.resolve(
            payload: .object([:]),
            candidates: [host],
            currentIdentity: { _ in nil }
        ))
    }
}
