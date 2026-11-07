// Fictional fixture data for local/test databases ONLY. Every name, bio and
// link here is made up. Used by scripts/seed-dev-fixtures.mjs.

import { PLACES as P } from "./live.mjs";
export const DOMAIN = "example.com";
const img = (seed, w = 600, h = 600) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const demo = (path) => `https://example.com/demo/${path}`;

// login: true  → gets a known password.
export const PEOPLE = [
  {
    key: "artist1", login: true, role: "artist", email: `demo-artist@${DOMAIN}`, username: "demo_mara_quill",
    artist: {
      handle: "mara-quill-demo", name: "Mara Quill", place: P.manchester, genres: ["Indie", "Folk"],
      artist_size: "developing", travel_radius_miles: 120, monthly_listeners: 12400, availability: "available",
      last_minute_alerts: true,
      bio: "DEMO DATA — fictional artist. Fingerpicked indie-folk with a loop pedal and a lot of reverb.",
      tracks: [
        { title: "Paper Lanterns", duration: "3:42", url: demo("mara-quill/paper-lanterns") },
        { title: "Slow Weather", duration: "4:05", url: demo("mara-quill/slow-weather") },
        { title: "Kitchen Light", duration: "2:58", url: null },
      ],
      shows: [
        { kind: "past", headliner: "The Fenwick Set (fictional)", venue: "YES Basement", city: "Manchester", date: "2026-05-16" },
        { kind: "past", headliner: "Low Tide Radio (fictional)", venue: "The Warehouse Exchange", city: "Leeds", date: "2026-07-04" },
      ],
    },
  },
  {
    key: "artist2", login: true, role: "artist", email: `demo-artist2@${DOMAIN}`, username: "demo_dex_harlow",
    artist: {
      handle: "dex-harlow-demo", name: "Dex Harlow", place: P.london, genres: ["Electronic", "Pop"],
      artist_size: "emerging", travel_radius_miles: 200, monthly_listeners: 3100, availability: "available",
      last_minute_alerts: false,
      bio: "DEMO DATA — fictional artist. Hardware synths, sad lyrics, danceable drums.",
      tracks: [
        { title: "Night Bus Neon", duration: "3:21", url: demo("dex-harlow/night-bus-neon") },
        { title: "Static Hearts", duration: "3:50", url: demo("dex-harlow/static-hearts") },
      ],
      shows: [{ kind: "past", headliner: "Glass Avenue (fictional)", venue: "Village Underground", city: "London", date: "2026-06-12" }],
    },
  },
  {
    key: "artist3", role: "artist", email: `demo-juno@${DOMAIN}`, username: "demo_juno_vale",
    artist: {
      handle: "juno-vale-demo", name: "Juno Vale", place: P.bristol, genres: ["Alternative", "Rock"],
      artist_size: "developing", travel_radius_miles: 150, monthly_listeners: 8800, availability: "limited",
      last_minute_alerts: true, bio: "DEMO DATA — fictional artist. Loud guitars, quiet verses.",
      tracks: [{ title: "Salt Flats", duration: "3:33", url: demo("juno-vale/salt-flats") }], shows: [],
    },
  },
  {
    key: "artist4", role: "artist", email: `demo-saltwells@${DOMAIN}`, username: "demo_salt_wells",
    artist: {
      handle: "the-salt-wells-demo", name: "The Salt Wells", place: P.leeds, genres: ["Punk", "Rock"],
      artist_size: "emerging", travel_radius_miles: 100, monthly_listeners: 1500, availability: "available",
      last_minute_alerts: false, bio: "DEMO DATA — fictional band. Three chords, no apologies.",
      tracks: [{ title: "Bus Stop Anthem", duration: "2:12", url: demo("salt-wells/bus-stop-anthem") }], shows: [],
    },
  },
  {
    key: "artist5", role: "artist", email: `demo-odette@${DOMAIN}`, username: "demo_odette_rowe",
    artist: {
      handle: "odette-rowe-demo", name: "Odette Rowe", place: P.brighton, genres: ["R&B", "Pop"],
      artist_size: "emerging", travel_radius_miles: 90, monthly_listeners: 2200, availability: "available",
      last_minute_alerts: true, bio: "DEMO DATA — fictional artist. Late-night R&B for early-evening slots.",
      tracks: [{ title: "Half Past Honey", duration: "3:09", url: demo("odette-rowe/half-past-honey") }], shows: [],
    },
  },
  {
    key: "artist6", role: "artist", email: `demo-gwen@${DOMAIN}`, username: "demo_gwen_tyrell",
    artist: {
      handle: "gwen-tyrell-demo", name: "Gwen Tyrell", place: P.aberystwyth, genres: ["Folk", "Alternative"],
      artist_size: "emerging", travel_radius_miles: 120, monthly_listeners: 900, availability: "available",
      last_minute_alerts: true, bio: "DEMO DATA — fictional artist from a small Welsh coastal town.",
      tracks: [{ title: "Harbour Wall", duration: "3:15", url: demo("gwen-tyrell/harbour-wall") }], shows: [],
    },
  },
  {
    key: "artist7", role: "artist", email: `demo-ciaran@${DOMAIN}`, username: "demo_ciaran_boyle",
    artist: {
      handle: "ciaran-boyle-demo", name: "Ciarán Boyle", place: P.derry, genres: ["Indie", "Rock"],
      artist_size: "developing", travel_radius_miles: 200, monthly_listeners: 5400, availability: "available",
      last_minute_alerts: false, bio: "DEMO DATA — fictional artist from Derry (no county needed).",
      tracks: [{ title: "Foyle Lights", duration: "3:48", url: demo("ciaran-boyle/foyle-lights") }], shows: [],
    },
  },
  {
    key: "artist8", role: "artist", email: `demo-morag@${DOMAIN}`, username: "demo_morag_ross",
    artist: {
      handle: "morag-ross-demo", name: "Morag Ross", place: P.inverness, genres: ["Folk", "Pop"],
      artist_size: "emerging", travel_radius_miles: 250, monthly_listeners: 2600, availability: "limited",
      last_minute_alerts: true, bio: "DEMO DATA — fictional artist from the Highlands.",
      tracks: [{ title: "Long Light", duration: "3:02", url: demo("morag-ross/long-light") }], shows: [],
    },
  },
  {
    key: "promA", login: true, role: "promoter", email: `demo-promoter@${DOMAIN}`, username: "demo_northern_lights",
    promoter: { name: "Sam Okoye", company: "Northern Lights Live (Demo)", place: P.manchester },
  },
  {
    key: "promB", login: true, role: "promoter", email: `demo-promoter-plus@${DOMAIN}`, username: "demo_harbour_co",
    promoter: { name: "Lena Brandt", company: "Harbour & Co. Sessions (Demo)", place: P.london },
  },
  {
    key: "admin", login: true, role: "promoter", email: `demo-admin@${DOMAIN}`, username: "demo_staff",
    adminRole: "admin",
    promoter: { name: "Support Slot Staff", company: "Support Slot Staff (Demo)", place: P.london },
  },
];

