import SwiftUI

/// Nearby Hazards: a severity summary, filters, and the list, tied to the map. Tapping a row
/// selects its pin and pans to it; tapping a pin scrolls to its row; the chevron opens details.
struct NearbyHazardsSheet: View {
    let items: [NearbyHazardList.Item]
    let hasLocation: Bool
    let radiusMeters: Double
    /// The hazard selected on the map (from a row or a pin).
    let selectedId: UUID?
    let onSelect: (UUID) -> Void
    let onOpenDetails: (UUID) -> Void

    @State private var severity: NearbyHazardList.SeverityFilter = .all
    @State private var type: HazardType?
    @State private var sort: NearbyHazardList.Sort = .nearest
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var shown: [NearbyHazardList.Item] {
        NearbyHazardList.apply(items, severity: severity, type: type, sort: sort)
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                        .padding(.top, SR.Space.xl)
                    RiskSummaryCard(counts: NearbyHazardList.counts(items))
                        .padding(.top, SR.Space.lg)
                    filterRow
                        .padding(.top, SR.Space.xl)
                    listHeader
                        .padding(.top, SR.Space.md)
                    list
                        .padding(.top, SR.Space.xs)
                }
                .padding(.horizontal, SR.Space.screenMargin)
                .padding(.bottom, SR.Space.xxl)
            }
            .task(id: selectedId) {
                // Scroll once the sheet has finished resizing (a row tap also lowers it), so the
                // two motions don't run at the same time. Cancelled if the selection changes again.
                guard let id = selectedId, shown.contains(where: { $0.id == id }) else { return }
                try? await Task.sleep(for: .milliseconds(450))
                guard !Task.isCancelled else { return }
                withAnimation(SR.Motion.standard(reduceMotion: reduceMotion)) { proxy.scrollTo(id, anchor: .top) }
            }
        }
        .srPageBackground()
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: SR.Space.xs) {
            Text("Nearby Hazards")
                .font(SR.Font.greeting)
                .foregroundStyle(SR.Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text(NearbyHazardList.subtitle(count: items.count, hasLocation: hasLocation, radiusMeters: radiusMeters))
                .font(SR.Font.secondary)
                .foregroundStyle(SR.Palette.textSecondary)
        }
    }

    // MARK: Filters

    private var filterRow: some View {
        let counts = NearbyHazardList.counts(items)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: SR.Space.xs) {
                ForEach(NearbyHazardList.SeverityFilter.allCases, id: \.self) { option in
                    SRFilterChip(title: option.title,
                                 count: option.severity.flatMap { counts[$0] },
                                 isSelected: severity == option) { severity = option }
                }
                let types = NearbyHazardList.typesPresent(items)
                if types.count > 1 {
                    Divider().frame(height: 24).padding(.horizontal, SR.Space.xxs)
                    ForEach(types) { option in
                        SRFilterChip(title: option.displayName, systemImage: option.symbolName,
                                     isSelected: type == option) { type = type == option ? nil : option }
                    }
                }
            }
        }
        .scrollClipDisabled()
    }

    private var listHeader: some View {
        HStack {
            Text("Hazards")
                .font(SR.Font.cardTitle)
                .foregroundStyle(SR.Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            Menu {
                Picker("Sort", selection: $sort) {
                    ForEach(NearbyHazardList.Sort.allCases) { option in
                        Text(option.rawValue).tag(option)
                    }
                }
            } label: {
                HStack(spacing: SR.Space.xxs) {
                    Text("Sort: \(sort.rawValue)")
                    Image(systemName: "chevron.down").imageScale(.small)
                }
                .font(SR.Font.secondary.weight(.medium))
                .foregroundStyle(SR.Palette.navy)
                .frame(minHeight: SR.Layout.minTouchTarget)
            }
            .accessibilityLabel("Sort, \(sort.rawValue)")
        }
    }

    // MARK: List

    @ViewBuilder
    private var list: some View {
        if shown.isEmpty {
            Text(items.isEmpty ? "No active reports nearby." : "No hazards match these filters.")
                .font(SR.Font.secondary)
                .foregroundStyle(SR.Palette.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(SR.Space.md)
                .srCardSurface(radius: SR.Radius.button)
        } else {
            VStack(spacing: 0) {
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, item in
                    if index > 0 { Divider().padding(.leading, 60) }
                    NearbyHazardRow(item: item, isSelected: item.id == selectedId,
                                    onSelect: { onSelect(item.id) },
                                    onOpenDetails: { onOpenDetails(item.id) })
                        .id(item.id)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: SR.Radius.button, style: .continuous))
            .srCardSurface(radius: SR.Radius.button)
        }
    }
}

