import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var appState: AppState
    @State private var profile: Profile?
    @State private var loadState: LoadState = .idle
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            SRScrollPage {
                SRPageHeader("Profile", subtitle: "Your activity and preferences")

                if let profile {
                    identityCard(profile)
                    section("Your impact") {
                        SRCard(padding: SR.Space.md) {
                            SRMetricRow(title: "Reports submitted", value: "\(profile.stats.reportsSubmitted)", systemImage: "square.and.pencil")
                            Divider()
                            SRMetricRow(title: "Reports verified", value: "\(profile.stats.reportsVerified)", systemImage: "checkmark.seal")
                            Divider()
                            SRMetricRow(title: "Community confirmations", value: "\(profile.stats.communityConfirmations)", systemImage: "hand.thumbsup")
                            Divider()
                            SRMetricRow(title: "Disputes", value: "\(profile.stats.disputesFiled)", systemImage: "hand.thumbsdown")
                        }
                    }
                    section("Recent activity") { activity(profile) }
                } else if let error = loadState.errorMessage {
                    SREmptyState(systemImage: "wifi.exclamationmark", title: "Couldn't load your profile", message: error) {
                        Button("Try again") { Task { await load() } }.buttonStyle(.srSecondary)
                    }
                } else {
                    SRCard { HStack { ProgressView(); Text("Loading profile…").foregroundStyle(SR.Palette.textSecondary) } }
                }

                section("Settings") { settings }

                Text("Other commuters see your trust level, never your name or email. Photos are stored without location data.")
                    .font(SR.Font.meta)
                    .foregroundStyle(SR.Palette.textTertiary)
            }
            .refreshable { await load() }
            .task { await load() }
            .toolbar(.hidden, for: .navigationBar)
            .confirmationDialog("Sign out of SafeRoute?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { appState.signOut() }
            }
        }
    }

    // MARK: Identity

    private func identityCard(_ profile: Profile) -> some View {
        let progress = TierProgress(score: profile.reputationScore, level: profile.trustLevel)
        return SRCard {
            HStack(spacing: SR.Space.md) {
                SRProfileAvatar(name: profile.displayName, size: 60)
                VStack(alignment: .leading, spacing: SR.Space.xxs) {
                    Text(profile.displayName).font(SR.Font.cardTitle).foregroundStyle(SR.Palette.textPrimary)
                    Label(profile.trustLevel.label, systemImage: profile.trustLevel.symbolName)
                        .font(SR.Font.secondary)
                        .foregroundStyle(SR.Palette.navy)
                    if profile.role != "USER" {
                        Text(profile.role == "MUNICIPAL_OFFICIAL" ? "Municipal official" : "Moderator")
                            .font(SR.Font.metaStrong)
                            .foregroundStyle(SR.Palette.navy)
                            .padding(.horizontal, SR.Space.xs)
                            .padding(.vertical, 2)
                            .background(SR.Palette.navyTint, in: Capsule())
                    }
                }
            }
            .accessibilityElement(children: .combine)

            VStack(alignment: .leading, spacing: SR.Space.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text("\(profile.reputationScore) pts").font(SR.Font.cardTitle.monospacedDigit()).foregroundStyle(SR.Palette.textPrimary)
                    Spacer()
                    Text(progress.caption).font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
                }
                ProgressView(value: progress.fraction)
                    .tint(SR.Palette.navy)
                    .accessibilityLabel("Progress to next level")
                    .accessibilityValue(progress.caption)
            }
            .padding(.top, SR.Space.xs)
        }
    }

    @ViewBuilder
    private func activity(_ profile: Profile) -> some View {
        if profile.recentActivity.isEmpty {
            SRCard {
                Text("No recent activity yet").font(SR.Font.body).foregroundStyle(SR.Palette.textPrimary)
                Text("Earn points when your reports are verified and when you confirm hazards others report.")
                    .font(SR.Font.secondary).foregroundStyle(SR.Palette.textSecondary)
            }
        } else {
            SRCard(padding: SR.Space.md) {
                ForEach(Array(profile.recentActivity.enumerated()), id: \.element.id) { index, activity in
                    if index > 0 { Divider() }
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(activity.title).font(SR.Font.body).foregroundStyle(SR.Palette.textPrimary)
                            Text(Format.relative(activity.at)).font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
                        }
                        Spacer()
                        Text(activity.delta >= 0 ? "+\(activity.delta)" : "\(activity.delta)")
                            .font(SR.Font.cardTitle.monospacedDigit())
                            .foregroundStyle(activity.delta >= 0 ? SR.Palette.safe : SR.Palette.critical)
                    }
                    .frame(minHeight: SR.Layout.minTouchTarget)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(activity.title), \(activity.delta) points")
                }
            }
        }
    }

    // MARK: Settings — one flat grouped container

    private var settings: some View {
        SRCard(padding: SR.Space.md) {
            NavigationLink { NotificationPreferencesView() } label: {
                SRListRow(title: "Notifications", systemImage: "bell.badge")
            }
            Divider()
            NavigationLink { ServiceAreaView(coverage: appState.meta.coverage) } label: {
                SRListRow(title: "Service area", value: appState.meta.coverage?.enabled == true ? "Metro Manila" : nil, systemImage: "mappin.and.ellipse")
            }
            Divider()
            NavigationLink { AccountView(user: appState.currentUser, profile: profile) } label: {
                SRListRow(title: "Account", value: appState.currentUser?.email, systemImage: "person.text.rectangle")
            }
            Divider()
            Button { confirmSignOut = true } label: {
                SRListRow(title: "Sign out", systemImage: "rectangle.portrait.and.arrow.right", tint: SR.Palette.critical, showsChevron: false)
            }
        }
        .buttonStyle(.plain)
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: SR.Space.sectionTitleToCard) {
            SRSectionHeader(title: title)
            content()
        }
    }

    private func load() async {
        if profile == nil { loadState = .loading }
        do {
            profile = try await APIClient.shared.send(.profile, as: Profile.self)
            loadState = .loaded
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }
}

