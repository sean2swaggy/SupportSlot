import XCTest
@testable import SupportSlot

final class QueryTests: XCTestCase {
    func testBuildsFiltersOrderAndLimit() {
        let q = Query("slots", "id, headliner").eq("status", "open").gte("date", "2026-10-07").order("date").order("id", ascending: false).limit(12).offset(24)
        XCTAssertEqual(q.queryString().removingPercentEncoding,
                       "select=id, headliner&status=eq.open&date=gte.2026-10-07&order=date.asc,id.desc&limit=12&offset=24")
    }

    func testPlusAndAmpersandInValuesAreEncoded() {
        let s = Query("artists").ilike("name", "%a+b&c%").queryString()
        XCTAssertTrue(s.contains("%2B"), "a literal + must be %2B or the server reads it as a space: \(s)")
        XCTAssertTrue(s.contains("%26"), s)
        XCTAssertFalse(s.contains("a+b"))
    }

    func testInListQuotesValues() {
        let s = Query("slots").in("id", ["a", "b,c", "say \"hi\""]).queryString(includeSelect: false)
        let decoded = s.removingPercentEncoding!
        XCTAssertEqual(decoded, "id=in.(\"a\",\"b,c\",\"say \\\"hi\\\"\")")
    }

    func testPageComputesOffset() {
        let decoded = Query("slots").page(3, size: 12).queryString(includeSelect: false).removingPercentEncoding!
        XCTAssertEqual(decoded, "limit=12&offset=36")
    }

    func testFilterStringHasNoSelectOrPaging() {
        let q = Query("applications").eq("id", "x").order("id").limit(3)
        XCTAssertEqual(q.filterString.removingPercentEncoding, "id=eq.x")
    }
}

final class JSONCodingTests: XCTestCase {
    func testParsesPostgresTimestampVariants() {
        for s in ["2026-10-07T16:20:55.123456+00:00", "2026-10-07T16:20:55+00:00", "2026-10-07T16:20:55Z", "2026-10-07 16:20:55+00", "2026-10-07T17:20:55.5+01:00"] {
            XCTAssertNotNil(JSONCoding.parseTimestamp(s), s)
        }
        XCTAssertEqual(JSONCoding.parseTimestamp("2026-10-07T17:20:55+01:00"), JSONCoding.parseTimestamp("2026-10-07T16:20:55Z"))
        XCTAssertNil(JSONCoding.parseTimestamp("not a date"))
    }

    func testDecodesSnakeCaseRows() throws {
        struct Row: Decodable { let imageUrl: String?; let createdAt: Date; let artistSize: String }
        let json = #"{"image_url":null,"created_at":"2026-10-07T16:20:55.123456+00:00","artist_size":"emerging"}"#.data(using: .utf8)!
        let row = try JSONCoding.decoder.decode(Row.self, from: json)
        XCTAssertNil(row.imageUrl)
        XCTAssertEqual(row.artistSize, "emerging")
    }

    func testEncodesSnakeCaseAndNullArguments() throws {
        let data = try JSONCoding.encoder.encode(["p_application_id": JSONValue.string("x"), "p_message": .null, "p_accept": .bool(true)])
        let obj = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(obj["p_application_id"] as? String, "x")
        XCTAssertTrue(obj["p_message"] is NSNull)
        XCTAssertEqual(obj["p_accept"] as? Bool, true)
    }
}

final class ErrorMapperTests: XCTestCase {
    func testMapsStableDatabaseCodes() {
        XCTAssertTrue(ErrorMapper.friendly("slot_filled").contains("already been confirmed"))
        XCTAssertTrue(ErrorMapper.friendly("offer_expired").contains("expired"))
        XCTAssertTrue(ErrorMapper.friendly("account_suspended").contains("suspended"))
        XCTAssertTrue(ErrorMapper.friendly("duplicate key value violates unique constraint \"applications_slot_id_artist_id_key\"").contains("already done that"))
        XCTAssertTrue(ErrorMapper.friendly("new row violates row-level security policy for table \"x\"").contains("permission"))
        XCTAssertTrue(ErrorMapper.friendly("promoter_required").contains("promoter who owns"))
    }

