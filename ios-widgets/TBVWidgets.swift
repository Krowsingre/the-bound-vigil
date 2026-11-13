// TBV's Home Screen and Lock Screen widgets. The app writes what they show
// (Widget/snapshot.json and small covers) into the App Group it shares with
// them, and asks iOS to redraw them (src-tauri/src/widgets.rs). A tap opens
// TBV with a theboundvigil:// link, which the app follows (src/widgets.ts).
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

struct Snapshot: Codable {
  var current: WidgetBook?
  var inProgress: [WidgetBook]
  var sigils: [WidgetSigil]
  var todayReadMinutes: Int
  var todayListenMinutes: Int
  var audio: WidgetAudio?
  var day: String

  static let empty = Snapshot(current: nil, inProgress: [], sigils: [], todayReadMinutes: 0, todayListenMinutes: 0, audio: nil, day: "")

  /// Shown while a widget is being picked, before TBV has written anything.
  static let sample = Snapshot(
    current: WidgetBook(id: "", title: "Paradise Lost", author: "John Milton", progress: 0.42, cover: nil),
    inProgress: [
      WidgetBook(id: "", title: "Paradise Lost", author: "John Milton", progress: 0.42, cover: nil),
      WidgetBook(id: "", title: "The Odyssey", author: "Homer", progress: 0.18, cover: nil),
      WidgetBook(id: "", title: "Middlemarch", author: "George Eliot", progress: 0.73, cover: nil),
    ],
    sigils: [
      WidgetSigil(id: "", title: "Discover", icon: "compass", cover: nil),
      WidgetSigil(id: "", title: "Archive", icon: "library", cover: nil),
      WidgetSigil(id: "", title: "Scribe", icon: "feather", cover: nil),
      WidgetSigil(id: "", title: "Resonance", icon: "headphones", cover: nil),
    ],
    todayReadMinutes: 25, todayListenMinutes: 40,
    audio: WidgetAudio(bookId: "", title: "The Odyssey", author: "Homer", playing: false, progress: 0.18, cover: nil),
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

  static func image(_ name: String?) -> UIImage? {
    guard let name = name, let file = folder?.appendingPathComponent(name) else { return nil }
    return UIImage(contentsOfFile: file.path)
  }

  /// Today's date as TBV writes it (`YYYY-MM-DD`, this device's time).
  static func day(_ date: Date) -> String {
    let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
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
    let snapshot = Store.load()
    let empty = snapshot.current == nil && snapshot.sigils.isEmpty
    completion(Entry(date: Date(), snapshot: context.isPreview && empty ? .sample : snapshot))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    let snapshot = Store.load()
    let now = Date()
    // A second entry at midnight sets today's minutes back to none.
    let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86_400))
    completion(Timeline(entries: [Entry(date: now, snapshot: snapshot), Entry(date: midnight, snapshot: snapshot)], policy: .never))
  }
}

// MARK: - Look

enum Palette {
  static let ink = Color(red: 0x1a / 255, green: 0x1c / 255, blue: 0x1e / 255)
  static let bloom = Color(red: 0x2f / 255, green: 0x3a / 255, blue: 0x44 / 255)
  static let ash = Color(red: 0xe6 / 255, green: 0xe3 / 255, blue: 0xde / 255)
  static let slate = Color(red: 0x8f / 255, green: 0xa3 / 255, blue: 0xb5 / 255)
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

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(Palette.ash.opacity(0.2))
        Capsule().fill(Palette.slate).frame(width: geo.size.width * CGFloat(min(max(value, 0), 1)))
      }
    }
    .frame(height: 4)
  }
}

func percent(_ value: Double) -> String { "\(Int((min(max(value, 0), 1) * 100).rounded()))%" }

