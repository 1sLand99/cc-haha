//
//  WindowFrameTracker.swift
//  cu-helper
//
//  Live window-follow for `CaptureGlowOverlay`. Keeps the glow border glued to
//  the target app's focused window as the user moves/resizes it, switches
//  Spaces, or rearranges displays.
//
//  Two strategies, in priority order:
//
//   1. PRIMARY — Accessibility observer. `AXObserverCreateWithInfoCallback`
//      against the target pid, subscribed to kAXMoved / kAXResized /
//      kAXWindowMiniaturized / kAXUIElementDestroyed / kAXFocusedWindowChanged
//      on both the application element and its focused window, with the
//      observer's run-loop source spliced onto the MAIN run loop. The C
//      callback recovers `self` via an `Unmanaged` refcon and hops back onto
//      the MainActor. This is event-driven (zero polling) and reacts the
//      instant AppKit posts the notification. Requires Accessibility (TCC) to
//      read the window geometry; without it `AXUIElementCopyAttributeValue`
//      fails and we fall through to strategy 2.
//
//   2. FALLBACK — ~30 Hz `DispatchSourceTimer` poll. Reads kAXPosition/kAXSize
//      when available, else `CGWindowListCopyWindowInfo` kCGWindowBounds (which
//      needs NO TCC for geometry). The timer fires on a private serial queue
//      and only re-resolves geometry there; the `onChange` callback is always
//      delivered on the MainActor. We diff against the last delivered frame so
//      the overlay isn't churned every tick.
//
//  COORDINATE SPACES — this is the whole point of the file. Quartz / CGWindow /
//  AX kAXPosition all report a GLOBAL TOP-LEFT origin, y growing DOWNWARD, with
//  the primary display's top-left at (0,0). AppKit `NSWindow.setFrame` wants a
//  GLOBAL BOTTOM-LEFT origin, y growing UPWARD. The flip pivots on the PRIMARY
//  screen's height (`NSScreen.screens.first!.frame.height`), exactly as the
//  rest of the helper converts. `start`/`currentCocoaFrame` always hand back
//  Cocoa-space rects so `CaptureGlowOverlay` can `setFrame:` verbatim.
//
//  The real OS cursor is never touched here; this module only observes.
//

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

enum WindowFrameReport: Equatable, Sendable {
    case frame(CGRect)
    case absent
}

/// Pure coalescing gate for tracker reports. Unlike the old optional-frame
/// cache, an initial absence is observable and repeated absences are suppressed.
struct WindowFrameReportGate: Sendable {
    private var lastReport: WindowFrameReport?

    var currentFrame: CGRect? {
        guard case let .frame(frame) = lastReport else { return nil }
        return frame
    }

    mutating func consume(_ frame: CGRect?, force: Bool = false) -> WindowFrameReport? {
        let next: WindowFrameReport
        if let frame, !frame.isNull, !frame.isEmpty {
            next = .frame(frame)
        } else {
            next = .absent
        }

        if let lastReport {
            switch (lastReport, next) {
            case (.absent, .absent):
                return nil
            case let (.frame(old), .frame(new)) where !force && Self.framesEqual(old, new):
                return nil
            default:
                break
            }
        }
        lastReport = next
        return next
    }

    mutating func reset() {
        lastReport = nil
    }

    private static func framesEqual(_ a: CGRect, _ b: CGRect) -> Bool {
        let eps: CGFloat = 0.5
        return abs(a.origin.x - b.origin.x) < eps
            && abs(a.origin.y - b.origin.y) < eps
            && abs(a.size.width - b.size.width) < eps
            && abs(a.size.height - b.size.height) < eps
    }
}

// MARK: - FrameResolver