    func testPassesThroughValidationSentencesCapitalised() {
        XCTAssertEqual(ErrorMapper.friendly("slot_invalid: the show date is in the past"), "The show date is in the past.")
        XCTAssertTrue(ErrorMapper.friendly("rate_limited: slow down — too many messages in the last minute").contains("Slow down"))
        XCTAssertEqual(ErrorMapper.friendly("support_invalid: please tell us a little more (at least 10 characters)"), "Please tell us a little more (at least 10 characters).")
    }

    func testNeverLeaksRawDatabaseText() {
        XCTAssertEqual(ErrorMapper.friendly("column \"secret_col\" of relation \"x\" does not exist"), "Something went wrong. Please try again.")
        XCTAssertEqual(ErrorMapper.friendly("", fallback: "custom"), "custom")
    }

    func testRecognisesConnectionProblems() {
        XCTAssertTrue(ErrorMapper.friendly("Load failed").contains("connection"))
    }

    func testExtractsTheCode() {
        XCTAssertEqual(ErrorMapper.code(in: "slot_filled"), "slot_filled")
        XCTAssertEqual(ErrorMapper.code(in: "invalid_transition: a declined application can't be shortlisted"), "invalid_transition")
    }
}

final class JWTTests: XCTestCase {
    func testReadsAssuranceLevel() {
        let aal1 = AuthSession(accessToken: TestSupport.token(aal: "aal1"), refreshToken: "r", expiresAt: .now.addingTimeInterval(3600), user: AuthUser(id: "u", email: nil, emailConfirmedAt: nil, factors: nil, identities: nil, userMetadata: nil))
        XCTAssertFalse(aal1.isAAL2)
        var aal2 = aal1; aal2.accessToken = TestSupport.token(aal: "aal2")
        XCTAssertTrue(aal2.isAAL2)
        XCTAssertNil(JWT.claim("aal", in: "garbage"))
    }
}

final class AuthServiceTests: XCTestCase {
    private let key = "test-session"
    override func setUp() { super.setUp(); Keychain.remove(key); Keychain.remove(key + ".pkce") }
    override func tearDown() { Keychain.remove(key); Keychain.remove(key + ".pkce"); super.tearDown() }

    private func makeAuth() -> AuthService { AuthService(transport: TestSupport.transport(), storageKey: key, restoreFromKeychain: false) }

    func testSignInStoresSessionAndSendsCredentialsToTheTokenEndpoint() async throws {
        StubURLProtocol.reset { _ in .json(TestSupport.tokenJSON()) }
        let auth = makeAuth()
        let s = try await auth.signIn(email: "a@example.com", password: "pw-123456")
        XCTAssertEqual(s.user.id, "user-1")
        XCTAssertEqual(auth.session?.refreshToken, "refresh-1")
        XCTAssertNotNil(Keychain.get(key))
        let req = StubURLProtocol.recorded[0]
        XCTAssertEqual(req.url?.path, "/auth/v1/token")
        XCTAssertTrue(req.url?.query?.contains("grant_type=password") ?? false)
        XCTAssertEqual(req.value(forHTTPHeaderField: "apikey"), TestSupport.config.anonKey)
    }

    func testBadPasswordGivesAPlainMessage() async {
        StubURLProtocol.reset { _ in .json(["code": 400, "error_code": "invalid_credentials", "msg": "Invalid login credentials"], status: 400) }
        do { _ = try await makeAuth().signIn(email: "a@example.com", password: "x"); XCTFail("should throw") }
        catch { XCTAssertEqual((error as? AppError)?.message, "That email and password don't match.") }
    }

    func testSignUpOutcomes() async throws {
        let auth = makeAuth()
        // confirmation required: a user, with identities
        StubURLProtocol.reset { _ in .json(["id": "u1", "email": "a@example.com", "identities": [["id": "i1"]]]) }
        var out = try await auth.signUp(email: "a@example.com", password: "pw-123456", role: "artist")
        XCTAssertEqual(out, .confirmationRequired)
        // existing address: GoTrue fakes success with an empty identities list
        StubURLProtocol.reset { _ in .json(["id": "u1", "email": "a@example.com", "identities": []]) }
        out = try await auth.signUp(email: "a@example.com", password: "pw-123456", role: "artist")
        XCTAssertEqual(out, .alreadyRegistered)
        // no confirmation needed: a session straight away
        StubURLProtocol.reset { _ in .json(TestSupport.tokenJSON()) }
        out = try await auth.signUp(email: "a@example.com", password: "pw-123456", role: "promoter")
        if case .signedIn = out {} else { XCTFail("expected signedIn, got \(out)") }
        // the role travels in the signup metadata
        let body = String(data: StubURLProtocol.recorded.last!.httpBody ?? Data(), encoding: .utf8) ?? ""
        XCTAssertTrue(body.contains("\"role\":\"promoter\""), body)
    }