export const imageFor = (key) => ({
  avatar: img(`ss-demo-${key}`, 400, 400),
  banner: img(`ss-demo-banner-${key}`, 1400, 500),
});

// Venues outside the six curated ones, anywhere in the UK. `typedIn: true` has no map position
// (what a person gets when place search is unavailable) so it can't appear in radius searches.
export const FIXTURE_VENUES = [
  { key: "edinburgh", owner: "promB", name: "Leith Corn Hall (Demo)", address: "1 Constitution St, Edinburgh", capacity: 320, place: P.edinburgh },
  { key: "belfast", owner: "promA", name: "Cathedral Quarter Room (Demo)", address: "10 Hill St, Belfast", capacity: 220, place: P.belfast },
  { key: "aberystwyth", owner: "promA", name: "Promenade Social Club (Demo)", address: "Marine Terrace, Aberystwyth", capacity: 140, place: P.aberystwyth, typedIn: true },
  { key: "newport-wales", owner: "promB", name: "Dock Street Hall (Demo)", address: "Dock St, Newport, Wales", capacity: 260, place: P.newportWales },
  { key: "newport-shropshire", owner: "promB", name: "Market Barn (Demo)", address: "High St, Newport, Shropshire", capacity: 180, place: P.newportShropshire },
  { key: "inverness", owner: "promA", name: "Ness Bank Church Hall (Demo)", address: "Ness Bank, Inverness", capacity: 200, place: P.inverness },
];

