import AppKit
import AudioToolbox
import CoreGraphics
import QuartzCore

// MARK: - Public types

/// Visual treatment for the capture glow border.
///
///  - `breathingAxial`:    a soft axial (linear) gradient stroke whose outer
///                         bloom pulses opacity (the calm default).
///  - `breathingConic`:    a conic gradient stroke (full hue/anglular sweep)
///                         with the same breathing bloom — richer, "alive".
///  - `travelingShimmer`:  a conic gradient that slowly rotates, so a highlight
///                         appears to travel around the border (the most active
///                         treatment, mirrors Codex's traveling-shimmer look).
public enum GlowStyle: Sendable {
    case breathingAxial
    case breathingConic
    case travelingShimmer
}

/// What the glow border should frame. Mirrors Codex `StartCaptureAnimation`
/// (color + rect + target + display): you can target a live app window (by pid,
/// optionally a specific window id, which is then *followed* as it moves), a
/// whole display, or a fixed rectangle.
///
/// Coordinate convention for `.display` and `.rect`: **global, top-left origin
/// (Quartz / logical points)** — the same convention every other coordinate in
/// this helper uses (screenshots, click targets). `CaptureGlowOverlay` flips to
/// Cocoa (bottom-left) internally on the primary screen height.
public enum OverlayTarget: Sendable {
    /// Follow the frontmost window of `pid`.
    case window(pid: pid_t)
    /// Follow a specific `CGWindowID` owned by `pid`.
    case windowID(CGWindowID, pid: pid_t)
    /// Frame an entire display.
    case display(CGDirectDisplayID)
    /// Frame a fixed rectangle in global top-left (Quartz) points.
    case rect(CGRect)
}

// MARK: - Non-animated gradient layer

/// A `CAGradientLayer` that refuses every implicit animation. Without this,
/// each `setFrame:` (window follow) and each gradient/color mutation triggers
/// Core Animation's default 0.25s fade/move, which makes the border smear and
/// lag behind a dragged window. Returning `nil` from `action(forKey:)` disables
/// implicit actions for ALL keys on this layer.
final class NonAnimatedGradientLayer: CAGradientLayer {
    override func action(forKey event: String) -> CAAction? {
        // NSNull would also disable; nil is the documented "no action" answer.
        return nil
    }
}

// MARK: - CaptureGlowOverlay

/// `@MainActor` glowing/shimmering border overlay drawn over the target the AI
/// is driving. Daemon-only (needs a live main run loop for the breathing /
/// shimmer animations). The overlay never intercepts input — it is purely a
/// visual affordance so the user can see what Claude is acting on.
///
/// Internals:
///  - One borderless, transparent, click-through `NSWindow` at
///    `CGShieldingWindowLevel() - 1` (above normal app windows + the system
///    shield-adjacent band, just under the absolute max so a real shield can
///    still cover it), `canJoinAllSpaces` so it follows the user across Spaces.
///  - A `NonAnimatedGradientLayer` filling the window, masked to a rounded-rect
///    stroke by a `CAShapeLayer` (so the gradient only shows *as the border*).
///  - A separate outer-bloom `CALayer` carrying the rounded-rect stroke as its
///    own path with a large `shadow*` — its `shadowOpacity` is animated for the
///    "breathing", and for `travelingShimmer` the gradient layer is rotated.
///  - A `WindowFrameTracker` (when targeting a live window) drives
///    `setFrame:display:` so the border tracks the window as it moves/resizes.
@MainActor
public final class CaptureGlowOverlay {

    // MARK: Stored state

    private var window: GlowWindow?
    private var tracker: WindowFrameTracker?
    private var lifecycle = OverlayLifecycleState()
    private var trackedTargetPid: pid_t?
    private var trackedProcessIdentity: AXTreeProcessIdentity?
    /// Most recent tracked content frame (Cocoa space); the background-exposure
    /// check in `currentDecision()` evaluates its center.
    private var lastCocoaContentFrame: CGRect?

    /// Current accent color (kept so `updateAccentColor` and re-`show` reuse it
    /// without the caller re-specifying).
    private var accentColor: NSColor = .systemBlue
    private var cornerRadius: CGFloat = 12
    private var borderWidth: CGFloat = 4
    private var style: GlowStyle = .breathingAxial