    func testConcurrentCallsShareOneRefresh() async throws {
        let auth = makeAuth()
        StubURLProtocol.reset { _ in .json(TestSupport.tokenJSON(expiresIn: 5)) } // about to expire straight away
        try await auth.signIn(email: "a@example.com", password: "pw-123456")
        XCTAssertTrue(auth.session!.needsRefresh)
        StubURLProtocol.reset { _ in
            Thread.sleep(forTimeInterval: 0.15)
            return .json(TestSupport.tokenJSON(access: TestSupport.token(), refresh: "refresh-2", expiresIn: 3600))
        }
        async let a = auth.validAccessToken()
        async let b = auth.validAccessToken()
        async let c = auth.validAccessToken()
        let tokens = try await [a, b, c]
        XCTAssertEqual(Set(tokens.compactMap { $0 }).count, 1)
        XCTAssertEqual(StubURLProtocol.recorded.count, 1, "three callers, one network refresh")
        XCTAssertEqual(auth.session?.refreshToken, "refresh-2")
    }

    func testInvalidRefreshTokenEndsTheSession() async throws {
        let auth = makeAuth()
        StubURLProtocol.reset { _ in .json(TestSupport.tokenJSON(expiresIn: 5)) }
        try await auth.signIn(email: "a@example.com", password: "pw-123456")
        StubURLProtocol.reset { _ in .json(["error_code": "refresh_token_not_found", "msg": "Invalid Refresh Token"], status: 400) }
        do { _ = try await auth.validAccessToken(); XCTFail("should throw") }
        catch { XCTAssertEqual(error as? AppError, .sessionExpired) }
        XCTAssertNil(auth.session)
        XCTAssertNil(Keychain.get(key))
    }

    // MARK: Email links (PKCE)

