import SwiftUI

/// Conversations. One thread per application between an artist and a promoter.
struct MessagesView: View {
    @Environment(AppStore.self) private var store
    @State private var path: [ChatThread.ID] = []

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    VStack(alignment: .leading, spacing: 8) { Eyebrow("Inbox"); DisplayTitle("Messages", size: 32) }.padding(20)
                    if store.threads.isEmpty {
                        EmptyState(title: "No conversations yet", message: store.role == .artist
                                   ? "Message a promoter from any of your applications."
                                   : "Message an applicant from your listing’s applicants screen.").padding(.horizontal, 20)
                    } else {
                        ForEach(store.threads) { t in
                            NavigationLink(value: t.id) { ThreadRow(thread: t) }.buttonStyle(.plain)
                            Divider1()
                        }
                    }
                }
            }
            .refreshable { await store.refreshThreads() }
            .screenBackground()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { NotificationsButton() } }
            .navigationDestination(for: ChatThread.ID.self) { id in ChatView(threadId: id) }
        }
        .task(id: store.pendingThreadID) {
            guard let id = store.pendingThreadID else { return }
            if !store.threads.contains(where: { $0.id == id }) { await store.refreshThreads() }
            path = [id]
            store.pendingThreadID = nil
        }
        .task { await store.refreshThreads() }
    }
}

struct ThreadRow: View {
    let thread: ChatThread
    var body: some View {
        HStack(spacing: 14) {
            Avatar(imageUrl: thread.withImage, name: thread.withName, size: 50)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(thread.withName).font(Theme.body(16, weight: thread.unread ? .bold : .medium)).foregroundStyle(Theme.paper).lineLimit(1)
                    Spacer()
                    Text(UKDates.timeAgo(thread.lastActivity)).font(Theme.mono(10)).foregroundStyle(Theme.paperDim)
                }
                if !thread.contextTitle.isEmpty { MonoLabel(thread.contextTitle) }
                Text(thread.preview).font(Theme.body(14)).foregroundStyle(thread.unread ? Theme.paper : Theme.paperDim).lineLimit(1)
            }
            if thread.unread { Circle().fill(Theme.acid).frame(width: 10, height: 10).accessibilityLabel("Unread") }
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct ChatBubble: Identifiable, Equatable {
    enum State: Equatable { case sent, sending, failed(String) }
    let id: String
    let text: String
    let mine: Bool
    let date: Date
    var state: State = .sent
}

struct ChatView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let threadId: ID

    @State private var bubbles: [ChatBubble] = []
    @State private var loaded = false
    @State private var loadError: AppError?
    @State private var canLoadEarlier = false
    @State private var loadingEarlier = false
    @State private var draft = ""
    @State private var sendError: String?
    @State private var showReport = false
    @State private var confirmBlock = false
    @State private var blockNote: String?
    @FocusState private var composing: Bool

