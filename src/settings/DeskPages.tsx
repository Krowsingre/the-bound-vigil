// Attunement's rebuilt computer pages (embre approved, 27 November): Appearance, Reading,
// Library and Management, built from the framework in attune.tsx to the approved pictures
// in tbv-next/0.168 (mock3, library5). Phones keep their own pages for now.

import { useState } from "react";
import { api, isApp } from "../api";
import { useToast } from "../components/Toast";
import { Icon } from "../components/Icon";
import type { AuthorStyle } from "../lib/authorNames";
import { relativeTime } from "../lib/format";
import { canCheckSeries, checkAllSeries, useSeriesNews } from "../library/seriesCheck";
import { canWatch, unwatch, useWatch, watchAuthor, watchBook, whenLine } from "../library/watchList";
import { PAGE_THEME_OPTIONS, widthShown } from "../reader/ReaderPopovers";
import { FADE_RANGE, FONTS, LINE_HEIGHT_RANGE, PAGE_COLORS, resolveTheme, SIZE_RANGE, WIDTH_RANGE, type ReadingFlow, type ReadingTheme, type TextSpread } from "../reader/settings";
import { AppearanceTab, useReaderSettings } from "./AppearanceTab";
import { SCALES, useAppDark, useAppSettings, type InterfaceDensity, type InterfaceFont, type InterfaceScale, type SeriesCheckEvery, type SurfaceStyle } from "./appSettings";
import { AtChoice, AtMore, AtPage, AtPair, AtRow, AtRows, AtSection, AtSlider, AtSwitch } from "./attune";
import { formatBytes, Select } from "./controls";
import { BookFilesList, BookFormatsList, DeletedBooksList, DeskReadAlong, ShowButton, TagChips, useLibraryInfo } from "./OtherTabs";
import { DuplicatesDialog } from "./DuplicatesDialog";
import { ReadingHistorySection } from "./ReadingHistory";
import type { DuplicateGroup } from "../api/types";

const SCALE_STEPS: InterfaceScale[] = ["small", "medium", "large"];

const SURFACES: { value: SurfaceStyle; label: string }[] = [
  { value: "clean", label: "Clean" },
  { value: "matte", label: "Matte" },
  { value: "paper", label: "Paper" },
  { value: "linen", label: "Linen" },
  { value: "vellum", label: "Vellum" },
];

/** Appearance: Theme, Interface and Surface. */
export function DeskAppearance({ sidebarShown, onSidebarShown }: { sidebarShown: boolean; onSidebarShown: (shown: boolean) => void }) {
  const { settings, change } = useAppSettings();
  const at = Math.max(0, SCALE_STEPS.indexOf(settings.scale));
  return (
    <AtPage>
      <AtSection id="theme" title="Theme" also={["preview", "adaptive", "custom-theme"]}>
        <AppearanceTab sidebarShown={sidebarShown} onSidebarShown={onSidebarShown} part="theme" />
      </AtSection>
      <AtSection id="text" title="Interface" also={["density", "sidebar"]}>
        <AtRows>
          <AtRow label="Interface font" wide>
            <AtChoice<InterfaceFont>
              label="Interface font"
              value={settings.interfaceFont}
              options={[
                { value: "system", label: "Segoe UI" },
                { value: "serif", label: "Georgia" },
                { value: "echolume", label: "Echolume" },
              ]}
              onChange={(interfaceFont) => change({ interfaceFont })}
            />
          </AtRow>
          <AtRow label="Density" wide>
            <AtChoice<InterfaceDensity>
              label="Density"
              value={settings.density}
              options={[
                { value: "compact", label: "Compact" },
                { value: "default", label: "Default" },
                { value: "spacious", label: "Spacious" },
              ]}
              onChange={(density) => change({ density })}
            />
          </AtRow>
          <AtRow label="Font scaling" wide>
            <AtSlider
              label="Font scaling"
              value={at}
              min={0}
              max={SCALE_STEPS.length - 1}
              shown={`${Math.round(SCALES[settings.scale] * 100)}%`}
              low="Smaller"
              high="Larger"
              onChange={(i) => change({ scale: SCALE_STEPS[i] })}
            />
          </AtRow>
          <AtSwitch label="Show full sidebar" checked={sidebarShown} onChange={onSidebarShown} />
        </AtRows>
      </AtSection>
      <AtSection id="touches" title="Surface">
        <div className="at-tiles" role="radiogroup" aria-label="Surface">
          {SURFACES.map((s) => (
            <button key={s.value} type="button" role="radio" className="at-tile" aria-checked={settings.surface === s.value} onClick={() => change({ surface: s.value })}>
              <span className={`at-tile-face is-${s.value}`} aria-hidden />
              {s.label}
            </button>
          ))}
        </div>
      </AtSection>
    </AtPage>
  );
}

