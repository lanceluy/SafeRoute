import SwiftUI
import MapKit

/// MKMapView wrapper — SwiftUI's `Map` has no annotation clustering on iOS 17, and clustering is
/// required once many hazards overlap. Reports the visible region (debounced) so
/// only hazards in view are fetched.
struct HazardMapView: UIViewRepresentable {
    let hazards: [Hazard]
    let pending: [ReportsStore.PendingSubmission]
    let plan: RoutePlan?
    let useSaferRoute: Bool
    let command: MapViewModel.CommandRequest?
    let selectedHazardId: UUID?
    var isNavigating = false
    /// Navigation camera target (the user's position and walking direction).
    var followCoordinate: CLLocationCoordinate2D?
    var followHeading: CLLocationDirection?
    /// Hazards that always show their name (the ones on the route while navigating).
    var labelledHazardIds: Set<UUID> = []
    var onFollowChange: (Bool) -> Void = { _ in }
    let onSelectHazard: (UUID) -> Void
    let onTapBackground: () -> Void
    let onRegionChange: (MKCoordinateRegion) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.showsUserLocation = true
        map.showsCompass = true
        map.pointOfInterestFilter = .excludingAll
        map.register(HazardPinView.self, forAnnotationViewWithReuseIdentifier: HazardPinView.reuseId)
        map.register(HazardClusterView.self, forAnnotationViewWithReuseIdentifier: MKMapViewDefaultClusterAnnotationViewReuseIdentifier)
        map.register(PendingPinView.self, forAnnotationViewWithReuseIdentifier: PendingPinView.reuseId)
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleBackgroundTap(_:)))
        tap.delegate = context.coordinator
        map.addGestureRecognizer(tap)
        let start = LocationManager.shared.currentLocation ?? CLLocationCoordinate2D(latitude: 14.5547, longitude: 121.0244)
        map.setRegion(MKCoordinateRegion(center: start, latitudinalMeters: 1500, longitudinalMeters: 1500), animated: false)
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.syncAnnotations(on: map)
        context.coordinator.syncSelection(on: map)
        context.coordinator.syncNavigation(on: map)
        context.coordinator.syncOverlays(on: map)
        context.coordinator.run(command, on: map)
    }

    @MainActor
    final class Coordinator: NSObject, MKMapViewDelegate, UIGestureRecognizerDelegate {
        var parent: HazardMapView
        private var hazardAnnotations: [UUID: HazardAnnotation] = [:]
        private var pendingAnnotations: [UUID: PendingAnnotation] = [:]
        private var renderedPlanKey: String?
        private var lastCommandId: UUID?
        private var regionDebounce: Task<Void, Never>?
        private var hasCenteredOnUser = false
        private var renderedSelection: UUID?
        private var labelsVisible = false
        private var wasNavigating = false
        /// Navigation camera follows the walker until they pan the map themselves.
        private var isFollowing = false
        private var lastFollowCoordinate: CLLocationCoordinate2D?
        private var renderedLabelled: Set<UUID> = []

        init(parent: HazardMapView) {
            self.parent = parent
        }

        private var animate: Bool { !UIAccessibility.isReduceMotionEnabled }

        // MARK: Annotations

        func syncAnnotations(on map: MKMapView) {
            let wanted = Dictionary(uniqueKeysWithValues: parent.hazards.map { ($0.id, $0) })
            var toRemove: [MKAnnotation] = []
            var toAdd: [MKAnnotation] = []
            for (id, annotation) in hazardAnnotations {
                guard let hazard = wanted[id] else {
                    toRemove.append(annotation)
                    hazardAnnotations[id] = nil
                    continue
                }
                if annotation.hazard != hazard {
                    // Re-add so the marker view picks up new color/glyph/accessibility text.
                    toRemove.append(annotation)
                    let replacement = HazardAnnotation(hazard: hazard)
                    hazardAnnotations[id] = replacement
                    toAdd.append(replacement)
                }
            }
            for (id, hazard) in wanted where hazardAnnotations[id] == nil {
                let annotation = HazardAnnotation(hazard: hazard)
                hazardAnnotations[id] = annotation
                toAdd.append(annotation)
            }

            let wantedPending = Dictionary(uniqueKeysWithValues: parent.pending.map { ($0.id, $0) })
            for (id, annotation) in pendingAnnotations where wantedPending[id] == nil {
                toRemove.append(annotation)
                pendingAnnotations[id] = nil
            }
            for (id, submission) in wantedPending where pendingAnnotations[id] == nil {
                let annotation = PendingAnnotation(submission: submission)
                pendingAnnotations[id] = annotation
                toAdd.append(annotation)
            }

            if !toRemove.isEmpty { map.removeAnnotations(toRemove) }
            if !toAdd.isEmpty {
                map.addAnnotations(toAdd)
                updateLabels(on: map)
            }
        }

        // MARK: Selection & labels

        func syncSelection(on map: MKMapView) {
            guard parent.selectedHazardId != renderedSelection else { return }
            let previous = renderedSelection
            renderedSelection = parent.selectedHazardId
            for id in [previous, renderedSelection].compactMap({ $0 }) {
                guard let annotation = hazardAnnotations[id], let view = map.view(for: annotation) as? HazardPinView else { continue }
                view.setEmphasis(selected: id == renderedSelection, showLabel: shouldLabel(id), animated: animate)
            }
        }

        /// Labels only at close zoom with few pins on screen; the selected pin always has one.
        func updateLabels(on map: MKMapView) {
            let visible = map.annotations(in: map.visibleMapRect).compactMap { $0 as? HazardAnnotation }
            labelsVisible = map.region.span.latitudeDelta < 0.006 && visible.count < 12
            for annotation in visible {
                guard let view = map.view(for: annotation) as? HazardPinView else { continue }
                let id = annotation.hazard.id
                view.setEmphasis(selected: id == renderedSelection, showLabel: shouldLabel(id), animated: false)
            }
        }

        private func shouldLabel(_ id: UUID) -> Bool {
            labelsVisible || id == renderedSelection || parent.labelledHazardIds.contains(id)
        }

        // MARK: Navigation camera

        func syncNavigation(on map: MKMapView) {
            if parent.labelledHazardIds != renderedLabelled {
                renderedLabelled = parent.labelledHazardIds
                updateLabels(on: map)
            }
            if parent.isNavigating != wasNavigating {
                wasNavigating = parent.isNavigating
                if !parent.isNavigating {
                    isFollowing = false
                    let camera = map.camera.copy() as! MKMapCamera
                    camera.pitch = 0
                    camera.heading = 0
                    map.setCamera(camera, animated: animate)
                }
            }
            // Move the camera with the walker. Done manually rather than with MKUserTrackingMode,
            // which picks its own zoom level and has no heading on the Simulator.
            if parent.isNavigating, isFollowing, let target = parent.followCoordinate,
               target.latitude != lastFollowCoordinate?.latitude || target.longitude != lastFollowCoordinate?.longitude {
                lastFollowCoordinate = target
                map.setCamera(navigationCamera(at: target, map: map), animated: animate)
            }
        }

        private func navigationCamera(at target: CLLocationCoordinate2D, map: MKMapView) -> MKMapCamera {
            MKMapCamera(lookingAtCenter: target, fromDistance: 450, pitch: 50,
                        heading: parent.followHeading ?? map.camera.heading)
        }

        private func followUser(on map: MKMapView) {
            guard let target = parent.followCoordinate ?? LocationManager.shared.currentLocation else { return }
            isFollowing = true
            lastFollowCoordinate = target
            map.setCamera(navigationCamera(at: target, map: map), animated: animate)
            parent.onFollowChange(true)
        }

        /// A drag/pinch/rotate by the user pauses following (the Re-center button resumes it).
        func mapView(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool) {
            guard parent.isNavigating, isFollowing else { return }
            let userGesture = mapView.subviews.first?.gestureRecognizers?.contains {
                $0.state == .began || $0.state == .changed
            } ?? false
            if userGesture {
                isFollowing = false
                parent.onFollowChange(false)
            }
        }

        @objc func handleBackgroundTap(_ recognizer: UITapGestureRecognizer) {
            guard let map = recognizer.view as? MKMapView else { return }
            let hit = map.hitTest(recognizer.location(in: map), with: nil)
            var view = hit
            while let current = view {
                if current is MKAnnotationView { return } // a pin or cluster handles its own tap
                view = current.superview
            }
            parent.onTapBackground()
        }

        nonisolated func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                                           shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }

        // MARK: Route overlays

        func syncOverlays(on map: MKMapView) {
            let key = parent.plan.map { "\($0.id)-\(parent.useSaferRoute)" }
            guard key != renderedPlanKey else { return }
            renderedPlanKey = key
            map.removeOverlays(map.overlays)
            guard let plan = parent.plan else { return }

            let activeIsSafer = parent.useSaferRoute && plan.safer != nil
            // Draw the inactive option first so the active route sits on top.
            if plan.safer != nil {
                addRoute(plan.original, kind: activeIsSafer ? .inactive : .activeOriginal(hasHazards: !plan.original.hazards.isEmpty), to: map)
            }
            if let safer = plan.safer {
                addRoute(safer, kind: activeIsSafer ? .activeSafer(warning: safer.hasHighSeverityHazard) : .inactive, to: map)
            } else {
                addRoute(plan.original, kind: .activeOriginal(hasHazards: !plan.original.hazards.isEmpty), to: map)
            }
            for avoided in plan.avoided {
                let ring = HazardRing(center: avoided.hazard.coordinate, radius: 30)
                map.addOverlay(ring, level: .aboveLabels)
            }
        }

        private func addRoute(_ option: RouteOption, kind: RouteLine.Kind, to map: MKMapView) {
            // Every leg of a waypoint detour is its own polyline; render them all.
            for leg in option.legs {
                let line = RouteLine(points: leg.polyline.points(), count: leg.polyline.pointCount)
                line.kind = kind
                map.addOverlay(line, level: .aboveRoads)
            }
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let line = overlay as? RouteLine {
                let renderer = MKPolylineRenderer(polyline: line)
                renderer.lineCap = .round
                renderer.lineJoin = .round
                switch line.kind {
                case .inactive:
                    renderer.strokeColor = UIColor.systemGray.withAlphaComponent(0.7)
                    renderer.lineWidth = 5
                    renderer.lineDashPattern = [6, 8]
                case .activeOriginal(let hasHazards):
                    renderer.strokeColor = hasHazards ? .systemOrange : SR.Palette.navyUI
                    renderer.lineWidth = 6
                case .activeSafer(let warning):
                    renderer.strokeColor = warning ? .systemOrange : SR.Palette.navyUI
                    renderer.lineWidth = 6
                }
                return renderer
            }
            if let ring = overlay as? HazardRing {
                let renderer = MKCircleRenderer(circle: ring)
                renderer.strokeColor = .systemRed
                renderer.fillColor = UIColor.systemRed.withAlphaComponent(0.12)
                renderer.lineWidth = 2
                renderer.lineDashPattern = [4, 4]
                return renderer
            }
            return MKOverlayRenderer(overlay: overlay)
        }

        // MARK: Commands

        func run(_ request: MapViewModel.CommandRequest?, on map: MKMapView) {
            guard let request, request.id != lastCommandId else { return }
            lastCommandId = request.id
            switch request.command {
            case .recenterOnUser:
                if let user = LocationManager.shared.currentLocation {
                    map.setRegion(MKCoordinateRegion(center: user, latitudinalMeters: 1200, longitudinalMeters: 1200), animated: animate)
                }
            case .focus(let coordinate):
                map.setRegion(MKCoordinateRegion(center: coordinate, latitudinalMeters: 400, longitudinalMeters: 400), animated: animate)
            case .followUser:
                followUser(on: map)
            case .showRoute:
                let rect = map.overlays.reduce(MKMapRect.null) { $0.union($1.boundingMapRect) }
                if !rect.isNull {
                    map.setVisibleMapRect(rect, edgePadding: UIEdgeInsets(top: 140, left: 40, bottom: 320, right: 40), animated: animate)
                }
            }
        }

        // MARK: Delegate

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            switch annotation {
            case is MKUserLocation: return nil
            case let cluster as MKClusterAnnotation:
                return mapView.dequeueReusableAnnotationView(withIdentifier: MKMapViewDefaultClusterAnnotationViewReuseIdentifier, for: cluster)
            case let hazard as HazardAnnotation:
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: HazardPinView.reuseId, for: annotation)
                if let pin = view as? HazardPinView {
                    let id = hazard.hazard.id
                    pin.setEmphasis(selected: id == renderedSelection, showLabel: shouldLabel(id), animated: false)
                }
                return view
            case is PendingAnnotation:
                return mapView.dequeueReusableAnnotationView(withIdentifier: PendingPinView.reuseId, for: annotation)
            default: return nil
            }
        }

        func mapView(_ mapView: MKMapView, didSelect annotation: MKAnnotation) {
            if let cluster = annotation as? MKClusterAnnotation {
                mapView.showAnnotations(cluster.memberAnnotations, animated: animate)
            } else if let hazard = annotation as? HazardAnnotation {
                parent.onSelectHazard(hazard.hazard.id)
            }
            mapView.deselectAnnotation(annotation, animated: false)
        }

        /// The "you are here" dot always sits above hazard pins and clusters, so a hazard right
        /// next to the user can never hide where they are.
        func mapView(_ mapView: MKMapView, didAdd views: [MKAnnotationView]) {
            for view in views where view.annotation is MKUserLocation {
                raiseUserLocation(view)
            }
        }

        private func raiseUserLocation(_ view: MKAnnotationView?) {
            guard let view else { return }
            view.zPriority = .max
            view.displayPriority = .required
            view.superview?.bringSubviewToFront(view)
        }

        func mapView(_ mapView: MKMapView, didUpdate userLocation: MKUserLocation) {
            raiseUserLocation(mapView.view(for: userLocation))
            guard !hasCenteredOnUser, let location = userLocation.location else { return }
            hasCenteredOnUser = true
            mapView.setRegion(MKCoordinateRegion(center: location.coordinate, latitudinalMeters: 1500, longitudinalMeters: 1500), animated: false)
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            updateLabels(on: mapView)
            let region = mapView.region
            regionDebounce?.cancel()
            regionDebounce = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(400))
                guard !Task.isCancelled else { return }
                self?.parent.onRegionChange(region)
            }
        }
    }
}

