import SwiftUI

/// Nearby Hazards: a severity summary, filters, and the list, tied to the map.
///
/// First tap on a row selects it (map centers, pin enlarges, row expands). Tapping the selected
/// row again, or "View details", opens a preview in the same sheet; "View full details" there
/// opens the full hazard screen.
struct NearbyHazardsSheet: View {
    let items: [NearbyHazardList.Item]
    let hasLocation: Bool
    let radiusMeters: Double
    /// The hazard selected on the map (from a row or a pin).
    let selectedId: UUID?
    /// For the preview's live data and its confirm / dispute actions.
    @ObservedObject var map: MapViewModel
    /// The hazard shown in the preview (pushed over the list), owned by the parent so it resets
    /// when the sheet closes.
    @Binding var previewId: UUID?
    let onSelect: (UUID) -> Void
    /// The preview opened; the parent raises the sheet so it has room.
    let onPreview: (UUID) -> Void
    let onOpenFullDetails: (UUID) -> Void

    @State private var severity: NearbyHazardList.SeverityFilter = .all
    @State private var type: HazardType?
    @State private var sort: NearbyHazardList.Sort = .nearest
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var shown: [NearbyHazardList.Item] {
        NearbyHazardList.apply(items, severity: severity, type: type, sort: sort)
    }

    var body: some View {
        VStack(spacing: 0) {
            DragHandle()
            NavigationStack {
                list
                    .toolbar(.hidden, for: .navigationBar)
                    .navigationDestination(item: $previewId) { id in
                        HazardPreviewView(hazardId: id,
                                          distance: items.first { $0.id == id }?.distance,
                                          map: map,
                                          onOpenFullDetails: { onOpenFullDetails(id) })
                    }
            }
        }
        .srPageBackground()
    }

    private func openPreview(_ id: UUID) {
        previewId = id
        onPreview(id)
    }

    // MARK: List screen

    private var list: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                        .padding(.top, SR.Space.lg)
                    RiskSummaryCard(counts: NearbyHazardList.counts(items))
                        .padding(.top, SR.Space.lg)
                    filterRow
                        .padding(.top, SR.Space.xl)
                    listHeader
                        .padding(.top, SR.Space.md)
                    rows
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
                withAnimation(SR.Motion.standard(reduceMotion: reduceMotion)) {
                    proxy.scrollTo(id, anchor: UnitPoint(x: 0.5, y: 0.04))
                }
            }
        }
        .srPageBackground()
    }

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

    @ViewBuilder
    private var rows: some View {
        if shown.isEmpty {
            Text(items.isEmpty ? "No active reports nearby." : "No hazards match these filters.")
                .font(SR.Font.secondary)
                .foregroundStyle(SR.Palette.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(SR.Space.md)
                .srCardSurface(radius: SR.Radius.button)
        } else {
            let hasSelection = shown.contains { $0.id == selectedId }
            VStack(spacing: 0) {
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, item in
                    let isSelected = item.id == selectedId
                    if index > 0 {
                        // No divider touching the lifted selected card.
                        Divider().padding(.leading, 56)
                            .opacity(isSelected || shown[index - 1].id == selectedId ? 0 : 1)
                    }
                    NearbyHazardRow(item: item, isSelected: isSelected, isDimmed: hasSelection && !isSelected,
                                    onTap: { isSelected ? openPreview(item.id) : onSelect(item.id) })
                        .id(item.id)
                        .zIndex(isSelected ? 1 : 0)
                }
            }
            .padding(SR.Space.xxs)
            .background(SR.Palette.surface, in: RoundedRectangle(cornerRadius: SR.Radius.button, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: SR.Radius.button, style: .continuous).strokeBorder(SR.Palette.border, lineWidth: 1))
        }
    }
}