    private var thread: ChatThread? { store.threads.first { $0.id == threadId } }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 10) {
                        if canLoadEarlier {
                            Button(loadingEarlier ? "Loading…" : "Load earlier messages") { Task { await loadEarlier() } }
                                .buttonStyle(.app(.outline, compact: true)).disabled(loadingEarlier)
                        }
                        if let loadError, !loaded { ErrorState(error: loadError) { Task { await loadLatest() } } }
                        if loaded && bubbles.isEmpty { Text("No messages yet — say hello.").dimBody(14).padding(.top, 30) }
                        ForEach(bubbles) { b in
                            BubbleView(bubble: b) { Task { await retry(b) } }.id(b.id)
                        }
                    }
                    .padding(16)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: bubbles.last?.id) { _, id in if let id { if reduceMotion { proxy.scrollTo(id, anchor: .bottom) } else { withAnimation { proxy.scrollTo(id, anchor: .bottom) } } } }
                .onAppear { if let id = bubbles.last?.id { proxy.scrollTo(id, anchor: .bottom) } }
            }
            if let blockNote { Banner(kind: .info, text: blockNote).padding(.horizontal, 16) }
            composer
        }
        .screenBackground()
        .navigationTitle(thread?.withName ?? "Conversation")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { showReport = true } label: { Label("Report this conversation", systemImage: "flag") }
                    if store.role == .artist, thread != nil { Button(role: .destructive) { confirmBlock = true } label: { Label("Block this promoter", systemImage: "hand.raised") } }
                } label: { Image(systemName: "ellipsis.circle") }
                .accessibilityLabel("More options")
            }
        }
        .task { await loadLatest(); await poll() }
        .sheet(isPresented: $showReport) {
            if let thread { NavigationStack { ReportSheet(contextType: "message", contextId: bubbles.last(where: { !$0.mine })?.id, reportedProfileId: thread.withId, subject: thread.withName) }.environment(store).presentationBackground(Theme.ink) }
        }
        .alert("Block this promoter?", isPresented: $confirmBlock) {
            Button("Block", role: .destructive) { Task { await block() } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("They won’t be able to message or invite you. You can unblock them in Settings.") }
    }

    // MARK: Composer

    private var composer: some View {
        VStack(spacing: 6) {
            if let sendError { Text(sendError).font(Theme.body(12)).foregroundStyle(Theme.signal).frame(maxWidth: .infinity, alignment: .leading) }
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Write a message", text: $draft, axis: .vertical)
                    .lineLimit(1...5).focused($composing).fieldStyle()
                    .onChange(of: draft) { _, new in if new.count > 2000 { draft = String(new.prefix(2000)) } }
                    .accessibilityLabel("Write a message")
                Button { Task { await send() } } label: {
                    Image(systemName: "arrow.up").font(.system(size: 18, weight: .bold)).foregroundStyle(Theme.acidInk)
                        .frame(width: 48, height: 48).background(Theme.acid)
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .opacity(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.4 : 1)
                .accessibilityLabel("Send")
            }
        }
        .padding(12)
        .background(Theme.ink)
        .overlay(alignment: .top) { Divider1() }
    }

    // MARK: Loading

    private func bubble(_ m: Message) -> ChatBubble {
        ChatBubble(id: m.id, text: m.text, mine: thread?.isFromViewerSide(m.senderId) ?? (m.senderId == store.userId), date: m.createdAt)
    }

    private func loadLatest() async {
        do {
            let page = try await store.db.messages(threadId: threadId)
            merge(page)
            canLoadEarlier = page.count >= Database.messagesPerPage
            loaded = true; loadError = nil
            await markRead()
        } catch is CancellationError {
        } catch { if !loaded { loadError = (error as? AppError) ?? .generic() } }
    }

    private func loadEarlier() async {
        guard let first = bubbles.first(where: { $0.state == .sent }) else { return }
        loadingEarlier = true; defer { loadingEarlier = false }
        do {
            let page = try await store.db.messages(threadId: threadId, before: first.date)
            merge(page)
            canLoadEarlier = page.count >= Database.messagesPerPage
        } catch { sendError = (error as? AppError)?.message ?? "Couldn’t load earlier messages." }
    }

    /// Adds fetched messages without duplicating or losing unsent local ones.
    private func merge(_ fetched: [Message]) {
        let local = bubbles.filter { $0.state != .sent }
        var byId: [String: ChatBubble] = [:]
        for b in bubbles where b.state == .sent { byId[b.id] = b }
        for m in fetched { byId[m.id] = bubble(m) }
        bubbles = (byId.values.sorted { $0.date < $1.date }) + local
    }

    private func markRead() async {
        guard thread?.unread == true else { return }
        try? await store.db.markThreadRead(id: threadId)
        await store.refreshThreads()
    }

    /// New messages from the other person appear while the chat is open.
    private func poll() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            if Task.isCancelled { break }
            if let page = try? await store.db.messages(threadId: threadId) {
                let hadNew = page.contains { m in !bubbles.contains { $0.id == m.id } }
                merge(page)
                if hadNew { try? await store.db.markThreadRead(id: threadId); await store.refreshThreads() }
            }
        }
    }

    // MARK: Sending

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let uid = store.userId else { return }
        draft = ""
        sendError = nil
        let clientId = UUID().uuidString.lowercased()
        let local = ChatBubble(id: "local-\(clientId)", text: text, mine: true, date: Date(), state: .sending)
        bubbles.append(local)
        await deliver(local, uid: uid)
    }

    private func retry(_ b: ChatBubble) async {
        guard let uid = store.userId, let i = bubbles.firstIndex(where: { $0.id == b.id }) else { return }
        bubbles[i].state = .sending
        await deliver(bubbles[i], uid: uid)
    }

    private func deliver(_ local: ChatBubble, uid: ID) async {
        do {
            let sent = try await store.db.sendMessage(threadId: threadId, senderId: uid, text: local.text, clientId: String(local.id.dropFirst("local-".count)))
            bubbles.removeAll { $0.id == local.id }
            if !bubbles.contains(where: { $0.id == sent.id }) { bubbles.append(ChatBubble(id: sent.id, text: local.text, mine: true, date: sent.createdAt)) }
            bubbles.sort { $0.date < $1.date }
            await store.refreshThreads()
        } catch {
            let message = (error as? AppError)?.message ?? "Couldn’t send that message."
            if let i = bubbles.firstIndex(where: { $0.id == local.id }) { bubbles[i].state = .failed(message) }
        }
    }

    private func block() async {
        guard let uid = store.userId, let thread else { return }
        do {
            try await store.db.blockPromoter(artistId: uid, promoterId: thread.withId)
            blockNote = "You’ve blocked \(thread.withName). They can no longer message you."
        } catch { sendError = (error as? AppError)?.message ?? "Couldn’t block that promoter." }
    }
}

private struct BubbleView: View {
    let bubble: ChatBubble
    let retry: () -> Void

    var body: some View {
        VStack(alignment: bubble.mine ? .trailing : .leading, spacing: 4) {
            Text(bubble.text)
                .font(Theme.body(15))
                .foregroundStyle(bubble.mine ? Theme.acidInk : Theme.paper)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(bubble.mine ? Theme.acid : Theme.inkCard)
                .overlay(Rectangle().stroke(bubble.mine ? .clear : Theme.inkBorder, lineWidth: 1))
                .opacity(bubble.state == .sending ? 0.6 : 1)
            switch bubble.state {
            case .sent: Text(UKDates.dateTime(bubble.date)).font(Theme.mono(9)).foregroundStyle(Theme.paperDim)
            case .sending: Text("Sending…").font(Theme.mono(9)).foregroundStyle(Theme.paperDim)
            case .failed(let m):
                VStack(alignment: .trailing, spacing: 4) {
                    Text(m).font(Theme.body(11)).foregroundStyle(Theme.signal).multilineTextAlignment(.trailing)
                    Button("Not sent — tap to retry", action: retry).font(Theme.mono(10)).foregroundStyle(Theme.signal)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: bubble.mine ? .trailing : .leading)
        .padding(.leading, bubble.mine ? 48 : 0).padding(.trailing, bubble.mine ? 0 : 48)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(bubble.mine ? "You" : "Them"): \(bubble.text)")
    }
}
