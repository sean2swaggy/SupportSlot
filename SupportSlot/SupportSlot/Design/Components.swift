import SwiftUI

// MARK: - Chips and badges

struct Tag: View {
    let text: String
    var tint: Color = Theme.paperDim
    var filled = false
    init(_ text: String, tint: Color = Theme.paperDim, filled: Bool = false) { self.text = text; self.tint = tint; self.filled = filled }
    var body: some View {
        Text(text.uppercased())
            .font(Theme.mono(10))
            .tracking(1.2)
            .foregroundStyle(filled ? Theme.acidInk : tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(filled ? tint : .clear)
            .overlay(Rectangle().stroke(filled ? tint : tint.opacity(0.5), lineWidth: Theme.hairline))
    }
}

struct VerifiedBadge: View {
    var body: some View {
        Label("Verified", systemImage: "checkmark.seal.fill")
            .labelStyle(.titleAndIcon)
            .font(Theme.mono(10))
            .textCase(.uppercase)
            .foregroundStyle(Theme.acid)
            .accessibilityLabel("Verified by Support Slot")
    }
}

/// A small filled mark for the person who founded Support Slot. Set by the platform only.
struct FounderBadge: View {
    var body: some View {
        Label("Founder", systemImage: "star.fill")
            .labelStyle(.titleAndIcon)
            .font(Theme.mono(10, weight: .bold))
            .textCase(.uppercase)
            .foregroundStyle(Theme.acidInk)
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(Theme.acid)
            .accessibilityLabel("Founder of Support Slot")
    }
}

/// Says in plain words what the badge means. Shown on profile pages (not inside tappable rows).
struct VerifiedExplainer: View {
    var body: some View {
        Text("Verified means the Support Slot team has checked this account’s venue or performing history. It’s never for sale.")
            .font(Theme.body(12)).foregroundStyle(Theme.paperDim)
    }
}

struct StatusPill: View {
    let status: ApplicationStatus
    var body: some View {
        Tag(label, tint: tint, filled: filled)
    }
    private var label: String {
        switch status {
        case .submitted: return "Submitted"
        case .viewed: return "Viewed"
        case .shortlisted: return "Shortlisted"
        case .offered: return "Offer received"
        case .confirmed: return "Confirmed"
        case .declined: return "Not successful"
        case .offerDeclined: return "Offer declined"
        case .withdrawn: return "Withdrawn"
        case .cancelled: return "Cancelled"
        }
    }
    private var tint: Color {
        switch status {
        case .offered: return Theme.acid
        case .confirmed: return Theme.ok
        case .shortlisted: return Theme.acid
        case .declined, .cancelled: return Theme.signal
        default: return Theme.paperDim
        }
    }
    private var filled: Bool { status == .offered || status == .confirmed }
}

// MARK: - States

struct EmptyState: View {
    let title: String
    var message: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 10) {
            Text(title).font(Theme.display(20)).foregroundStyle(Theme.paper).multilineTextAlignment(.center)
            if let message { Text(message).dimBody(14).multilineTextAlignment(.center) }
            if let actionTitle, let action {
                Button(actionTitle, action: action).buttonStyle(.app(.primary, compact: true)).padding(.top, 8)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .overlay(Rectangle().stroke(Theme.inkBorder, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
        .accessibilityElement(children: .combine)
    }
}

/// A failed load, with a retry. Never an empty list pretending nothing exists.
struct ErrorState: View {
    let error: AppError
    var retry: (() -> Void)? = nil
    var body: some View {
        VStack(spacing: 10) {
            Text(error.isNetwork ? "You're offline" : "Couldn't load this").font(Theme.display(20)).foregroundStyle(Theme.paper)
            Text(error.message).dimBody(14).multilineTextAlignment(.center)
            if let retry {
                Button("Try again", action: retry).buttonStyle(.app(.outline, compact: true)).padding(.top, 6)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .overlay(Rectangle().stroke(Theme.signal.opacity(0.5), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

struct LoadingView: View {
    var label = "Loading…"
    var body: some View {
        HStack(spacing: 10) {
            ProgressView().tint(Theme.paperDim)
            Text(label).dimBody(14)
        }
        .frame(maxWidth: .infinity)
        .padding(28)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(label)
    }
}

struct Banner: View {
    enum Kind { case info, success, error }
    let kind: Kind
    let text: String
    var body: some View {
        Text(text)
            .font(Theme.body(14))
            .foregroundStyle(kind == .error ? Theme.signal : Theme.paper)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tint.opacity(0.1))
            .overlay(Rectangle().stroke(tint.opacity(0.5), lineWidth: 1))
            .accessibilityAddTraits(kind == .error ? [] : [])
    }
    private var tint: Color { kind == .error ? Theme.signal : kind == .success ? Theme.ok : Theme.acid }
}

/// Shows an error under a field, announced to VoiceOver.
struct FieldError: View {
    let message: String?
    var body: some View {
        if let message, !message.isEmpty {
            Text(message).font(Theme.body(13)).foregroundStyle(Theme.signal).accessibilityLabel("Error: \(message)")
        }
    }
}

// MARK: - Fields

struct LabeledField<Content: View>: View {
    let label: String
    var error: String? = nil
    var hint: String? = nil
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            MonoLabel(label)
            content
            if let hint, error == nil { Text(hint).font(Theme.body(12)).foregroundStyle(Theme.paperDim) }
            FieldError(message: error)
        }
    }
}

struct FieldStyle: ViewModifier {
    var invalid = false
    func body(content: Content) -> some View {
        content
            .font(Theme.body(16))
            .foregroundStyle(Theme.paper)
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(Theme.inkRaised)
            .overlay(Rectangle().stroke(invalid ? Theme.signal : Theme.inkBorder, lineWidth: 1))
            .tint(Theme.acid)
    }
}

extension View {
    func fieldStyle(invalid: Bool = false) -> some View { modifier(FieldStyle(invalid: invalid)) }
}

/// Multi-line text with a placeholder.
struct TextArea: View {
    @Binding var text: String
    var placeholder = ""
    var minHeight: CGFloat = 100
    var invalid = false
    var body: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text(placeholder).font(Theme.body(16)).foregroundStyle(Theme.paperDim.opacity(0.6)).padding(.horizontal, 18).padding(.vertical, 14)
                    .allowsHitTesting(false)
            }
            TextEditor(text: $text)
                .font(Theme.body(16))
                .foregroundStyle(Theme.paper)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .frame(minHeight: minHeight)
        }
        .background(Theme.inkRaised)
        .overlay(Rectangle().stroke(invalid ? Theme.signal : Theme.inkBorder, lineWidth: 1))
        .tint(Theme.acid)
    }
}

/// Bridges an optional number to a text field (empty = nil, invalid = nil).
struct IntField: View {
    @Binding var value: Int?
    var placeholder = ""
    var invalid = false
    @State private var text = ""
    @State private var seeded = false

    var body: some View {
        TextField(placeholder, text: $text)
            .keyboardType(.numberPad)
            .fieldStyle(invalid: invalid)
            .onChange(of: text) { _, new in
                let digits = new.filter(\.isNumber)
                if digits != new { text = digits }
                value = Int(digits)
            }
            .onAppear {
                if !seeded { seeded = true; text = value.map(String.init) ?? "" }
            }
    }
}

/// Binds a `YYYY-MM-DD` string to a date picker (UK calendar dates).
struct ISODatePicker: View {
    let title: String
    @Binding var iso: String
    var range: PartialRangeFrom<Date>? = nil

    private var binding: Binding<Date> {
        Binding(
            get: { Self.date(from: iso) ?? Date() },
            set: { iso = Self.string(from: $0) }
        )
    }

    var body: some View {
        HStack {
            Text(iso.isEmpty ? "Choose a date" : UKDates.formatShowDate(iso, withYear: true))
                .font(Theme.body(16))
                .foregroundStyle(iso.isEmpty ? Theme.paperDim : Theme.paper)
            Spacer()
            if let range {
                DatePicker(title, selection: binding, in: range, displayedComponents: .date).labelsHidden().colorScheme(.dark)
            } else {
                DatePicker(title, selection: binding, displayedComponents: .date).labelsHidden().colorScheme(.dark)
            }
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 48)
        .background(Theme.inkRaised)
        .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title), \(iso.isEmpty ? "not set" : UKDates.formatShowDate(iso, withYear: true))")
    }

    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = UKDates.london
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    static func date(from iso: String) -> Date? {
        guard !iso.isEmpty else { return nil }
        // Noon in London so DST edges can't move it to another day.
        return formatter.date(from: iso).map { $0.addingTimeInterval(12 * 3600) }
    }
    static func string(from date: Date) -> String { formatter.string(from: date) }
}

/// Binds an `HH:MM` string to a time picker.
struct ISOTimePicker: View {
    let title: String
    @Binding var time: String

    private var binding: Binding<Date> {
        Binding(
            get: { Self.date(from: time) ?? Date() },
            set: { time = Self.string(from: $0) }
        )
    }

    var body: some View {
        HStack {
            Text(time.isEmpty ? "Choose a time" : time).font(Theme.body(16)).foregroundStyle(time.isEmpty ? Theme.paperDim : Theme.paper)
            Spacer()
            DatePicker(title, selection: binding, displayedComponents: .hourAndMinute).labelsHidden().colorScheme(.dark)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 48)
        .background(Theme.inkRaised)
        .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title), \(time.isEmpty ? "not set" : time)")
    }

    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = UKDates.london
        f.dateFormat = "HH:mm"
        return f
    }()
    static func date(from t: String) -> Date? {
        guard !t.isEmpty else { return nil }
        return formatter.date(from: String(t.prefix(5)))
    }
    static func string(from d: Date) -> String { formatter.string(from: d) }
}