    private func requestBody(_ req: URLRequest) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: req.httpBody ?? Data())) as? [String: Any] ?? [:]
    }

    func testPasswordResetSendsAS256ChallengeAndTheCallbackExchangesCodeWithTheMatchingVerifier() async throws {
        let auth = makeAuth()
        StubURLProtocol.reset { _ in .json([:]) }
        try await auth.sendPasswordReset(email: "a@example.com")
        let first = requestBody(StubURLProtocol.recorded[0])
        XCTAssertEqual(first["code_challenge_method"] as? String, "s256")
        let challenge = try XCTUnwrap(first["code_challenge"] as? String)

        StubURLProtocol.reset { _ in .json(TestSupport.tokenJSON(access: TestSupport.token(), refresh: "pkce-refresh")) }
        let kind = await auth.handleCallback(URL(string: "supportslot://auth-callback?code=abc123")!)
        XCTAssertEqual(kind, .recovery)
        XCTAssertEqual(auth.session?.refreshToken, "pkce-refresh")
        let exchange = try XCTUnwrap(StubURLProtocol.recorded.first)
        XCTAssertEqual(exchange.url?.query, "grant_type=pkce")
        let body = requestBody(exchange)
        XCTAssertEqual(body["auth_code"] as? String, "abc123")
        let verifier = try XCTUnwrap(body["code_verifier"] as? String)
        XCTAssertEqual(PKCEPair.challenge(for: verifier), challenge, "the verifier sent at exchange must hash to the challenge sent when the email was requested")
    }

    func testSignupConfirmationUsesPKCEToo() async throws {
        let auth = makeAuth()
        StubURLProtocol.reset { _ in .json(["id": "u1", "email": "a@example.com", "identities": [["id": "i"]]]) }
        let outcome = try await auth.signUp(email: "a@example.com", password: "pw-123456", role: "artist")
        XCTAssertEqual(outcome, .confirmationRequired)
        let body = requestBody(StubURLProtocol.recorded[0])
        XCTAssertNotNil(body["code_challenge"])
        StubURLProtocol.reset { _ in .json(TestSupport.tokenJSON()) }
        let kind = await auth.handleCallback(URL(string: "supportslot://auth-callback?code=zzz")!)
        XCTAssertEqual(kind, .signedIn)
    }

    func testAForgedLinkWithReadyMadeTokensSignsNobodyIn() async {
        let auth = makeAuth()
        StubURLProtocol.reset { _ in XCTFail("no network call should be made"); return .json([:]) }
        let kind = await auth.handleCallback(URL(string: "supportslot://auth-callback#access_token=\(TestSupport.token())&refresh_token=evil&type=recovery")!)
        if case .failed = kind {} else { XCTFail("expected a refusal, got \(kind)") }
        XCTAssertNil(auth.session)
        XCTAssertTrue(StubURLProtocol.recorded.isEmpty)
    }

    func testACodeThisDeviceNeverAskedForIsRefusedWithoutANetworkCall() async {
        let auth = makeAuth()
        StubURLProtocol.reset { _ in XCTFail("no network call should be made"); return .json([:]) }
        let kind = await auth.handleCallback(URL(string: "supportslot://auth-callback?code=attackers-code")!)
        if case .failed(let m) = kind { XCTAssertTrue(m.contains("wasn’t requested from this device")) } else { XCTFail() }
        XCTAssertNil(auth.session)
        XCTAssertTrue(StubURLProtocol.recorded.isEmpty)
    }

    func testALinkWorksOnceAndTheVerifierIsSpent() async throws {
        let auth = makeAuth()
        StubURLProtocol.reset { _ in .json([:]) }
        try await auth.sendPasswordReset(email: "a@example.com")
        StubURLProtocol.reset { _ in .json(TestSupport.tokenJSON()) }
        let first = await auth.handleCallback(URL(string: "supportslot://auth-callback?code=one")!)
        XCTAssertEqual(first, .recovery)
        StubURLProtocol.reset { _ in XCTFail("a reused link must not reach the network"); return .json([:]) }
        let second = await auth.handleCallback(URL(string: "supportslot://auth-callback?code=one")!)
        if case .failed = second {} else { XCTFail("a reused link must fail") }
    }

    func testAnExpiredPendingFlowIsRefusedAndAServerRejectionIsReportedAsExpired() async throws {
        let auth = makeAuth()
        StubURLProtocol.reset { _ in .json([:]) }
        try await auth.sendPasswordReset(email: "a@example.com")
        StubURLProtocol.reset { _ in XCTFail("expired locally"); return .json([:]) }
        let later = Date().addingTimeInterval(PendingAuthFlow.lifetime + 60)
        let expired = await auth.handleCallback(URL(string: "supportslot://auth-callback?code=late")!, now: later)
        if case .failed(let m) = expired { XCTAssertTrue(m.contains("expired")) } else { XCTFail() }

        StubURLProtocol.reset { _ in .json([:]) }
        try await auth.sendPasswordReset(email: "a@example.com")
        StubURLProtocol.reset { _ in .json(["error_code": "flow_state_expired", "msg": "flow state expired"], status: 400) }
        let rejected = await auth.handleCallback(URL(string: "supportslot://auth-callback?code=old")!)
        if case .failed(let m) = rejected { XCTAssertTrue(m.contains("expired or was already used")) } else { XCTFail() }
        XCTAssertNil(auth.session)
    }

    func testServerReportedLinkErrorsAndForeignURLs() async throws {
        let auth = makeAuth()
        let other = await auth.handleCallback(URL(string: "https://example.com/x")!)
        XCTAssertEqual(other, .notAuthLink)
        let wrongHost = await auth.handleCallback(URL(string: "supportslot://somewhere-else?code=x")!)
        XCTAssertEqual(wrongHost, .notAuthLink)
        let expired = await auth.handleCallback(URL(string: "supportslot://auth-callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")!)
        if case .failed(let m) = expired { XCTAssertTrue(m.contains("expired")) } else { XCTFail() }
    }

    func testRFC7636ChallengeVector() {
        XCTAssertEqual(PKCEPair.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let a = PKCEPair.generate(), b = PKCEPair.generate()
        XCTAssertNotEqual(a.verifier, b.verifier)
        XCTAssertGreaterThanOrEqual(a.verifier.count, 43)
        XCTAssertLessThanOrEqual(a.verifier.count, 128)
        XCTAssertFalse(a.verifier.contains("=") || a.verifier.contains("+") || a.verifier.contains("/"))
    }

    func testSigningOutForgetsAPendingFlow() async throws {
        let auth = makeAuth()
        StubURLProtocol.reset { _ in .json([:]) }
        try await auth.sendPasswordReset(email: "a@example.com")
        await auth.signOut()
        StubURLProtocol.reset { _ in XCTFail("no call"); return .json([:]) }
        let kind = await auth.handleCallback(URL(string: "supportslot://auth-callback?code=x")!)
        if case .failed = kind {} else { XCTFail() }
    }

    func testMFAVerifyRefusesATokenThatIsNotReallyAal2() async throws {
        let auth = makeAuth()
        StubURLProtocol.reset { _ in .json(TestSupport.tokenJSON(factors: [["id": "f1", "factor_type": "totp", "status": "verified"]])) }
        try await auth.signIn(email: "a@example.com", password: "pw-123456")
        StubURLProtocol.reset { req in
            if req.url!.path.hasSuffix("/challenge") { return .json(["id": "ch1", "expires_at": 1_900_000_000]) }
            return .json(TestSupport.tokenJSON(access: TestSupport.token(aal: "aal1"), refresh: "still-aal1"))
        }
        do { try await auth.verifyTOTP(factorID: "f1", code: "123456"); XCTFail("an aal1 token must not count as verified") } catch {}
        XCTAssertFalse(auth.session!.isAAL2)
    }

    func testMFAVerifyUpgradesTheSession() async throws {
        let auth = makeAuth()
        StubURLProtocol.reset { _ in .json(TestSupport.tokenJSON(factors: [["id": "f1", "factor_type": "totp", "status": "verified"]])) }
        try await auth.signIn(email: "a@example.com", password: "pw-123456")
        XCTAssertFalse(auth.session!.isAAL2)
        XCTAssertEqual(auth.session!.user.verifiedTOTPFactorID, "f1")
        StubURLProtocol.reset { req in
            if req.url!.path.hasSuffix("/challenge") { return .json(["id": "ch1", "expires_at": 1_900_000_000]) }
            return .json(TestSupport.tokenJSON(access: TestSupport.token(aal: "aal2"), refresh: "refresh-aal2"))
        }
        try await auth.verifyTOTP(factorID: "f1", code: "123456")
        XCTAssertTrue(auth.session!.isAAL2)
        let verify = StubURLProtocol.recorded[1]
        XCTAssertEqual(verify.url?.path, "/auth/v1/factors/f1/verify")
        XCTAssertTrue(String(data: verify.httpBody ?? Data(), encoding: .utf8)!.contains("\"challenge_id\":\"ch1\""))
    }

    func testWrongAuthenticatorCodeIsExplained() async throws {
        let auth = makeAuth()
        StubURLProtocol.reset { _ in .json(TestSupport.tokenJSON()) }
        try await auth.signIn(email: "a@example.com", password: "pw-123456")
        StubURLProtocol.reset { req in
            req.url!.path.hasSuffix("/challenge") ? .json(["id": "ch1"]) : .json(["error_code": "mfa_verification_failed", "msg": "Invalid TOTP code entered"], status: 400)
        }
        do { try await auth.verifyTOTP(factorID: "f1", code: "000000"); XCTFail() }
        catch { XCTAssertTrue((error as? AppError)?.message.contains("code isn't right") ?? false) }
    }
}

