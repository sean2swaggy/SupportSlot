import SwiftUI
import MapKit

/// The slots from the current search on a map. Positions are the venues' (public) map positions.
struct SlotMapView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let slots: [Slot]

    private var pins: [Slot] { slots.filter { $0.lat != nil && $0.lon != nil } }

    var body: some View {
        NavigationStack {
            Map {
                ForEach(pins) { s in
                    Annotation(s.headliner, coordinate: CLLocationCoordinate2D(latitude: s.lat ?? 0, longitude: s.lon ?? 0)) {
                        Button {
                            dismiss()
                            store.presentedSlotID = s.id
                        } label: {
                            VStack(spacing: 2) {
                                Text(Money.gbp(s.supportFee)).font(Theme.mono(11, weight: .bold)).foregroundStyle(Theme.acidInk)
                                    .padding(.horizontal, 8).padding(.vertical, 5).background(s.isUrgent ? Theme.signal : Theme.acid)
                                Image(systemName: "triangle.fill").font(.system(size: 7)).rotationEffect(.degrees(180)).foregroundStyle(s.isUrgent ? Theme.signal : Theme.acid)
                            }
                            .frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel("\(s.headliner) in \(s.city), \(UKDates.shortDate(s.date)), \(Money.gbp(s.supportFee)) fee")
                    }
                }
            }
            .mapStyle(.standard(elevation: .flat))
            .overlay(alignment: .bottom) {
                Text(pins.isEmpty ? "No listings with a map position in this search." : "Showing \(pins.count) listing\(pins.count == 1 ? "" : "s"). Tap a price to open it.")
                    .font(Theme.body(12)).foregroundStyle(Theme.paper).padding(10).background(Theme.ink.opacity(0.9)).padding(.bottom, 12)
            }
            .navigationTitle("Map").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } } }
        }
        .presentationBackground(Theme.ink)
    }
}
