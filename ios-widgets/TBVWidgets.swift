// TBV's Home Screen widgets. The app writes what they show
// (Widget/snapshot.json and small covers) into the App Group it shares with
// them, and asks iOS to redraw them (src-tauri/src/widgets.rs). A tap opens
// TBV with a theboundvigil:// link, which the app follows (src/widgets.ts).
//
// embre's ten (13 November): small Continue Reading, Continue Listening,
// Reading Today, Reading Activity and Quick Access; medium Continue Reading
// & Listening, Reading Shelf, Quick Access, Scribe Workspace and Reading
// Activity. Large and Lock Screen widgets are left out for now.
import AppIntents
import SwiftUI
import UIKit
import WidgetKit

// MARK: - What the app wrote

struct WidgetBook: Codable, Hashable {
  let id: String
  let title: String
  let author: String
  let progress: Double
  let cover: String?
}

struct WidgetSigil: Codable, Hashable {
  let id: String
  let title: String
  let icon: String
  let cover: String?
}

struct WidgetAudio: Codable, Hashable {
  let bookId: String
  let title: String
  let author: String
  let playing: Bool
  let progress: Double
  let cover: String?
}

struct WidgetDay: Codable, Hashable {
  let day: String
  let readMinutes: Int
  let listenMinutes: Int
}

struct WidgetProject: Codable, Hashable {
  let id: String
  let title: String
  let chapters: Int
  let cover: String?
}

struct WidgetNote: Codable, Hashable {
  let id: String
  let title: String
  let preview: String
}

struct Snapshot: Codable {
  var current: WidgetBook?
  var inProgress: [WidgetBook]
  var sigils: [WidgetSigil]
  var todayReadMinutes: Int
  var todayListenMinutes: Int
  var audio: WidgetAudio?
  // Optional, so a file from an older TBV still reads.
  var week: [WidgetDay]?
  var project: WidgetProject?
  var notes: [WidgetNote]?
  var day: String

  static let empty = Snapshot(current: nil, inProgress: [], sigils: [], todayReadMinutes: 0, todayListenMinutes: 0,
                              audio: nil, week: nil, project: nil, notes: nil, day: "")

  /// Shown while a widget is being picked, before TBV has written anything.
  static let sample = Snapshot(
    current: WidgetBook(id: "", title: "Paradise Lost", author: "John Milton", progress: 0.42, cover: nil),
    inProgress: [
      WidgetBook(id: "", title: "Paradise Lost", author: "John Milton", progress: 0.42, cover: nil),
      WidgetBook(id: "", title: "The Odyssey", author: "Homer", progress: 0.18, cover: nil),
      WidgetBook(id: "", title: "Middlemarch", author: "George Eliot", progress: 0.73, cover: nil),
      WidgetBook(id: "", title: "Beowulf", author: "Unknown", progress: 0.05, cover: nil),
    ],
    sigils: [
      WidgetSigil(id: "", title: "Discover", icon: "compass", cover: nil),
      WidgetSigil(id: "", title: "Archive", icon: "library", cover: nil),
      WidgetSigil(id: "", title: "Scribe", icon: "feather", cover: nil),
      WidgetSigil(id: "", title: "Resonance", icon: "headphones", cover: nil),
    ],
    todayReadMinutes: 25, todayListenMinutes: 40,
    audio: WidgetAudio(bookId: "", title: "The Odyssey", author: "Homer", playing: false, progress: 0.18, cover: nil),
    week: [20, 35, 0, 45, 15, 60, 25].enumerated().map { i, read in
      WidgetDay(day: "", readMinutes: read, listenMinutes: [30, 0, 20, 10, 40, 15, 40][i])
    },
    project: WidgetProject(id: "", title: "The Long Watch", chapters: 12, cover: nil),
    notes: [
      WidgetNote(id: "", title: "Opening line", preview: "The lamp was lit before the first bell."),
      WidgetNote(id: "", title: "Names", preview: "Keeper, Warden, the one who waits."),
    ],
    day: "")
}

