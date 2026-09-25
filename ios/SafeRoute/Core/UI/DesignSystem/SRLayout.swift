import SwiftUI

/// Page title + subtitle placed at the top of scrolling content (Reports, Alerts, Profile).
/// The Map uses its personalized greeting instead.
struct SRPageHeader<Accessory: View>: View {
    let title: String
    let subtitle: String?
    @ViewBuilder var accessory: () -> Accessory

    init(_ title: String, subtitle: String? = nil, @ViewBuilder accessory: @escaping () -> Accessory = { EmptyView() }) {
        self.title = title
        self.subtitle = subtitle
        self.accessory = accessory
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: SR.Space.sm) {
            VStack(alignment: .leading, spacing: SR.Space.xxs) {
                Text(title)
                    .font(SR.Font.pageTitle)
                    .foregroundStyle(SR.Palette.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle {
                    Text(subtitle)
                        .font(SR.Font.secondary)
                        .foregroundStyle(SR.Palette.textSecondary)
                }
            }
            Spacer(minLength: 0)
            accessory()
        }
        .padding(.top, SR.Space.xs)
    }
}

struct SRSectionHeader: View {
    let title: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack {
            Text(title)
                .font(SR.Font.cardTitle)
                .foregroundStyle(SR.Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(SR.Font.secondary.weight(.medium))
                    .foregroundStyle(SR.Palette.navy)
                    .frame(minHeight: SR.Layout.minTouchTarget)
            }
        }
    }
}

/// Level-1 opaque content card.
struct SRCard<Content: View>: View {
    var padding: CGFloat = SR.Space.cardPadding
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: SR.Space.sm) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .srCardSurface()
    }
}

/// Level-2 glass card — floating layers only (map controls, previews, route card).
struct SRGlassCard<Content: View>: View {
    var padding: CGFloat = SR.Space.md
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: SR.Space.sm) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .srGlassSurface()
    }
}

/// Standard scrolling page: soft background, 20 pt margins, room for the floating tab bar.
struct SRScrollPage<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SR.Space.xl) { content() }
                .padding(.horizontal, SR.Space.screenMargin)
                .padding(.bottom, SR.Space.xxl)
        }
        .srPageBackground()
    }
}

/// Wraps chips onto multiple lines (filter sheet, preferences).
struct FlowLayout: Layout {
    var spacing: CGFloat = SR.Space.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(proposal: proposal, subviews: subviews)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(proposal: ProposedViewSize(width: bounds.width, height: nil), subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> [Row] {
        let maxWidth = proposal.width ?? .infinity
        var rows: [Row] = [Row()]
        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(.unspecified)
            if !rows[rows.count - 1].indices.isEmpty, rows[rows.count - 1].width + spacing + size.width > maxWidth {
                rows.append(Row())
            }
            var row = rows[rows.count - 1]
            row.width += (row.indices.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
            rows[rows.count - 1] = row
        }
        return rows
    }
}