    /// Margin (points) added around the target rect so the *outer* bloom and the
    /// stroke (which straddles the path) are not clipped by the window edge.
    /// Derived from borderWidth + bloom radius on show.
    private var inset: CGFloat = 24

    private var screenParamsObserver: NSObjectProtocol?

    public var isVisible: Bool { lifecycle.isVisible }
    public var isActive: Bool { lifecycle.isActive }

    // MARK: Init / deinit

    public init() {}

    // An `isolated deinit` (Swift 6.0+) lets us touch `@MainActor`-isolated
    // stored state during teardown. The notification token is normally removed
    // in `hide()` / `removeScreenParamsObserver()`; this is a last-resort guard
    // (e.g. dropped without an explicit hide).
    isolated deinit {
        // Last-resort guard for a drop-without-hide: stop the window-follow
        // tracker (its AX observer / run-loop source / timer) so it cannot leak
        // or fire a callback into a half-deallocated overlay.
        tracker?.stop()
        if let token = screenParamsObserver {
            // `removeObserver` is thread-safe for token-based observers.
            NotificationCenter.default.removeObserver(token)
        }
    }

    // MARK: Public API

    /// Reveal the glow border framing `target`. Re-entrant: calling `show` again
    /// reconfigures the existing window/tracker in place (no flash).
    ///
    /// - Parameters:
    ///   - target:          window / windowID / display / rect to frame.
    ///   - accentColor:     base hue of the border + bloom.
    ///   - cornerRadius:    corner radius of the rounded-rect stroke (points).
    ///   - borderWidth:     stroke width (points).
    ///   - style:           breathing axial / breathing conic / traveling shimmer.
    ///   - playCaptureSound: when true, play a short system click via
    ///                       AudioServices. Default callers pass `false`.
    func show(
        over target: OverlayTarget,
        resolvedTarget: ProvenProcessTarget?,
        accentColor: NSColor,
        cornerRadius: CGFloat,
        borderWidth: CGFloat,
        style: GlowStyle,
        playCaptureSound: Bool
    ) {
        self.accentColor = accentColor
        self.cornerRadius = max(0, cornerRadius)
        self.borderWidth = max(1, borderWidth)
        self.style = style

        // The window must be large enough to contain the stroke (centered on the
        // path, so ±borderWidth/2) plus the outer bloom (shadowRadius). Pad
        // generously; the actual drawing is clipped to the window content layer.
        let bloomRadius = max(8, borderWidth * 3)
        self.inset = ceil(borderWidth / 2 + bloomRadius + 4)

        // Re-targeting stops only the old tracker. The new target starts hidden
        // and must pass the shared foreground policy before any order-front.
        tracker?.stop()
        tracker = nil
        if lifecycle.isActive { hideWindow(animated: false) }
        // A stale frame must not feed the previous target's exposure into the
        // new target's first decision.
        lastCocoaContentFrame = nil
        trackedTargetPid = Self.targetPid(target)
        if resolvedTarget?.pid == trackedTargetPid {
            trackedProcessIdentity = resolvedTarget?.identity
        } else {
            trackedProcessIdentity = nil
        }
        lifecycle.startTracking()

        ensureWindow()
        guard let window else { return }

        window.configure(
            accentColor: accentColor,
            cornerRadius: self.cornerRadius,
            borderWidth: self.borderWidth,
            style: style,
            inset: inset
        )

        installScreenParamsObserverIfNeeded()

        // Start live tracking before considering the initial frame. Its initial
        // absence report must be able to hide without tearing the tracker down.
        switch target {
        case let .window(pid):
            startTracking(pid: pid, windowID: nil)
        case let .windowID(windowID, pid):
            startTracking(pid: pid, windowID: windowID)
        case .display, .rect:
            break // static frame; no tracker
        }

        if case .display = target {
            applyTrackedFrame(resolveInitialCocoaFrame(for: target))
        } else if case .rect = target {
            applyTrackedFrame(resolveInitialCocoaFrame(for: target))
        }

        if playCaptureSound, isVisible {
            Self.playCaptureSound()
        }
    }

