import CoreMedia
import ScreenCaptureKit
import XCTest

@testable import cc_haha_computer_use

@MainActor
final class WindowCaptureStreamTests: XCTestCase {
    func testSameTargetReusesStreamAndReturnsNewestFrameAcrossCoveredAction() async {
        let factory = FakeWindowCaptureStreamFactory { source, _ in
            source.startFrame = makeFrame(for: source.targetKey, sequence: 1, uptime: 10, byte: 1)
        }
        let manager = makeManager(factory: factory)
        let target = makeTarget(windowID: 10)

        let first = await manager.frame(for: target, newerThanUptime: nil)
        XCTAssertEqual(first?.sequence, 1)
        XCTAssertEqual(factory.sources.count, 1)

        factory.sources[0].publish(
            makeFrame(for: target.key, sequence: 3, uptime: 12, byte: 3)
        )
        let afterCoveredAction = await manager.frame(
            for: target,
            newerThanUptime: 11
        )

        XCTAssertEqual(afterCoveredAction?.sequence, 3)
        XCTAssertEqual(afterCoveredAction?.bytes.first, 3)
        XCTAssertEqual(factory.sources.count, 1)
        XCTAssertEqual(factory.sources[0].startCount, 1)
        XCTAssertEqual(factory.sources[0].retireCount, 0)
    }

    func testIdenticalPixelsWithANewerSequenceSatisfyFreshness() async {
        let factory = FakeWindowCaptureStreamFactory { source, _ in
            source.startFrame = makeFrame(for: source.targetKey, sequence: 1, uptime: 10, byte: 7)
        }
        let manager = makeManager(factory: factory)
        let target = makeTarget(windowID: 11)

        let first = await manager.frame(for: target, newerThanUptime: nil)
        XCTAssertEqual(first?.sequence, 1)

        let source = factory.sources[0]
        source.onLatestRead = { source, readCount in
            guard readCount >= 2 else { return }
            source.publish(
                makeFrame(for: target.key, sequence: 2, uptime: 20, byte: 7)
            )
        }
        let fresh = await manager.frame(for: target, newerThanUptime: 15)

        XCTAssertEqual(fresh?.sequence, 2)
        XCTAssertEqual(fresh?.bytes, first?.bytes)
        XCTAssertEqual(factory.sources.count, 1)
    }

    func testPostMutationTimeoutNeverReturnsThePreMutationFrame() async {
        let factory = FakeWindowCaptureStreamFactory { source, _ in
            source.startFrame = makeFrame(for: source.targetKey, sequence: 1, uptime: 10, byte: 4)
        }
        let manager = makeManager(factory: factory)
        let target = makeTarget(windowID: 12)

        let initial = await manager.frame(for: target, newerThanUptime: nil)
        XCTAssertNotNil(initial)
        let stale = await manager.frame(for: target, newerThanUptime: 11)

        XCTAssertNil(stale)
        XCTAssertEqual(factory.sources.count, 2)
        XCTAssertEqual(factory.sources[0].retireCount, 1)
        XCTAssertEqual(factory.sources[1].retireCount, 0)
        XCTAssertEqual(manager.activeKeyForTesting, target.key)
    }

    func testPostMutationStarvationRebuildsOnceAndReturnsAStartedFrame() async {
        let factory = FakeWindowCaptureStreamFactory { source, index in
            source.startFrame = makeFrame(
                for: source.targetKey,
                sequence: 1,
                uptime: index == 0 ? 10 : 20,
                byte: UInt8(index + 1)
            )
        }
        let manager = makeManager(factory: factory)
        let target = makeTarget(windowID: 13)

        _ = await manager.frame(for: target, newerThanUptime: nil)
        let recovered = await manager.frame(for: target, newerThanUptime: 15)

        XCTAssertEqual(recovered?.receivedUptime, 20)
        XCTAssertEqual(recovered?.bytes.first, 2)
        XCTAssertEqual(factory.sources.count, 2)
        XCTAssertEqual(factory.sources[0].retireCount, 1)
        XCTAssertEqual(factory.sources[1].retireCount, 0)
    }

