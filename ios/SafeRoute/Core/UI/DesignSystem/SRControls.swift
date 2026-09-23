import SwiftUI

// MARK: Buttons

/// Navy fill, white label. Destructive variant is red — reserved for moderation/destructive actions.
struct SRPrimaryButtonStyle: ButtonStyle {
    var destructive = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(SR.Font.button)
            .frame(maxWidth: .infinity, minHeight: SR.Layout.buttonHeight)
            .padding(.horizontal, SR.Space.md)
            .foregroundStyle(destructive ? Color.white : SR.Palette.onNavy)
            .background(destructive ? SR.Palette.critical : SR.Palette.navy,
                        in: RoundedRectangle(cornerRadius: SR.Radius.button, style: .continuous))
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.45)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

/// Navy-tinted secondary action.
struct SRSecondaryButtonStyle: ButtonStyle {
    var destructive = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let tint = destructive ? SR.Palette.critical : SR.Palette.navy
        configuration.label
            .font(SR.Font.button)
            .frame(maxWidth: .infinity, minHeight: SR.Layout.buttonHeight)
            .padding(.horizontal, SR.Space.md)
            .foregroundStyle(tint)
            .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: SR.Radius.button, style: .continuous))
            .opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.45)
    }
}

extension ButtonStyle where Self == SRPrimaryButtonStyle {
    static var srPrimary: SRPrimaryButtonStyle { SRPrimaryButtonStyle() }
    static var srDestructive: SRPrimaryButtonStyle { SRPrimaryButtonStyle(destructive: true) }
}

extension ButtonStyle where Self == SRSecondaryButtonStyle {
    static var srSecondary: SRSecondaryButtonStyle { SRSecondaryButtonStyle() }
}

// MARK: Chips

struct SRFilterChip: View {
    let title: String
    var count: Int?
    var systemImage: String?
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: SR.Space.xs) {
                if let systemImage { Image(systemName: systemImage).imageScale(.small) }
                Text(title)
                if let count, count > 0 {
                    Text("\(count)")
                        .font(SR.Font.metaStrong.monospacedDigit())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(isSelected ? SR.Palette.onNavy.opacity(0.2) : SR.Palette.navyTint, in: Capsule())
                }
            }
            .font(SR.Font.secondary.weight(.medium))
            .padding(.horizontal, SR.Space.md)
            .frame(minHeight: 36)
            .foregroundStyle(isSelected ? SR.Palette.onNavy : SR.Palette.textPrimary)
            .background(isSelected ? SR.Palette.navy : SR.Palette.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(isSelected ? Color.clear : SR.Palette.border, lineWidth: 1))
            .contentShape(Capsule())
            .padding(.vertical, 4) // 44 pt touch target
        }
        .buttonStyle(.plain)
        .accessibilityLabel(count.map { "\(title), \($0)" } ?? title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: Search field (a button that opens the destination search)

struct SRSearchField: View {
    let placeholder: String
    var value: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: SR.Space.xs) {
                Image(systemName: "magnifyingglass").foregroundStyle(SR.Palette.textSecondary)
                Text(value ?? placeholder)
                    .foregroundStyle(value == nil ? SR.Palette.textSecondary : SR.Palette.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .font(SR.Font.body)
            .padding(.horizontal, SR.Space.md)
            .frame(minHeight: SR.Layout.minTouchTarget + 4)
            .background(SR.Palette.surface.opacity(0.85), in: RoundedRectangle(cornerRadius: SR.Radius.button, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: SR.Radius.button, style: .continuous).strokeBorder(SR.Palette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// MARK: Badges — status is subtle; severity keeps its semantic color (review §36)

struct SRStatusBadge: View {
    let status: HazardStatus

    var body: some View {
        Label(status.label, systemImage: status.symbolName)
            .labelStyle(BadgeLabelStyle())
            .foregroundStyle(status.color)
            .background(status.color.opacity(0.10), in: Capsule())
            .accessibilityLabel("Status: \(status.label)")
    }
}

struct SRSeverityBadge: View {
    let severity: Severity
    var compact = false

    var body: some View {
        Label(compact ? severity.shortLabel : severity.label, systemImage: severity.symbolName)
            .labelStyle(BadgeLabelStyle())
            .foregroundStyle(severity.color)
            .background(severity.color.opacity(0.14), in: Capsule())
            .accessibilityLabel(severity.label)
    }
}

private struct BadgeLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: SR.Space.xxs) {
            configuration.icon.imageScale(.small)
            configuration.title.lineLimit(1)
        }
        .fixedSize()
        .font(SR.Font.metaStrong)
        .padding(.horizontal, SR.Space.xs)
        .padding(.vertical, SR.Space.xxs)
    }
}

// MARK: Rows

/// Title with a trailing badge; stacks vertically at accessibility text sizes so neither the
/// title nor the badge has to hyphenate.
struct SRTitleBadgeRow<Title: View, Badge: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ViewBuilder var title: () -> Title
    @ViewBuilder var badge: () -> Badge

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: SR.Space.xxs) { title(); badge() }
        } else {
            HStack(alignment: .firstTextBaseline) {
                title()
                Spacer(minLength: SR.Space.xs)
                badge()
            }
        }
    }
}

struct SRMetricRow: View {
    let title: String
    let value: String
    var systemImage: String?