    /// Recolor the border + bloom in place without re-resolving the target.
    /// No-op if not currently shown.
    public func updateAccentColor(_ color: NSColor) {
        accentColor = color
        window?.updateAccentColor(color)
    }

    /// Transiently hide visuals while retaining the active target, tracker, and
    /// observers. A later valid foreground frame can reveal the same overlay.
    public func hideWindow(animated: Bool = true) {
        guard lifecycle.isActive else { return }
        let wasVisible = lifecycle.isVisible
        lifecycle.hideWindow()

        guard let window else { return }
        guard animated, wasVisible else {
            window.stopAnimations()
            window.orderOut(nil)
            return
        }
        window.fadeOutAndOrderOut()
    }

    /// Terminal lifecycle path for explicit hide, disconnect, teardown, and
    /// daemon shutdown. Unlike `hideWindow`, this destroys tracking state.
    public func stopTrackingAndHide(animated: Bool) {
        hideWindow(animated: animated)
        tracker?.stop()
        tracker = nil
        removeScreenParamsObserver()
        trackedTargetPid = nil
        trackedProcessIdentity = nil
        lastCocoaContentFrame = nil
        lifecycle.stopTracking()
    }

    /// Backward-compatible terminal alias. New lifecycle-sensitive callers use
    /// `hideWindow` or `stopTrackingAndHide` explicitly.
    public func hide(animated: Bool) {
        stopTrackingAndHide(animated: animated)
    }

    /// True only for the same still-proven process lifetime. Visibility is not
    /// consulted because a background target remains actively tracked.
    public func isTracking(pid: pid_t) -> Bool {
        guard lifecycle.isActive,
              trackedTargetPid == pid,
              let expected = trackedProcessIdentity,
              let current = Self.provenProcessIdentity(pid),
              current == expected else { return false }
        return true
    }

    // MARK: - Window lifecycle

    private func ensureWindow() {
        if window != nil { return }
        let w = GlowWindow()
        window = w
    }

    /// Fully release the window (used by callers that want to reclaim memory;
    /// not part of the public API but kept tidy).
    private func teardown() {
        stopTrackingAndHide(animated: false)
        window?.orderOut(nil)
        window = nil
    }

    // MARK: - Frame resolution

    /// Resolve the target's current frame in **Cocoa** space (bottom-left,
    /// y-up). Returns nil when the target cannot be located right now.
    private func resolveInitialCocoaFrame(for target: OverlayTarget) -> CGRect? {
        switch target {
        case let .window(pid):
            return Self.cocoaWindowFrame(pid: pid, windowID: nil)
        case let .windowID(windowID, pid):
            return Self.cocoaWindowFrame(pid: pid, windowID: windowID)
        case let .display(displayID):
            let bounds = CGDisplayBounds(displayID) // global, top-left
            guard !bounds.isNull, !bounds.isEmpty else { return nil }
            return Self.quartzToCocoa(bounds)
        case let .rect(rect):
            guard !rect.isNull, !rect.isEmpty else { return nil }
            // Incoming rect is global top-left (Quartz) points by contract.
            return Self.quartzToCocoa(rect)
        }
    }

    /// Position the window so the *content* rect (Cocoa space) is framed, with
    /// `inset` padding on every side for the stroke + bloom. The drawing layers
    /// inside the window draw the rounded rect inset by `inset` from the window
    /// edge, so the path lines up exactly with `contentCocoaFrame`.
    private func applyContentFrame(_ contentCocoaFrame: CGRect) {
        guard let window else { return }
        let windowFrame = contentCocoaFrame.insetBy(dx: -inset, dy: -inset)
        window.setOverlayFrame(windowFrame, contentInset: inset)
    }

    // MARK: - Window tracking

    private func startTracking(pid: pid_t, windowID: CGWindowID?) {
        let t = WindowFrameTracker(pid: pid, windowID: windowID)
        tracker = t
        // `onChange` delivers a Cocoa-space frame (bottom-left), per contract.
        t.start { [weak self, weak t] cocoaFrame in
            // Tracker hops to the main actor before invoking; assert isolation.
            MainActor.assumeIsolated {
                guard let self, let t, self.lifecycle.isActive, self.tracker === t else { return }
                self.applyTrackedFrame(cocoaFrame.isNull ? nil : cocoaFrame)
            }
        }
    }