struct NothingYet: View {
  var body: some View {
    VStack(spacing: 6) {
      Image(systemName: "book.closed").font(.title2)
      Text("Nothing in progress").font(.caption)
    }
    .foregroundColor(Palette.ash.opacity(0.8))
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

// MARK: - Continue reading (small and medium)

struct ReadingBlock: View {
  let book: WidgetBook
  var compact = false

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Cover(name: book.cover, title: book.title)
        .frame(width: compact ? 44 : 64, height: compact ? 66 : 96)
        .clipShape(RoundedRectangle(cornerRadius: 4))
      VStack(alignment: .leading, spacing: 4) {
        Text("Continue reading").font(.caption2).foregroundColor(Palette.slate)
        Text(book.title).font(.system(.subheadline, design: .serif).weight(.semibold))
          .foregroundColor(Palette.ash).lineLimit(2)
        Text(book.author).font(.caption2).foregroundColor(Palette.ash.opacity(0.7)).lineLimit(1)
        Spacer(minLength: 0)
        ProgressLine(value: book.progress)
        Text(percent(book.progress)).font(.caption2).foregroundColor(Palette.ash.opacity(0.7))
      }
    }
  }
}

struct SmallReading: View {
  let book: WidgetBook

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Cover(name: book.cover, title: book.title)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 6))
      Text(book.title).font(.system(.caption, design: .serif).weight(.semibold))
        .foregroundColor(Palette.ash).lineLimit(1)
      ProgressLine(value: book.progress)
    }
  }
}

struct AudioBlock: View {
  let audio: WidgetAudio

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Cover(name: audio.cover, title: audio.title)
          .frame(width: 34, height: 34).clipShape(RoundedRectangle(cornerRadius: 4))
        VStack(alignment: .leading, spacing: 2) {
          Text(audio.title).font(.caption.weight(.semibold)).foregroundColor(Palette.ash).lineLimit(1)
          Text(audio.author).font(.caption2).foregroundColor(Palette.ash.opacity(0.7)).lineLimit(1)
        }
      }
      ProgressLine(value: audio.progress)
      HStack(spacing: 18) {
        Link(destination: Links.audio("back", audio.bookId)) {
          Image(systemName: "gobackward.30").font(.title3)
        }
        Link(destination: Links.audio("toggle", audio.bookId)) {
          Image(systemName: audio.playing ? "pause.circle.fill" : "play.circle.fill").font(.title)
        }
      }
      .foregroundColor(Palette.ash)
      .frame(maxWidth: .infinity)
    }
  }
}

struct ContinueReadingView: View {
  @Environment(\.widgetFamily) var family
  let entry: Entry

  var body: some View {
    content.widgetBackground(family == .accessoryCircular ? Color.clear : Palette.ink)
  }

  @ViewBuilder var content: some View {
    let snapshot = entry.snapshot
    switch family {
    case .accessoryCircular:
      if let book = snapshot.current {
        Gauge(value: min(max(book.progress, 0), 1)) {
          Image(systemName: "book")
        } currentValueLabel: {
          Text("\(Int((book.progress * 100).rounded()))")
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetURL(Links.book(book.id))
      } else {
        Image(systemName: "book.closed").widgetURL(Links.home)
      }
    case .systemMedium:
      if let book = snapshot.current {
        HStack(spacing: 14) {
          Link(destination: Links.book(book.id)) { ReadingBlock(book: book, compact: snapshot.audio != nil) }
          if let audio = snapshot.audio {
            Divider().background(Palette.ash.opacity(0.3))
            AudioBlock(audio: audio).frame(maxWidth: 140)
          }
        }
      } else if let audio = snapshot.audio {
        AudioBlock(audio: audio)
      } else {
        NothingYet().widgetURL(Links.home)
      }
    default:
      if let book = snapshot.current {
        SmallReading(book: book).widgetURL(Links.book(book.id))
      } else {
        NothingYet().widgetURL(Links.home)
      }
    }
  }
}

struct ContinueReadingWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ContinueReading", provider: Provider()) { entry in
      ContinueReadingView(entry: entry)
    }
    .configurationDisplayName("Continue reading")
    .description("The book you're reading, and the audiobook you're listening to.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular])
  }
}

// MARK: - In progress (large)

