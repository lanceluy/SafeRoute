import Foundation

enum LoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)

    var isLoading: Bool { self == .loading }

    var errorMessage: String? {
        if case .failed(let message) = self { return message }
        return nil
    }
}

struct Toast: Identifiable, Equatable {
    enum Style { case info, success, warning, error }

    let id = UUID()
    let message: String
    let systemImage: String
    var style: Style = .info
}