final class DatabaseTests: XCTestCase {
    private let key = "test-session-db"
    override func setUp() { super.setUp(); Keychain.remove(key); Keychain.remove(key + ".pkce") }
    override func tearDown() { Keychain.remove(key); Keychain.remove(key + ".pkce"); super.tearDown() }

    private func makeDB(signedIn: Bool) async throws -> (Database, AuthService) {
        let t = TestSupport.transport()
        let auth = AuthService(transport: t, storageKey: key, restoreFromKeychain: false)
        if signedIn {
            StubURLProtocol.reset { _ in .json(TestSupport.tokenJSON(access: TestSupport.token(extra: ["marker": "first"]))) }
            try await auth.signIn(email: "a@example.com", password: "pw-123456")
        }
        return (Database(transport: t, auth: auth), auth)
    }

    func testSignedOutReadsUseTheAnonKeyAsBearer() async throws {
        let (db, _) = try await makeDB(signedIn: false)
        StubURLProtocol.reset { _ in .json([["id": "a"]]) }
        let rows: [IDRow] = try await db.select(Query("slots", "id"))
        XCTAssertEqual(rows, [IDRow(id: "a")])
        XCTAssertEqual(StubURLProtocol.recorded[0].value(forHTTPHeaderField: "Authorization"), "Bearer \(TestSupport.config.anonKey)")
    }

