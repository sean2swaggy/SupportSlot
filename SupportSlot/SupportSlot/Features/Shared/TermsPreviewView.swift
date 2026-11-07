import SwiftUI

/// The travel part of an offer, exactly as the database would fix it
/// (`terms_preview`), worded as a distance rule — never a journey time. The
/// promoter pays the artist directly; nothing here implies Support Slot
/// handles or guarantees any payment.
struct TermsPreviewView: View {
    @Environment(AppStore.self) private var store
    let slotId: ID
    /// Another artist (a promoter reviewing an applicant); nil = the signed-in artist.
    var artistId: ID? = nil
    /// The promoter's own travel figure in whole pounds, shown until the database answers.
    let listedTravelPounds: Int

    @State private var terms: TermsPreview?
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let terms {
                Text(headline(terms)).dimBody(14)
                if let sentence = terms.distanceSentence { Text(sentence).font(Theme.body(12)).foregroundStyle(Theme.paperDim) }
                if terms.minimumApplies { Text(Travel.ruleSummary).font(Theme.body(12)).foregroundStyle(Theme.paperDim) }
            } else {
                Text("+ \(Money.gbp(listedTravelPounds)) travel contribution").dimBody(14)
                Text(failed ? "We couldn’t check the minimum travel rule just now." : Travel.ruleSummary).font(Theme.body(12)).foregroundStyle(Theme.paperDim)
            }
        }
        .task(id: "\(slotId)\(artistId ?? "")") { await load() }
    }

    private func headline(_ t: TermsPreview) -> String {
        let listed = listedTravelPounds * 100
        if t.minimumApplies {
            return "+ \(Money.pence(t.travelPence)) travel (the promoter listed \(Money.pence(listed)); raised to the \(Money.pence(Travel.minimumLongTravelPence)) minimum)"
        }
        return "+ \(Money.pence(t.travelPence)) travel contribution"
    }

    private func load() async {
        guard store.isSignedIn else { return }
        do { terms = try await store.db.termsPreview(slotId: slotId, artistId: artistId); failed = false }
        catch { failed = true }
    }
}