    private func applyTrackedFrame(_ cocoaFrame: CGRect?) {
        guard lifecycle.isActive else { return }
        if let pid = trackedTargetPid, !isTracking(pid: pid) {
            hideWindow(animated: false)
            return
        }
        guard let cocoaFrame, !cocoaFrame.isNull, !cocoaFrame.isEmpty else {
            hideWindow(animated: true)
            return
        }
        // Record BEFORE deciding: the exposure check inside currentDecision()
        // evaluates this frame's center.
        lastCocoaContentFrame = cocoaFrame
        let decision = currentDecision()
        guard decision.visible else {
            hideWindow(animated: true)
            return
        }

        applyContentFrame(cocoaFrame)
        window?.orderFrontRegardless()
        window?.startAnimations()
        lifecycle.showWindow()
    }

    private func currentDecision() -> OverlayPolicy.Decision {
        let verifiedPid: pid_t?
        if let pid = trackedTargetPid, isTracking(pid: pid) {
            verifiedPid = pid
        } else {
            verifiedPid = nil
        }
        let frontmostPid = NSWorkspace.shared.frontmostApplication?.processIdentifier
        // Background glow: visible while the tracked window's CENTER is
        // actually exposed. Center-of-frame is a deliberate proxy — a mostly
        // visible window glows, a buried one does not.
        var exposed = false
        if let pid = verifiedPid,
           frontmostPid != pid,
           let cocoaFrame = lastCocoaContentFrame {
            let quartz = Self.cocoaToQuartz(cocoaFrame)
            let center = CGPoint(x: quartz.midX, y: quartz.midY)
            exposed = WindowExposure.targetWindowExposed(at: center, targetPid: pid)
        }
        return OverlayPolicy.decision(
            targetPid: verifiedPid,
            frontmostPid: frontmostPid,
            overlayRequested: lifecycle.isActive,
            targetWindowExposed: exposed
        )
    }

    private static func targetPid(_ target: OverlayTarget) -> pid_t? {
        switch target {
        case let .window(pid), let .windowID(_, pid):
            return pid
        case .display, .rect:
            return nil
        }
    }

    private static func provenProcessIdentity(_ pid: pid_t) -> AXTreeProcessIdentity? {
        guard let identity = AXTree.currentProcessIdentity(pid: pid), identity.isProven else {
            return nil
        }
        return identity
    }

    // MARK: - Screen parameter changes