// MARK: - Annotation & overlay types

final class HazardAnnotation: NSObject, MKAnnotation {
    let hazard: Hazard
    var coordinate: CLLocationCoordinate2D { hazard.coordinate }
    var title: String? { hazard.type.displayName }
    var subtitle: String? { hazard.status.label }

    init(hazard: Hazard) {
        self.hazard = hazard
    }
}

final class PendingAnnotation: NSObject, MKAnnotation {
    let submission: ReportsStore.PendingSubmission
    var coordinate: CLLocationCoordinate2D { submission.coordinate }
    var title: String? { "Checking your report…" }

    init(submission: ReportsStore.PendingSubmission) {
        self.submission = submission
    }
}

final class RouteLine: MKPolyline {
    enum Kind {
        case inactive
        case activeOriginal(hasHazards: Bool)
        case activeSafer(warning: Bool)
    }

    var kind: Kind = .inactive
}

final class HazardRing: MKCircle {}

/// 38 pt severity disc with the type glyph (46 pt when selected), a light shadow and the calmer
/// marker palette. The type name is shown as a small label only when it helps: selected, or
/// zoomed in close with few pins.
final class HazardPinView: MKAnnotationView {
    static let reuseId = "hazard"

    struct Metrics {
        /// The view's frame: also the area MapKit uses for collisions, so a frame larger than the
        /// disc makes neighbouring pins cluster sooner.
        var viewSize: CGFloat
        var discSize: CGFloat
        var selectedDiscSize: CGFloat
        var glyphPointSize: CGFloat
        var borderWidth: CGFloat
        var shadowOpacity: Float
        var shadowRadius: CGFloat
    }