enum Store {
  static let folder: URL? = FileManager.default
    .containerURL(forSecurityApplicationGroupIdentifier: "group.com.krowsingre.theboundvigil")?
    .appendingPathComponent("Widget", isDirectory: true)

  static func load() -> Snapshot {
    guard let file = folder?.appendingPathComponent("snapshot.json"),
          let data = try? Data(contentsOf: file),
          let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data)
    else { return .empty }
    return snapshot
  }

  /// What a widget shows: the sample while it's being picked and TBV hasn't
  /// written anything yet.
  static func shown(preview: Bool) -> Snapshot {
    let snapshot = load()
    let empty = snapshot.current == nil && snapshot.audio == nil && snapshot.sigils.isEmpty
    return preview && empty ? .sample : snapshot
  }

  static func image(_ name: String?) -> UIImage? {
    guard let name = name, let file = folder?.appendingPathComponent(name) else { return nil }
    return UIImage(contentsOfFile: file.path)
  }

  /// Today's date as TBV writes it (`YYYY-MM-DD`, this device's time).
  static func day(_ date: Date) -> String {
    let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }

  /// The next midnight, when today's minutes go back to none.
  static func midnight(after date: Date) -> Date {
    Calendar.current.startOfDay(for: date.addingTimeInterval(86_400))
  }
}

// MARK: - Links

enum Links {
  static func escaped(_ text: String) -> String {
    text.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? text
  }
  static func book(_ id: String) -> URL { URL(string: "theboundvigil://book/\(escaped(id))")! }
  static func sigil(_ id: String) -> URL { URL(string: "theboundvigil://sigil/\(escaped(id))")! }
  static func audio(_ action: String, _ bookId: String) -> URL {
    URL(string: "theboundvigil://audio/\(action)?book=\(escaped(bookId))")!
  }
  static func page(_ route: String) -> URL { URL(string: "theboundvigil://page/\(route)")! }
  static func scribeBook(_ id: String) -> URL { URL(string: "theboundvigil://scribe/book/\(escaped(id))")! }
  static func scribeNote(_ id: String) -> URL { URL(string: "theboundvigil://scribe/note/\(escaped(id))")! }
  static let newNote = URL(string: "theboundvigil://scribe/new")!
  static let home = URL(string: "theboundvigil://home")!
}

// MARK: - Timeline

struct Entry: TimelineEntry {
  let date: Date
  let snapshot: Snapshot

  /// Minutes for the entry's own day: none yet on a new day TBV hasn't seen.
  var readMinutes: Int { Store.day(date) == snapshot.day ? snapshot.todayReadMinutes : 0 }
  var listenMinutes: Int { Store.day(date) == snapshot.day ? snapshot.todayListenMinutes : 0 }
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry { Entry(date: Date(), snapshot: .sample) }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    completion(Entry(date: Date(), snapshot: Store.shown(preview: context.isPreview)))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    let snapshot = Store.load()
    let now = Date()
    // A second entry at midnight sets today's minutes back to none. TBV asks
    // for a redraw whenever it writes something new.
    completion(Timeline(entries: [Entry(date: now, snapshot: snapshot), Entry(date: Store.midnight(after: now), snapshot: snapshot)], policy: .never))
  }
}

// MARK: - Look

enum Palette {
  static let ink = Color(red: 0x1a / 255, green: 0x1c / 255, blue: 0x1e / 255)
  static let bloom = Color(red: 0x2f / 255, green: 0x3a / 255, blue: 0x44 / 255)
  static let ash = Color(red: 0xe6 / 255, green: 0xe3 / 255, blue: 0xde / 255)
  static let slate = Color(red: 0x8f / 255, green: 0xa3 / 255, blue: 0xb5 / 255)
  /// Listening, beside reading's slate.
  static let listen = Color(red: 0xbb / 255, green: 0xaa / 255, blue: 0x8c / 255)
}