/// Multi-select of fixed options (genres, artist sizes).
/// What tapping a chip does: choose it, or un-choose it, or nothing when the limit is full.
enum ChipSelection {
    static func toggled(_ option: String, in selection: [String], limit: Int?) -> [String] {
        if selection.contains(option) { return selection.filter { $0 != option } }
        if let limit, selection.count >= limit { return selection }
        return selection + [option]
    }
    static func isFull(_ selection: [String], limit: Int?) -> Bool {
        guard let limit else { return false }
        return selection.count >= limit
    }
}

struct ChoiceChips: View {
    let options: [String]
    @Binding var selection: [String]
    var limit: Int? = nil
    var label: (String) -> String = { $0 }

    private var full: Bool { ChipSelection.isFull(selection, limit: limit) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            chips
            if let limit {
                Text(full ? "\(selection.count) of \(limit) chosen — tap one you’ve chosen to swap it."
                          : "\(selection.count) of \(limit) chosen")
                    .font(Theme.body(12)).foregroundStyle(full ? Theme.acid : Theme.paperDim)
                    .accessibilityLabel(full ? "\(selection.count) of \(limit) chosen. Unselect one to pick another." : "\(selection.count) of \(limit) chosen")
            }
        }
    }

    private var chips: some View {
        FlowLayout(spacing: 8) {
            ForEach(options, id: \.self) { option in
                let on = selection.contains(option)
                Button {
                    selection = ChipSelection.toggled(option, in: selection, limit: limit)
                } label: {
                    Text(label(option).uppercased())
                        .font(Theme.mono(11))
                        .tracking(1)
                        .foregroundStyle(on ? Theme.acidInk : Theme.paper)
                        .padding(.horizontal, 12).frame(minHeight: 38)
                        .background(on ? Theme.acid : .clear)
                        .overlay(Rectangle().stroke(on ? Theme.acid : Theme.inkBorder, lineWidth: 1))
                        .opacity(full && !on ? 0.4 : 1)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityLabel(label(option))
            }
        }
    }
}

/// Lays children out left to right, wrapping onto new lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > width, x > 0 { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
        }
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
        }
    }
}