    /// The frame is larger than the disc, so MapKit starts clustering neighbouring pins sooner.
    static let metrics = Metrics(viewSize: 56, discSize: 38, selectedDiscSize: 46, glyphPointSize: 15,
                                 borderWidth: 2.5, shadowOpacity: 0.08, shadowRadius: 2)

    static func color(for severity: Severity) -> UIColor { severity.markerColor }

    private let disc = UIView()
    private let glyph = UIImageView()
    private let label = PaddedLabel()
    private var isEmphasized = false

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        let m = Self.metrics
        frame = CGRect(x: 0, y: 0, width: m.viewSize, height: m.viewSize)
        disc.frame = CGRect(x: (m.viewSize - m.discSize) / 2, y: (m.viewSize - m.discSize) / 2,
                            width: m.discSize, height: m.discSize)
        disc.layer.cornerRadius = m.discSize / 2
        disc.layer.borderColor = UIColor.white.cgColor
        disc.layer.borderWidth = m.borderWidth
        disc.layer.shadowColor = UIColor.black.cgColor
        disc.layer.shadowOpacity = m.shadowOpacity
        disc.layer.shadowRadius = m.shadowRadius
        disc.layer.shadowOffset = CGSize(width: 0, height: m.shadowRadius / 2)
        disc.isUserInteractionEnabled = false
        addSubview(disc)
        glyph.tintColor = .white
        glyph.contentMode = .center
        glyph.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: m.glyphPointSize, weight: .semibold)
        glyph.frame = disc.bounds
        disc.addSubview(glyph)
        label.font = .preferredFont(forTextStyle: .caption2).withWeight(.semibold)
        label.textColor = UIColor(SR.Palette.textPrimary)
        label.backgroundColor = UIColor(SR.Palette.surface).withAlphaComponent(0.92)
        label.layer.cornerRadius = 8
        label.layer.masksToBounds = true
        label.isHidden = true
        addSubview(label)
        collisionMode = .circle
        canShowCallout = false
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var annotation: MKAnnotation? {
        didSet { configure() }
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        isEmphasized = false
        label.isHidden = true
        disc.transform = .identity
    }

    private func configure() {
        guard let hazard = (annotation as? HazardAnnotation)?.hazard else { return }
        clusteringIdentifier = "hazards"
        disc.backgroundColor = hazard.status.isActive ? Self.color(for: hazard.severity) : .systemGray
        glyph.image = UIImage(systemName: hazard.type.symbolName)
        alpha = hazard.status.isActive ? 1 : 0.6
        displayPriority = hazard.severity == .high ? .required : .defaultHigh
        label.text = hazard.type.displayName
        label.sizeToFit()
        label.frame.size.width += 12
        label.frame.size.height += 4
        label.center = CGPoint(x: bounds.midX, y: disc.frame.maxY + label.bounds.height / 2 + 6)
        isAccessibilityElement = true
        accessibilityLabel = hazard.accessibilitySummary
        accessibilityHint = "Double tap for a summary"
        accessibilityTraits = .button
    }

    func setEmphasis(selected: Bool, showLabel: Bool, animated: Bool) {
        label.isHidden = !showLabel
        guard selected != isEmphasized else { return }
        isEmphasized = selected
        let scale = selected ? Self.metrics.selectedDiscSize / Self.metrics.discSize : 1
        let change = { self.disc.transform = CGAffineTransform(scaleX: scale, y: scale) }
        if animated { UIView.animate(withDuration: 0.2, animations: change) } else { change() }
        zPriority = selected ? .defaultSelected : .defaultUnselected
    }
}