// Steps: view | shortlist | decline | offer | accept | declineOffer | withdraw
// finalize: close | cancel   (done by the listing's owner after the applications)
export const SLOTS = [
  { n: 1, owner: "promA", venue: "venue-2", headliner: "The Midnight Orchids", days: 21, deadline: 14,
    genres: ["Indie", "Alternative"], fee: 150, travel: 20, attendance: 350, sizeFit: ["emerging", "developing"],
    reqs: ["Own backline for guitars", "30 minute set"],
    desc: "DEMO LISTING — fictional show. Looking for a warm, melodic opener.",
    apps: [
      { n: 1, artist: "artist1", msg: "Would love to open this one — I play Manchester a lot.", steps: [] },
      { n: 2, artist: "artist2", msg: "Synth-pop opener, 25 minutes, own laptop rig.", steps: ["view", "shortlist"] },
      { n: 3, artist: "artist3", msg: "Loud but tuneful, happy to travel.", steps: ["view"] },
      { n: 4, artist: "artist4", msg: "Fast, short, fun.", steps: ["view", "decline"] },
      { n: 5, artist: "artist5", msg: "Can no longer make the date.", steps: ["withdraw"] },
    ] },
  { n: 2, owner: "promB", venue: "venue-1", headliner: "Static Garden", days: 0, deadline: 0, urgent: true,
    genres: ["Electronic", "Pop"], fee: 120, travel: 15, attendance: 600, sizeFit: ["emerging"],
    reqs: ["Can load in by 6pm"], desc: "DEMO LISTING — fictional show. Support act dropped out; need a replacement tonight.",
    apps: [{ n: 1, artist: "artist2", msg: "Free tonight and ten minutes away.", steps: [] }] },
  { n: 3, owner: "promB", venue: "venue-1", headliner: "Quiet Riot Club", days: 28, deadline: 21,
    genres: ["Indie", "Folk"], fee: 200, travel: 30, attendance: 700, sizeFit: ["developing", "established"],
    reqs: ["35 minute set", "Merch table available"], desc: "DEMO LISTING — fictional show. Seated, listening crowd.",
    apps: [
      { n: 1, artist: "artist1", msg: "Folk-leaning set, perfect for a seated room.",
        steps: ["view", "shortlist", "offer"], offerMsg: "We'd love you on this bill — terms below." },
      { n: 2, artist: "artist3", msg: "Would be a great fit.", steps: ["view", "shortlist"] },
      { n: 3, artist: "artist4", msg: "Louder than your usual bill, but keen.", steps: [] },
    ] },
  { n: 4, owner: "promA", venue: "venue-5", headliner: "Hollow Parade", days: 35, deadline: 28,
    genres: ["Rock", "Punk"], fee: 100, travel: 25, attendance: 400, sizeFit: ["emerging"],
    reqs: ["Share backline"], desc: "DEMO LISTING — fictional show. No applications yet.", apps: [] },
  { n: 5, owner: "promA", venue: "venue-2", headliner: "Velvet Harbour", days: 14, deadline: 10,
    genres: ["Indie", "Folk"], fee: 180, travel: 20, attendance: 350, sizeFit: ["developing"],
    reqs: ["30 minute set"], desc: "DEMO LISTING — fictional show. Filled: one confirmed booking.",
    apps: [
      { n: 1, artist: "artist2", msg: "Would be a perfect pairing.", steps: [] },
      { n: 2, artist: "artist3", msg: "Keen to play.", steps: ["view", "shortlist", "offer"] },
      { n: 3, artist: "artist1", msg: "Home-city show — yes please.",
        steps: ["view", "shortlist", "offer", "accept"], offerMsg: "Delighted to offer you this slot." },
    ] },
  { n: 6, owner: "promA", venue: "venue-3", headliner: "Brass Coast", days: 30, deadline: 20,
    genres: ["Alternative"], fee: 130, travel: 30, attendance: 250, sizeFit: ["emerging", "developing"],
    reqs: [], desc: "DEMO LISTING — fictional show. Closed by the promoter.",
    apps: [{ n: 1, artist: "artist2", msg: "Interested if it reopens.", steps: [] }], finalize: "close" },
  { n: 7, owner: "promB", venue: "venue-6", headliner: "Neon Ferry", days: 40, deadline: 30,
    genres: ["Pop", "R&B"], fee: 140, travel: 20, attendance: 300, sizeFit: ["emerging"],
    reqs: ["25 minute set"], desc: "DEMO LISTING — fictional show. Cancelled after a booking was confirmed.",
    apps: [
      { n: 1, artist: "artist3", msg: "Would love to play Brighton.",
        steps: ["view", "shortlist", "offer", "accept"], offerMsg: "Offer for Neon Ferry." },
      { n: 2, artist: "artist1", msg: "Interested.", steps: [] },
    ], finalize: "cancel", cancelReason: "Headliner pulled out (demo data)." },
  { n: 8, owner: "promA", venue: "venue-4", headliner: "Marble Arch Sound", days: 45, deadline: 35,
    genres: ["Electronic", "Experimental"], fee: 110, travel: 15, attendance: 180, sizeFit: ["emerging"],
    reqs: [], desc: "DEMO LISTING — fictional show. An offer was declined, the slot is open again.",
    apps: [{ n: 1, artist: "artist2", msg: "Experimental electronics set.",
      steps: ["view", "shortlist", "offer", "declineOffer"], offerMsg: "Offer for Marble Arch Sound.",
      declineReason: "Dates clash with another show." }] },
  { n: 9, owner: "promB", venue: "venue-6", headliner: "Sunday Driver", days: 18, deadline: 12,
    genres: ["Pop", "Indie"], fee: 160, travel: 20, attendance: 300, sizeFit: ["emerging", "developing"],
    reqs: ["Backing tracks OK"], desc: "DEMO LISTING — fictional show. One pending offer.",
    apps: [
      { n: 1, artist: "artist2", msg: "Pop-leaning electronic set.", steps: ["view", "shortlist", "offer"], offerMsg: "Offer for Sunday Driver." },
      { n: 2, artist: "artist5", msg: "Brighton local.", steps: [] },
    ] },
  { n: 10, owner: "promB", venue: "fixture:edinburgh", headliner: "Forth Road Revival", days: 26, deadline: 18,
    genres: ["Indie", "Rock"], fee: 170, travel: 5, attendance: 300, sizeFit: ["developing"],
    reqs: ["30 minute set"], desc: "DEMO LISTING — fictional show in Scotland. Travel listed at £5: for a long journey the database lifts it to £10.",
    apps: [{ n: 1, artist: "artist1", msg: "Happy to come up from Manchester.", steps: ["view", "shortlist"] }] },
  { n: 11, owner: "promA", venue: "fixture:belfast", headliner: "Lagan Lines", days: 33, deadline: 25,
    genres: ["Indie", "Alternative"], fee: 140, travel: 30, attendance: 200, sizeFit: ["emerging", "developing"],
    reqs: [], desc: "DEMO LISTING — fictional show in Northern Ireland.", apps: [] },
  { n: 12, owner: "promA", venue: "fixture:aberystwyth", headliner: "Coastal Static", days: 22, deadline: 15,
    genres: ["Folk"], fee: 90, travel: 10, attendance: 120, sizeFit: ["emerging"],
    reqs: [], desc: "DEMO LISTING — fictional show whose venue was typed in (no map position): it appears in text search but not in a radius search, and the minimum-travel rule applies.", apps: [] },
  { n: 13, owner: "promB", venue: "fixture:newport-wales", headliner: "Usk Valley Sessions", days: 24, deadline: 16,
    genres: ["Pop", "Indie"], fee: 110, travel: 10, attendance: 240, sizeFit: ["emerging"],
    reqs: [], desc: "DEMO LISTING — fictional show in Newport, Wales (not to be confused with the other Newports).", apps: [] },
  { n: 14, owner: "promB", venue: "fixture:newport-shropshire", headliner: "Edgmond Evenings", days: 27, deadline: 19,
    genres: ["Folk", "Indie"], fee: 100, travel: 10, attendance: 160, sizeFit: ["emerging"],
    reqs: [], desc: "DEMO LISTING — fictional show in Newport, Shropshire.", apps: [] },
];

