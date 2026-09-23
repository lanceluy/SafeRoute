import SwiftUI

struct AuthView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var viewModel = AuthViewModel()
    @FocusState private var focusedField: Field?

    private enum Field { case email, password, displayName }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SR.Space.xl) {
                VStack(alignment: .leading, spacing: SR.Space.sm) {
                    Image(systemName: "figure.walk")
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(SR.Palette.onNavy)
                        .frame(width: 56, height: 56)
                        .background(SR.Palette.navy, in: RoundedRectangle(cornerRadius: SR.Radius.button, style: .continuous))
                        .accessibilityHidden(true)
                    Text(viewModel.mode == .login ? "Welcome back" : "Join SafeRoute")
                        .font(SR.Font.pageTitle)
                        .foregroundStyle(SR.Palette.textPrimary)
                    Text("Real-time pedestrian hazard alerts, shared by commuters around you.")
                        .font(SR.Font.secondary)
                        .foregroundStyle(SR.Palette.textSecondary)
                }
                .padding(.top, SR.Space.xxxl)

                Picker("Mode", selection: $viewModel.mode) {
                    Text("Log in").tag(AuthViewModel.Mode.login)
                    Text("Create account").tag(AuthViewModel.Mode.register)
                }
                .pickerStyle(.segmented)

                SRCard(padding: SR.Space.md) {
                    if viewModel.mode == .register {
                        field("Name", text: $viewModel.displayName)
                            .textContentType(.name)
                            .focused($focusedField, equals: .displayName)
                        Divider()
                    }
                    field("Email", text: $viewModel.email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focusedField, equals: .email)
                    Divider()
                    SecureField("Password", text: $viewModel.password)
                        .font(SR.Font.body)
                        .frame(minHeight: SR.Layout.minTouchTarget)
                        .textContentType(viewModel.mode == .login ? .password : .newPassword)
                        .focused($focusedField, equals: .password)
                }

                if let errorMessage = viewModel.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.circle.fill")
                        .font(SR.Font.secondary)
                        .foregroundStyle(SR.Palette.critical)
                }

                Button {
                    focusedField = nil
                    Task { await viewModel.submit(appState: appState) }
                } label: {
                    if viewModel.isSubmitting {
                        ProgressView().tint(SR.Palette.onNavy)
                    } else {
                        Text(viewModel.mode == .login ? "Log in" : "Create account")
                    }
                }
                .buttonStyle(.srPrimary)
                .disabled(viewModel.isSubmitting || !isFormValid)

                if viewModel.mode == .register {
                    Text("Other commuters see your trust level, never your name or email.")
                        .font(SR.Font.meta)
                        .foregroundStyle(SR.Palette.textTertiary)
                }
            }
            .padding(.horizontal, SR.Space.screenMargin)
            .padding(.bottom, SR.Space.xxl)
        }
        .scrollDismissesKeyboard(.interactively)
        .srPageBackground()
    }

    private func field(_ title: String, text: Binding<String>) -> some View {
        TextField(title, text: text)
            .font(SR.Font.body)
            .frame(minHeight: SR.Layout.minTouchTarget)
    }

    private var isFormValid: Bool {
        guard !viewModel.email.isEmpty, !viewModel.password.isEmpty else { return false }
        if viewModel.mode == .register { return !viewModel.displayName.isEmpty }
        return true
    }
}
