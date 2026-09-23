import SwiftUI

/// Floating glass tab bar (UI review §10, §31): selected tab gets a soft navy tint, the rest are
/// charcoal. Replaces the system tab bar so the look is identical on iOS 17 and iOS 26.
struct SRBottomNavigation: View {
    struct Item: Identifiable {
        let tab: AppState.Tab
        let title: String
        let systemImage: String
        var badge: Int = 0
        var id: AppState.Tab { tab }
    }

    @Binding var selection: AppState.Tab
    let items: [Item]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: SR.Space.xxs) {
            ForEach(items) { item in
                let selected = item.tab == selection
                Button {
                    withAnimation(SR.Motion.standard(reduceMotion: reduceMotion)) { selection = item.tab }
                } label: {
                    VStack(spacing: 2) {
                        Image(systemName: selected ? item.systemImage + ".fill" : item.systemImage)
                            .font(.system(size: 20, weight: .medium))
                            .frame(height: 24)
                            .overlay(alignment: .topTrailing) {
                                if item.badge > 0 {
                                    Text(item.badge > 99 ? "99+" : "\(item.badge)")
                                        .font(.system(size: 10, weight: .bold).monospacedDigit())
                                        .foregroundStyle(.white)
                                        .padding(.horizontal, 4)
                                        .frame(minWidth: 16, minHeight: 16)
                                        .background(SR.Palette.critical, in: Capsule())
                                        .offset(x: 10, y: -4)
                                }
                            }
                        Text(item.title).font(SR.Font.tabLabel)
                    }
                    .foregroundStyle(selected ? SR.Palette.navy : SR.Palette.textPrimary.opacity(0.75))
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background {
                        if selected {
                            RoundedRectangle(cornerRadius: SR.Radius.card, style: .continuous).fill(SR.Palette.navyTint)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                // Like the system tab bar: labels stay compact; long-press shows them enlarged.
                .accessibilityShowsLargeContentViewer {
                    Label(item.title, systemImage: item.systemImage)
                }
                .accessibilityLabel(item.badge > 0 ? "\(item.title), \(item.badge) new" : item.title)
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(SR.Space.xs)
        .dynamicTypeSize(...DynamicTypeSize.large)
        .srGlassSurface(radius: SR.Radius.tabBar)
        .padding(.horizontal, SR.Space.screenMargin)
        .padding(.bottom, SR.Space.xxs)
    }
}