// [slot, application, who starts the thread, messages]
export const THREADS = [
  { slot: 3, app: 1, starter: "promoter", read: "none", messages: [
    ["promoter", "Hi Mara — loved your demo track. Are you free on the night?"],
    ["artist", "Thanks! Yes, I'm free. Is there a soundcheck window?"],
    ["promoter", "Soundcheck at 5pm. Offer is in your Applications page."],
  ] },
  { slot: 5, app: 3, starter: "promoter", read: "both", messages: [
    ["promoter", "Congratulations — you're confirmed for Velvet Harbour."],
    ["artist", "Brilliant, thank you! I'll bring my own pedalboard."],
  ] },
  { slot: 1, app: 2, starter: "promoter", read: "none", messages: [
    ["promoter", "Thanks for applying, Dex. How many tracks do you play live?"],
    ["artist", "Around six in 25 minutes."],
  ] },
  { slot: 9, app: 1, starter: "promoter", read: "none", messages: [
    ["promoter", "We've sent you an offer for Sunday Driver."],
  ] },
];

export const SAVED = [
  { who: "artist1", slots: [2, 4] },
  { who: "artist2", slots: [3] },
];

export const REPORT = {
  by: "artist2", slot: 1, against: "promA",
  reason: "Demo report: the listing wording is unclear about the load-in time (fixture data).",
};