    /// When displays are reconfigured (resolution change, monitor plugged), the
    /// primary-screen height used for the Quartz→Cocoa flip changes, so any
    /// static (display/rect) target must be re-flipped. For window targets the
    /// tracker already re-reads AX/CGWindow geometry, so we only need to nudge
    /// the static case — but re-resolving is cheap, so we just re-apply via the
    /// tracker's current frame when present, and leave static frames as-is
    /// (they were captured against the then-current primary height; a display
    /// reconfig is rare mid-action).
    private func installScreenParamsObserverIfNeeded() {
        guard screenParamsObserver == nil else { return }
        screenParamsObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let window = self.window, self.lifecycle.isActive else { return }
                // Re-clamp the window onto the (possibly changed) screen layout
                // and refresh the tracked frame if a tracker is live.
                if let cocoa = self.tracker?.currentCocoaFrame(),
                   !cocoa.isNull, !cocoa.isEmpty {
                    self.applyTrackedFrame(cocoa)
                }
                window.refreshScaleFactor()
            }
        }
    }

    private func removeScreenParamsObserver() {
        if let token = screenParamsObserver {
            NotificationCenter.default.removeObserver(token)
            screenParamsObserver = nil
        }
    }

    // MARK: - Geometry helpers

    /// Quartz (top-left, y-down, global) → Cocoa (bottom-left, y-up). Flip about
    /// the PRIMARY screen height (`NSScreen.screens.first`). Matches
    /// `FrameResolver.toCocoa` in WindowFrameTracker.swift.
    static func quartzToCocoa(_ quartz: CGRect) -> CGRect {
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        return CGRect(
            x: quartz.origin.x,
            y: primaryHeight - quartz.origin.y - quartz.height,
            width: quartz.width,
            height: quartz.height
        )
    }

    /// Inverse of `quartzToCocoa` — the flip is an involution about the same
    /// primary-screen height, so the formula is identical.
    static func cocoaToQuartz(_ cocoa: CGRect) -> CGRect {
        quartzToCocoa(cocoa)
    }

    /// Best-effort current window frame in Cocoa space via CGWindowList. Used
    /// for the *initial* placement (the tracker takes over live updates).
    static func cocoaWindowFrame(pid: pid_t, windowID: CGWindowID?) -> CGRect? {
        guard let quartz = cgWindowQuartzFrame(pid: pid, windowID: windowID) else {
            return nil
        }
        return quartzToCocoa(quartz)
    }

    /// Quartz-space (top-left) bounds of the target window from the window
    /// server. Picks the largest on-screen, non-zero-layer window for `pid`
    /// when no explicit `windowID` is given (heuristic for "the main window").
    static func cgWindowQuartzFrame(pid: pid_t, windowID: CGWindowID?) -> CGRect? {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let infoList = CGWindowListCopyWindowInfo(options, kCGNullWindowID)
            as? [[String: Any]]
        else { return nil }

        var best: CGRect?
        var bestArea: CGFloat = 0

        for info in infoList {
            guard let ownerPID = info[kCGWindowOwnerPID as String] as? pid_t,
                  ownerPID == pid
            else { continue }

            if let windowID {
                guard let number = info[kCGWindowNumber as String] as? CGWindowID,
                      number == windowID
                else { continue }
            } else {
                // Skip menu-bar / overlay layers; layer 0 is normal window content.
                let layer = (info[kCGWindowLayer as String] as? Int) ?? 0
                if layer != 0 { continue }
            }

            guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary)
            else { continue }

            if rect.isEmpty { continue }

            if let windowID, windowID != kCGNullWindowID {
                // Exact window requested → first match wins.
                return rect
            }

            let area = rect.width * rect.height
            if area > bestArea {
                bestArea = area
                best = rect
            }
        }
        return best
    }

    // MARK: - Capture sound

    private static func playCaptureSound() {
        // A short, unobtrusive system click. AudioServices is the lightest path
        // and needs no asset bundling. Default-off per the contract.
        let soundID: SystemSoundID = 1108 // "begin recording"-style camera tick
        AudioServicesPlaySystemSound(soundID)
    }
}

// MARK: - GlowWindow (private)

/// The borderless, click-through overlay window + its layer tree. Kept private
/// so the public surface stays exactly the documented API.
@MainActor
private final class GlowWindow: NSWindow {

    private let glowView: GlowContentView

    init() {
        glowView = GlowContentView(frame: .zero)

        super.init(
            contentRect: .zero,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )

        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        ignoresMouseEvents = true            // click-through
        isMovableByWindowBackground = false
        // Just under the absolute top so a genuine system shield can still
        // cover us, but above normal app windows + most utility panels.
        level = NSWindow.Level(rawValue: Int(CGShieldingWindowLevel()) - 1)
        collectionBehavior = [
            .canJoinAllSpaces,
            .stationary,
            .fullScreenAuxiliary,
            .ignoresCycle,
        ]
        // Never participate in window restoration / Mission Control cycling.
        isReleasedWhenClosed = false
        animationBehavior = .none
        // Allow drawing outside the nominal content for the bloom.
        contentView = glowView
        glowView.wantsLayer = true
    }

    // MARK: Configuration

    func configure(
        accentColor: NSColor,
        cornerRadius: CGFloat,
        borderWidth: CGFloat,
        style: GlowStyle,
        inset: CGFloat
    ) {
        glowView.configure(
            accentColor: accentColor,
            cornerRadius: cornerRadius,
            borderWidth: borderWidth,
            style: style,
            inset: inset
        )
    }

    func updateAccentColor(_ color: NSColor) {
        glowView.updateAccentColor(color)
    }