/// Stateless geometry helpers shared by the observer and the polling fallback.
/// Every `CGRect` returned by `axFrame`/`cgWindowFrame` is in QUARTZ space
/// (global, top-left origin, y-down). `toCocoa` performs the single y-flip.
enum FrameResolver {
    /// Read the focused window's frame for `pid` via the Accessibility API.
    /// Returns a Quartz-space rect (top-left origin), or `nil` when the app has
    /// no focused window, the attributes are unreadable, or TCC is denied.
    static func axFrame(pid: pid_t) -> CGRect? {
        guard pid > 0 else { return nil }
        // Not trusted → don't touch the AX API at all; the caller falls back to
        // the TCC-free CGWindowList path. Avoids any chance of a blocking AX
        // round-trip when we hold no Accessibility grant.
        guard AXIsProcessTrusted() else { return nil }
        let app = AXUIElementCreateApplication(pid)
        // Hard-cap every AX message: a slow / unresponsive target app must NEVER
        // wedge the main run loop (that would freeze the whole daemon).
        AXUIElementSetMessagingTimeout(app, 0.25)

        guard let window = AXUtil.copyElement(app, kAXFocusedWindowAttribute)
            ?? AXUtil.firstWindow(of: app)
        else { return nil }
        AXUIElementSetMessagingTimeout(window, 0.25)

        return AXUtil.frame(of: window)
    }

    /// Read the target window's frame via the window-server window list. Needs
    /// no Accessibility grant — `kCGWindowBounds` is already Quartz top-left.
    /// When `windowID` is given we match it exactly; otherwise we pick the
    /// frontmost (lowest window-list index) normal-layer window owned by `pid`.
    static func cgWindowFrame(pid: pid_t, windowID: CGWindowID?) -> CGRect? {
        guard pid > 0 else { return nil }
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard
            let infoList = CGWindowListCopyWindowInfo(options, kCGNullWindowID)
                as? [[String: Any]]
        else { return nil }

        for info in infoList {
            guard let ownerPID = info[kCGWindowOwnerPID as String] as? pid_t,
                ownerPID == pid
            else { continue }

            if let want = windowID {
                guard let wid = info[kCGWindowNumber as String] as? CGWindowID,
                    wid == want
                else { continue }
            } else {
                // Only normal app windows (layer 0). Skip menus, shadows,
                // status items, the Dock, etc.
                let layer = (info[kCGWindowLayer as String] as? Int) ?? 0
                guard layer == 0 else { continue }
            }

            guard
                let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
                let rect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary)
            else { continue }

            // Ignore degenerate / off-screen-parked windows.
            if rect.width < 1 || rect.height < 1 { continue }
            return rect
        }
        return nil
    }

    /// Quartz (global, top-left origin, y-down) → Cocoa (global, bottom-left
    /// origin, y-up). Pivots on the PRIMARY screen height. `NSScreen.screens`
    /// is ordered with the primary (menu-bar) display first; its frame always
    /// has origin (0,0), so its height is the global flip axis.
    static func toCocoa(_ quartz: CGRect) -> CGRect {
        let primaryHeight = NSScreen.screens.first?.frame.height
            ?? CGDisplayBounds(CGMainDisplayID()).height
        return CGRect(
            x: quartz.origin.x,
            y: primaryHeight - quartz.origin.y - quartz.size.height,
            width: quartz.size.width,
            height: quartz.size.height
        )
    }
}

// MARK: - AX attribute helpers (CF memory-safe)

