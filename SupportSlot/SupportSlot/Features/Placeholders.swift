import SwiftUI

// Temporary stand-ins, replaced one by one as each screen is built.
struct ApplicantsView: View { let slotId: ID; var body: some View { Text("Applicants").foregroundStyle(Theme.paper).screenBackground() } }
struct ListingFormView: View { var editing: Slot?; var body: some View { Text("Listing form").foregroundStyle(Theme.paper).screenBackground() } }
struct PromoterArtistActions: View { let artist: Artist; var body: some View { EmptyView() } }
