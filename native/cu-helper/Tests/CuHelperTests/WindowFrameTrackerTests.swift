import CoreGraphics
import XCTest
@testable import cc_haha_computer_use

final class WindowFrameTrackerTests: XCTestCase {
    private let frame = CGRect(x: 10, y: 20, width: 300, height: 200)

    func testInitialAbsenceEmitsOnceAndRepeatedAbsenceCoalesces() {
        var gate = WindowFrameReportGate()

        XCTAssertEqual(gate.consume(nil), .absent)
        XCTAssertNil(gate.consume(nil))
    }

    func testAbsenceThenFrameEmitsFrame() {
        var gate = WindowFrameReportGate()
        _ = gate.consume(nil)

        XCTAssertEqual(gate.consume(frame), .frame(frame))
    }

    func testFrameThenAbsenceEmitsNull() {
        var gate = WindowFrameReportGate()
        _ = gate.consume(frame)

        XCTAssertEqual(gate.consume(nil), .absent)
    }

    func testStopResetsGateToUnreported() {
        var gate = WindowFrameReportGate()
        _ = gate.consume(nil)

        gate.reset()

        XCTAssertEqual(gate.consume(nil), .absent)
    }
}