    /// Set the window frame (Cocoa) and tell the content view how far in from
    /// the window edge to draw the stroke path.
    func setOverlayFrame(_ frame: CGRect, contentInset: CGFloat) {
        // No implicit animation on the window move — the layers handle their own.
        setFrame(frame, display: true, animate: false)
        glowView.contentInset = contentInset
        glowView.layoutGlow()
    }

    func refreshScaleFactor() {
        glowView.refreshScaleFactor(backingScaleFactor)
    }

    // MARK: Animation control

    func startAnimations() {
        glowView.startAnimations()
    }

    func stopAnimations() {
        glowView.stopAnimations()
    }

    func fadeOutAndOrderOut() {
        glowView.fadeOut { [weak self] in
            MainActor.assumeIsolated {
                self?.glowView.stopAnimations()
                self?.orderOut(nil)
            }
        }
    }

    // A borderless window cannot become key/main by default, but be explicit so
    // a stray `makeKey` can never steal focus from the app Claude is driving.
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

// MARK: - GlowContentView (private)

/// Layer-backed content view that owns the gradient + mask + bloom layers and
/// drives the breathing / shimmer animations. Flipped is irrelevant here
/// because we lay out layers manually in the view's bounds.
@MainActor
private final class GlowContentView: NSView {

    // Layer tree:
    //   layer (root, view-backed)
    //   ├─ bloomLayer   (outer glow: stroked path + big shadow, breathing)
    //   └─ gradientLayer (NonAnimatedGradientLayer, masked to the stroke)
    //         └─ mask = strokeMaskLayer (CAShapeLayer stroke)
    private let bloomLayer = CALayer()
    private let gradientLayer = NonAnimatedGradientLayer()
    private let strokeMaskLayer = CAShapeLayer()

    // Configuration snapshot.
    private var accentColor: NSColor = .systemBlue
    private var cornerRadius: CGFloat = 12
    private var borderWidth: CGFloat = 4
    private var style: GlowStyle = .breathingAxial

    /// Distance from the view edge to the stroke path (matches the window inset).
    var contentInset: CGFloat = 24

    private var animating = false

    /// Bumped on every `cancelFadeOut()` (re-show) and every `fadeOut()`. A
    /// fade's completion block (which orders the window out) captures the value
    /// at scheduling time and runs only if it still matches — so a re-show that
    /// lands inside the 0.25s fade window cancels the stale order-out. Fixes the
    /// "glow stays invisible after the first hide→show turn boundary" bug.
    private var fadeGeneration = 0

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layerContentsRedrawPolicy = .onSetNeedsDisplay
        setupLayers()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    override var isFlipped: Bool { false }

    // The view manages its own layer; nothing else draws.
    override func makeBackingLayer() -> CALayer {
        let root = CALayer()
        root.masksToBounds = false
        return root
    }

    override func layout() {
        super.layout()
        layoutGlow()
    }

    // Keep layers crisp across Retina/non-Retina moves.
    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        refreshScaleFactor(window?.backingScaleFactor ?? 2.0)
    }

    private func setupLayers() {
        guard let root = layer else { return }
        root.masksToBounds = false

        // Bloom: a stroked rounded rect with a large soft shadow. We draw the
        // stroke itself faintly and rely on the shadow for the glow halo.
        bloomLayer.masksToBounds = false
        bloomLayer.backgroundColor = NSColor.clear.cgColor
        bloomLayer.shadowOffset = .zero
        bloomLayer.shouldRasterize = false
        root.addSublayer(bloomLayer)

        // Gradient stroke: gradient fills the layer, masked to a ring by the
        // CAShapeLayer stroke so only the border shows.
        gradientLayer.masksToBounds = false
        gradientLayer.needsDisplayOnBoundsChange = true

        strokeMaskLayer.fillColor = NSColor.clear.cgColor
        strokeMaskLayer.strokeColor = NSColor.white.cgColor // mask: alpha matters, not hue
        strokeMaskLayer.lineCap = .round
        strokeMaskLayer.lineJoin = .round
        gradientLayer.mask = strokeMaskLayer

        root.addSublayer(gradientLayer)
    }

