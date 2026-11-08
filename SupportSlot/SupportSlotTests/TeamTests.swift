import XCTest
@testable import SupportSlot

final class TeamTests: XCTestCase {
    private func decoder() -> JSONDecoder {
        let d = JSONDecoder(); d.keyDecodingStrategy = .convertFromSnakeCase; d.dateDecodingStrategy = .iso8601
        return d
    }

    func testATeamRowDecodesFromTheServer() throws {
        let json = """
        [{"id":"t1","promoter_id":"owner","member_id":"me","status":"active","invited_at":"2026-11-08T10:00:00Z",
          "owner_name":"Night Owl Presents","member_name":"Sam","member_email":null}]
        """
        let rows = try decoder().decode([TeamRow].self, from: Data(json.utf8))
        XCTAssertEqual(rows.count, 1)
        XCTAssertTrue(rows[0].isActive)
        XCTAssertEqual(rows[0].ownerName, "Night Owl Presents")
        XCTAssertNil(rows[0].memberEmail)
        let pending = try decoder().decode([TeamRow].self, from: Data(json.replacingOccurrences(of: "active", with: "pending").utf8))
        XCTAssertFalse(pending[0].isActive)
    }

    func testTheLimitsMatchTheDatabase() {
        XCTAssertEqual(TeamRules.maxPeople, 5)
        XCTAssertTrue(TeamRules.skipsListingLimit(isTeamMember: true))
        XCTAssertFalse(TeamRules.skipsListingLimit(isTeamMember: false))
    }

    private func thread(viewer: UserRole, viewerId: String, latestSender: String) throws -> ChatThread {
        let row = """
        {"id":"th","application_id":"a","context":"application:a","artist_last_read_at":null,"promoter_last_read_at":null,
         "last_message_at":"2026-11-08T10:00:00Z","created_at":"2026-11-08T09:00:00Z",
         "artists":{"id":"artist1","name":"The Artist","image_url":null},
         "promoters":{"id":"owner","company":"Night Owl","avatar_url":null}}
        """
        let msg = """
        {"id":"m1","thread_id":"th","sender_id":"\(latestSender)","text":"hello","created_at":"2026-11-08T10:00:00Z"}
        """
        return ChatThread(row: try decoder().decode(MessageThreadRow.self, from: Data(row.utf8)), viewerRole: viewer, viewerId: viewerId,
                          latest: try decoder().decode(Message.self, from: Data(msg.utf8)))
    }

    func testAPromotersTeamSharesOneSideOfTheConversation() throws {
        // The owner's helper wrote the last message: the owner sees it as "You", and it isn't unread for them.
        let owner = try thread(viewer: .promoter, viewerId: "owner", latestSender: "helper")
        XCTAssertTrue(owner.isFromViewerSide("helper"))
        XCTAssertTrue(owner.isFromViewerSide("owner"))
        XCTAssertFalse(owner.isFromViewerSide("artist1"))
        XCTAssertEqual(owner.preview, "You: hello")
        XCTAssertFalse(owner.unread)
        // The artist wrote it: it's unread for the whole team.
        let fromArtist = try thread(viewer: .promoter, viewerId: "helper", latestSender: "artist1")
        XCTAssertTrue(fromArtist.unread)
        XCTAssertEqual(fromArtist.preview, "hello")
    }

    func testAnArtistStillSeesOnlyTheirOwnMessagesAsMine() throws {
        let t = try thread(viewer: .artist, viewerId: "artist1", latestSender: "helper")
        XCTAssertFalse(t.isFromViewerSide("helper"))
        XCTAssertTrue(t.isFromViewerSide("artist1"))
        XCTAssertTrue(t.unread)
    }
}

@MainActor
final class TeamRoutingTests: XCTestCase {
    func testATeamNotificationOpensTheTeamPage() {
        let store = AppStore()
        XCTAssertFalse(store.presentedTeam)
        store.open(href: "/team")
        XCTAssertTrue(store.presentedTeam)
    }
}
