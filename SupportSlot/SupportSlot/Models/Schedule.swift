import Foundation

enum ScheduleKind: String, CaseIterable, Identifiable {
    case arrival, load_in, soundcheck, doors, performance, changeover, `break`, other
    var id: String { rawValue }
    var label: String {
        switch self {
        case .arrival: return "Arrival"
        case .load_in: return "Load-in"
        case .soundcheck: return "Soundcheck"
        case .doors: return "Doors"
        case .performance: return "Performance"
        case .changeover: return "Changeover"
        case .break: return "Break"
        case .other: return "Other"
        }
    }
}

// table: show_schedules
/// One event's private running order. `version` backs optimistic-concurrency
/// saves: every write first claims the next version, and a lost race reads as
/// "stale" so the screen reloads instead of overwriting someone else's edit.
struct ShowSchedule: Decodable, Identifiable, Equatable {
    let id: ID
    let slotId: ID
    let promoterId: ID
    let status: String
    let version: Int
    let updatedAt: Date
    static let columns = "id, slot_id, promoter_id, status, version, updated_at"
}

// table: schedule_entries
/// One item on a running order. start/end are naive Europe/London wall-clock
/// strings ("YYYY-MM-DDTHH:mm:ss") — they mirror the database's `timestamp`
/// columns, so an event running past midnight just works.
struct ScheduleEntry: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let scheduleId: ID
    var kind: String
    var title: String
    var stage: String
    var startAt: String
    var endAt: String
    var artistId: ID?
    var notes: String
    var sortOrder: Int
    static let columns = "id, schedule_id, kind, title, stage, start_at, end_at, artist_id, notes, sort_order"

    var scheduleKind: ScheduleKind { ScheduleKind(rawValue: kind) ?? .other }
}

// table: schedule_template_entries
struct ScheduleTemplateEntry: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let templateId: ID
    let kind: String
    let title: String
    let stage: String
    let offsetMinutes: Int
    let durationMinutes: Int
    let sortOrder: Int
    static let columns = "id, template_id, kind, title, stage, offset_minutes, duration_minutes, sort_order"
}

// table: schedule_templates
struct ScheduleTemplate: Decodable, Identifiable, Equatable {
    let id: ID
    let name: String
    let scheduleTemplateEntries: [ScheduleTemplateEntry]?
    static let columns = "id, name, schedule_template_entries(\(ScheduleTemplateEntry.columns))"
    var entries: [ScheduleTemplateEntry] { (scheduleTemplateEntries ?? []).sorted { $0.sortOrder < $1.sortOrder } }
}

/// What the schedule screen edits before it becomes a row.
struct ScheduleEntryDraft: Equatable {
    var kind: ScheduleKind = .performance
    var title = ""
    var stage = ScheduleRules.defaultStage
    var startAt = ""
    var endAt = ""
    var artistId: ID?
    var notes = ""
    var sortOrder = 0
}