/// Clusters look nothing like single hazards: a white count badge with a ring in the most severe
/// member's color, instead of a filled disc with a glyph.
final class HazardClusterView: MKAnnotationView {
    private let badge = UILabel()
    private static let viewSize: CGFloat = 56
    private static let badgeHeight: CGFloat = 38

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(x: 0, y: 0, width: Self.viewSize, height: Self.viewSize)
        badge.textAlignment = .center
        badge.font = .systemFont(ofSize: 15, weight: .bold)
        badge.textColor = UIColor(SR.Palette.textPrimary)
        badge.backgroundColor = UIColor(SR.Palette.surface)
        badge.layer.cornerRadius = Self.badgeHeight / 2
        badge.layer.masksToBounds = true
        badge.layer.borderWidth = 2.5
        addSubview(badge)
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.10
        layer.shadowRadius = 3
        layer.shadowOffset = CGSize(width: 0, height: 1)
        collisionMode = .circle
        displayPriority = .required
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var annotation: MKAnnotation? {
        didSet { configure() }
    }

    private func configure() {
        guard let cluster = annotation as? MKClusterAnnotation else { return }
        let members = cluster.memberAnnotations.compactMap { ($0 as? HazardAnnotation)?.hazard }
        let worst = members.map(\.severity).max() ?? .medium
        let count = cluster.memberAnnotations.count
        badge.text = "\(count)"
        badge.layer.borderColor = worst.markerColor.cgColor
        let width = max(Self.badgeHeight, badge.intrinsicContentSize.width + 16)
        badge.frame = CGRect(x: (Self.viewSize - width) / 2, y: (Self.viewSize - Self.badgeHeight) / 2,
                             width: width, height: Self.badgeHeight)
        isAccessibilityElement = true
        accessibilityLabel = "Group of \(count) hazards, most severe: \(worst.label.lowercased())"
        accessibilityHint = "Double tap to zoom in"
        accessibilityTraits = .button
    }
}

/// Your just-submitted report while it's being checked.
final class PendingPinView: MKAnnotationView {
    static let reuseId = "pending"

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(x: 0, y: 0, width: 38, height: 38)
        let disc = UIView(frame: bounds)
        disc.backgroundColor = SR.Palette.navyUI
        disc.layer.cornerRadius = 19
        disc.layer.borderColor = UIColor.white.cgColor
        disc.layer.borderWidth = 2.5
        let glyph = UIImageView(image: UIImage(systemName: "hourglass"))
        glyph.tintColor = .white
        glyph.frame = disc.bounds.insetBy(dx: 10, dy: 10)
        glyph.contentMode = .scaleAspectFit
        disc.addSubview(glyph)
        addSubview(disc)
        displayPriority = .required
        isAccessibilityElement = true
        accessibilityLabel = "Your report, being checked"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

private final class PaddedLabel: UILabel {
    override func drawText(in rect: CGRect) {
        super.drawText(in: rect.insetBy(dx: 6, dy: 2))
    }
}

private extension UIFont {
    func withWeight(_ weight: UIFont.Weight) -> UIFont {
        UIFont.systemFont(ofSize: pointSize, weight: weight)
    }
}