    var body: some View {
        HStack(spacing: SR.Space.sm) {
            if let systemImage {
                Image(systemName: systemImage)
                    .foregroundStyle(SR.Palette.navy)
                    .frame(width: 24)
                    .accessibilityHidden(true)
            }
            Text(title).font(SR.Font.body).foregroundStyle(SR.Palette.textPrimary)
            Spacer()
            Text(value).font(SR.Font.cardTitle.monospacedDigit()).foregroundStyle(SR.Palette.textPrimary)
        }
        .frame(minHeight: SR.Layout.minTouchTarget)
        .accessibilityElement(children: .combine)
    }
}

/// A settings-style navigation row for flat grouped lists.
struct SRListRow: View {
    let title: String
    var value: String?
    var systemImage: String?
    var tint: Color = SR.Palette.textPrimary
    var showsChevron = true

    var body: some View {
        HStack(spacing: SR.Space.sm) {
            if let systemImage {
                Image(systemName: systemImage)
                    .foregroundStyle(tint == SR.Palette.textPrimary ? SR.Palette.navy : tint)
                    .frame(width: 24)
                    .accessibilityHidden(true)
            }
            Text(title).font(SR.Font.body).foregroundStyle(tint)
            Spacer()
            if let value { Text(value).font(SR.Font.secondary).foregroundStyle(SR.Palette.textSecondary).lineLimit(1) }
            if showsChevron {
                Image(systemName: "chevron.right").font(SR.Font.meta.weight(.semibold)).foregroundStyle(SR.Palette.textTertiary)
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: SR.Layout.minTouchTarget + 4)
        .contentShape(Rectangle())
    }
}

// MARK: Empty state — a soft card placed in the upper part of the page (review §15)

struct SREmptyState<Actions: View>: View {
    let systemImage: String
    let title: String
    let message: String
    @ViewBuilder var actions: () -> Actions

    init(systemImage: String, title: String, message: String, @ViewBuilder actions: @escaping () -> Actions = { EmptyView() }) {
        self.systemImage = systemImage
        self.title = title
        self.message = message
        self.actions = actions
    }

    var body: some View {
        VStack(spacing: SR.Space.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(SR.Palette.navy)
                .frame(width: 56, height: 56)
                .background(SR.Palette.navyTint, in: Circle())
                .accessibilityHidden(true)
            Text(title)
                .font(SR.Font.cardTitle)
                .foregroundStyle(SR.Palette.textPrimary)
            Text(message)
                .font(SR.Font.secondary)
                .foregroundStyle(SR.Palette.textSecondary)
                .multilineTextAlignment(.center)
            actions()
                .padding(.top, SR.Space.xs)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, SR.Space.xxl)
        .padding(.horizontal, SR.Space.lg)
        .srCardSurface()
        .accessibilityElement(children: .contain)
    }
}

// MARK: Avatar

struct SRProfileAvatar: View {
    let name: String
    var size: CGFloat = 56

    var body: some View {
        Text(Self.initials(from: name))
            .font(.system(size: size * 0.36, weight: .semibold, design: .rounded))
            .foregroundStyle(SR.Palette.navy)
            .frame(width: size, height: size)
            .background(SR.Palette.navyTint, in: Circle())
            .overlay(Circle().strokeBorder(SR.Palette.navy.opacity(0.25), lineWidth: 1))
            .accessibilityHidden(true)
    }

    static func initials(from name: String) -> String {
        let parts = name.split(whereSeparator: { $0 == " " || $0 == "." || $0 == "_" }).prefix(2)
        let letters = parts.compactMap(\.first).map { String($0).uppercased() }.joined()
        return letters.isEmpty ? "?" : (letters.count == 1 ? String(name.prefix(2)).uppercased() : letters)
    }
}

// MARK: Hazard glyph

/// Type glyph on a severity-colored disc. Always paired with text so type/severity are never
/// conveyed by color alone.
struct HazardIcon: View {
    let type: HazardType
    let severity: Severity
    var size: CGFloat = 36

    var body: some View {
        Image(systemName: type.symbolName)
            .font(.system(size: size * 0.46, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(severity.color, in: Circle())
            .accessibilityHidden(true)
    }
}

// MARK: Banners & toasts

/// Slim glass banner for connection / loading / failure states over the map.
struct StateBanner: View {
    let text: String
    let systemImage: String
    var tint: Color = SR.Palette.textSecondary
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(spacing: SR.Space.xs) {
            Image(systemName: systemImage).foregroundStyle(tint)
            Text(text).font(SR.Font.secondary).foregroundStyle(SR.Palette.textPrimary)
            Spacer(minLength: 0)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(SR.Font.secondary.weight(.semibold))
                    .foregroundStyle(SR.Palette.navy)
                    .frame(minHeight: SR.Layout.minTouchTarget)
            }
        }
        .padding(.horizontal, SR.Space.md)
        .frame(minHeight: SR.Layout.minTouchTarget)
        .srGlassSurface(radius: SR.Radius.button)
        .accessibilityElement(children: .combine)
    }
}

struct ToastView: View {
    let toast: Toast

    var body: some View {
        HStack(spacing: SR.Space.sm) {
            Image(systemName: toast.systemImage)
                .foregroundStyle(tint)
                .font(SR.Font.cardTitle)
            Text(toast.message)
                .font(SR.Font.secondary.weight(.medium))
                .foregroundStyle(SR.Palette.textPrimary)
            Spacer(minLength: 0)
        }
        .padding(SR.Space.md)
        .srGlassSurface(radius: SR.Radius.button)
        .padding(.horizontal, SR.Space.screenMargin)
        .accessibilityElement(children: .combine)
    }

    private var tint: Color {
        switch toast.style {
        case .info: return SR.Palette.navy
        case .success: return SR.Palette.safe
        case .warning: return SR.Palette.warning
        case .error: return SR.Palette.critical
        }
    }
}
