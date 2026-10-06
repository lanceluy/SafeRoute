import SwiftUI

struct AuthView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var viewModel = AuthViewModel()
    @FocusState private var focusedField: Field?

    private enum Field { case email, password, displayName, server }

    var body: some View {
        ZStack {
            AuthBackdrop()

            ScrollView {
                VStack(spacing: SR.Space.md) {
                    hero
                    authCard

                    Text("Community reports help everyone choose a safer way forward.")
                        .font(SR.Font.meta)
                        .foregroundStyle(SR.Palette.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, SR.Space.md)
                }
                .frame(maxWidth: 520)
                .padding(.horizontal, SR.Space.screenMargin)
                .padding(.top, SR.Space.sm)
                .padding(.bottom, SR.Space.lg)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(SR.Palette.background.ignoresSafeArea())
        .animation(SR.Motion.standard(reduceMotion: reduceMotion), value: viewModel.mode)
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: SR.Space.sm) {
            HStack(spacing: SR.Space.sm) {
                Image("LogoMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: SR.Radius.control, style: .continuous))
                    .shadow(color: SR.Palette.navy.opacity(0.18), radius: 8, y: 4)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 1) {
                    Text("SafeRoute")
                        .font(SR.Font.cardTitle)
                        .foregroundStyle(SR.Palette.textPrimary)
                    Text("COMMUNITY-POWERED SAFETY")
                        .font(.system(.caption2, design: .rounded, weight: .bold))
                        .tracking(0.8)
                        .foregroundStyle(SR.Palette.navy)
                }
            }

            VStack(alignment: .leading, spacing: SR.Space.xxs) {
                Text("Walk informed. Arrive safer.")
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .foregroundStyle(SR.Palette.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.84)
                    .accessibilityAddTraits(.isHeader)

                Text("See nearby hazards and choose a safer path with live community reports.")
                    .font(SR.Font.secondary)
                    .foregroundStyle(SR.Palette.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: SR.Space.xs) {
                benefit("location.fill", "Live alerts")
                benefit("arrow.triangle.turn.up.right.diamond.fill", "Safer routes")
                benefit("person.2.fill", "Local reports")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var authCard: some View {
        VStack(alignment: .leading, spacing: SR.Space.md) {
            modePicker

            VStack(alignment: .leading, spacing: SR.Space.xxs) {
                Text(viewModel.mode == .login ? "Welcome back" : "Create your account")
                    .font(SR.Font.greeting)
                    .foregroundStyle(SR.Palette.textPrimary)
                Text(viewModel.mode == .login
                     ? "Sign in to see what’s happening along your route."
                     : "Join your local community and make every walk safer.")
                    .font(SR.Font.secondary)
                    .foregroundStyle(SR.Palette.textSecondary)
            }

            VStack(spacing: SR.Space.md) {
                if viewModel.mode == .register {
                    labeledField("Name", systemImage: "person.fill") {
                        TextField("How should we address you?", text: $viewModel.displayName)
                            .textContentType(.name)
                            .focused($focusedField, equals: .displayName)
                            .submitLabel(.next)
                            .onSubmit { focusedField = .email }
                    }
                    .transition(.move(edge: .top).combined(with: .opacity))
                }

                labeledField("Email", systemImage: "envelope.fill") {
                    TextField("you@example.com", text: $viewModel.email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focusedField, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focusedField = .password }
                }

                labeledField("Password", systemImage: "lock.fill") {
                    SecureField(viewModel.mode == .login ? "Enter your password" : "Create a password", text: $viewModel.password)
                        .textContentType(viewModel.mode == .login ? .password : .newPassword)
                        .focused($focusedField, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(submit)
                }
            }

            if let errorMessage = viewModel.errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.circle.fill")
                    .font(SR.Font.secondary)
                    .foregroundStyle(SR.Palette.critical)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
            }

            Button(action: submit) {
                HStack(spacing: SR.Space.xs) {
                    if viewModel.isSubmitting {
                        ProgressView().tint(SR.Palette.onNavy)
                    } else {
                        Text(viewModel.mode == .login ? "Continue to SafeRoute" : "Create account")
                        Image(systemName: "arrow.right")
                            .font(.system(.body, weight: .semibold))
                    }
                }
            }
            .buttonStyle(.srPrimary)
            .disabled(viewModel.isSubmitting || !isFormValid)

            if viewModel.mode == .register {
                Label("Other commuters see your trust level—not your name or email.", systemImage: "checkmark.shield.fill")
                    .font(SR.Font.meta)
                    .foregroundStyle(SR.Palette.textSecondary)
                    .transition(.opacity)
            }

            if APIConfig.serverIsConfigurable {
                serverSection
            }
        }
        .padding(SR.Space.md)
        .srCardSurface(radius: SR.Radius.floating)
    }

    private var modePicker: some View {
        HStack(spacing: SR.Space.xxs) {
            modeButton("Log in", mode: .login)
            modeButton("Create account", mode: .register)
        }
        .padding(SR.Space.xxs)
        .background(SR.Palette.fill, in: RoundedRectangle(cornerRadius: SR.Radius.button, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Account action")
    }

    private func modeButton(_ title: String, mode: AuthViewModel.Mode) -> some View {
        let isSelected = viewModel.mode == mode
        return Button {
            focusedField = nil
            viewModel.errorMessage = nil
            viewModel.mode = mode
        } label: {
            Text(title)
                .font(SR.Font.secondary.weight(.semibold))
                .foregroundStyle(isSelected ? SR.Palette.textPrimary : SR.Palette.textSecondary)
                .frame(maxWidth: .infinity, minHeight: SR.Layout.minTouchTarget)
                .background(isSelected ? SR.Palette.surface : Color.clear,
                            in: RoundedRectangle(cornerRadius: SR.Radius.control, style: .continuous))
                .shadow(color: isSelected ? Color.black.opacity(0.07) : .clear, radius: 4, y: 2)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func benefit(_ systemImage: String, _ title: String) -> some View {
        HStack(spacing: SR.Space.xxs) {
            Image(systemName: systemImage)
                .font(.system(.caption, weight: .semibold))
                .foregroundStyle(SR.Palette.navy)
            Text(title)
                .font(.system(.caption2, design: .default, weight: .semibold))
                .foregroundStyle(SR.Palette.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, minHeight: 34)
        .padding(.horizontal, SR.Space.xs)
        .background(SR.Palette.surface.opacity(0.78), in: RoundedRectangle(cornerRadius: SR.Radius.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: SR.Radius.control, style: .continuous).strokeBorder(SR.Palette.border.opacity(0.8)))
        .accessibilityElement(children: .combine)
    }

    private func labeledField<Content: View>(
        _ label: String,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: SR.Space.xs) {
            Text(label)
                .font(SR.Font.metaStrong)
                .foregroundStyle(SR.Palette.textPrimary)

            HStack(spacing: SR.Space.sm) {
                Image(systemName: systemImage)
                    .font(.system(.subheadline, weight: .medium))
                    .foregroundStyle(SR.Palette.navy)
                    .frame(width: 20)
                    .accessibilityHidden(true)
                content()
                    .font(SR.Font.body)
                    .foregroundStyle(SR.Palette.textPrimary)
            }
            .padding(.horizontal, SR.Space.md)
            .frame(minHeight: SR.Layout.buttonHeight)
            .background(SR.Palette.fill.opacity(0.72), in: RoundedRectangle(cornerRadius: SR.Radius.control, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: SR.Radius.control, style: .continuous).strokeBorder(SR.Palette.border))
        }
    }

    /// On a real iPhone the backend runs on another machine; the Simulator always uses localhost.
    private var serverSection: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: SR.Space.xs) {
                labeledField("Server address", systemImage: "server.rack") {
                    TextField("http://your-mac.local:8080", text: $viewModel.server)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focusedField, equals: .server)
                        .accessibilityLabel("Server address")
                }
                Text("Use the address of the computer running SafeRoute on the same Wi-Fi network.")
                    .font(SR.Font.meta)
                    .foregroundStyle(SR.Palette.textTertiary)
            }
            .padding(.top, SR.Space.sm)
        } label: {
            Label("Connection settings", systemImage: "network")
                .font(SR.Font.secondary.weight(.medium))
                .foregroundStyle(SR.Palette.textSecondary)
        }
    }

    private func submit() {
        guard isFormValid, !viewModel.isSubmitting else { return }
        focusedField = nil
        Task { await viewModel.submit(appState: appState) }
    }

    private var isFormValid: Bool {
        guard !viewModel.email.trimmingCharacters(in: .whitespaces).isEmpty,
              !viewModel.password.isEmpty else { return false }
        if viewModel.mode == .register {
            return !viewModel.displayName.trimmingCharacters(in: .whitespaces).isEmpty
        }
        return true
    }
}

/// A quiet map-like route motif that makes the welcome screen feel connected to the product.
private struct AuthBackdrop: View {
    var body: some View {
        GeometryReader { proxy in
            ZStack {
                LinearGradient(
                    colors: [SR.Palette.background, SR.Palette.navy.opacity(0.07), SR.Palette.background],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )

                Path { path in
                    path.move(to: CGPoint(x: proxy.size.width * 0.74, y: -20))
                    path.addCurve(
                        to: CGPoint(x: proxy.size.width * 0.88, y: proxy.size.height * 0.48),
                        control1: CGPoint(x: proxy.size.width * 1.02, y: proxy.size.height * 0.10),
                        control2: CGPoint(x: proxy.size.width * 0.58, y: proxy.size.height * 0.30)
                    )
                    path.addCurve(
                        to: CGPoint(x: proxy.size.width * 0.52, y: proxy.size.height + 40),
                        control1: CGPoint(x: proxy.size.width * 1.05, y: proxy.size.height * 0.66),
                        control2: CGPoint(x: proxy.size.width * 0.46, y: proxy.size.height * 0.78)
                    )
                }
                .stroke(SR.Palette.navy.opacity(0.10), style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [3, 10]))

                Circle()
                    .fill(SR.Palette.navy.opacity(0.10))
                    .frame(width: 12, height: 12)
                    .position(x: proxy.size.width * 0.82, y: proxy.size.height * 0.20)

                Circle()
                    .fill(SR.Palette.navy.opacity(0.08))
                    .frame(width: 18, height: 18)
                    .position(x: proxy.size.width * 0.76, y: proxy.size.height * 0.72)
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}