const READING_FONTS: Record<string, string> = {
  lora: '"Lora", Georgia, serif',
  georgia: "Georgia, Gelasio, serif",
  sans: "var(--font-sans)",
  echolume: '"Echolume", sans-serif',
  publisher: "Georgia, Gelasio, serif",
};

/** Reading: the sample page, then Typography, Page layout, Navigation and Focus mode. */
export function DeskReading() {
  const [reader, change] = useReaderSettings();
  const dark = useAppDark();
  if (!reader) return null;
  const colors = PAGE_COLORS[resolveTheme(reader.theme, dark)];
  return (
    <AtPage>
      <AtSection id="sample" foldable={false} className="at-sample">
        <div style={{ background: colors.background, color: colors.text, margin: "calc(var(--at-card-pad) * -1)", padding: "20px 28px", borderRadius: "inherit" }}>
          <p
            style={{
              fontFamily: READING_FONTS[reader.font],
              fontSize: reader.size,
              lineHeight: reader.lineHeight,
              textAlign: reader.justify ? "justify" : "start",
              maxWidth: Math.min(720, reader.width),
            }}
          >
            It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it
            was the epoch of incredulity, it was the season of Light, it was the season of Darkness.
          </p>
          <span className="at-sample-note" style={{ color: colors.muted }}>
            A Tale of Two Cities · Charles Dickens
          </span>
        </div>
      </AtSection>
      <AtSection id="typography" title="Typography" also={["text"]}>
        <AtRows>
          <AtRow label="Font" wide>
            <AtChoice label="Font" value={reader.font} options={FONTS} onChange={(font) => change({ font })} />
          </AtRow>
          <AtRow label="Text size" wide>
            <AtSlider
              label="Text size"
              value={reader.size}
              min={SIZE_RANGE.min}
              max={SIZE_RANGE.max}
              step={SIZE_RANGE.step}
              shown={String(reader.size)}
              low="Smaller"
              high="Larger"
              onChange={(size) => change({ size })}
            />
          </AtRow>
          <AtRow label="Line spacing" wide>
            <AtSlider
              label="Line spacing"
              value={reader.lineHeight}
              min={LINE_HEIGHT_RANGE.min}
              max={LINE_HEIGHT_RANGE.max}
              step={LINE_HEIGHT_RANGE.step}
              shown={reader.lineHeight.toFixed(1)}
              low={LINE_HEIGHT_RANGE.min.toFixed(1)}
              high={LINE_HEIGHT_RANGE.max.toFixed(1)}
              onChange={(lineHeight) => change({ lineHeight: Math.round(lineHeight * 10) / 10 })}
            />
          </AtRow>
          <AtSwitch label="Justify text" checked={reader.justify} onChange={(justify) => change({ justify })} />
        </AtRows>
      </AtSection>
      <AtSection id="page-layout" title="Page layout">
        <AtRows>
          <AtRow label="Page width" wide>
            <AtSlider
              label="Page width"
              value={reader.width}
              min={WIDTH_RANGE.min}
              max={WIDTH_RANGE.max}
              step={WIDTH_RANGE.step}
              shown={widthShown(reader.width)}
              low="Narrow"
              high="Wide"
              onChange={(width) => change({ width })}
            />
          </AtRow>
          <AtRow label="Pages at a time" wide>
            <AtChoice<TextSpread>
              label="Pages at a time"
              value={reader.textSpread}
              options={[
                { value: "one", label: "One" },
                { value: "auto", label: "Two when there's room" },
              ]}
              onChange={(textSpread) => change({ textSpread })}
            />
          </AtRow>
          <AtRow label="Page colour" wide>
            <AtChoice<ReadingTheme> label="Page colour" className="is-swatches" value={reader.theme} options={PAGE_THEME_OPTIONS} onChange={(theme) => change({ theme })} />
          </AtRow>
        </AtRows>
      </AtSection>
      <AtSection id="navigation" title="Navigation">
        <AtRows>
          <AtRow label="Moving through the book" wide>
            <AtChoice<ReadingFlow>
              label="Moving through the book"
              value={reader.flow}
              options={[
                { value: "paginated", label: "Turn pages" },
                { value: "scrolled", label: "Scroll" },
              ]}
              onChange={(flow) => change({ flow })}
            />
          </AtRow>
          <AtRow label="Manual scroll speed" wide>
            <AtSlider
              label="Manual scroll speed"
              value={reader.keyboardScrollSpeed}
              min={120}
              max={1200}
              step={60}
              low="Slower"
              high="Faster"
              onChange={(keyboardScrollSpeed) => change({ keyboardScrollSpeed })}
            />
          </AtRow>
          <AtRow label="Auto-scroll speed" hint="Tap the page three times to start or stop auto-scroll." wide>
            <AtSlider
              label="Auto-scroll speed"
              value={reader.autoScrollSpeed}
              min={1}
              max={100}
              shown={`${reader.autoScrollSpeed}%`}
              low="Slower"
              high="Faster"
              onChange={(autoScrollSpeed) => change({ autoScrollSpeed })}
            />
          </AtRow>
        </AtRows>
      </AtSection>
      <AtSection id="focus" title="Focus mode">
        <AtRows>
          <AtSwitch label="Fade page edges" checked={reader.edgeFade} onChange={(edgeFade) => change({ edgeFade })} />
          {reader.edgeFade && (
            <AtRow label="Fade strength" wide>
              <AtSlider
                label="Fade strength"
                value={reader.fadeStrength}
                min={FADE_RANGE.min}
                max={FADE_RANGE.max}
                step={FADE_RANGE.step}
                low="Faint"
                high="Deep"
                onChange={(fadeStrength) => change({ fadeStrength })}
              />
            </AtRow>
          )}
        </AtRows>
      </AtSection>
    </AtPage>
  );
}