// MARK: - Summary card

/// "Nearby Risk": the three counts as big numbers with text labels, and a thin distribution bar.
private struct RiskSummaryCard: View {
    let counts: [Severity: Int]
    private let levels: [Severity] = [.high, .medium, .low]

    var body: some View {
        let total = levels.reduce(0) { $0 + (counts[$1] ?? 0) }
        VStack(alignment: .leading, spacing: SR.Space.sm) {
            Text("Nearby Risk")
                .font(SR.Font.metaStrong)
                .foregroundStyle(SR.Palette.textSecondary)
            HStack(spacing: 0) {
                ForEach(levels, id: \.self) { level in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(counts[level] ?? 0)")
                            .font(SR.Font.metric.monospacedDigit())
                            .foregroundStyle((counts[level] ?? 0) > 0 ? SR.Palette.textPrimary : SR.Palette.textTertiary)
                        SeverityBadge(severity: level, style: .plain)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(counts[level] ?? 0) \(level.shortLabel.lowercased()) severity")
                }
            }
            SeverityBar(counts: counts, levels: levels, total: total)
        }
        .padding(SR.Space.md)
        .srCardSurface(radius: SR.Radius.button)
    }
}

private struct SeverityBar: View {
    let counts: [Severity: Int]
    let levels: [Severity]
    let total: Int

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 2) {
                if total == 0 {
                    Capsule().fill(SR.Palette.fill)
                } else {
                    ForEach(levels, id: \.self) { level in
                        let count = counts[level] ?? 0
                        if count > 0 {
                            Rectangle()
                                .fill(level.color)
                                .frame(width: max(4, (geo.size.width - 4) * CGFloat(count) / CGFloat(total)))
                        }
                    }
                }
            }
            .clipShape(Capsule())
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

// MARK: - Row

