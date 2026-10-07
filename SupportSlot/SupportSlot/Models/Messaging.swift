import Foundation

// table: messages
struct Message: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let threadId: ID
    let senderId: ID
    let text: String
    let createdAt: Date

    static let columns = "id, thread_id, sender_id, text, created_at"
}

struct ThreadArtist: Decodable, Equatable, Hashable { let id: ID; let name: String; let imageUrl: String? }
struct ThreadPromoter: Decodable, Equatable, Hashable { let id: ID; let company: String; let avatarUrl: String? }

// table: message_threads
struct MessageThreadRow: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let applicationId: ID?
    let context: String?
    let artistLastReadAt: Date?
    let promoterLastReadAt: Date?
    let lastMessageAt: Date?
    let createdAt: Date
    let artists: ThreadArtist?
    let promoters: ThreadPromoter?

    static let columns = "id, application_id, context, artist_last_read_at, promoter_last_read_at, last_message_at, created_at, artists(id, name, image_url), promoters(id, company, avatar_url)"
}

/// One conversation as the signed-in person sees it.
struct ChatThread: Identifiable, Equatable, Hashable {
    let row: MessageThreadRow
    let viewerRole: UserRole
    let viewerId: ID
    let latest: Message?

    var id: ID { row.id }
    var withId: ID { (viewerRole == .artist ? row.promoters?.id : row.artists?.id) ?? "" }
    var withName: String { (viewerRole == .artist ? row.promoters?.company : row.artists?.name) ?? "Unknown" }
    var withImage: String? { viewerRole == .artist ? row.promoters?.avatarUrl : row.artists?.imageUrl }
    var lastActivity: Date { latest?.createdAt ?? row.lastMessageAt ?? row.createdAt }

    var contextTitle: String {
        guard let c = row.context, !c.isEmpty else { return "" }
        if c.hasPrefix("application:") { return "About an application" }
        if c.hasPrefix("availability-request:") { return "Availability request" }
        return c
    }

    var preview: String {
        guard let latest else { return "No messages yet" }
        return (latest.senderId == viewerId ? "You: " : "") + latest.text
    }

    var unread: Bool {
        guard let latest, latest.senderId != viewerId else { return false }
        let lastRead = viewerRole == .artist ? row.artistLastReadAt : row.promoterLastReadAt
        return lastRead == nil || latest.createdAt > lastRead!
    }
}