extension View {
  /// iOS 17 draws a widget's background itself; earlier ones need it here.
  @ViewBuilder func widgetBackground(_ color: Color) -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      containerBackground(for: .widget) { color }
    } else {
      background(color)
    }
  }
}

struct Cover: View {
  let name: String?
  let title: String

  var body: some View {
    if let image = Store.image(name) {
      Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
    } else {
      ZStack {
        Palette.bloom
        Text(title).font(.system(size: 11, weight: .semibold, design: .serif))
          .foregroundColor(Palette.ash).multilineTextAlignment(.center).padding(4)
      }
    }
  }
}

struct ProgressLine: View {
  let value: Double
  var color: Color = Palette.slate

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(Palette.ash.opacity(0.2))
        Capsule().fill(color).frame(width: geo.size.width * CGFloat(min(max(value, 0), 1)))
      }
    }
    .frame(height: 4)
  }
}

func percent(_ value: Double) -> String { "\(Int((min(max(value, 0), 1) * 100).rounded()))%" }

/// "45 min", or "1 h 20 min".
func duration(_ minutes: Int) -> String {
  minutes < 60 ? "\(minutes) min" : minutes % 60 == 0 ? "\(minutes / 60) h" : "\(minutes / 60) h \(minutes % 60) min"
}

struct Caption: View {
  let text: String
  var symbol: String? = nil

  var body: some View {
    HStack(spacing: 4) {
      if let symbol = symbol { Image(systemName: symbol) }
      Text(text)
    }
    .font(.caption2.weight(.semibold))
    .foregroundColor(Palette.slate)
    .lineLimit(1)
  }
}

struct Empty: View {
  let symbol: String
  let text: String

  var body: some View {
    VStack(spacing: 6) {
      Image(systemName: symbol).font(.title2)
      Text(text).font(.caption).multilineTextAlignment(.center)
    }
    .foregroundColor(Palette.ash.opacity(0.8))
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

// MARK: - 1. Continue Reading (small)

struct SmallBook: View {
  let title: String
  let cover: String?
  let progress: Double
  let caption: String
  let symbol: String
  var color: Color = Palette.slate

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      Caption(text: caption, symbol: symbol)
      Cover(name: cover, title: title)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 6))
      Text(title).font(.system(.caption, design: .serif).weight(.semibold))
        .foregroundColor(Palette.ash).lineLimit(1)
      HStack(spacing: 6) {
        ProgressLine(value: progress, color: color)
        Text(percent(progress)).font(.caption2).foregroundColor(Palette.ash.opacity(0.7))
      }
    }
  }
}

struct ContinueReadingView: View {
  let entry: Entry

  var body: some View {
    Group {
      if let book = entry.snapshot.current {
        SmallBook(title: book.title, cover: book.cover, progress: book.progress, caption: "Reading", symbol: "book")
          .widgetURL(Links.book(book.id))
      } else {
        Empty(symbol: "book.closed", text: "Nothing in progress").widgetURL(Links.page("library"))
      }
    }
    .widgetBackground(Palette.ink)
  }
}

struct ContinueReadingWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ContinueReading", provider: Provider()) { entry in
      ContinueReadingView(entry: entry)
    }
    .configurationDisplayName("Continue Reading")
    .description("Your current book. Tap to open it where you left off.")
    .supportedFamilies([.systemSmall])
  }
}

// MARK: - 2. Continue Listening (small)

struct ContinueListeningView: View {
  let entry: Entry

  var body: some View {
    Group {
      if let audio = entry.snapshot.audio {
        SmallBook(title: audio.title, cover: audio.cover, progress: audio.progress,
                  caption: audio.playing ? "Playing" : "Listening", symbol: "headphones", color: Palette.listen)
          .widgetURL(Links.audio("play", audio.bookId))
      } else {
        Empty(symbol: "headphones", text: "No audiobook yet").widgetURL(Links.page("audiobooks"))
      }
    }
    .widgetBackground(Palette.ink)
  }
}