/** Discovery: suggestions from online, and the check for new books in a series. */
function Discovery() {
  const { settings, change } = useAppSettings();
  const { last, progress } = useSeriesNews();
  const [days, setDays] = useState(String(settings.seriesCheckDays));
  return (
    <AtSection id="discovery" title="Discovery" also={["sanctum", "series-check"]}>
      <AtRows>
        <AtSwitch label="Suggest books from online" checked={settings.suggestOnline} onChange={(suggestOnline) => change({ suggestOnline })} />
        {canCheckSeries && (
          <>
            <AtRow label="Check for new in series">
              <Select<SeriesCheckEvery>
                label="Check for new in series"
                value={settings.seriesCheck}
                options={[
                  { value: "never", label: "Never" },
                  { value: "day", label: "Every day" },
                  { value: "week", label: "Every week" },
                  { value: "month", label: "Every month" },
                  { value: "year", label: "Every year" },
                  { value: "custom", label: "Custom" },
                ]}
                onChange={(seriesCheck) => change({ seriesCheck })}
              />
            </AtRow>
            {settings.seriesCheck === "custom" && (
              <AtRow label="Days between checks">
                <input
                  className="settings-number"
                  type="number"
                  min={1}
                  max={365}
                  inputMode="numeric"
                  aria-label="Days between checks"
                  value={days}
                  onChange={(e) => {
                    setDays(e.target.value);
                    const n = Math.round(Number(e.target.value));
                    if (n >= 1 && n <= 365) change({ seriesCheckDays: n });
                  }}
                />
              </AtRow>
            )}
            <AtRow label="Last check">
              <span className="at-row-hint">{progress ? `Checking ${Math.min(progress.done + 1, progress.total)} of ${progress.total} series…` : last ? relativeTime(last) : "Not checked yet"}</span>
              <button type="button" className="btn btn-quiet" disabled={!!progress} onClick={() => void checkAllSeries()}>
                {progress ? "Checking…" : "Check now"}
              </button>
            </AtRow>
          </>
        )}
      </AtRows>
    </AtSection>
  );
}

