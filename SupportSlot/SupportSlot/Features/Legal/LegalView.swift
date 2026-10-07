import SwiftUI

/// Terms, Privacy and Trust & Safety as full-screen readable documents.
struct LegalView: View {
    let document: LegalDocument

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 10) {
                    Eyebrow(document.eyebrow)
                    DisplayTitle(document.title, size: 32)
                    if let updated = document.updated { Text(updated).dimBody(13) }
                    if let intro = document.intro { Text(intro).dimBody(16).padding(.top, 4) }
                }
                ForEach(document.sections) { section in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(section.heading).font(Theme.display(20)).foregroundStyle(Theme.paper).accessibilityAddTraits(.isHeader)
                        ForEach(Array(section.paragraphs.enumerated()), id: \.offset) { _, p in
                            if p.hasPrefix("• ") {
                                HStack(alignment: .top, spacing: 8) {
                                    Text("•").foregroundStyle(Theme.acid)
                                    Text(String(p.dropFirst(2))).dimBody(15)
                                }
                            } else {
                                Text(p).dimBody(15).lineSpacing(3)
                            }
                        }
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// The three legal documents, reachable from the sign-up screen and Settings.
enum LegalPage: String, Identifiable, CaseIterable {
    case terms, privacy, trust
    var id: String { rawValue }
    var document: LegalDocument {
        switch self {
        case .terms: return LegalContent.terms
        case .privacy: return LegalContent.privacy
        case .trust: return LegalContent.trust
        }
    }
    var label: String {
        switch self {
        case .terms: return "Terms of Service"
        case .privacy: return "Privacy Policy"
        case .trust: return "Trust & Safety"
        }
    }
}