    func testWindowSwitchRetiresOldStreamAndLateFramesCannotLeak() async {
        let factory = FakeWindowCaptureStreamFactory { source, index in
            source.startFrame = makeFrame(
                for: source.targetKey,
                sequence: 1,
                uptime: 10 + Double(index),
                byte: UInt8(index + 1)
            )
        }
        let manager = makeManager(factory: factory)
        let targetA = makeTarget(windowID: 21)
        let targetB = makeTarget(windowID: 22)

        let frameA = await manager.frame(for: targetA, newerThanUptime: nil)
        let generationA = manager.activeGenerationForTesting
        let frameB = await manager.frame(for: targetB, newerThanUptime: nil)
        let generationB = manager.activeGenerationForTesting

        XCTAssertEqual(frameA?.bytes.first, 1)
        XCTAssertEqual(frameB?.bytes.first, 2)
        XCTAssertNotEqual(generationA, generationB)
        XCTAssertEqual(factory.sources.count, 2)
        XCTAssertEqual(factory.sources[0].retireCount, 1)

        factory.sources[0].publish(
            makeFrame(for: targetA.key, sequence: 99, uptime: 99, byte: 99)
        )
        let stillB = await manager.frame(for: targetB, newerThanUptime: nil)
        XCTAssertEqual(stillB?.bytes.first, 2)
        XCTAssertEqual(manager.activeKeyForTesting, targetB.key)
    }

    func testPIDReuseReplacesStreamEvenWhenPIDAndWindowIDMatch() async {
        let factory = FakeWindowCaptureStreamFactory { source, index in
            source.startFrame = makeFrame(
                for: source.targetKey,
                sequence: 1,
                uptime: 10,
                byte: UInt8(index + 1)
            )
        }
        let manager = makeManager(factory: factory)
        let firstLifetime = makeTarget(windowID: 31, launchTime: 100)
        let reusedPID = makeTarget(windowID: 31, launchTime: 200)

        _ = await manager.frame(for: firstLifetime, newerThanUptime: nil)
        let replacement = await manager.frame(for: reusedPID, newerThanUptime: nil)

        XCTAssertEqual(replacement?.bytes.first, 2)
        XCTAssertEqual(factory.sources.count, 2)
        XCTAssertEqual(factory.sources[0].retireCount, 1)
        XCTAssertEqual(manager.activeKeyForTesting?.processIdentity.launchTime, 200)
    }

    func testResizeCannotReuseAFrameFromTheOldConfiguration() async {
        let factory = FakeWindowCaptureStreamFactory { source, index in
            source.startFrame = makeFrame(
                for: source.targetKey,
                sequence: 1,
                uptime: 10,
                byte: UInt8(index + 1)
            )
        }
        let manager = makeManager(factory: factory)
        let before = makeTarget(windowID: 41, pixelWidth: 2, pixelHeight: 2)
        let after = makeTarget(windowID: 41, pixelWidth: 4, pixelHeight: 3)

        _ = await manager.frame(for: before, newerThanUptime: nil)
        let resized = await manager.frame(for: after, newerThanUptime: nil)

        XCTAssertEqual(resized?.width, 4)
        XCTAssertEqual(resized?.height, 3)
        XCTAssertEqual(resized?.bytes.first, 2)
        XCTAssertEqual(factory.sources.count, 2)
        XCTAssertEqual(factory.sources[0].retireCount, 1)
    }

    func testMovingTheSameWindowReusesItsStream() async {
        let factory = FakeWindowCaptureStreamFactory { source, _ in
            source.startFrame = makeFrame(
                for: source.targetKey,
                sequence: 1,
                uptime: 10,
                byte: 5
            )
        }
        let manager = makeManager(factory: factory)
        let before = makeTarget(windowID: 42, originX: 100, originY: 200)
        let after = makeTarget(windowID: 42, originX: 500, originY: 600)

        _ = await manager.frame(for: before, newerThanUptime: nil)
        let moved = await manager.frame(for: after, newerThanUptime: nil)

        XCTAssertEqual(moved?.bytes.first, 5)
        XCTAssertEqual(factory.sources.count, 1)
        XCTAssertEqual(factory.sources[0].startCount, 1)
        XCTAssertEqual(factory.sources[0].retireCount, 0)
        XCTAssertEqual(manager.activeKeyForTesting, after.key)
    }

    func testDelegateFailureRestartsOnceAndDropsTheFailedFrame() async {
        let factory = FakeWindowCaptureStreamFactory { source, index in
            source.startFrame = makeFrame(
                for: source.targetKey,
                sequence: 1,
                uptime: 10,
                byte: UInt8(index + 1)
            )
        }
        let manager = makeManager(factory: factory)
        let target = makeTarget(windowID: 51)

        let first = await manager.frame(for: target, newerThanUptime: nil)
        XCTAssertEqual(first?.bytes.first, 1)
        factory.sources[0].failed = true

        let recovered = await manager.frame(for: target, newerThanUptime: nil)

        XCTAssertEqual(recovered?.bytes.first, 2)
        XCTAssertEqual(factory.sources.count, 2)
        XCTAssertEqual(factory.sources[0].retireCount, 1)
        XCTAssertEqual(factory.sources[1].startCount, 1)
    }