struct ContinueListeningWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ContinueListening", provider: Provider()) { entry in
      ContinueListeningView(entry: entry)
    }
    .configurationDisplayName("Continue Listening")
    .description("Your current audiobook. Tap to carry on listening.")
    .supportedFamilies([.systemSmall])
  }
}

// MARK: - 3. Reading Today (small)

struct TodayView: View {
  let entry: Entry

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Caption(text: "Today", symbol: "sun.max")
      Spacer(minLength: 0)
      Text(duration(entry.readMinutes + entry.listenMinutes))
        .font(.system(.title2, design: .serif).weight(.semibold)).foregroundColor(Palette.ash)
        .minimumScaleFactor(0.7).lineLimit(1)
      Spacer(minLength: 0)
      Label(duration(entry.readMinutes) + " read", systemImage: "book")
        .foregroundColor(Palette.slate)
      Label(duration(entry.listenMinutes) + " listened", systemImage: "headphones")
        .foregroundColor(Palette.listen)
    }
    .font(.caption)
    .lineLimit(1)
    .frame(maxWidth: .infinity, alignment: .leading)
    .widgetURL(Links.home)
    .widgetBackground(Palette.ink)
  }
}

struct TodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ReadingToday", provider: Provider()) { entry in
      TodayView(entry: entry)
    }
    .configurationDisplayName("Reading Today")
    .description("Minutes read and listened today, and both together.")
    .supportedFamilies([.systemSmall])
  }
}

// MARK: - 4 and 10. Reading Activity (small and medium)

struct WeekBars: View {
  let week: [WidgetDay]
  /// Listening drawn on top of reading, in its own colour.
  let split: Bool

  var body: some View {
    let most = max(week.map { $0.readMinutes + $0.listenMinutes }.max() ?? 0, 1)
    HStack(alignment: .bottom, spacing: 5) {
      ForEach(Array(week.enumerated()), id: \.offset) { _, day in
        VStack(spacing: 3) {
          GeometryReader { geo in
            VStack(spacing: 0) {
              Spacer(minLength: 0)
              if split {
                Rectangle().fill(Palette.listen)
                  .frame(height: geo.size.height * CGFloat(day.listenMinutes) / CGFloat(most))
                Rectangle().fill(Palette.slate)
                  .frame(height: geo.size.height * CGFloat(day.readMinutes) / CGFloat(most))
              } else {
                Rectangle().fill(Palette.slate)
                  .frame(height: geo.size.height * CGFloat(day.readMinutes + day.listenMinutes) / CGFloat(most))
              }
            }
            .frame(maxWidth: .infinity)
            .background(Palette.ash.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 3))
          }
          Text(letter(day.day)).font(.system(size: 9, weight: .semibold)).foregroundColor(Palette.ash.opacity(0.6))
        }
      }
    }
  }

  /// The day's first letter (M, T, W…), from `YYYY-MM-DD`.
  func letter(_ day: String) -> String {
    let parser = DateFormatter()
    parser.dateFormat = "yyyy-MM-dd"
    guard let date = parser.date(from: day) else { return "" }
    let name = DateFormatter()
    name.dateFormat = "EEEEE"
    return name.string(from: date)
  }
}

struct ActivityView: View {
  @Environment(\.widgetFamily) var family
  let entry: Entry