struct InProgressView: View {
  let entry: Entry

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("In progress").font(.system(.headline, design: .serif)).foregroundColor(Palette.ash)
      if entry.snapshot.inProgress.isEmpty {
        NothingYet()
      } else {
        ForEach(entry.snapshot.inProgress, id: \.self) { book in
          Link(destination: Links.book(book.id)) {
            HStack(spacing: 10) {
              Cover(name: book.cover, title: book.title)
                .frame(width: 40, height: 60).clipShape(RoundedRectangle(cornerRadius: 4))
              VStack(alignment: .leading, spacing: 3) {
                Text(book.title).font(.system(.subheadline, design: .serif).weight(.semibold))
                  .foregroundColor(Palette.ash).lineLimit(1)
                Text(book.author).font(.caption2).foregroundColor(Palette.ash.opacity(0.7)).lineLimit(1)
                HStack(spacing: 6) {
                  ProgressLine(value: book.progress)
                  Text(percent(book.progress)).font(.caption2).foregroundColor(Palette.ash.opacity(0.7))
                }
              }
            }
          }
        }
        Spacer(minLength: 0)
      }
    }
    .widgetBackground(Palette.ink)
  }
}

struct InProgressWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "InProgress", provider: Provider()) { entry in
      InProgressView(entry: entry)
    }
    .configurationDisplayName("In progress")
    .description("The books you're reading, to pick one up.")
    .supportedFamilies([.systemLarge])
  }
}

// MARK: - Sigils (large)

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

struct SigilsView: View {
  let entry: Entry
  private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Sigils").font(.system(.headline, design: .serif)).foregroundColor(Palette.ash)
      LazyVGrid(columns: columns, spacing: 10) {
        ForEach(entry.snapshot.sigils, id: \.self) { sigil in
          Link(destination: Links.sigil(sigil.id)) {
            ZStack(alignment: .bottomLeading) {
              if let image = Store.image(sigil.cover) {
                Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
                  .frame(maxWidth: .infinity, minHeight: 54, maxHeight: 54).clipped()
                LinearGradient(colors: [.clear, Palette.ink.opacity(0.8)], startPoint: .top, endPoint: .bottom)
              } else {
                Palette.bloom
                Image(systemName: symbol(sigil.icon)).font(.title3).foregroundColor(Palette.slate)
                  .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing).padding(8)
              }
              Text(sigil.title).font(.caption.weight(.semibold)).foregroundColor(Palette.ash)
                .lineLimit(1).padding(8)
            }
            .frame(height: 54)
            .clipShape(RoundedRectangle(cornerRadius: 8))
          }
        }
      }
      Spacer(minLength: 0)
    }
    .widgetBackground(Palette.ink)
  }
}

struct SigilsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "Sigils", provider: Provider()) { entry in
      SigilsView(entry: entry)
    }
    .configurationDisplayName("Sigils")
    .description("Your Sigils from Sanctum, one tap away.")
    .supportedFamilies([.systemLarge])
  }
}

// MARK: - Reading today (Lock Screen)

struct TodayView: View {
  @Environment(\.widgetFamily) var family
  let entry: Entry

  var body: some View {
    Group {
      if family == .accessoryInline {
        Text("\(Image(systemName: "book")) \(entry.readMinutes) min · \(Image(systemName: "headphones")) \(entry.listenMinutes) min")
      } else {
        VStack(alignment: .leading, spacing: 2) {
          Text("Today").font(.headline)
          Label("\(entry.readMinutes) min read", systemImage: "book")
          Label("\(entry.listenMinutes) min listened", systemImage: "headphones")
        }
        .font(.caption)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .widgetURL(Links.home)
    .widgetBackground(.clear)
  }
}

struct TodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ReadingToday", provider: Provider()) { entry in
      TodayView(entry: entry)
    }
    .configurationDisplayName("Reading today")
    .description("How long you've read and listened today.")
    .supportedFamilies([.accessoryRectangular, .accessoryInline])
  }
}

@main
struct TBVWidgetBundle: WidgetBundle {
  var body: some Widget {
    ContinueReadingWidget()
    InProgressWidget()
    SigilsWidget()
    TodayWidget()
  }
}
