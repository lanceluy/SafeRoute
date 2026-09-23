import Foundation
import Security

/// Stores the access and refresh tokens. displayName/email are non-sensitive and live in
/// AppState/UserDefaults instead.
final class KeychainService: @unchecked Sendable {
    static let shared = KeychainService()

    private let service = "com.saferoute.app.jwt"
    private let accessAccount = "current-user"
    private let refreshAccount = "current-user-refresh"

    private init() {}

    func save(accessToken: String, refreshToken: String) {
        write(accessToken, account: accessAccount)
        write(refreshToken, account: refreshAccount)
    }

    func readAccessToken() -> String? { read(account: accessAccount) }
    func readRefreshToken() -> String? { read(account: refreshAccount) }

    func deleteTokens() {
        delete(account: accessAccount)
        delete(account: refreshAccount)
    }

    private func write(_ value: String, account: String) {
        delete(account: account)
        var attributes = baseQuery(account)
        attributes[kSecValueData as String] = Data(value.utf8)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(attributes as CFDictionary, nil)
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