    func testOneBoundedRetryRecoversAStartFailure() async {
        let factory = FakeWindowCaptureStreamFactory { source, index in
            if index == 0 {
                source.startError = CUError("capture_failed", "fixture start failure")
            } else {
                source.startFrame = makeFrame(
                    for: source.targetKey,
                    sequence: 1,
                    uptime: 10,
                    byte: 8
                )
            }
        }
        let manager = makeManager(factory: factory)
        let target = makeTarget(windowID: 52)

        let recovered = await manager.frame(for: target, newerThanUptime: nil)

        XCTAssertEqual(recovered?.bytes.first, 8)
        XCTAssertEqual(factory.sources.count, 2)
        XCTAssertEqual(factory.sources[0].retireCount, 1)
        XCTAssertEqual(factory.sources[1].startCount, 1)
    }

    func testSessionInvalidationStopsTheStreamAndMakesLateFramesInert() async {
        let factory = FakeWindowCaptureStreamFactory { source, index in
            source.startFrame = makeFrame(
                for: source.targetKey,
                sequence: 1,
                uptime: 10,
                byte: UInt8(index + 1)
            )
        }
        let manager = makeManager(factory: factory)
        let target = makeTarget(windowID: 61)

        _ = await manager.frame(for: target, newerThanUptime: nil)
        let oldSource = factory.sources[0]
        manager.invalidate()
        oldSource.publish(
            makeFrame(for: target.key, sequence: 100, uptime: 100, byte: 100)
        )

        XCTAssertNil(manager.activeKeyForTesting)
        XCTAssertEqual(oldSource.retireCount, 1)

        let nextTurn = await manager.frame(for: target, newerThanUptime: nil)
        XCTAssertEqual(nextTurn?.bytes.first, 2)
        XCTAssertEqual(factory.sources.count, 2)
    }

    func testOnlyPixelBearingFrameStatusesAreAccepted() {
        XCTAssertTrue(WindowCaptureFrameStatusPolicy.accepts(.started))
        XCTAssertTrue(WindowCaptureFrameStatusPolicy.accepts(.complete))
        XCTAssertFalse(WindowCaptureFrameStatusPolicy.accepts(.idle))
        XCTAssertFalse(WindowCaptureFrameStatusPolicy.accepts(.blank))
        XCTAssertFalse(WindowCaptureFrameStatusPolicy.accepts(.suspended))
        XCTAssertFalse(WindowCaptureFrameStatusPolicy.accepts(.stopped))
        XCTAssertFalse(WindowCaptureFrameStatusPolicy.marksFailure(.started))
        XCTAssertFalse(WindowCaptureFrameStatusPolicy.marksFailure(.complete))
        XCTAssertFalse(WindowCaptureFrameStatusPolicy.marksFailure(.idle))
        XCTAssertFalse(WindowCaptureFrameStatusPolicy.marksFailure(.blank))
        XCTAssertFalse(WindowCaptureFrameStatusPolicy.marksFailure(.suspended))
        XCTAssertTrue(WindowCaptureFrameStatusPolicy.marksFailure(.stopped))
    }

    func testStreamConfigurationUsesCodexCadenceBufferingAndPixelFormat() {
        let target = makeTarget(windowID: 71, pixelWidth: 640, pixelHeight: 480)
        let configuration = ScreenCaptureKitWindowStreamSource.makeConfiguration(
            for: target
        )

        XCTAssertEqual(configuration.width, 640)
        XCTAssertEqual(configuration.height, 480)
        XCTAssertEqual(
            configuration.minimumFrameInterval,
            CMTime(value: 1, timescale: 60)
        )
        XCTAssertEqual(configuration.queueDepth, 5)
        XCTAssertFalse(configuration.showsCursor)
        XCTAssertFalse(configuration.capturesAudio)
        XCTAssertTrue(configuration.scalesToFit)
        XCTAssertTrue(configuration.preservesAspectRatio)
        XCTAssertEqual(configuration.pixelFormat, kCVPixelFormatType_32BGRA)
        XCTAssertEqual(configuration.colorSpaceName, CGColorSpace.sRGB)
        XCTAssertTrue(configuration.ignoreShadowsSingleWindow)
        XCTAssertTrue(configuration.ignoreShadowsDisplay)
    }

