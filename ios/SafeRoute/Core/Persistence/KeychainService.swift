import Foundation
import Security

/// Stores the access and refresh tokens. displayName/email are non-sensitive and live in
/// AppState/UserDefaults instead.
final class KeychainService: @unchecked Sendable {
    /// Signing in without a saved token would look like success while every request fails with 401.
    struct SaveError: LocalizedError {
        let status: OSStatus
        var errorDescription: String? {
            "SafeRoute couldn't save your sign-in on this device (Keychain error \(status)). Please try again."
        }
    }

    static let shared = KeychainService()

    private let service = "com.saferoute.app.jwt"
    private let accessAccount = "current-user"
    private let refreshAccount = "current-user-refresh"

    private init() {}

    /// Throws if either token could not be stored, e.g. in a build without Keychain access.
    func save(accessToken: String, refreshToken: String) throws {
        try write(accessToken, account: accessAccount)
        try write(refreshToken, account: refreshAccount)
    }

    func readAccessToken() -> String? { read(account: accessAccount) }
    func readRefreshToken() -> String? { read(account: refreshAccount) }

    func deleteTokens() {
        delete(account: accessAccount)
        delete(account: refreshAccount)
    }

    private func write(_ value: String, account: String) throws {
        delete(account: account)
        var attributes = baseQuery(account)
        attributes[kSecValueData as String] = Data(value.utf8)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else { throw SaveError(status: status) }
    }

    private func read(account: String) -> String? {
        var query = baseQuery(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func delete(account: String) {
        SecItemDelete(baseQuery(account) as CFDictionary)
    }

    private func baseQuery(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}
