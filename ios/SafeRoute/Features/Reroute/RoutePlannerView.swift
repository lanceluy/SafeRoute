import SwiftUI
import MapKit

/// Destination search → safest-route planning. The result is handed to MapViewModel, which
/// draws both routes and the comparison card.
struct RoutePlannerView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appState: AppState
    @StateObject private var search = DestinationSearch()
    @State private var isPlanning = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if let current = appState.map.plan {
                    Section {
                        Button {
                            Task { await replan(to: current.destination, name: current.destinationName, item: current.destinationItem) }
                        } label: {
                            Label("Re-check route to \(current.destinationName)", systemImage: "arrow.clockwise")
                                .foregroundStyle(SR.Palette.navy)
                                .frame(minHeight: SR.Layout.minTouchTarget)
                        }
                    }
                }
                Section {
                    ForEach(search.suggestions, id: \.self) { suggestion in
                        Button {
                            Task { await select(suggestion) }
                        } label: {
                            HStack(spacing: SR.Space.sm) {
                                Image(systemName: "mappin.circle.fill")
                                    .font(.title2)
                                    .foregroundStyle(SR.Palette.navy)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(suggestion.title).font(SR.Font.body).foregroundStyle(SR.Palette.textPrimary)
                                    if !suggestion.subtitle.isEmpty {
                                        Text(suggestion.subtitle).font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, minHeight: SR.Layout.minTouchTarget, alignment: .leading)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .srPageBackground()
            .overlay(alignment: .top) {
                if isPlanning {
                    ProgressView("Finding the safest route…")
                        .padding(SR.Space.lg)
                        .srGlassSurface(radius: SR.Radius.card)
                        .padding(.top, SR.Space.xxxl)
                } else if search.queryText.isEmpty && appState.map.plan == nil {
                    SREmptyState(systemImage: "figure.walk", title: "Where are you going?",
                                 message: "SafeRoute compares the fastest walking route with a safer route that avoids reported hazards.")
                        .padding(.horizontal, SR.Space.screenMargin)
                        .padding(.top, SR.Space.xxxl)
                }
            }
            .searchable(text: $search.queryText, placement: .navigationBarDrawer(displayMode: .always), prompt: "Where are you going?")
            .navigationTitle("Safer route")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .alert("Couldn't plan a route", isPresented: .constant(errorMessage != nil)) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
            .disabled(isPlanning)
        }
    }

    private func select(_ suggestion: MKLocalSearchCompletion) async {
        guard let item = await search.resolve(suggestion) else {
            errorMessage = "That place couldn't be found."
            return
        }
        await replan(to: item.placemark.coordinate, name: suggestion.title, item: item)
    }

    private func replan(to destination: CLLocationCoordinate2D, name: String, item: MKMapItem?) async {
        guard let source = LocationManager.shared.currentLocation else {
            errorMessage = "Your current location isn't available yet. Check that Location Services are on."
            return
        }
        isPlanning = true
        defer { isPlanning = false }
        do {
            let plan = try await RouteAvoidanceService.shared.plan(from: source, to: destination, destinationName: name,
                                                                  destinationItem: item)
            appState.map.setPlan(plan)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

@MainActor
final class DestinationSearch: NSObject, ObservableObject, MKLocalSearchCompleterDelegate {
    @Published var queryText = "" {
        didSet { completer.queryFragment = queryText }
    }
    @Published var suggestions: [MKLocalSearchCompletion] = []

    private let completer = MKLocalSearchCompleter()

    override init() {
        super.init()
        completer.resultTypes = [.pointOfInterest, .address]
        completer.delegate = self
        if let here = LocationManager.shared.currentLocation {
            completer.region = MKCoordinateRegion(center: here, latitudinalMeters: 20_000, longitudinalMeters: 20_000)
        }
    }

    func resolve(_ completion: MKLocalSearchCompletion) async -> MKMapItem? {
        try? await MKLocalSearch(request: MKLocalSearch.Request(completion: completion)).start().mapItems.first
    }

    nonisolated func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        // MKLocalSearchCompleter calls its delegate on the main thread.
        MainActor.assumeIsolated { self.suggestions = self.completer.results }
    }
}
