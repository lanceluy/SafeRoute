import SwiftUI

/// ORIGINAL vs SAFER, and *why* the safer one is safer (review §12). A floating glass layer.
struct RouteComparisonCard: View {
    let plan: RoutePlan
    @Binding var useSafer: Bool
    let onClose: () -> Void
    let onSelectHazard: (UUID) -> Void
    var onStart: (() -> Void)?

    var body: some View {
        SRGlassCard(padding: SR.Space.md) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Walking to").font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
                    Text(plan.destinationName).font(SR.Font.cardTitle).foregroundStyle(SR.Palette.textPrimary).lineLimit(1)
                }
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(SR.Font.meta.weight(.bold))
                        .foregroundStyle(SR.Palette.textSecondary)
                        .frame(width: SR.Layout.minTouchTarget, height: SR.Layout.minTouchTarget)
                }
                .accessibilityLabel("Clear route")
            }

            if let safer = plan.safer {
                HStack(spacing: SR.Space.xs) {
                    routeTile(title: "Original", time: plan.original.expectedTravelTime, detail: hazardCount(plan.original),
                              selected: !useSafer, dashed: true) { useSafer = false }
                    routeTile(title: "Safer route", time: safer.expectedTravelTime,
                              detail: plan.extraTime >= 30 ? "+\(Format.duration(plan.extraTime))" : "Same time",
                              selected: useSafer, dashed: false) { useSafer = true }
                }
                if !plan.avoided.isEmpty {
                    VStack(alignment: .leading, spacing: SR.Space.xxs) {
                        Text("Avoids").font(SR.Font.metaStrong).foregroundStyle(SR.Palette.textSecondary)
                        ForEach(plan.avoided) { rh in
                            Button { onSelectHazard(rh.id) } label: {
                                HStack(spacing: SR.Space.xs) {
                                    HazardIcon(type: rh.hazard.type, severity: rh.hazard.severity, size: 24)
                                    Text(rh.hazard.type.displayName).font(SR.Font.secondary.weight(.medium))
                                        .foregroundStyle(SR.Palette.textPrimary)
                                    Text("· \(Format.distance(rh.distanceFromPath)) from original path")
                                        .font(SR.Font.secondary).foregroundStyle(SR.Palette.textSecondary)
                                    Spacer(minLength: 0)
                                }
                                .frame(minHeight: 32)
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint("Shows the hazard")
                        }
                    }
                }
                if safer.hasHighSeverityHazard {
                    warning("The safer route still passes a high-severity hazard.")
                }
            } else if plan.original.hazards.isEmpty {
                Label("No reported hazards on this route · \(Format.duration(plan.original.expectedTravelTime))",
                      systemImage: "checkmark.shield.fill")
                    .font(SR.Font.secondary.weight(.medium))
                    .foregroundStyle(SR.Palette.safe)
            } else {
                Text("\(Format.duration(plan.original.expectedTravelTime)) · \(Format.distance(plan.original.distance))")
                    .font(SR.Font.secondary).foregroundStyle(SR.Palette.textSecondary)
                warning("No walkable alternative avoids \(hazardCount(plan.original).lowercased()) on this route. Take care.")
                ForEach(plan.original.hazards) { rh in
                    Button { onSelectHazard(rh.id) } label: {
                        Label("\(rh.hazard.type.displayName) · \(Format.distance(rh.distanceFromPath)) from path",
                              systemImage: rh.hazard.type.symbolName)
                            .font(SR.Font.secondary)
                            .foregroundStyle(SR.Palette.textPrimary)
                    }
                    .buttonStyle(.plain)
                }
            }

            if let onStart {
                Button(action: onStart) {
                    Label(plan.safer != nil && useSafer ? "Start safer route" : "Start", systemImage: "figure.walk")
                }
                .buttonStyle(.srPrimary)
                .accessibilityHint("Starts walking navigation with hazard warnings")
            }
        }
    }

    private func routeTile(title: String, time: TimeInterval, detail: String, selected: Bool,
                           dashed: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: SR.Space.xxs) {
                HStack(spacing: SR.Space.xs) {
                    // Swatch matches the map: dashed grey original vs solid navy safer route.
                    Capsule()
                        .strokeBorder(style: StrokeStyle(lineWidth: 3, dash: dashed ? [4, 3] : []))
                        .foregroundStyle(dashed ? SR.Palette.textSecondary : SR.Palette.navy)
                        .frame(width: 22, height: 6)
                    Text(title.uppercased()).font(SR.Font.metaStrong).foregroundStyle(SR.Palette.textSecondary)
                }
                Text(Format.duration(time)).font(SR.Font.metric).foregroundStyle(SR.Palette.textPrimary)
                Text(detail).font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(SR.Space.sm)
            .background(selected ? SR.Palette.navyTint : SR.Palette.surface.opacity(0.6),
                        in: RoundedRectangle(cornerRadius: SR.Radius.control, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: SR.Radius.control, style: .continuous)
                .strokeBorder(selected ? SR.Palette.navy : SR.Palette.border, lineWidth: selected ? 2 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(Format.duration(time)), \(detail)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func hazardCount(_ option: RouteOption) -> String {
        let n = option.hazards.count
        return n == 0 ? "No hazards" : "\(n) hazard\(n == 1 ? "" : "s")"
    }

    private func warning(_ text: String) -> some View {
        Label(text, systemImage: "exclamationmark.triangle.fill")
            .font(SR.Font.metaStrong)
            .foregroundStyle(SR.Palette.warning)
    }
}