private struct NearbyHazardRow: View {
    let item: NearbyHazardList.Item
    let isSelected: Bool
    let onSelect: () -> Void
    let onOpenDetails: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    private var hazard: Hazard { item.hazard }
    private var isHigh: Bool { hazard.severity == .high }
    private var isStale: Bool { NearbyHazardList.isPossiblyOutdated(hazard) }

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onSelect) {
                HStack(alignment: .top, spacing: SR.Space.sm) {
                    CategoryIcon(type: hazard.type, emphasized: isHigh)
                    VStack(alignment: .leading, spacing: SR.Space.xxs) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(hazard.type.displayName)
                                .font(SR.Font.body.weight(.semibold))
                                .foregroundStyle(SR.Palette.textPrimary)
                            Spacer(minLength: SR.Space.xs)
                            if let distance = item.distance {
                                Text(Format.distance(distance))
                                    .font(SR.Font.secondary.weight(.medium).monospacedDigit())
                                    .foregroundStyle(SR.Palette.textPrimary)
                            }
                        }
                        // One line normally; stacked at accessibility text sizes instead of wrapping.
                        let metaLayout = typeSize.isAccessibilitySize
                            ? AnyLayout(VStackLayout(alignment: .leading, spacing: SR.Space.xxs))
                            : AnyLayout(HStackLayout(spacing: SR.Space.xs))
                        metaLayout {
                            SeverityBadge(severity: hazard.severity, style: .filled)
                            Text(Format.relative(hazard.createdAt))
                                .font(SR.Font.secondary)
                                .foregroundStyle(SR.Palette.textSecondary)
                            if !typeSize.isAccessibilitySize { Spacer(minLength: 0) }
                            if let distance = item.distance, let walk = NearbyHazardList.walkingTime(distance) {
                                Text(walk)
                                    .font(SR.Font.meta)
                                    .foregroundStyle(SR.Palette.textTertiary)
                                    .lineLimit(1)
                            }
                        }
                        HStack(spacing: SR.Space.xxs) {
                            Image(systemName: hazard.status == .verified ? "checkmark.seal.fill" : "person.2.fill")
                                .imageScale(.small)
                            Text(NearbyHazardList.trust(hazard))
                            if isStale {
                                Text("· Possibly outdated")
                            }
                        }
                        .font(SR.Font.meta)
                        .foregroundStyle(SR.Palette.textSecondary)
                    }
                }
                .padding(.vertical, SR.Space.sm)
                .padding(.leading, SR.Space.sm)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityText)
            .accessibilityHint("Shows it on the map")
            .accessibilityAddTraits(isSelected ? .isSelected : [])

            Button(action: onOpenDetails) {
                Image(systemName: "chevron.right")
                    .font(SR.Font.meta.weight(.semibold))
                    .foregroundStyle(SR.Palette.textTertiary)
                    .frame(width: SR.Layout.minTouchTarget, height: SR.Layout.minTouchTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Details for \(hazard.type.displayName)")
        }
        .opacity(isStale ? 0.6 : 1)
        .background(rowBackground)
        .overlay(alignment: .leading) {
            // Thin severity edge: high severity stands out without turning the whole row red.
            if isHigh || isSelected {
                Rectangle()
                    .fill(isSelected ? SR.Palette.navy : SR.Palette.critical)
                    .frame(width: 3)
            }
        }
    }

    private var rowBackground: Color {
        if isSelected { return SR.Palette.navyTint }
        if isHigh { return SR.Palette.critical.opacity(0.06) }
        return .clear
    }

    private var accessibilityText: String {
        var parts = [hazard.type.displayName, hazard.severity.label]
        if let distance = item.distance { parts.append("\(Format.distance(distance)) away") }
        parts.append("reported \(Format.relativeInSentence(hazard.createdAt))")
        parts.append(NearbyHazardList.trust(hazard))
        if isStale { parts.append("possibly outdated") }
        return parts.joined(separator: ", ")
    }
}

/// Category glyph in SafeRoute navy — type only. Severity is shown separately by the badge, so
/// orange never means "construction". High severity gets a red-tinted well for emphasis.
private struct CategoryIcon: View {
    let type: HazardType
    let emphasized: Bool

    var body: some View {
        Image(systemName: type.symbolName)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(emphasized ? SR.Palette.critical : SR.Palette.navy)
            .frame(width: 36, height: 36)
            .background(emphasized ? SR.Palette.critical.opacity(0.12) : SR.Palette.navyTint,
                        in: RoundedRectangle(cornerRadius: SR.Radius.control, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// Severity as text plus an icon, never color alone: "⚠︎ HIGH".
struct SeverityBadge: View {
    enum Style { case filled, plain }
    let severity: Severity
    var style: Style = .filled

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: severity == .high ? "exclamationmark.triangle.fill" : "circle.fill")
                .font(.system(size: severity == .high ? 10 : 7, weight: .bold))
                .foregroundStyle(severity.color)
            Text(severity.shortLabel.uppercased())
                .font(SR.Font.metaStrong)
                .foregroundStyle(SR.Palette.textPrimary)
        }
        .fixedSize()
        .padding(.horizontal, style == .filled ? 6 : 0)
        .padding(.vertical, style == .filled ? 2 : 0)
        .background {
            if style == .filled { Capsule().fill(severity.color.opacity(0.14)) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(severity.label)
    }
}