/// Thin wrappers around the un-annotated `AXUIElementCopyAttributeValue` C API.
/// Each `copy*` returns a value the caller owns; ARC reclaims the bridged
/// `CFTypeRef` automatically once it goes out of scope.
private enum AXUtil {
    /// Copy a child `AXUIElement`-valued attribute (e.g. focused window).
    static func copyElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
        var value: CFTypeRef?
        let err = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        guard err == .success, let value else { return nil }
        guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }

    /// First window from the application's kAXWindowsAttribute array, used when
    /// there is no focused window (e.g. app just launched, or focus is on a
    /// sheet). Returns `nil` if the app has no windows.
    static func firstWindow(of app: AXUIElement) -> AXUIElement? {
        var value: CFTypeRef?
        let err = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value)
        guard err == .success, let value else { return nil }
        guard CFGetTypeID(value) == CFArrayGetTypeID() else { return nil }
        let array = value as! CFArray
        let count = CFArrayGetCount(array)
        guard count > 0 else { return nil }
        let raw = CFArrayGetValueAtIndex(array, 0)
        guard let raw else { return nil }
        let element = Unmanaged<AXUIElement>.fromOpaque(raw).takeUnretainedValue()
        return element
    }

    /// Read kAXPosition (CGPoint) + kAXSize (CGSize) off a window element and
    /// assemble a Quartz-space rect. `kAXPositionAttribute` is documented as
    /// top-left in the global Quartz coordinate space.
    static func frame(of window: AXUIElement) -> CGRect? {
        guard let origin = copyPoint(window, kAXPositionAttribute),
            let size = copySize(window, kAXSizeAttribute)
        else { return nil }
        return CGRect(origin: origin, size: size)
    }

    static func copyPoint(_ element: AXUIElement, _ attribute: String) -> CGPoint? {
        guard let axValue = copyAXValue(element, attribute) else { return nil }
        var point = CGPoint.zero
        guard AXValueGetType(axValue) == .cgPoint,
            AXValueGetValue(axValue, .cgPoint, &point)
        else { return nil }
        return point
    }

    static func copySize(_ element: AXUIElement, _ attribute: String) -> CGSize? {
        guard let axValue = copyAXValue(element, attribute) else { return nil }
        var size = CGSize.zero
        guard AXValueGetType(axValue) == .cgSize,
            AXValueGetValue(axValue, .cgSize, &size)
        else { return nil }
        return size
    }

    private static func copyAXValue(_ element: AXUIElement, _ attribute: String) -> AXValue? {
        var value: CFTypeRef?
        let err = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        guard err == .success, let value else { return nil }
        guard CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        return (value as! AXValue)
    }
}

// MARK: - WindowFrameTracker

@MainActor
public final class WindowFrameTracker {
    private let pid: pid_t
    private let windowID: CGWindowID?

    /// Delivered on the MainActor whenever the resolved frame changes.
    private var onChange: ((CGRect) -> Void)?

    /// Coalesces frame/absence transitions, including the initial-absence case.
    private var reportGate = WindowFrameReportGate()

    // AX observer (primary strategy).
    private var observer: AXObserver?
    private var observedAppElement: AXUIElement?
    private var observedWindowElement: AXUIElement?
    private var runLoopSource: CFRunLoopSource?

    // Polling fallback.
    private var pollTimer: DispatchSourceTimer?
    private let pollQueue = DispatchQueue(label: "dev.cchaha.cu-helper.window-tracker")

    private var screenParamsObserver: NSObjectProtocol?

    /// NSWorkspace app-level hide/unhide/activate observers. AX has no reliable
    /// app-hide (Cmd+H) notification — on hide the window simply leaves the
    /// on-screen list with no kAXMiniaturized — so we watch the workspace to hide
    /// / restore the glow when the tracked app is hidden or comes back.
    private var workspaceObservers: [NSObjectProtocol] = []

    private var started = false

    public init(pid: pid_t, windowID: CGWindowID?) {
        self.pid = pid
        self.windowID = windowID
    }

    deinit {
        // `stop()` is @MainActor and tears everything down; by the time we are
        // deallocated the run-loop source / observer / timer must already be
        // gone (CFRunLoopSource and AXObserver hold a +1 on us via the refcon
        // would otherwise keep us alive). We intentionally do nothing here.
    }

    // MARK: Public API