  var body: some View {
    let week = entry.snapshot.week ?? []
    let read = week.reduce(0) { $0 + $1.readMinutes }
    let listen = week.reduce(0) { $0 + $1.listenMinutes }
    let active = week.filter { $0.readMinutes + $0.listenMinutes > 0 }.count
    Group {
      if week.isEmpty {
        Empty(symbol: "chart.bar", text: "Open TBV to see your week")
      } else if family == .systemMedium {
        HStack(spacing: 14) {
          VStack(alignment: .leading, spacing: 6) {
            Caption(text: "This week", symbol: "chart.bar")
            Text(duration(read + listen)).font(.system(.title3, design: .serif).weight(.semibold))
              .foregroundColor(Palette.ash).lineLimit(1).minimumScaleFactor(0.7)
            Spacer(minLength: 0)
            Label(duration(read) + " read", systemImage: "book").foregroundColor(Palette.slate)
            Label(duration(listen) + " listened", systemImage: "headphones").foregroundColor(Palette.listen)
          }
          .font(.caption)
          .lineLimit(1)
          .frame(width: 118, alignment: .leading)
          WeekBars(week: week, split: true)
        }
      } else {
        VStack(alignment: .leading, spacing: 6) {
          Caption(text: "This week", symbol: "chart.bar")
          WeekBars(week: week, split: false)
          Text("\(active) of 7 days").font(.caption2).foregroundColor(Palette.ash.opacity(0.7))
        }
      }
    }
    .widgetURL(Links.home)
    .widgetBackground(Palette.ink)
  }
}

struct ActivityWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ReadingActivity", provider: Provider()) { entry in
      ActivityView(entry: entry)
    }
    .configurationDisplayName("Reading Activity")
    .description("Your last seven days of reading and listening.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

// MARK: - 5 and 8. Quick Access (small and medium, chosen by you)

/// A place a Quick Access widget opens: one of TBV's pages, or a Sigil.
struct ShortcutEntity: AppEntity, Hashable {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Shortcut"
  static var defaultQuery = ShortcutQuery()

  let id: String
  let title: String
  let symbol: String
  let cover: String?
  let link: String

  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
  var url: URL { URL(string: link) ?? Links.home }
}

enum Shortcuts {
  static let pages: [ShortcutEntity] = [
    ShortcutEntity(id: "page:home", title: "Sanctum", symbol: "house", cover: nil, link: "theboundvigil://page/home"),
    ShortcutEntity(id: "page:library", title: "Archive", symbol: "books.vertical", cover: nil, link: "theboundvigil://page/library"),
    ShortcutEntity(id: "page:audiobooks", title: "Resonance", symbol: "headphones", cover: nil, link: "theboundvigil://page/audiobooks"),
    ShortcutEntity(id: "page:writing", title: "Scribe", symbol: "pencil", cover: nil, link: "theboundvigil://page/writing"),
    ShortcutEntity(id: "page:collections", title: "Compendium", symbol: "square.stack", cover: nil, link: "theboundvigil://page/collections"),
    ShortcutEntity(id: "scribe:new", title: "New note", symbol: "square.and.pencil", cover: nil, link: "theboundvigil://scribe/new"),
    ShortcutEntity(id: "page:catalogs", title: "Scry", symbol: "safari", cover: nil, link: "theboundvigil://page/catalogs"),
    ShortcutEntity(id: "page:libram", title: "Libram", symbol: "book.closed", cover: nil, link: "theboundvigil://page/libram"),
    ShortcutEntity(id: "page:geas", title: "Geas", symbol: "externaldrive.connected.to.line.below", cover: nil, link: "theboundvigil://page/geas"),
    ShortcutEntity(id: "page:settings", title: "Preferences", symbol: "gearshape", cover: nil, link: "theboundvigil://page/settings"),
  ]

  /// TBV's pages, then your Sigils from Sanctum.
  static func all() -> [ShortcutEntity] {
    pages + Store.load().sigils.map { sigil in
      ShortcutEntity(id: "sigil:\(sigil.id)", title: sigil.title, symbol: symbol(sigil.icon), cover: sigil.cover,
                     link: Links.sigil(sigil.id).absoluteString)
    }
  }
}

struct ShortcutQuery: EntityQuery {
  func entities(for identifiers: [ShortcutEntity.ID]) async throws -> [ShortcutEntity] {
    let all = Shortcuts.all()
    return identifiers.compactMap { id in all.first { $0.id == id } }
  }

  func suggestedEntities() async throws -> [ShortcutEntity] { Shortcuts.all() }

  func defaultResult() async -> ShortcutEntity? { Shortcuts.pages.first }
}

struct QuickAccessIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Quick Access"
  static var description = IntentDescription("Choose the page or Sigil this widget opens.")

  @Parameter(title: "Shortcut")
  var shortcut: ShortcutEntity?
}