/// Wider and darker than the system indicator, so it reads as "this panel expands".
private struct DragHandle: View {
    var body: some View {
        Capsule()
            .fill(SR.Palette.textTertiary.opacity(0.6))
            .frame(width: 44, height: 5)
            .padding(.top, SR.Space.xs)
            .padding(.bottom, SR.Space.xxs)
            .frame(maxWidth: .infinity)
            .accessibilityHidden(true)
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

/// Unselected: three compact lines. Selected: a slightly taller, lifted card with confidence,
/// walking time on its own line and a "View details" action.
private struct NearbyHazardRow: View {
    let item: NearbyHazardList.Item
    let isSelected: Bool
    /// Another row is selected: lower this one's contrast a little to strengthen focus.
    let isDimmed: Bool
    let onTap: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    private var hazard: Hazard { item.hazard }
    private var isHigh: Bool { hazard.severity == .high }
    private var isStale: Bool { NearbyHazardList.isPossiblyOutdated(hazard) }
    private var walk: String? { item.distance.flatMap(NearbyHazardList.walkingTime) }

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: SR.Space.sm) {
                CategoryIcon(type: hazard.type)
                VStack(alignment: .leading, spacing: SR.Space.xxs) {
                    titleLine
                    metaLine
                    trustLine
                    if isSelected {
                        if let walk {
                            Label(walk, systemImage: "figure.walk")
                                .font(SR.Font.meta)
                                .foregroundStyle(SR.Palette.textSecondary)
                        }
                        Divider().padding(.vertical, SR.Space.xxs)
                        HStack {
                            Text("View details")
                            Spacer()
                            Image(systemName: "chevron.right")
                        }
                        .font(SR.Font.secondary.weight(.semibold))
                        .foregroundStyle(SR.Palette.navy)
                    }
                }
                if !isSelected {
                    Image(systemName: "chevron.right")
                        .font(SR.Font.meta.weight(.semibold))
                        .foregroundStyle(SR.Palette.textTertiary)
                        .padding(.top, 2)
                        .accessibilityHidden(true)
                }
            }
            .padding(.vertical, isSelected ? SR.Space.md : SR.Space.sm)
            .padding(.leading, SR.Space.sm + 2)
            .padding(.trailing, SR.Space.sm)
            .background(background)
            .overlay(alignment: .leading) { accent }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(opacity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint(isSelected ? "Opens a preview with photo, description and actions" : "Selects it and shows it on the map")
        .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : .isButton)
    }

    private var titleLine: some View {
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
    }

    /// One line normally; stacked at accessibility text sizes instead of wrapping.
    private var metaLine: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: SR.Space.xxs))
            : AnyLayout(HStackLayout(spacing: SR.Space.xs))
        return layout {
            SeverityBadge(severity: hazard.severity, style: .filled)
            Text(Format.ago(hazard.createdAt))
                .font(SR.Font.secondary)
                .foregroundStyle(SR.Palette.textSecondary)
            if !isSelected {
                if !typeSize.isAccessibilitySize { Spacer(minLength: 0) }
                if let walk {
                    // Secondary to the distance above it.
                    Text(walk)
                        .font(SR.Font.meta)
                        .foregroundStyle(SR.Palette.textTertiary)
                        .lineLimit(1)
                }
            }
        }
    }

    private var trustLine: some View {
        HStack(spacing: SR.Space.xxs) {
            Image(systemName: hazard.status == .verified ? "checkmark.seal.fill" : "person.2.fill")
                .imageScale(.small)
            Text(isSelected ? NearbyHazardList.detailedTrust(hazard) : NearbyHazardList.trust(hazard))
            if isStale { Text("· Possibly outdated") }
        }
        .font(SR.Font.meta)
        .foregroundStyle(SR.Palette.textSecondary)
    }

    @ViewBuilder
    private var background: some View {
        let shape = RoundedRectangle(cornerRadius: SR.Radius.control, style: .continuous)
        if isSelected {
            // Lifted, with a very light navy tint rather than a gray fill.
            shape.fill(SR.Palette.surface)
                .overlay(shape.fill(SR.Palette.navy.opacity(0.05)))
                .overlay(shape.strokeBorder(SR.Palette.navy.opacity(0.18), lineWidth: 1))
                .shadow(color: SR.Palette.navy.opacity(0.14), radius: 8, y: 3)
        } else if isHigh {
            // The red accent, badge and pin already say "danger"; the tint only hints at it.
            shape.fill(SR.Palette.critical.opacity(0.03))
        } else {
            Color.clear
        }
    }

    @ViewBuilder
    private var accent: some View {
        if isSelected || isHigh {
            Capsule()
                .fill(isSelected ? SR.Palette.navy : SR.Palette.critical)
                .frame(width: 3)
                .padding(.vertical, SR.Space.xs)
                .padding(.leading, 3)
        }
    }

    private var opacity: Double {
        (isStale ? 0.6 : 1) * (isDimmed ? 0.78 : 1)
    }

    private var accessibilityText: String {
        var parts = [hazard.type.displayName, hazard.severity.label]
        if let distance = item.distance { parts.append("\(Format.distance(distance)) away") }
        if let walk { parts.append(walk) }
        parts.append("reported \(Format.ago(hazard.createdAt).lowercased())")
        parts.append(isSelected ? NearbyHazardList.detailedTrust(hazard) : NearbyHazardList.trust(hazard))
        if isStale { parts.append("possibly outdated") }
        return parts.joined(separator: ", ")
    }
}

/// Category glyph in SafeRoute navy — hazard type only. Severity is carried by the badge and the
/// map marker's color, so category and severity colors never compete.
struct CategoryIcon: View {
    let type: HazardType
    var size: CGFloat = 36

    var body: some View {
        Image(systemName: type.symbolName)
            .font(.system(size: size * 0.44, weight: .semibold))
            .foregroundStyle(SR.Palette.navy)
            .frame(width: size, height: size)
            .background(SR.Palette.navyTint, in: RoundedRectangle(cornerRadius: SR.Radius.control, style: .continuous))
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