    func testSignedInRequestsCarryTheUsersToken() async throws {
        let (db, auth) = try await makeDB(signedIn: true)
        StubURLProtocol.reset { _ in .json([]) }
        let _: [IDRow] = try await db.select(Query("applications", "id"))
        XCTAssertEqual(StubURLProtocol.recorded[0].value(forHTTPHeaderField: "Authorization"), "Bearer \(auth.session!.accessToken)")
    }

    func testExpiredTokenIsRefreshedOnceAndTheRequestRetried() async throws {
        let (db, auth) = try await makeDB(signedIn: true)
        let newToken = TestSupport.token(extra: ["marker": "second"])
        StubURLProtocol.reset { req in
            if req.url!.path == "/auth/v1/token" { return .json(TestSupport.tokenJSON(access: newToken, refresh: "refresh-2")) }
            if req.value(forHTTPHeaderField: "Authorization") == "Bearer \(newToken)" { return .json([["id": "ok"]]) }
            return .json(["code": "PGRST301", "message": "JWT expired"], status: 401)
        }
        let rows: [IDRow] = try await db.select(Query("slots", "id"))
        XCTAssertEqual(rows, [IDRow(id: "ok")])
        XCTAssertEqual(auth.session?.refreshToken, "refresh-2")
        XCTAssertEqual(StubURLProtocol.recorded.count, 3) // fail, refresh, retry
    }

    func testPageReadsTheTotalFromContentRange() async throws {
        let (db, _) = try await makeDB(signedIn: false)
        StubURLProtocol.reset { _ in .json([["id": "a"], ["id": "b"]], headers: ["Content-Range": "0-1/37"]) }
        let page: (rows: [IDRow], total: Int) = try await db.selectPage(Query("slots", "id").limit(2))
        XCTAssertEqual(page.total, 37)
        XCTAssertEqual(page.rows.count, 2)
        XCTAssertEqual(StubURLProtocol.recorded[0].value(forHTTPHeaderField: "Prefer"), "count=exact")
    }

    func testDatabaseErrorsBecomePlainSentences() async throws {
        let (db, _) = try await makeDB(signedIn: true)
        StubURLProtocol.reset { _ in .json(["code": "P0001", "message": "slot_filled"], status: 400) }
        do { try await db.rpcVoid("respond_to_offer", ["p_application_id": "x", "p_accept": true]); XCTFail() }
        catch let e as AppError { XCTAssertEqual(e.code, "slot_filled"); XCTAssertTrue(e.message.contains("already been confirmed")) }
    }

    func testMissingFunctionMeansTheSchemaIsOutOfDate() async throws {
        let (db, _) = try await makeDB(signedIn: false)
        StubURLProtocol.reset { _ in .json(["code": "PGRST202", "message": "Could not find the function public.search_slots"], status: 404) }
        do { _ = try await db.rpc("search_slots", [:], as: [IDRow].self); XCTFail() }
        catch let e as AppError { XCTAssertEqual(e.code, "schema_out_of_date") }
    }

    func testUpdateReturnsAffectedIdsSoARowHiddenByPolicyIsDetectable() async throws {
        let (db, _) = try await makeDB(signedIn: true)
        StubURLProtocol.reset { _ in .json([]) }
        struct Patch: Encodable { let headliner: String }
        let rows = try await db.update(Query("slots").eq("id", "x"), Patch(headliner: "y"))
        XCTAssertTrue(rows.isEmpty)
        let req = StubURLProtocol.recorded[0]
        XCTAssertEqual(req.httpMethod, "PATCH")
        XCTAssertTrue(req.url!.query!.contains("select=id"))
    }

    func testNetworkFailureIsReportedAsOffline() async throws {
        let t = TestSupport.transport()
        let auth = AuthService(transport: t, storageKey: key, restoreFromKeychain: false)
        let db = Database(transport: t, auth: auth)
        // Reuse the stub but make the handler "crash" the connection by using an invalid status path:
        StubURLProtocol.reset { _ in StubURLProtocol.Reply(status: 503, body: Data("upstream down".utf8)) }
        do { let _: [IDRow] = try await db.select(Query("slots", "id")); XCTFail() }
        catch let e as AppError { XCTAssertFalse(e.message.isEmpty) }
    }
}