    // MARK: Configure

    func configure(
        accentColor: NSColor,
        cornerRadius: CGFloat,
        borderWidth: CGFloat,
        style: GlowStyle,
        inset: CGFloat
    ) {
        self.accentColor = accentColor
        self.cornerRadius = cornerRadius
        self.borderWidth = borderWidth
        // Use the caller's style as-is. (An earlier attempt forced travelingShimmer
        // here for a "flowing highlight"; its transform.rotation.z spin rotated the
        // gradient layer TOGETHER WITH its stroke mask, turning the border into a
        // rotating diagonal cross. The accent gradient still uses the Codex blue
        // palette — see applyAccentColor — just without the broken rotation.)
        self.style = style
        self.contentInset = inset
        applyStyle()
        applyAccentColor()
        layoutGlow()
        if animating { restartAnimations() }
    }

    func updateAccentColor(_ color: NSColor) {
        accentColor = color
        applyAccentColor()
    }

    func refreshScaleFactor(_ scale: CGFloat) {
        bloomLayer.contentsScale = scale
        gradientLayer.contentsScale = scale
        strokeMaskLayer.contentsScale = scale
    }

    // MARK: Layout

    /// Recompute the rounded-rect path + gradient frame for the current bounds.
    func layoutGlow() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)

        let b = bounds
        gradientLayer.frame = b
        bloomLayer.frame = b
        strokeMaskLayer.frame = b

        // The stroke path is inset from the view edge by `contentInset`; the
        // stroke straddles the path (±borderWidth/2), so the path itself sits
        // exactly on the target content rect's edge.
        let pathRect = b.insetBy(dx: contentInset, dy: contentInset)
        guard pathRect.width > 0, pathRect.height > 0 else {
            CATransaction.commit()
            return
        }
        let radius = min(cornerRadius, min(pathRect.width, pathRect.height) / 2)
        let path = CGPath(
            roundedRect: pathRect,
            cornerWidth: radius,
            cornerHeight: radius,
            transform: nil
        )

        strokeMaskLayer.path = path
        strokeMaskLayer.lineWidth = borderWidth

        // Bloom path mirrors the stroke; its shadow provides the halo.
        bloomLayer.shadowPath = path
        bloomLayer.contents = nil
        // Re-derive bloom shadow radius from border width. Kept modest so the
        // halo is a faint glow, not a hot bloom (was *2.5, then *2.0 — still a bit
        // bright on the user's display).
        bloomLayer.shadowRadius = max(5, borderWidth * 1.7)

        // For conic styles the gradient must cover the layer fully; for axial it
        // sweeps along the border. Keep gradient frame == bounds (mask clips it).
        CATransaction.commit()
    }

    // MARK: Style + color

    private func applyStyle() {
        switch style {
        case .breathingAxial:
            gradientLayer.type = .axial
            gradientLayer.startPoint = CGPoint(x: 0, y: 0)
            gradientLayer.endPoint = CGPoint(x: 1, y: 1)
        case .breathingConic, .travelingShimmer:
            gradientLayer.type = .conic
            gradientLayer.startPoint = CGPoint(x: 0.5, y: 0.5)
            // For conic, endPoint defines the 0° reference direction.
            gradientLayer.endPoint = CGPoint(x: 1.0, y: 0.5)
        }
    }

    private func applyAccentColor() {
        // Fixed Codex-style blue→cyan palette sampled from the orb, rather than
        // tinting from an arbitrary caller accent — the whole point is a pretty,
        // consistent hue. `cyan` is the bright travelling highlight, `deep` the base.
        let cyan = NSColor(srgbRed: 0.349, green: 0.773, blue: 0.996, alpha: 1) // #59C5FE
        let core = NSColor(srgbRed: 0.071, green: 0.580, blue: 0.988, alpha: 1) // #1294FC
        let deep = NSColor(srgbRed: 0.000, green: 0.463, blue: 0.949, alpha: 1) // #0076F2

        switch style {
        case .breathingAxial:
            gradientLayer.colors = [cyan.cgColor, core.cgColor, deep.cgColor]
            gradientLayer.locations = [0.0, 0.5, 1.0]
        case .breathingConic, .travelingShimmer:
            // Seamless conic loop: one bright cyan point that travels the border.
            gradientLayer.colors = [
                cyan.cgColor, core.cgColor, deep.cgColor, core.cgColor, cyan.cgColor,
            ]
            gradientLayer.locations = [0.0, 0.25, 0.5, 0.75, 1.0]
        }

        // Bloom halo uses the core blue.
        bloomLayer.shadowColor = core.cgColor
        bloomLayer.shadowOpacity = 0 // animated up in startAnimations()
    }

    // MARK: Animations

    func startAnimations() {
        animating = true
        // A re-show can land within the previous hide's 0.25s fade-out. Cancel
        // any in-flight fade and restore full opacity first, otherwise the root
        // layer stays filled-forward at opacity 0 (invisible) and the stale fade
        // completion orders the freshly-shown window back out ~250ms later.
        cancelFadeOut()
        restartAnimations()
    }

    func stopAnimations() {
        animating = false
        bloomLayer.removeAllAnimations()
        gradientLayer.removeAllAnimations()
    }

    /// Cancel an in-flight fade-out and restore full opacity, invalidating any
    /// pending fade completion via the generation token.
    func cancelFadeOut() {
        fadeGeneration &+= 1
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer?.removeAnimation(forKey: "fadeOut")
        layer?.opacity = 1
        CATransaction.commit()
    }

    private func restartAnimations() {
        bloomLayer.removeAllAnimations()
        gradientLayer.removeAllAnimations()

        // Capture border bloom: a SINGLE gentle bloom-in that settles to a faint,
        // steady halo — deliberately NOT an infinite pulse. The old infinite
        // autoreversing breathing (0.35↔0.95) read as a too-bright blinking alarm.
        // Codex shows a brief capture transition then a calm border that simply
        // follows the window; we mirror that — bloom in once, then rest dim.
        let restOpacity: Float = 0.12
        // Softer initial bloom-in peak (was 0.30) so the capture transition reads
        // as a gentle settle, not a bright flash — the user reported it too bright.
        let peakOpacity: Float = 0.22
        bloomLayer.shadowOpacity = restOpacity
        let bloomIn = CABasicAnimation(keyPath: "shadowOpacity")
        bloomIn.fromValue = peakOpacity
        bloomIn.toValue = restOpacity
        bloomIn.duration = 0.55
        bloomIn.timingFunction = CAMediaTimingFunction(name: .easeOut)
        // Default isRemovedOnCompletion = true → after the bloom-in the presentation
        // settles onto the model value (restOpacity), leaving a faint steady halo.
        bloomLayer.add(bloomIn, forKey: "breathe")

        if style == .travelingShimmer {
            // Slowly rotate the conic gradient so the highlight travels around
            // the border. Rotating the whole gradient layer is cheapest and the
            // mask (stroke) stays put, so only the colors appear to move.
            let spin = CABasicAnimation(keyPath: "transform.rotation.z")
            spin.fromValue = 0
            spin.toValue = Double.pi * 2
            spin.duration = 5.5 // slow, elegant travel — a gentle shimmer, not a spin
            spin.repeatCount = .infinity
            spin.isRemovedOnCompletion = false
            // Rotate about the layer center.
            gradientLayer.add(spin, forKey: "shimmer")
        }
    }

    func fadeOut(completion: @escaping () -> Void) {
        fadeGeneration &+= 1
        let generation = fadeGeneration
        CATransaction.begin()
        CATransaction.setCompletionBlock { [weak self] in
            MainActor.assumeIsolated {
                // Suppress the order-out if a re-show (or a newer fade) bumped
                // the generation in the meantime — the window is visible again.
                guard let self, self.fadeGeneration == generation else { return }
                completion()
            }
        }
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = layer?.presentation()?.opacity ?? 1.0
        fade.toValue = 0.0
        fade.duration = 0.25
        fade.timingFunction = CAMediaTimingFunction(name: .easeOut)
        fade.isRemovedOnCompletion = false
        fade.fillMode = .forwards
        layer?.add(fade, forKey: "fadeOut")
        CATransaction.commit()
    }
}
