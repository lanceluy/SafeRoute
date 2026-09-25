import SwiftUI
import UIKit

/// The single source of SafeRoute's visual tokens. Screens must use these instead of one-off
/// colors, paddings or radii.
enum SR {

    // MARK: Colors

    /// Cool, navy-tinted neutrals + one brand accent. Dark-mode values are derived equivalents
    /// (the review specifies light values only).
    enum Palette {
        /// Page background (level 0).
        static let background = dynamic(light: 0xF3F6FA, dark: 0x0E1522)
        /// Opaque cards (level 1).
        static let surface = dynamic(light: 0xFFFFFF, dark: 0x172031)
        /// Subtle fills inside cards (icon wells, unselected chips).
        static let fill = dynamic(light: 0xEEF2F7, dark: 0x222D40)
        static let border = dynamic(light: 0xE5EAF1, dark: 0x2A3548)
        static let textPrimary = dynamic(light: 0x172033, dark: 0xE8EDF5)
        static let textSecondary = dynamic(light: 0x667085, dark: 0x98A2B3)
        static let textTertiary = dynamic(light: 0x98A2B3, dark: 0x667085)

        /// SafeRoute brand. Use sparingly: selected tab, primary buttons, links, active chips,
        /// avatar accents, route highlights.
        static let navy = dynamic(light: 0x173B67, dark: 0x8DB4E6)
        /// Text/icons placed *on* a navy fill.
        static let onNavy = dynamic(light: 0xFFFFFF, dark: 0x0E1522)
        static let navyTint = navy.opacity(0.10)

        // Semantic — meaning, not brand.
        static let critical = Color(uiColor: .systemRed)
        static let warning = Color(uiColor: .systemOrange)
        static let caution = dynamic(light: 0xC99700, dark: 0xF5C542)
        static let safe = Color(uiColor: .systemGreen)

        static var navyUI: UIColor { UIColor(navy) }

        static func dynamic(light: UInt32, dark: UInt32) -> Color {
            Color(uiColor: UIColor { traits in
                UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
            })
        }
    }

    // MARK: Spacing (4-pt scale — never use values outside it)

    enum Space {
        static let xxs: CGFloat = 4
        static let xs: CGFloat = 8
        static let sm: CGFloat = 12
        static let md: CGFloat = 16
        static let lg: CGFloat = 20
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
        static let xxxl: CGFloat = 40

        static let screenMargin: CGFloat = lg
        static let cardPadding: CGFloat = lg
        static let betweenCards: CGFloat = sm
        static let sectionTitleToCard: CGFloat = sm
        static let betweenSections: CGFloat = xxl
    }

    // MARK: Corner radii

    enum Radius {
        static let control: CGFloat = 12
        static let button: CGFloat = 16
        static let card: CGFloat = 20
        static let floating: CGFloat = 24
        static let tabBar: CGFloat = 28
    }

    // MARK: Elevation

    enum Elevation {
        case page, card, floating
    }

    // MARK: Typography — mapped onto Dynamic Type styles so accessibility sizes still scale.

    enum Font {
        /// 28 pt bold.
        static let pageTitle = SwiftUI.Font.system(.title, design: .default, weight: .bold)
        /// 17–20 pt semibold (map greeting).
        static let greeting = SwiftUI.Font.system(.title3, design: .default, weight: .semibold)
        /// 17 pt semibold.
        static let cardTitle = SwiftUI.Font.system(.headline, design: .default, weight: .semibold)
        /// 16 pt.
        static let body = SwiftUI.Font.system(.callout)
        /// 15 pt.
        static let secondary = SwiftUI.Font.system(.subheadline)
        /// 12 pt.
        static let meta = SwiftUI.Font.system(.caption)
        static let metaStrong = SwiftUI.Font.system(.caption, design: .default, weight: .semibold)
        /// 17 pt semibold.
        static let button = SwiftUI.Font.system(.headline, design: .default, weight: .semibold)
        /// Large numbers in data cards.
        static let metric = SwiftUI.Font.system(.title2, design: .rounded, weight: .semibold)
        static let tabLabel = SwiftUI.Font.system(.caption2, design: .default, weight: .medium)
    }

    // MARK: Layout constants

    enum Layout {
        static let minTouchTarget: CGFloat = 44
        static let buttonHeight: CGFloat = 52
        static let tabBarHeight: CGFloat = 64
        /// Space reserved under tab content for the floating navigation bar.
        static let tabBarClearance: CGFloat = 76
    }

    // MARK: Motion

    enum Motion {
        static let standard = Animation.spring(duration: 0.35, bounce: 0.15)

        /// nil when Reduce Motion is on.
        static func standard(reduceMotion: Bool) -> Animation? {
            reduceMotion ? nil : standard
        }
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255,
                  green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255,
                  alpha: 1)
    }
}

// MARK: - Elevation modifiers

extension View {
    /// Level 1: opaque white card, thin border, very soft shadow (y 2, blur 12, ~5%).
    func srCardSurface(radius: CGFloat = SR.Radius.card) -> some View {
        background(SR.Palette.surface, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(SR.Palette.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    /// Level 2: glass for floating layers only — map controls, nav bar, previews
    /// (ultra-thin material + white 40% + white 55% border, shadow y 6, blur 24, ~10%).
    func srGlassSurface(radius: CGFloat = SR.Radius.floating) -> some View {
        modifier(GlassSurface(radius: radius))
    }

    /// Soft page background (level 0), extended under the safe areas.
    func srPageBackground() -> some View {
        background(SR.Palette.background.ignoresSafeArea())
    }
}

private struct GlassSurface: ViewModifier {
    let radius: CGFloat
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background {
                shape.fill(.ultraThinMaterial)
                    .overlay(shape.fill(Color.white.opacity(colorScheme == .dark ? 0.04 : 0.40)))
            }
            .overlay(shape.strokeBorder(Color.white.opacity(colorScheme == .dark ? 0.10 : 0.55), lineWidth: 1))
            .shadow(color: Color(red: 0.09, green: 0.23, blue: 0.40).opacity(colorScheme == .dark ? 0.35 : 0.10), radius: 12, y: 6)
    }
}
