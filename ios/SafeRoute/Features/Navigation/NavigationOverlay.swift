import SwiftUI

/// Top half of the navigation screen: next turn, off-route state, and the hazard ahead.
struct NavigationTopPanel: View {
    @ObservedObject var session: NavigationSession
    @ObservedObject var model: MapViewModel
    let onSelectHazard: (UUID) -> Void

    var body: some View {
        VStack(spacing: SR.Space.sm) {
            if session.phase == .offRoute {
                offRouteCard
            } else if session.phase == .navigating {
                instructionCard
            }
            if session.phase != .arrived {
                if let warning = session.activeWarning {
                    hazardWarning(warning.hazard, distance: warning.distance)
                        .transition(.move(edge: .top).combined(with: .opacity))
                } else if let next = session.nextHazard {
                    nextHazardChip(next.hazard, distance: next.distance)
                }
            }
        }
        .padding(.horizontal, SR.Space.screenMargin)
        .padding(.top, SR.Space.xxs)
    }

    private var instructionCard: some View {
        HStack(spacing: SR.Space.md) {
            Image(systemName: session.nextStep?.symbol ?? "arrow.up")
                .font(.system(size: 34, weight: .semibold))
                .frame(width: 48)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(Format.distance(session.distanceToNextStep))
                    .font(SR.Font.metric)
                Text(session.nextStep?.instruction ?? "Continue on the route")
                    .font(SR.Font.body.weight(.medium))
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(SR.Palette.onNavy)
        .padding(SR.Space.lg)
        .background(SR.Palette.navy, in: RoundedRectangle(cornerRadius: SR.Radius.floating, style: .continuous))
        .shadow(color: .black.opacity(0.15), radius: 12, y: 6)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("In \(Format.distance(session.distanceToNextStep)), \(session.nextStep?.instruction ?? "continue")")
    }

    private var offRouteCard: some View {
        HStack(spacing: SR.Space.md) {
            Image(systemName: "location.slash.fill").font(.title2).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("You're off the route").font(SR.Font.cardTitle)
                Text("Head back, or get a new safe route from here.").font(SR.Font.secondary)
            }
            Spacer(minLength: 0)
            Button {
                Task { await model.reroute() }
            } label: {
                if model.isRerouting { ProgressView().tint(SR.Palette.warning) } else { Text("Reroute").fontWeight(.semibold) }
            }
            .padding(.horizontal, SR.Space.md)
            .frame(minHeight: SR.Layout.minTouchTarget)
            .background(.white, in: Capsule())
            .foregroundStyle(SR.Palette.warning)
            .disabled(model.isRerouting)
        }
        .foregroundStyle(.white)
        .padding(SR.Space.lg)
        .background(SR.Palette.warning, in: RoundedRectangle(cornerRadius: SR.Radius.floating, style: .continuous))
        .shadow(color: .black.opacity(0.15), radius: 12, y: 6)
    }