struct QuickAccessSetIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Quick Access"
  static var description = IntentDescription("Choose up to six pages or Sigils.")

  @Parameter(title: "Shortcuts")
  var shortcuts: [ShortcutEntity]?
}

struct QuickEntry: TimelineEntry {
  let date: Date
  let shortcuts: [ShortcutEntity]
}

struct QuickProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> QuickEntry { QuickEntry(date: Date(), shortcuts: [Shortcuts.pages[0]]) }

  func snapshot(for configuration: QuickAccessIntent, in context: Context) async -> QuickEntry {
    QuickEntry(date: Date(), shortcuts: [configuration.shortcut ?? Shortcuts.pages[0]])
  }

  func timeline(for configuration: QuickAccessIntent, in context: Context) async -> Timeline<QuickEntry> {
    Timeline(entries: [await snapshot(for: configuration, in: context)], policy: .never)
  }
}

struct QuickSetProvider: AppIntentTimelineProvider {
  static let fallback = Array(Shortcuts.pages.prefix(4))

  func placeholder(in context: Context) -> QuickEntry { QuickEntry(date: Date(), shortcuts: Self.fallback) }

  func snapshot(for configuration: QuickAccessSetIntent, in context: Context) async -> QuickEntry {
    let chosen = Array((configuration.shortcuts ?? []).prefix(6))
    return QuickEntry(date: Date(), shortcuts: chosen.isEmpty ? Self.fallback : chosen)
  }

  func timeline(for configuration: QuickAccessSetIntent, in context: Context) async -> Timeline<QuickEntry> {
    Timeline(entries: [await snapshot(for: configuration, in: context)], policy: .never)
  }
}

struct ShortcutTile: View {
  let shortcut: ShortcutEntity
  var large = false

  var body: some View {
    ZStack(alignment: .bottomLeading) {
      if let image = Store.image(shortcut.cover) {
        Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
          .frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
        LinearGradient(colors: [.clear, Palette.ink.opacity(0.85)], startPoint: .top, endPoint: .bottom)
      } else {
        Palette.bloom
        Image(systemName: shortcut.symbol).font(large ? .largeTitle : .title3).foregroundColor(Palette.slate)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: large ? .center : .topTrailing)
          .padding(large ? 0 : 8)
      }
      Text(shortcut.title).font((large ? Font.subheadline : Font.caption).weight(.semibold))
        .foregroundColor(Palette.ash).lineLimit(1).padding(8)
    }
    .clipShape(RoundedRectangle(cornerRadius: 10))
  }
}

struct QuickAccessView: View {
  let entry: QuickEntry

  var body: some View {
    let shortcut = entry.shortcuts.first ?? Shortcuts.pages[0]
    ShortcutTile(shortcut: shortcut, large: true)
      .widgetURL(shortcut.url)
      .widgetBackground(Palette.ink)
  }
}

struct QuickAccessSetView: View {
  let entry: QuickEntry

  var body: some View {
    let columns = entry.shortcuts.count > 4 ? 3 : 2
    let grid = Array(repeating: GridItem(.flexible(), spacing: 8), count: columns)
    LazyVGrid(columns: grid, spacing: 8) {
      ForEach(entry.shortcuts, id: \.id) { shortcut in
        Link(destination: shortcut.url) {
          ShortcutTile(shortcut: shortcut).frame(height: 62)
        }
      }
    }
    .frame(maxHeight: .infinity)
    .widgetBackground(Palette.ink)
  }
}

struct QuickAccessWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "QuickAccess", intent: QuickAccessIntent.self, provider: QuickProvider()) { entry in
      QuickAccessView(entry: entry)
    }
    .configurationDisplayName("Quick Access")
    .description("One page or Sigil, one tap away. Press and hold to choose.")
    .supportedFamilies([.systemSmall])
  }
}