    func testCopiedBGRAFrameEncodesAsAStreamPNGWithTheSameGeometry() throws {
        let target = makeTarget(
            windowID: 72,
            pixelWidth: 1,
            pixelHeight: 1,
            originX: 300,
            originY: 400
        )
        let frame = WindowCaptureStreamFrame(
            bytes: Data([0x00, 0x00, 0xff, 0xff]),
            width: 1,
            height: 1,
            bytesPerRow: 4,
            sequence: 1,
            receivedUptime: 10
        )

        let shot = try XCTUnwrap(Capture.windowShot(from: frame, target: target))
        let png = try XCTUnwrap(Data(base64Encoded: shot.base64))

        XCTAssertEqual(Array(png.prefix(8)), [137, 80, 78, 71, 13, 10, 26, 10])
        XCTAssertEqual(shot.width, 1)
        XCTAssertEqual(shot.height, 1)
        XCTAssertEqual(shot.originX, 300)
        XCTAssertEqual(shot.originY, 400)
        XCTAssertEqual(shot.windowID, 72)
        XCTAssertEqual(shot.source, .stream)
    }

    private func makeManager(
        factory: FakeWindowCaptureStreamFactory
    ) -> WindowCaptureStreamManager {
        WindowCaptureStreamManager(
            factory: factory,
            frameWaitAttempts: 0,
            frameWaitNanoseconds: 0
        )
    }

    private func makeTarget(
        windowID: CGWindowID,
        launchTime: TimeInterval = 100,
        pixelWidth: Int = 2,
        pixelHeight: Int = 2,
        originX: Double = 100,
        originY: Double = 200
    ) -> WindowCaptureStreamTarget {
        WindowCaptureStreamTarget(
            key: WindowCaptureStreamKey(
                pid: 4242,
                processIdentity: AXTreeProcessIdentity(
                    bundleID: "com.example.fixture",
                    executablePath: "/Applications/Fixture.app/Contents/MacOS/Fixture",
                    launchTime: launchTime
                ),
                windowID: windowID,
                pixelWidth: pixelWidth,
                pixelHeight: pixelHeight
            ),
            originX: originX,
            originY: originY,
            pointWidth: Double(pixelWidth),
            pointHeight: Double(pixelHeight)
        )
    }
}

@MainActor
private final class FakeWindowCaptureStreamFactory: WindowCaptureStreamSourceFactory {
    typealias Configure = (FakeWindowCaptureStreamSource, Int) -> Void

    private let configure: Configure
    private(set) var sources: [FakeWindowCaptureStreamSource] = []

    init(configure: @escaping Configure) {
        self.configure = configure
    }

    func makeSource(
        for target: WindowCaptureStreamTarget
    ) -> any WindowCaptureStreamSource {
        let source = FakeWindowCaptureStreamSource(targetKey: target.key)
        configure(source, sources.count)
        sources.append(source)
        return source
    }
}

@MainActor
private final class FakeWindowCaptureStreamSource: WindowCaptureStreamSource {
    let targetKey: WindowCaptureStreamKey
    var failed = false
    var startError: CUError?
    var startFrame: WindowCaptureStreamFrame?
    var onLatestRead: ((FakeWindowCaptureStreamSource, Int) -> Void)?
    private(set) var startCount = 0
    private(set) var retireCount = 0
    private(set) var latestReadCount = 0
    private var latest: WindowCaptureStreamFrame?

    init(targetKey: WindowCaptureStreamKey) {
        self.targetKey = targetKey
    }

    var hasFailed: Bool { failed }

    func start() async throws {
        startCount += 1
        if let startError { throw startError }
        latest = startFrame
    }

    func latestFrame() -> WindowCaptureStreamFrame? {
        latestReadCount += 1
        onLatestRead?(self, latestReadCount)
        return latest
    }

    func retire() {
        retireCount += 1
    }

    func publish(_ frame: WindowCaptureStreamFrame) {
        latest = frame
    }
}

private func makeFrame(
    for key: WindowCaptureStreamKey,
    sequence: UInt64,
    uptime: TimeInterval,
    byte: UInt8
) -> WindowCaptureStreamFrame {
    let bytesPerRow = key.pixelWidth * 4
    return WindowCaptureStreamFrame(
        bytes: Data(
            repeating: byte,
            count: bytesPerRow * key.pixelHeight
        ),
        width: key.pixelWidth,
        height: key.pixelHeight,
        bytesPerRow: bytesPerRow,
        sequence: sequence,
        receivedUptime: uptime
    )
}