    private func hazardWarning(_ item: NavigationSession.HazardOnRoute, distance: Double) -> some View {
        let hazard = item.hazard
        return Button { onSelectHazard(hazard.id) } label: {
            HStack(spacing: SR.Space.sm) {
                HazardIcon(type: hazard.type, severity: hazard.severity, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(hazard.type.displayName) ahead").font(SR.Font.cardTitle).foregroundStyle(SR.Palette.textPrimary)
                    Text("\(hazard.severity.label) · \(hazard.status == .verified ? "confirmed by \(hazard.confirmationCount)" : hazard.status.label.lowercased())")
                        .font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
                }
                Spacer(minLength: 0)
                Text(distance < 15 ? "Now" : Format.distance(distance))
                    .font(SR.Font.metric.monospacedDigit())
                    .foregroundStyle(hazard.severity.color)
            }
            .padding(SR.Space.md)
            .srGlassSurface(radius: SR.Radius.floating)
            .overlay(RoundedRectangle(cornerRadius: SR.Radius.floating, style: .continuous).strokeBorder(hazard.severity.color, lineWidth: 2))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Caution: \(hazard.type.displayName) in \(Format.distance(distance)), \(hazard.severity.label)")
        .accessibilityHint("Shows hazard details")
    }

    private func nextHazardChip(_ item: NavigationSession.HazardOnRoute, distance: Double) -> some View {
        Button { onSelectHazard(item.hazard.id) } label: {
            HStack(spacing: SR.Space.xs) {
                HazardIcon(type: item.hazard.type, severity: item.hazard.severity, size: 24)
                Text("Next hazard: \(item.hazard.type.displayName) · \(Format.distance(distance))")
                    .font(SR.Font.secondary.weight(.medium))
                    .foregroundStyle(SR.Palette.textPrimary)
            }
            .padding(.horizontal, SR.Space.md)
            .frame(minHeight: SR.Layout.minTouchTarget)
            .srGlassSurface(radius: SR.Radius.button)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Bottom of the navigation screen: progress, hazards count, voice toggle, recenter, End.
struct NavigationBottomPanel: View {
    @ObservedObject var session: NavigationSession
    let isFollowing: Bool
    let onRecenter: () -> Void
    let onEnd: () -> Void
    let onFinish: () -> Void

    var body: some View {
        VStack(spacing: SR.Space.sm) {
            if session.phase == .arrived {
                arrivalCard
            } else {
                if !isFollowing {
                    HStack {
                        Spacer()
                        Button(action: onRecenter) {
                            Label("Re-center", systemImage: "location.north.line.fill")
                                .font(SR.Font.secondary.weight(.semibold))
                                .foregroundStyle(SR.Palette.navy)
                                .padding(.horizontal, SR.Space.md)
                                .frame(minHeight: SR.Layout.minTouchTarget)
                                .srGlassSurface(radius: SR.Radius.button)
                        }
                    }
                }
                progressBar
            }
        }
        .padding(.horizontal, SR.Space.screenMargin)
        .padding(.bottom, SR.Space.xs)
    }

    private var progressBar: some View {
        SRGlassCard(padding: SR.Space.md) {
            HStack(alignment: .center, spacing: SR.Space.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Format.duration(session.remainingTime))
                        .font(SR.Font.metric)
                        .foregroundStyle(SR.Palette.safe)
                    Text("\(Format.distance(session.remainingDistance)) · arrive \(session.arrivalTime.formatted(date: .omitted, time: .shortened))")
                        .font(SR.Font.meta)
                        .foregroundStyle(SR.Palette.textSecondary)
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: 0)
                Button { session.voiceEnabled.toggle() } label: {
                    Image(systemName: session.voiceEnabled ? "speaker.wave.2.fill" : "speaker.slash.fill")
                        .font(SR.Font.cardTitle)
                        .foregroundStyle(SR.Palette.navy)
                        .frame(width: SR.Layout.minTouchTarget, height: SR.Layout.minTouchTarget)
                        .background(SR.Palette.navyTint, in: Circle())
                }
                .accessibilityLabel(session.voiceEnabled ? "Mute voice warnings" : "Unmute voice warnings")
                Button(action: onEnd) {
                    Text("End")
                        .font(SR.Font.button)
                        .foregroundStyle(.white)
                        .padding(.horizontal, SR.Space.lg)
                        .frame(minHeight: SR.Layout.minTouchTarget)
                        .background(SR.Palette.critical, in: Capsule())
                }
                .accessibilityLabel("End navigation")
            }
            let ahead = session.hazardsAhead.count
            if !session.assessment.isComplete {
                // Never a green shield when the route's hazards weren't fully checked.
                Label(ahead == 0 ? "Hazard check incomplete" : "\(ahead) known hazard\(ahead == 1 ? "" : "s") ahead · check incomplete",
                      systemImage: "questionmark.diamond.fill")
                    .font(SR.Font.meta.weight(.medium))
                    .foregroundStyle(SR.Palette.warning)
            } else {
                Label(ahead == 0 ? "No reported hazards ahead" : "\(ahead) hazard\(ahead == 1 ? "" : "s") ahead on this route",
                      systemImage: ahead == 0 ? "checkmark.shield.fill" : "exclamationmark.triangle.fill")
                    .font(SR.Font.meta.weight(.medium))
                    .foregroundStyle(ahead == 0 ? SR.Palette.safe : SR.Palette.warning)
            }
        }
    }

    private var arrivalCard: some View {
        SRGlassCard(padding: SR.Space.lg) {
            HStack(spacing: SR.Space.md) {
                Image(systemName: "flag.checkered")
                    .font(.title)
                    .foregroundStyle(SR.Palette.navy)
                    .frame(width: 56, height: 56)
                    .background(SR.Palette.navyTint, in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("You've arrived").font(SR.Font.cardTitle).foregroundStyle(SR.Palette.textPrimary)
                    Text(session.destinationName).font(SR.Font.secondary).foregroundStyle(SR.Palette.textSecondary)
                }
            }
            Button("Done", action: onFinish).buttonStyle(.srPrimary)
        }
    }
}