/** Watching: authors and books followed for new books. */
function Watching() {
  const { list } = useWatch();
  const [adding, setAdding] = useState<"author" | "book" | null>(null);
  const [author, setAuthor] = useState("");
  const [title, setTitle] = useState("");
  const [by, setBy] = useState("");
  if (!canWatch()) return null;
  const authors = list.flatMap((w) => (w.kind === "author" ? [w] : []));
  const books = list.flatMap((w) => (w.kind === "book" && !w.auto ? [w] : []));
  const done = () => {
    setAdding(null);
    setAuthor("");
    setTitle("");
    setBy("");
  };
  return (
    <AtSection id="watching" title="Watching">
      <AtRows>
        <AtRow label="Authors" hint={authors.length ? undefined : "No authors yet. You can also watch one from a book's menu, under Find related."}>
          {adding === "author" ? (
            <form
              className="at-form"
              onSubmit={(e) => {
                e.preventDefault();
                watchAuthor(author);
                done();
              }}
            >
              <input className="attune-input" autoFocus aria-label="Author to watch" placeholder="Author's name" value={author} onChange={(e) => setAuthor(e.target.value)} />
              <button type="button" className="btn btn-quiet" onClick={done}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={!author.trim()}>
                Watch
              </button>
            </form>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => setAdding("author")}>
              Watch author
            </button>
          )}
        </AtRow>
        {authors.length > 0 && (
          <ul className="tag-manage">
            {authors.map((a) => (
              <li key={a.name}>
                <span className="tag-chip">
                  {a.name}
                  <button type="button" aria-label={`Stop watching ${a.name}`} title="Stop watching" onClick={() => unwatch(a)}>
                    <Icon name="close" size={12} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <AtRow label="Books" hint={books.length ? undefined : "No books yet. You can also watch one from its series' missing books."}>
          {adding === "book" ? (
            <form
              className="at-form"
              onSubmit={(e) => {
                e.preventDefault();
                watchBook(title, by);
                done();
              }}
            >
              <input className="attune-input" autoFocus aria-label="Title of the book to watch" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <input className="attune-input" aria-label="Its author" placeholder="Author" value={by} onChange={(e) => setBy(e.target.value)} />
              <button type="button" className="btn btn-quiet" onClick={done}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={!title.trim()}>
                Watch
              </button>
            </form>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => setAdding("book")}>
              Watch book
            </button>
          )}
        </AtRow>
        {books.length > 0 && (
          <ul className="tag-manage">
            {books.map((b) => (
              <li key={b.key}>
                <span className="tag-chip">
                  {b.title}
                  <span className="muted">{b.released ? "Out now" : b.date ? whenLine({ kind: "announced", date: b.date }) : "No date yet"}</span>
                  <button type="button" aria-label={`Stop watching ${b.title}`} title="Stop watching" onClick={() => unwatch(b)}>
                    <Icon name="close" size={12} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </AtRows>
    </AtSection>
  );
}

/** Library: Presentation | Compendium, Privacy mode | Discovery, Watching, Read-along. */
export function DeskLibrary() {
  const { settings, change, togglePrivacy } = useAppSettings();
  const privacy = settings.privacy;
  return (
    <AtPage>
      <AtPair>
        <AtSection id="presentation" title="Presentation">
          <AtRows>
            <AtRow label="Author names" wide>
              <AtChoice<AuthorStyle>
                label="Author names"
                value={settings.authorNames}
                options={[
                  { value: "asBook", label: "As in the book" },
                  { value: "firstLast", label: "First Last" },
                  { value: "lastFirst", label: "Last, First" },
                ]}
                onChange={(authorNames) => change({ authorNames })}
              />
            </AtRow>
            <AtSwitch label="Show progress bars on books" checked={settings.showProgress} onChange={(showProgress) => change({ showProgress })} />
          </AtRows>
        </AtSection>
        <AtSection id="show" title="Compendium">
          <AtRows>
            <AtSwitch label="Show smart collections" checked={settings.showSmartCollections} onChange={(showSmartCollections) => change({ showSmartCollections })} />
            <AtSwitch label="Show series" hint="Series found in your books' details, next to your own collections." checked={settings.showSeries} onChange={(showSeries) => change({ showSeries })} />
          </AtRows>
        </AtSection>
      </AtPair>
      <AtPair>
        <AtSection id="privacy" title="Privacy mode">
          <AtRows>
            <AtSwitch label="Hide covers" checked={privacy.on} onChange={() => togglePrivacy()} />
            <AtSwitch label="Hide avatar" checked={privacy.hideAvatar} onChange={(hideAvatar) => change({ privacy: { ...privacy, hideAvatar } })} />
            <AtSwitch label="Hide reading activity" checked={privacy.hideActivity} onChange={(hideActivity) => change({ privacy: { ...privacy, hideActivity } })} />
          </AtRows>
        </AtSection>
        <Discovery />
      </AtPair>
      <Watching />
      <DeskReadAlong />
    </AtPage>
  );
}

/** Scribe: every book's notes, one file each, in an archive. */
function ScribeExport() {
  const toast = useToast();
  const [format, setFormat] = useState<"markdown" | "plainText">("markdown");
  return (
    <AtSection id="view" title="Scribe">
      <AtRows>
        <AtRow label="Export notes">
          <Select<"markdown" | "plainText">
            label="Export notes as"
            value={format}
            options={[
              { value: "markdown", label: "Markdown" },
              { value: "plainText", label: "Plain text" },
            ]}
            onChange={setFormat}
          />
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              if (!isApp) return toast("Exporting works in the desktop app.");
              api.exportNotesArchive(format).then(
                (done) => done && toast("Exported your notes."),
                (e: unknown) => toast(`That didn't work: ${String(e)}`),
              );
            }}
          >
            Export
          </button>
        </AtRow>
      </AtRows>
    </AtSection>
  );
}

function Duplicates() {
  const toast = useToast();
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const find = async () => {
    setBusy(true);
    try {
      const found = await api.findDuplicates();
      if (found.length) setGroups(found);
      else toast("No duplicates found. Every book in your library looks different.");
    } catch (e) {
      toast(`That didn't work: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AtSection id="duplicates" title="Duplicates">
      <AtRows>
        <AtRow label="Find duplicate books" hint="Compare them side by side and pick which to keep.">
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void find()}>
            Find duplicates
          </button>
        </AtRow>
      </AtRows>
      {groups && <DuplicatesDialog groups={groups} onClose={() => setGroups(null)} />}
    </AtSection>
  );
}

/** Management: Archive folder, Tags, Duplicates | Scribe, Deleted books, Reading history. */
export function DeskManagement() {
  const info = useLibraryInfo();
  const { settings, change } = useAppSettings();
  return (
    <AtPage>
      <AtSection id="folder" title="Archive folder" also={["files", "formats", "where"]}>
        <AtRows>
          {info ? (
            <AtRow label="Folder" hint={`${info.bookCount} ${info.bookCount === 1 ? "book" : "books"}, ${formatBytes(info.booksBytes)}`}>
              <code className="at-path" title={info.booksDir}>
                {info.booksDir}
              </code>
              <ShowButton path={info.booksDir} />
            </AtRow>
          ) : (
            <AtRow label="Folder" hint="The library folder couldn't be read." />
          )}
        </AtRows>
        <AtMore id="files" label="How TBV treats your files">
          <BookFilesList />
        </AtMore>
        <AtMore id="formats" label="Book formats">
          <BookFormatsList />
        </AtMore>
      </AtSection>
      <AtSection id="tags" title="Tags">
        <TagChips after={<span className="at-row-hint">Add them from any book's menu, right-click a book, or filter the Archive by them.</span>} />
      </AtSection>
      <AtPair>
        <Duplicates />
        <ScribeExport />
      </AtPair>
      <AtSection id="deleted" title="Deleted books">
        <AtRows>
          <AtSwitch label="Skip books I've deleted" checked={settings.skipDeletedImports} onChange={(skipDeletedImports) => change({ skipDeletedImports })} />
        </AtRows>
        <DeletedBooksList />
      </AtSection>
      <ReadingHistorySection />
    </AtPage>
  );
}