struct QuickAccessSetWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "QuickAccessSet", intent: QuickAccessSetIntent.self, provider: QuickSetProvider()) { entry in
      QuickAccessSetView(entry: entry)
    }
    .configurationDisplayName("Quick Access")
    .description("Up to six pages or Sigils. Press and hold to choose.")
    .supportedFamilies([.systemMedium])
  }
}

// MARK: - 6. Continue Reading & Listening (medium)

struct HalfBook: View {
  let caption: String
  let symbol: String
  let title: String
  let author: String
  let cover: String?
  let progress: Double
  let color: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      Caption(text: caption, symbol: symbol)
      HStack(alignment: .top, spacing: 8) {
        Cover(name: cover, title: title).frame(width: 46, height: 69).clipShape(RoundedRectangle(cornerRadius: 4))
        VStack(alignment: .leading, spacing: 2) {
          Text(title).font(.system(.caption, design: .serif).weight(.semibold)).foregroundColor(Palette.ash).lineLimit(3)
          Text(author).font(.caption2).foregroundColor(Palette.ash.opacity(0.7)).lineLimit(1)
        }
      }
      Spacer(minLength: 0)
      HStack(spacing: 6) {
        ProgressLine(value: progress, color: color)
        Text(percent(progress)).font(.caption2).foregroundColor(Palette.ash.opacity(0.7))
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct ReadingListeningView: View {
  let entry: Entry

  var body: some View {
    HStack(spacing: 12) {
      if let book = entry.snapshot.current {
        Link(destination: Links.book(book.id)) {
          HalfBook(caption: "Reading", symbol: "book", title: book.title, author: book.author,
                   cover: book.cover, progress: book.progress, color: Palette.slate)
        }
      } else {
        Link(destination: Links.page("library")) { Empty(symbol: "book.closed", text: "Nothing in progress") }
      }
      Rectangle().fill(Palette.ash.opacity(0.15)).frame(width: 1)
      if let audio = entry.snapshot.audio {
        Link(destination: Links.audio("play", audio.bookId)) {
          HalfBook(caption: audio.playing ? "Playing" : "Listening", symbol: "headphones", title: audio.title,
                   author: audio.author, cover: audio.cover, progress: audio.progress, color: Palette.listen)
        }
      } else {
        Link(destination: Links.page("audiobooks")) { Empty(symbol: "headphones", text: "No audiobook yet") }
      }
    }
    .widgetBackground(Palette.ink)
  }
}

struct ReadingListeningWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ReadingAndListening", provider: Provider()) { entry in
      ReadingListeningView(entry: entry)
    }
    .configurationDisplayName("Continue Reading & Listening")
    .description("Your current book and audiobook, each a tap away.")
    .supportedFamilies([.systemMedium])
  }
}

// MARK: - 7. Reading Shelf (medium)

struct ShelfView: View {
  let entry: Entry

  var body: some View {
    let books = Array(entry.snapshot.inProgress.prefix(4))
    Group {
      if books.isEmpty {
        Empty(symbol: "books.vertical", text: "Nothing in progress").widgetURL(Links.page("library"))
      } else {
        HStack(alignment: .top, spacing: 10) {
          ForEach(Array(books.enumerated()), id: \.offset) { _, book in
            Link(destination: Links.book(book.id)) {
              VStack(alignment: .leading, spacing: 4) {
                Cover(name: book.cover, title: book.title)
                  .frame(maxWidth: .infinity, maxHeight: .infinity)
                  .clipShape(RoundedRectangle(cornerRadius: 4))
                Text(book.title).font(.system(size: 10, weight: .semibold, design: .serif))
                  .foregroundColor(Palette.ash).lineLimit(1)
                ProgressLine(value: book.progress)
              }
            }
          }
          ForEach(books.count..<4, id: \.self) { _ in Color.clear }
        }
      }
    }
    .widgetBackground(Palette.ink)
  }
}