    public func start(onChange: @escaping (CGRect) -> Void) {
        if started { stop() }
        started = true
        self.onChange = onChange

        // React to display arrangement / resolution changes — the flip axis
        // (primary screen height) and the window's screen can both change, so
        // re-resolve from scratch.
        screenParamsObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.rebindObserverWindow()
                self.refresh(force: true)
            }
        }

        installWorkspaceObservers()

        // Install the low-latency AX observer when possible, but ALWAYS run the
        // ~30 Hz CGWindowList poll alongside it. The poll is TCC-free and
        // session-independent, so it is the reliable backstop for BOTH follow
        // (window moved/resized) and hide (app hidden via Cmd+H / window closed /
        // minimized → the window drops off the on-screen list) when the AX and
        // NSWorkspace callbacks don't fire reliably in the daemon's `.accessory`,
        // launchd-reparented process context. Duplicate deliveries are coalesced
        // by the frame diff in `refresh`, so running both is cheap and never
        // churns the overlay. (Previously the poll ran ONLY when the AX observer
        // failed to install — so with AX granted, follow/hide depended entirely
        // on callbacks that may never arrive, leaving the glow stuck.)
        _ = installObserver()
        startPolling()

        // Deliver the initial frame immediately so the overlay is positioned
        // on the very first paint, before any move/resize event arrives.
        refresh(force: true)
    }

    public func stop() {
        started = false
        onChange = nil
        reportGate.reset()

        if let screenParamsObserver {
            NotificationCenter.default.removeObserver(screenParamsObserver)
            self.screenParamsObserver = nil
        }
        removeWorkspaceObservers()

        stopPolling()
        teardownObserver()
    }

    public func currentCocoaFrame() -> CGRect? {
        if let current = reportGate.currentFrame { return current }
        guard let quartz = resolveQuartzFrame() else { return nil }
        return FrameResolver.toCocoa(quartz)
    }

    // MARK: Geometry resolution

    /// Resolve the target's current frame in QUARTZ space, preferring AX (more
    /// accurate, picks the *focused* window) and falling back to the window
    /// server (TCC-free).
    private func resolveQuartzFrame() -> CGRect? {
        if let axRect = FrameResolver.axFrame(pid: pid) {
            return axRect
        }
        return FrameResolver.cgWindowFrame(pid: pid, windowID: windowID)
    }

    /// Re-resolve and, if the Cocoa frame moved (or `force`), notify. Always
    /// runs on the MainActor; safe to call from the AX callback or the screen
    /// param observer.
    private func refresh(force: Bool) {
        guard started else { return }
        // Only show the glow while the controlled app is frontmost. Computer Use now
        // runs in the BACKGROUND (no forced activate), so the controlled window
        // usually isn't frontmost — the glow then stays hidden and never strands on
        // top of whatever the user switched to; it reappears the instant the user
        // brings the controlled app forward. Same gate as the virtual cursor's
        // syncVisibilityToFrontmost(); the ~30 Hz poll re-evaluates it continuously.
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
            reportDisappeared()
            return
        }
        guard let quartz = resolveQuartzFrame() else {
            // The window is gone — app hidden (Cmd+H), all windows closed, or
            // minimized (drops out of the on-screen list). Report absence ONCE so
            // the overlay hides; this previously returned silently and the glow
            // was stranded over the now-empty spot ("App 隐藏了 glow 还在原位").
            reportDisappeared()
            return
        }
        let cocoa = FrameResolver.toCocoa(quartz)

        deliver(cocoa, force: force)
    }

    /// Report that the tracked window vanished — exactly once — by delivering a
    /// null frame, which `CaptureGlowOverlay` treats as "hide". Idempotent: a
    /// no-op once we've already signalled absence, so the ~30 Hz poll and
    /// repeated hide notifications don't churn the overlay.
    private func reportDisappeared() {
        deliver(nil, force: false)
    }

    private func deliver(_ frame: CGRect?, force: Bool) {
        guard let report = reportGate.consume(frame, force: force) else { return }
        switch report {
        case let .frame(frame):
            onChange?(frame)
        case .absent:
            onChange?(.null)
        }
    }

    // MARK: Workspace hide/unhide (app-level)

    /// Watch NSWorkspace for the target app being hidden (Cmd+H), unhidden, or
    /// re-activated. Unlike AX move/resize/miniaturize, an app *hide* posts no AX
    /// geometry notification — the windows simply leave the on-screen list — so
    /// the glow would otherwise stay stranded where the window used to be.
    private func installWorkspaceObservers() {
        let nc = NSWorkspace.shared.notificationCenter
        // Hidden → the window is no longer on screen; hide the glow.
        workspaceObservers.append(nc.addObserver(
            forName: NSWorkspace.didHideApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            // Read the (non-Sendable) Notification on the delivery queue first;
            // only the Sendable pid crosses into actor isolation.
            let notePid = Self.notePid(note)
            MainActor.assumeIsolated {
                guard let self, self.started, notePid == self.pid else { return }
                self.reportDisappeared()
            }
        })
        // Unhidden → the controlled app's window is back; re-resolve & re-anchor.
        workspaceObservers.append(nc.addObserver(
            forName: NSWorkspace.didUnhideApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            let notePid = Self.notePid(note)
            MainActor.assumeIsolated {
                guard let self, self.started, notePid == self.pid else { return }
                self.refresh(force: true)
            }
        })
        // ANY app activation → re-evaluate. refresh()'s frontmost gate shows the
        // glow when the controlled app comes forward and hides it when the user
        // switches to a different app. Deliberately NOT guarded on self.pid — we
        // must react precisely when the user activates some OTHER app, to hide.
        workspaceObservers.append(nc.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.started else { return }
                self.refresh(force: true)
            }
        })
    }

    private func removeWorkspaceObservers() {
        let nc = NSWorkspace.shared.notificationCenter
        for token in workspaceObservers { nc.removeObserver(token) }
        workspaceObservers.removeAll()
    }

    /// The pid an NSWorkspace app notification refers to. Read off the delivery
    /// queue BEFORE hopping into MainActor isolation — `Notification` isn't
    /// `Sendable`, but the resulting pid (a `Sendable` Int32) crosses cleanly.
    private nonisolated static func notePid(_ note: Notification) -> pid_t? {
        (note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?
            .processIdentifier
    }

    // MARK: AX observer (primary)

    /// Build the observer, subscribe to the geometry/lifecycle notifications on
    /// both the app and its focused window, and splice the run-loop source onto
    /// the main run loop. Returns `false` if the observer could not be created
    /// or no notification could be registered (→ caller starts polling).
    private func installObserver() -> Bool {
        guard pid > 0 else { return false }
        // Without Accessibility the observer can't read geometry anyway — skip
        // straight to the TCC-free polling fallback so we never risk a blocking
        // AX call on the main run loop.
        guard AXIsProcessTrusted() else { return false }

        var observerRef: AXObserver?
        let createErr = AXObserverCreateWithInfoCallback(pid, axCallback, &observerRef)
        guard createErr == .success, let observerRef else { return false }
        observer = observerRef

        let appElement = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(appElement, 0.25)
        observedAppElement = appElement

        // Unretained pointer to self handed to the C callback as refcon. We do
        // NOT take a +1 (no retain cycle) — `stop()`/`teardownObserver` runs
        // while `self` is guaranteed alive (the overlay owns the tracker).
        let refcon = Unmanaged.passUnretained(self).toOpaque()

        // App-level notifications: focus changes + a window being destroyed/
        // minimized bubble here regardless of which window currently has focus.
        var addedAny = false
        for note in [
            kAXFocusedWindowChangedNotification,
            kAXWindowMiniaturizedNotification,
            kAXUIElementDestroyedNotification,
            kAXMainWindowChangedNotification,
        ] {
            let err = AXObserverAddNotification(observerRef, appElement, note as CFString, refcon)
            if err == .success { addedAny = true }
        }

        // Window-level notifications: move/resize fire on the window element
        // itself, so bind them to the currently focused window.
        bindWindowNotifications(observer: observerRef, refcon: refcon)

        guard addedAny || observedWindowElement != nil else {
            teardownObserver()
            return false
        }

        let source = AXObserverGetRunLoopSource(observerRef)
        runLoopSource = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .defaultMode)
        return true
    }

    /// Subscribe to kAXMoved/kAXResized on the app's CURRENT focused window and
    /// remember the element so we can unbind on rebind/teardown.
    private func bindWindowNotifications(observer: AXObserver, refcon: UnsafeMutableRawPointer) {
        guard let appElement = observedAppElement else { return }
        guard let window = AXUtil.copyElement(appElement, kAXFocusedWindowAttribute)
            ?? AXUtil.firstWindow(of: appElement)
        else { return }

        observedWindowElement = window
        for note in [
            kAXMovedNotification,
            kAXResizedNotification,
            kAXUIElementDestroyedNotification,
        ] {
            _ = AXObserverAddNotification(observer, window, note as CFString, refcon)
        }
    }

    /// On focus change we must move the move/resize subscriptions to the new
    /// focused window. Unbind the old one, bind the new one.
    private func rebindObserverWindow() {
        guard let observer, started else { return }
        let refcon = Unmanaged.passUnretained(self).toOpaque()

        if let old = observedWindowElement {
            for note in [
                kAXMovedNotification,
                kAXResizedNotification,
                kAXUIElementDestroyedNotification,
            ] {
                _ = AXObserverRemoveNotification(observer, old, note as CFString)
            }
            observedWindowElement = nil
        }
        bindWindowNotifications(observer: observer, refcon: refcon)
    }

    private func teardownObserver() {
        if let source = runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .defaultMode)
            runLoopSource = nil
        }
        if let observer {
            if let window = observedWindowElement {
                for note in [
                    kAXMovedNotification,
                    kAXResizedNotification,
                    kAXUIElementDestroyedNotification,
                ] {
                    _ = AXObserverRemoveNotification(observer, window, note as CFString)
                }
            }
            if let app = observedAppElement {
                for note in [
                    kAXFocusedWindowChangedNotification,
                    kAXWindowMiniaturizedNotification,
                    kAXUIElementDestroyedNotification,
                    kAXMainWindowChangedNotification,
                ] {
                    _ = AXObserverRemoveNotification(observer, app, note as CFString)
                }
            }
        }
        observer = nil
        observedAppElement = nil
        observedWindowElement = nil
    }

    /// Called from the C trampoline (already hopped onto the MainActor).
    fileprivate func handleAXNotification(_ notification: String) {
        guard started else { return }
        // Focus moved → re-point the move/resize subscriptions before reading.
        if notification == kAXFocusedWindowChangedNotification as String
            || notification == kAXMainWindowChangedNotification as String
        {
            rebindObserverWindow()
        }
        refresh(force: false)
    }

    // MARK: Polling fallback

    private func startPolling() {
        stopPolling()
        let timer = DispatchSource.makeTimerSource(queue: pollQueue)
        // ~30 Hz, generous leeway so we don't spin the CPU when nothing moves.
        timer.schedule(deadline: .now(), repeating: .milliseconds(33), leeway: .milliseconds(8))
        // The handler MUST be @Sendable (i.e. NONISOLATED): it runs on `pollQueue`,
        // NOT the MainActor. WindowFrameTracker is @MainActor, so a plain closure
        // here is inferred @MainActor — and Swift 6's runtime isolation check
        // (`swift_task_isCurrentExecutor`) SIGTRAPs when libdispatch invokes it on
        // the background queue, crashing the ENTIRE daemon. That is exactly what
        // happened once the poll started running alongside the AX observer: the
        // first injection shows the overlay → starts this tracker → the 33 ms timer
        // fires on pollQueue → trap → the client sees "cu-helper daemon reset:
        // socket closed" and every click/type fails. The @Sendable closure touches
        // no isolated state; it only hops to the MainActor to diff + deliver.
        let handler: @Sendable () -> Void = { [weak self] in
            Task { @MainActor in self?.refresh(force: false) }
        }
        timer.setEventHandler(handler: handler)
        pollTimer = timer
        timer.resume()
    }

    private func stopPolling() {
        pollTimer?.cancel()
        pollTimer = nil
    }
}

// MARK: - C callback trampoline

/// AX observer callback. Fires on whatever run loop the observer source was
/// added to — here, the MAIN run loop (`CFRunLoopGetMain()`), i.e. the main
/// thread, which is the MainActor's executor. We recover the tracker from the
/// unretained refcon and hop into MainActor isolation to do the real work.
///
/// `AXObserverCreateWithInfoCallback`'s callback may not capture context, so
/// this must be a free C function; state travels through `refcon`.
private func axCallback(
    _ observer: AXObserver,
    _ element: AXUIElement,
    _ notification: CFString,
    _ info: CFDictionary?,
    _ refcon: UnsafeMutableRawPointer?
) {
    guard let refcon else { return }
    let tracker = Unmanaged<WindowFrameTracker>.fromOpaque(refcon).takeUnretainedValue()
    let note = notification as String
    // The source lives on the main run loop, so we are already on the main
    // thread; assert that isolation rather than bouncing through another hop.
    MainActor.assumeIsolated {
        tracker.handleAXNotification(note)
    }
}