/// Progress toward the next trust tier (thresholds mirror the backend's TrustLevel: 10 and 50).
private struct TierProgress {
    let fraction: Double
    let caption: String

    init(score: Int, level: TrustLevel) {
        switch level {
        case .trustedReporter:
            fraction = 1
            caption = "Highest level reached"
        case .regularReporter:
            fraction = Double(score - 10) / 40
            caption = "\(max(0, 50 - score)) until Trusted Reporter"
        default:
            fraction = Double(max(0, score)) / 10
            caption = "\(max(0, 10 - score)) until Regular Reporter"
        }
    }
}

struct ServiceAreaView: View {
    let coverage: CoverageArea?

    var body: some View {
        SRScrollPage {
            SRCard {
                Image(systemName: "mappin.and.ellipse")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(SR.Palette.navy)
                    .frame(width: 56, height: 56)
                    .background(SR.Palette.navyTint, in: Circle())
                    .accessibilityHidden(true)
                Text(coverage?.enabled == false ? "Available everywhere" : "Metro Manila pilot")
                    .font(SR.Font.cardTitle)
                    .foregroundStyle(SR.Palette.textPrimary)
                Text(coverage?.enabled == false
                     ? "This test server accepts hazard reports anywhere."
                     : "SafeRoute currently accepts hazard reports inside the \(coverage?.name ?? "Metro Manila pilot area"). You can still view hazards and plan routes anywhere the map loads.")
                    .font(SR.Font.body)
                    .foregroundStyle(SR.Palette.textSecondary)
            }
            .padding(.top, SR.Space.md)
        }
        .navigationTitle("Service area")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct AccountView: View {
    let user: CurrentUser?
    let profile: Profile?

    var body: some View {
        SRScrollPage {
            SRCard(padding: SR.Space.md) {
                SRListRow(title: "Name", value: profile?.displayName ?? user?.displayName, showsChevron: false)
                Divider()
                SRListRow(title: "Email", value: user?.email, showsChevron: false)
                Divider()
                SRListRow(title: "Role", value: roleLabel, showsChevron: false)
            }
            .padding(.top, SR.Space.md)
        }
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var roleLabel: String {
        switch profile?.role ?? user?.role {
        case "MODERATOR": return "Moderator"
        case "MUNICIPAL_OFFICIAL": return "Municipal official"
        default: return "Commuter"
        }
    }
}

struct NotificationPreferencesView: View {
    @State private var prefs: NotificationPreferences?
    @State private var errorMessage: String?
    @State private var saveTask: Task<Void, Never>?

    private let radii = [200, 400, 800]

    var body: some View {
        SRScrollPage {
            if let prefs {
                VStack(alignment: .leading, spacing: SR.Space.sectionTitleToCard) {
                    SRSectionHeader(title: "Alert me for")
                    SRCard {
                        FlowLayout {
                            ForEach(HazardType.reportable) { type in
                                SRFilterChip(title: type.displayName, systemImage: type.symbolName,
                                             isSelected: prefs.enabledTypes.contains(type)) {
                                    update { if $0.enabledTypes.contains(type) { $0.enabledTypes.remove(type) } else { $0.enabledTypes.insert(type) } }
                                }
                            }
                        }
                    }
                }
                VStack(alignment: .leading, spacing: SR.Space.sectionTitleToCard) {
                    SRSectionHeader(title: "Alert distance")
                    SRCard {
                        HStack(spacing: SR.Space.xs) {
                            ForEach(radii, id: \.self) { r in
                                SRFilterChip(title: "\(r) m", isSelected: prefs.radiusMeters == r) { update { $0.radiusMeters = r } }
                            }
                        }
                        Text("While you're following a route, you're alerted about hazards ahead on it regardless of distance.")
                            .font(SR.Font.meta)
                            .foregroundStyle(SR.Palette.textSecondary)
                    }
                }
            } else if let errorMessage {
                SREmptyState(systemImage: "exclamationmark.triangle", title: "Couldn't load preferences", message: errorMessage)
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(SR.Space.xxl)
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do {
                prefs = try await APIClient.shared.send(.notificationPreferences, as: NotificationPreferences.self)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func update(_ change: (inout NotificationPreferences) -> Void) {
        guard var current = prefs else { return }
        change(&current)
        prefs = current
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            do {
                _ = try await APIClient.shared.send(.updateNotificationPreferences(current), as: NotificationPreferences.self)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