struct ShelfWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ReadingShelf", provider: Provider()) { entry in
      ShelfView(entry: entry)
    }
    .configurationDisplayName("Reading Shelf")
    .description("Up to four books you're reading.")
    .supportedFamilies([.systemMedium])
  }
}

// MARK: - 9. Scribe Workspace (medium)

struct ScribeView: View {
  let entry: Entry

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      if let project = entry.snapshot.project {
        Link(destination: Links.scribeBook(project.id)) {
          VStack(alignment: .leading, spacing: 4) {
            Caption(text: "Writing", symbol: "pencil")
            Cover(name: project.cover, title: project.title)
              .frame(width: 52, height: 78).clipShape(RoundedRectangle(cornerRadius: 4))
            Text(project.title).font(.system(.caption, design: .serif).weight(.semibold))
              .foregroundColor(Palette.ash).lineLimit(2)
            Text(project.chapters == 1 ? "1 chapter" : "\(project.chapters) chapters")
              .font(.caption2).foregroundColor(Palette.ash.opacity(0.7))
          }
          .frame(width: 96, alignment: .leading)
        }
      } else {
        Link(destination: Links.page("writing")) {
          VStack(alignment: .leading, spacing: 6) {
            Caption(text: "Writing", symbol: "pencil")
            Text("Start a book in Scribe").font(.caption).foregroundColor(Palette.ash.opacity(0.8))
          }
          .frame(width: 96, alignment: .leading)
        }
      }
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          Caption(text: "Notes", symbol: "note.text")
          Spacer()
          Link(destination: Links.newNote) {
            Label("New note", systemImage: "square.and.pencil")
              .font(.caption2.weight(.semibold))
              .padding(.horizontal, 8).padding(.vertical, 4)
              .background(Capsule().fill(Palette.bloom))
              .foregroundColor(Palette.ash)
          }
        }
        let notes = entry.snapshot.notes ?? []
        if notes.isEmpty {
          Text("No notes yet").font(.caption).foregroundColor(Palette.ash.opacity(0.7))
        }
        ForEach(Array(notes.prefix(3).enumerated()), id: \.offset) { _, note in
          Link(destination: Links.scribeNote(note.id)) {
            VStack(alignment: .leading, spacing: 1) {
              Text(note.title).font(.caption.weight(.semibold)).foregroundColor(Palette.ash).lineLimit(1)
              if note.preview != note.title && !note.preview.isEmpty {
                Text(note.preview).font(.caption2).foregroundColor(Palette.ash.opacity(0.7)).lineLimit(1)
              }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
        Spacer(minLength: 0)
      }
    }
    .widgetBackground(Palette.ink)
  }
}

struct ScribeWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ScribeWorkspace", provider: Provider()) { entry in
      ScribeView(entry: entry)
    }
    .configurationDisplayName("Scribe Workspace")
    .description("The book you're writing, your latest notes, and a new note.")
    .supportedFamilies([.systemMedium])
  }
}

// MARK: - Icons

/// TBV's icon names, as the nearest of Apple's symbols.
func symbol(_ icon: String) -> String {
  switch icon {
  case "compass", "globe": return "safari"
  case "library", "books", "archive": return "books.vertical"
  case "feather", "pen", "writing": return "pencil"
  case "headphones", "audio": return "headphones"
  case "collection", "collections", "layers": return "square.stack"
  case "book", "bookClosed", "chapel": return "book.closed"
  case "database", "broadcast", "connections": return "antenna.radiowaves.left.and.right"
  case "home": return "house"
  case "star": return "star"
  case "heart": return "heart"
  default: return "sparkles"
  }
}

// MARK: - The bundle

@main
struct TBVWidgetBundle: WidgetBundle {
  var body: some Widget {
    ContinueReadingWidget()
    ContinueListeningWidget()
    TodayWidget()
    ActivityWidget()
    QuickAccessWidget()
    ReadingListeningWidget()
    ShelfWidget()
    QuickAccessSetWidget()
    ScribeWidget()
  }
}
