import { useEffect, useRef, useState } from "react";
import { api, isApp, isIOS, openExternal } from "../api";
import type { DuplicateGroup, GoodreadsImport, LibraryInfo, SortOrder, TagCount } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { DuplicatesDialog } from "./DuplicatesDialog";
import { OwnerCode, PlanButtons, shopName, useLicense } from "../license/License";
import { canSelfUpdate, useUpdater, type UpdateState } from "./updates";
import { SORTS, type Layout } from "../library/libraryView";
import { TextSettings } from "../reader/ReaderPopovers";
import { PAGE_COLORS, resolveTheme, WIDTHS } from "../reader/settings";
import { readLocal, useAppDark, useAppSettings, writeLocal } from "./appSettings";
import { useReaderSettings } from "./AppearanceTab";
import { ActionTile, Columns, formatBytes, RadioList, Row, Section, SectionGroup, Segmented, Select, Toggle } from "./controls";
import { HardcoverSection } from "./HardcoverSection";
import { ReadingHistorySection } from "./ReadingHistory";

const READING_FONTS = {
  lora: '"Lora", Georgia, serif',
  georgia: "Georgia, Gelasio, serif",
  sans: "var(--font-sans)",
  echolume: '"Echolume", sans-serif',
  publisher: "Georgia, Gelasio, serif",
};

export function ReadingTab() {
  const [reader, change] = useReaderSettings();
  const dark = useAppDark();
  if (!reader) return null;
  const colors = PAGE_COLORS[resolveTheme(reader.theme, dark)];
  return (
    <Columns side={isApp ? <ReadAlongSection /> : undefined}>
      <Section
        id="text"
        title="Text and page"
        lede="These are the same choices as the Aa button in the reader, and apply to every book."
        aside={
          <div className="reading-sample" style={{ background: colors.background, color: colors.text }}>
            <p
              style={{
                fontFamily: READING_FONTS[reader.font],
                fontSize: reader.size,
                lineHeight: reader.lineHeight,
                textAlign: reader.justify ? "justify" : "start",
                maxWidth: WIDTHS[reader.width] / 1.6,
              }}
            >
              It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief,
              it was the epoch of incredulity, it was the season of Light, it was the season of Darkness.
            </p>
            <span className="reading-sample-note" style={{ color: colors.muted }}>
              Charles Dickens, A Tale of Two Cities
            </span>
          </div>
        }
      >
        <TextSettings settings={reader} onChange={change} />
      </Section>
    </Columns>
  );
}

interface LineUpSettings {
  auto: boolean;
  model: "standard" | "faster";
  effort: "gentle" | "full";
  background: boolean;
  /** Phones: the battery and heat warning was agreed to when it was turned on. */
  agreed: boolean;
}

/** On a phone, lining up is off until it's turned on and the warning agreed to. */
const LINE_UP_DEFAULTS: LineUpSettings = { auto: !isIOS, model: "standard", effort: "gentle", background: true, agreed: false };
/** Said before lining up is turned on on a phone, and under the switch. */
export const PHONE_LINE_UP_WARNING =
  "Confluence works the phone's processor hard for a long time. It can drain the battery, even when the phone is plugged in, and it may make the phone overheat. TBV pauses when the phone gets too warm and carries on once it has cooled down. A computer with TBV open converges pairs for your phone as well.";
const LINE_UP_KEY = "readAlong.lineUp";

/** How this device lines up books with their audiobooks, word by word. */
function ReadAlongSection() {
  const [set, setSet] = useState<LineUpSettings | null>(null);
  const [models, setModels] = useState<[string, number][]>([]);
  const [asking, setAsking] = useState(false);
  const toast = useToast();
  useEffect(() => {
    api.getSetting(LINE_UP_KEY).then(
      (raw) => {
        let saved: Partial<LineUpSettings> = {};
        try {
          saved = raw ? JSON.parse(raw) : {};
        } catch {
          // A broken value falls back to the defaults.
        }
        setSet({ ...LINE_UP_DEFAULTS, ...saved });
      },
      () => setSet(LINE_UP_DEFAULTS),
    );
    api.speechModels().then(setModels, () => setModels([]));
  }, []);
  if (!set) return null;
  const change = (patch: Partial<LineUpSettings>) => {
    const next = { ...set, ...patch };
    setSet(next);
    void api.setSetting(LINE_UP_KEY, JSON.stringify(next)).then(() => api.wakeLiningUp());
  };
  const size = models.reduce((sum, [, bytes]) => sum + bytes, 0);
  return (
    <Section
      id="read-along"
      title="Read-along"
      lede="A book paired with its audiobook converges with it word by word in Confluence, so the words light up as they're read. Activity shows how far each pair has got."
    >
      <Toggle
        label="Run Confluence by itself"
        hint={
          isIOS
            ? `Off unless you turn it on. ${PHONE_LINE_UP_WARNING}`
            : "When it's off, nothing converges on this device. Pairs still follow along by chapter."
        }
        checked={set.auto && (!isIOS || set.agreed)}
        onChange={(auto) => (auto && isIOS ? setAsking(true) : change({ auto }))}
      />
      {asking && (
        <ConfirmDialog
          title="Run Confluence on this phone?"
          body={PHONE_LINE_UP_WARNING}
          confirm="Turn on"
          onConfirm={() => {
            setAsking(false);
            change({ auto: true, agreed: true });
          }}
          onCancel={() => setAsking(false)}
        />
      )}
      <Row label="Accuracy" hint="Applies to what converges from now on." stack>
        <RadioList<LineUpSettings["model"]>
          label="Accuracy"
          value={set.model}
          options={[
            { value: "standard", label: "Standard", hint: "Hears words more reliably. A one-time download of about 190 MB." },
            { value: "faster", label: "Faster", hint: "About twice as quick, with a few more missed words. About 60 MB." },
          ]}
          onChange={(model) => change({ model })}
        />
      </Row>
      <Row label="Speed" hint="Gently uses half the processor, so everything else stays quick.">
        <Segmented<LineUpSettings["effort"]>
          label="Speed"
          value={set.effort}
          options={[
            { value: "gentle", label: "Gently" },
            { value: "full", label: "As fast as possible" },
          ]}
          onChange={(effort) => change({ effort })}
        />
      </Row>
      {isIOS && (
        <Toggle
          label="Carry on in the background while charging"
          hint="iPhone lets this run only when the phone is plugged in and not in use."
          checked={set.background}
          onChange={(background) => change({ background })}
        />
      )}
      <Row label="Speech model" hint={size ? `${formatBytes(size)} on this device.` : "Not downloaded yet. It's fetched the first time a pair converges."}>
        {size > 0 && (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() =>
              void api.removeSpeechModels().then(
                () => {
                  setModels([]);
                  toast("Speech model removed. It's downloaded again when it's needed.");
                },
                () => toast("The speech model couldn't be removed."),
              )
            }
          >
            Remove
          </button>
        )}
      </Row>
    </Section>
  );
}

const LIBRARY_LAYOUTS: { value: Layout; label: string }[] = [
  { value: "grid", label: "Covers" },
  { value: "list", label: "List" },
  { value: "compact", label: "Compact" },
];

function useLibraryInfo() {
  const [info, setInfo] = useState<LibraryInfo | null>(null);
  useEffect(() => {
    api.libraryInfo().then(setInfo, () => setInfo(null));
  }, []);
  return info;
}

function ShowButton({ path, label = "Show in File Explorer" }: { path: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn btn-quiet"
      onClick={() => (isApp ? api.showFolder(path).catch((e: unknown) => toast(String(e))) : toast("This opens File Explorer in the desktop app."))}
    >
      <Icon name="folder" size={16} /> {label}
    </button>
  );
}

export function LibraryTab({
  layout,
  sort,
  onChange,
}: {
  layout: Layout;
  sort: SortOrder;
  onChange: (change: { layout?: Layout; sort?: SortOrder }) => void;
}) {
  const info = useLibraryInfo();
  const { settings, change } = useAppSettings();
  const side = (
    <>
      <SectionGroup id="where" title="Where your books live" lede="TBV's own copy of each book, and the books you've deleted." holds={["folder", "deleted"]}>
        <Section
          id="folder"
          title="Archive folder"
          lede="TBV keeps its own copy of every book you import here. The originals you imported from are left alone."
        >
          {info ? (
            <>
              <Row label="Folder" hint={`${info.bookCount} ${info.bookCount === 1 ? "book" : "books"}, ${formatBytes(info.booksBytes)}`} stack>
                <div className="path-row">
                  <code className="path">{info.booksDir}</code>
                  <ShowButton path={info.booksDir} />
                </div>
              </Row>
            </>
          ) : (
            <p className="settings-row-hint">The library folder couldn't be read.</p>
          )}
        </Section>
        <DeletedBooksSection />
      </SectionGroup>
      <SectionGroup id="ratings" title="Ratings sites" lede="Your ratings in and out of Goodreads and Hardcover." holds={["goodreads", "hardcover"]}>
        <GoodreadsSection />
        <HardcoverSection />
      </SectionGroup>
    </>
  );
  return (
    <Columns side={side}>
      <Section id="view" title="Archive view" lede="How the Archive starts out. Changing it there is remembered too.">
        <Row label="Layout">
          <Segmented<Layout> label="Archive layout" value={layout} options={LIBRARY_LAYOUTS} onChange={(l) => onChange({ layout: l })} />
        </Row>
        <Row label="Sort books by">
          <Select<SortOrder>
            label="Sort books by"
            value={sort}
            options={SORTS.map((s) => ({ value: s.sort, label: s.label }))}
            onChange={(s) => onChange({ sort: s })}
          />
        </Row>
        <Row label="Pages" hint="On a phone the Archive always scrolls on without pages.">
          <Toggle
            label="Scroll on without page numbers"
            hint="More books load as you reach the end."
            checked={settings.scrollLibrary}
            onChange={(scrollLibrary) => change({ scrollLibrary })}
          />
        </Row>
      </Section>
      <SectionGroup id="tidying" title="Tidying your Archive" lede="Your tags, and books you have more than once." holds={["tags", "duplicates"]}>
        <TagsSection />
        <DuplicatesSection />
      </SectionGroup>
      <ReadingHistorySection />
    </Columns>
  );
}

function TagsSection() {
  const toast = useToast();
  const [tags, setTags] = useState<TagCount[] | null>(null);
  const [removing, setRemoving] = useState<TagCount | null>(null);
  const load = () => void api.allTags().then(setTags, () => setTags([]));
  useEffect(load, []);
  const remove = async (tag: TagCount) => {
    setRemoving(null);
    try {
      // The Library hands books over a page at a time.
      const ids: string[] = [];
      for (let page = 0; ; page++) {
        const found = await api.getLibrary({ shelf: "all", sort: "title", search: null, formats: [], location: null, tags: [tag.name], page, pageSize: 200 });
        ids.push(...found.books.map((b) => b.id));
        if (found.page < page || ids.length >= found.total || !found.books.length) break;
      }
      await api.removeTag(ids, tag.name);
      toast(`Took “${tag.name}” off ${tag.count} ${tag.count === 1 ? "book" : "books"}.`);
    } catch (e) {
      toast(`That didn't work: ${String(e)}`);
    }
    load();
  };
  return (
    <Section id="tags" title="Tags" lede="Your own labels for books. Add them from any book's menu, right-click a book, or filter the Archive by them.">
      {tags === null ? null : tags.length === 0 ? (
        <p className="settings-row-hint">No tags yet. Right-click a book, or open its … menu, and choose Add tags.</p>
      ) : (
        <ul className="tag-manage">
          {tags.map((t) => (
            <li key={t.name}>
              <span className="tag-chip">
                {t.name}
                <span className="muted num">{t.count}</span>
                <button type="button" aria-label={`Remove ${t.name} from every book`} title="Remove from every book" onClick={() => setRemoving(t)}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove the tag “${removing.name}”?`}
          body={`It comes off all ${removing.count} ${removing.count === 1 ? "book" : "books"} that have it. The books stay in your library.`}
          confirm="Remove tag"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() => void remove(removing)}
        />
      )}
    </Section>
  );
}

/** What happens when an import brings back a book that was deleted before. */
function DeletedBooksSection() {
  const { settings, change } = useAppSettings();
  return (
    <Section
      id="deleted"
      title="Deleted books"
      lede="TBV remembers the books you've deleted, on any of your devices, by the file itself, so renamed copies are recognised too."
    >
      <div className="toggle-list">
        <Toggle
          label="Skip books I've deleted"
          hint={
            settings.skipDeletedImports
              ? "Imports leave them out. The Imports page lists them as skipped."
              : "Imports bring them back and put them in the Previously deleted collection, so you can look them over."
          }
          checked={settings.skipDeletedImports}
          onChange={(skipDeletedImports) => change({ skipDeletedImports })}
        />
      </div>
    </Section>
  );
}

function DuplicatesSection() {
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
    <Section
      id="duplicates"
      title="Duplicates"
      lede="Finds books that look like the same book twice: the same ISBN, or the same title and author. Nothing is deleted unless you choose to."
    >
      <div className="action-tiles">
        <ActionTile
          icon={<Icon name="copy" size={22} />}
          title="Find duplicate books"
          hint="Compare them side by side and pick which to keep."
          disabled={busy}
          onClick={() => void find()}
        />
      </div>
      {groups && <DuplicatesDialog groups={groups} onClose={() => setGroups(null)} />}
    </Section>
  );
}


function GoodreadsSection() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<GoodreadsImport | null>(null);
  const exportFile = async () => {
    setBusy(true);
    try {
      const count = await api.exportGoodreads();
      if (count !== null) toast(`Saved ${count} ${count === 1 ? "book" : "books"}. On Goodreads, open My Books, then Import and export, and import this file.`);
    } catch (e) {
      toast(`That didn't work: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    setBusy(true);
    try {
      const done = await api.importGoodreads();
      if (done) setReport(done);
    } catch (e) {
      toast(`That didn't work: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      id="goodreads"
      title="Goodreads"
      lede="Goodreads doesn't let other apps change your account, so ratings travel by file. Bring a Goodreads export into TBV, or make a file of your TBV ratings and shelves for Goodreads to import."
    >
      <div className="action-tiles">
        <ActionTile
          icon={<Icon name="upload" size={22} />}
          title="Import a Goodreads export"
          hint="Only fills in what TBV is missing."
          disabled={busy}
          onClick={() => void start()}
        />
        <ActionTile
          icon={<Icon name="download" size={22} />}
          title="Export for Goodreads"
          hint="Your ratings, reading status and shelves."
          disabled={busy}
          onClick={() => void exportFile()}
        />
      </div>
      <p className="settings-row-hint">
        On the Goodreads website, open My Books, then Import and export, and choose Export Library. Save the file it gives you, then choose it here.
      </p>
      {report && <GoodreadsReport report={report} onClose={() => setReport(null)} />}
    </Section>
  );
}

function GoodreadsReport({ report, onClose }: { report: GoodreadsImport; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  const books = (n: number) => `${n} ${n === 1 ? "book" : "books"}`;
  const lines = [
    report.ratings > 0 && `Ratings added to ${books(report.ratings)}.`,
    report.statuses > 0 && `Reading status brought in for ${books(report.statuses)}.`,
    report.upNext > 0 && `${books(report.upNext)} put in Up next.`,
    report.favourites > 0 && `${books(report.favourites)} marked as favourites.`,
    report.collectionsCreated.length > 0 &&
      `New ${report.collectionsCreated.length === 1 ? "collection" : "collections"} from your shelves: ${report.collectionsCreated.join(", ")}.`,
    report.collectionBooks > 0 && `${books(report.collectionBooks)} added to collections.`,
  ].filter(Boolean) as string[];
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog goodreads-report" role="dialog" aria-label="Goodreads import" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h2>Goodreads import</h2>
        <p className="muted">
          {report.matched} of the {report.rows} books in your export are in your library.
        </p>
        {lines.length > 0 ? (
          <ul>
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          <p>TBV already had everything the export holds, so nothing changed.</p>
        )}
        {report.notFound.length > 0 && (
          <details>
            <summary>
              {books(report.notFound.length)} from Goodreads aren't in your library
            </summary>
            <ul className="goodreads-missing">
              {report.notFound.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </details>
        )}
        <div className="dialog-actions">
          <button ref={close} type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const COLLECTIONS_PREFS = "tbv.collections.view";

export function CollectionsTab() {
  const { settings, change } = useAppSettings();
  const [layout, setLayout] = useState<"grid" | "list">(() => (readLocal(COLLECTIONS_PREFS).layout === "list" ? "list" : "grid"));
  return (
    <Section id="show" title="What the Compendium shows" lede="Sorting and your own order are set in the Compendium itself.">
      <div className="toggle-list">
        <Toggle
          label="Show smart collections"
          hint="Recently added, Unread, In progress and the others that fill themselves."
          checked={settings.showSmartCollections}
          onChange={(showSmartCollections) => change({ showSmartCollections })}
        />
        <Toggle
          label="Show series"
          hint="Series found in your books' details, next to your own collections."
          checked={settings.showSeries}
          onChange={(showSeries) => change({ showSeries })}
        />
      </div>
      <Row label="Your collections appear as">
        <Segmented<"grid" | "list">
          label="Compendium layout"
          value={layout}
          options={[
            { value: "grid", label: "Cards" },
            { value: "list", label: "List" },
          ]}
          onChange={(l) => {
            setLayout(l);
            writeLocal(COLLECTIONS_PREFS, { layout: l });
          }}
        />
      </Row>
    </Section>
  );
}

const NOTES_PREFS = "tbv.notes.view";
type NotesLayout = "list" | "cards" | "compact";
type NotesSortChoice = "recent" | "updated" | "book";

export function NotesTab() {
  const toast = useToast();
  const saved = readLocal(NOTES_PREFS);
  const [layout, setLayout] = useState<NotesLayout>(saved.layout === "cards" || saved.layout === "compact" ? saved.layout : "list");
  const [sort, setSort] = useState<NotesSortChoice>(saved.sort === "updated" || saved.sort === "book" ? saved.sort : "recent");
  return (
    <>
      <Section id="view" title="Notes" lede="How Scribe shows your notes, and all of them in one file.">
        <Row label="Layout">
          <Segmented<NotesLayout>
            label="Notes layout"
            value={layout}
            options={[
              { value: "list", label: "List" },
              { value: "cards", label: "Cards" },
              { value: "compact", label: "Compact" },
            ]}
            onChange={(l) => {
              setLayout(l);
              writeLocal(NOTES_PREFS, { layout: l });
            }}
          />
        </Row>
        <Row label="Sort notes by">
          <Select<NotesSortChoice>
            label="Sort notes by"
            value={sort}
            options={[
              { value: "recent", label: "Recently added" },
              { value: "updated", label: "Recently changed" },
              { value: "book", label: "Book, in reading order" },
            ]}
            onChange={(s) => {
              setSort(s);
              writeLocal(NOTES_PREFS, { sort: s });
            }}
          />
        </Row>
        <Row label="Export notes" hint="Every highlight and note in one Markdown file, grouped by book. It opens in any text editor, Obsidian or Notion.">
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              if (!isApp) return toast("Exporting works in the desktop app.");
              api.exportNotesMarkdown().then(
                (done) => done && toast("Exported your notes."),
                (e: unknown) => toast(`That didn't work: ${String(e)}`),
              );
            }}
          >
            <Icon name="download" size={16} /> Export as Markdown
          </button>
        </Row>
      </Section>
    </>
  );
}

const FORMATS: { ext: string; name: string }[] = [
  { ext: "EPUB", name: "The standard eBook format" },
  { ext: "PDF", name: "Fixed pages, like print" },
  { ext: "MOBI", name: "Older Kindle books" },
  { ext: "AZW3", name: "Kindle books without DRM (also AZW)" },
  { ext: "CBZ, CBR", name: "Comics and graphic novels" },
  { ext: "FB2", name: "FictionBook (also zipped, as FBZ)" },
  { ext: "TXT", name: "Plain text, split into chapters where it has them" },
  { ext: "DOCX", name: "Word documents, with their formatting" },
  { ext: "DOC", name: "Older Word documents, as text only" },
];

export function FilesTab() {
  const formats = (
      <Section id="formats" title="Book formats" lede="TBV imports and reads all of these.">
        <ul className="format-list">
          {FORMATS.map((f) => (
            <li key={f.ext}>
              <span className="format-ext">{f.ext}</span>
              <span className="settings-row-hint">{f.name}</span>
              <span className="format-state is-ready">Opens in the reader</span>
            </li>
          ))}
        </ul>
        <p className="settings-row-hint">Books with DRM (copy protection) can't be opened by any reader but the shop's own.</p>
      </Section>
  );
  return (
    <Columns side={formats}>
      <Section id="files" title="Your book files" lede="What TBV does, and never does, with your books.">
        <ul className="promise-list">
          <li>
            <Icon name="check" size={18} /> Importing copies a book into TBV's library folder. The file you imported from stays where it was.
          </li>
          <li>
            <Icon name="check" size={18} /> TBV never changes a book file. Titles, authors, covers and other details you correct are kept beside the
            book, and a reset brings back the book's own.
          </li>
          <li>
            <Icon name="check" size={18} /> The same book imported twice is recognised from its contents, so it appears once.
          </li>
          <li>
            <Icon name="check" size={18} /> Removing a book from this device keeps your progress and notes. Deleting it removes it everywhere.
          </li>
        </ul>
      </Section>
    </Columns>
  );
}

export function AccessibilityTab() {
  const { settings, change } = useAppSettings();
  return (
    <>
      <Section id="vision" title="Seeing and motion" lede="Interface size is under Appearance, and reading text sizes under Reading.">
        <div className="toggle-list">
          <Toggle
            label="Use high contrast"
            hint="Darker text, clearer edges and a stronger focus colour."
            checked={settings.highContrast}
            onChange={(highContrast) => change({ highContrast })}
          />
          <Toggle
            label="Always show where focus is"
            hint="Draws a ring around the control you are on, even after a mouse click."
            checked={settings.strongFocus}
            onChange={(strongFocus) => change({ strongFocus })}
          />
          <Toggle
            label="Underline links"
            hint="Makes text you can click easier to spot."
            checked={settings.underlineLinks}
            onChange={(underlineLinks) => change({ underlineLinks })}
          />
          <Toggle
            label="Reduce motion"
            hint="Turns off animations, fades and sliding panels."
            checked={settings.reduceMotion}
            onChange={(reduceMotion) => change({ reduceMotion })}
          />
        </div>
      </Section>
    </>
  );
}

const EVERYWHERE: [string, string][] = [
  ["Ctrl + 1 to 7", "Go to Sanctum, Archive, Resonance, Compendium, Scribe, Discover or Preferences"],
  ["Ctrl + F  or  Ctrl + K", "Search"],
  ["Ctrl + O", "Import books"],
  ["Ctrl + \\", "Show or hide the sidebar"],
  ["Alt + arrow keys", "Move a collection when sorted by Your order"],
];

const READER: [string, string][] = [
  ["→  or  Page Down  or  Space", "Next page"],
  ["←  or  Page Up  or  Shift + Space", "Previous page"],
  ["Ctrl + F", "Search in the book"],
  ["Ctrl + B", "Add or remove a bookmark"],
  ["F", "Focus mode"],
  ["R", "Read aloud, or pause reading"],
  ["F11", "Full screen"],
  ["Esc", "Close a panel, leave focus mode or full screen"],
];

function KeyTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="key-table">
      <tbody>
        {rows.map(([keys, what]) => (
          <tr key={keys}>
            <td>
              {keys.split(/\s{2}or\s{2}/).map((k, i) => (
                <span key={k}>
                  {i > 0 && <span className="key-or"> or </span>}
                  <kbd>{k}</kbd>
                </span>
              ))}
            </td>
            <td>{what}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ShortcutsTab() {
  return (
    <Columns
      side={
        <Section id="reader" title="While reading" lede="Page keys turn pages when Turn pages is chosen; with Scroll they scroll.">
          <KeyTable rows={READER} />
        </Section>
      }
    >
      <Section id="everywhere" title="Everywhere">
        <KeyTable rows={EVERYWHERE} />
      </Section>
    </Columns>
  );
}

export function AdvancedTab() {
  const info = useLibraryInfo();
  const { reset } = useAppSettings();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  return (
    <Columns
      side={
        <Section
          id="reset"
          title="Reset settings"
          lede="Puts Appearance, Compendium, Accessibility and Sync choices back as they came. Your books, notes and collections are not touched."
        >
          <button type="button" className="btn btn-quiet" onClick={() => setConfirming(true)}>
            Reset settings…
          </button>
        </Section>
      }
    >
      <Section id="data" title="Data on this device" lede="Your library's details, progress, notes and collections live in one database file.">
        {info ? (
          <>
            <Row label="Database" hint={formatBytes(info.databaseBytes)} stack>
              <div className="path-row">
                <code className="path">{info.database}</code>
                <ShowButton path={info.database} />
              </div>
            </Row>
            <Row label="Data version" hint="Goes up when an update changes how TBV stores things. Backups from newer versions need the newer TBV.">
              <span className="settings-value">{info.schemaVersion}</span>
            </Row>
          </>
        ) : (
          <p className="settings-row-hint">The data folder couldn't be read.</p>
        )}
      </Section>
      {confirming && (
        <ConfirmDialog
          title="Reset settings?"
          body="Theme, scale, accessibility and sync choices go back to how they came. Your library, notes and collections stay as they are."
          confirm="Reset settings"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            reset();
            setConfirming(false);
            toast("Settings are back as they came.");
          }}
        />
      )}
    </Columns>
  );
}

const CREDITS: { name: string; what: string; licence: string; url?: string }[] = [
  {
    name: "Echolume",
    what: "A reading and interface font, by Krowsingre Publishing",
    licence: "All rights reserved, Krowsingre Publishing LLC",
  },
  {
    name: "foliate-js",
    what: "The page engine inside the reader",
    licence: "MIT",
    url: "https://github.com/johnfactotum/foliate-js",
  },
  {
    name: "zip.js",
    what: "Opening EPUB files",
    licence: "BSD 3-Clause",
    url: "https://github.com/gildas-lormeau/zip.js",
  },
  {
    name: "fflate",
    what: "Unpacking compressed book files",
    licence: "MIT",
    url: "https://github.com/101arrowz/fflate",
  },
  {
    name: "PDF.js",
    what: "Showing PDF books, by Mozilla",
    licence: "Apache 2.0",
    url: "https://github.com/mozilla/pdf.js",
  },
  {
    name: "Readability",
    what: "Discover's reader mode, by Mozilla",
    licence: "Apache 2.0",
    url: "https://github.com/mozilla/readability",
  },
  {
    name: "Mammoth",
    what: "Reading Word documents",
    licence: "BSD 2-Clause",
    url: "https://github.com/mwilliamson/mammoth.js",
  },
  {
    name: "Lora",
    what: "The default reading font, by Cyreal",
    licence: "SIL Open Font License 1.1",
    url: "https://github.com/cyrealtype/Lora-Cyrillic",
  },
  {
    name: "Gelasio",
    what: "Titles where Georgia isn't installed",
    licence: "SIL Open Font License 1.1",
    url: "https://github.com/SorkinType/Gelasio",
  },
  {
    name: "Tauri",
    what: "The desktop app around TBV",
    licence: "MIT or Apache 2.0",
    url: "https://tauri.app",
  },
  {
    name: "React",
    what: "The interface",
    licence: "MIT",
    url: "https://react.dev",
  },
  {
    name: "SQLite",
    what: "The library's database",
    licence: "Public domain",
    url: "https://sqlite.org",
  },
  {
    name: "citeproc-js",
    what: "Writes citations in Scribe",
    licence: "CPAL 1.0",
    url: "https://github.com/Juris-M/citeproc-js",
  },
  {
    name: "Citation Style Language styles",
    what: "APA, MLA, Chicago and the other citation styles",
    licence: "CC BY-SA 3.0",
    url: "https://citationstyles.org",
  },
];

/** The trial, or the purchase. */
function YourCopy() {
  const { license, busy, buy, restore } = useLicense();
  if (!license) return null;
  const ends = new Date(license.trialEnds * 1000).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  const words =
    license.state === "owned"
      ? license.plan === "yearly" || license.plan === "monthly"
        ? `On the ${license.publisher ? "Publisher " : ""}${license.plan} plan from ${shopName(license.shop)}. Thank you. It renews each ${license.plan === "yearly" ? "year" : "month"}; ${license.shop === "apple" ? "manage it in your Apple ID's Subscriptions" : "manage it in the Microsoft Store's Subscriptions"}.`
        : `${license.publisher ? "TBV Publisher, bought" : "Bought"} in ${shopName(license.shop)}. Thank you.`
      : license.trialDays > 0
        ? `${license.daysLeft === 1 ? "1 day" : `${license.daysLeft} days`} left of your free trial (until ${ends}). Choose a plan to keep using it after that.`
        : "Choose a plan to use The Bound Vigil.";
  return (
    <Section id="licence" title="Your copy" lede={words}>
      {license.state !== "owned" && license.shop !== "none" && (
        <div className="settings-actions">
          <PlanButtons />
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void restore()}>
            I bought it already
          </button>
        </div>
      )}
      {license.state !== "owned" && license.shop === "none" && (
        <p className="settings-row-hint">This copy didn't come from a store, so it can't be bought in. The Bound Vigil will be sold in the Microsoft Store and the App Store.</p>
      )}
      {license.state === "owned" && (license.plan === "monthly" || license.plan === "yearly") && license.shop !== "none" && (
        <div className="settings-actions">
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void buy(license.publisher ? "publisherLifetime" : "lifetime")}>
            Switch to lifetime{(license.publisher ? license.publisherPrice : license.price) ? ` for ${license.publisher ? license.publisherPrice : license.price}` : ""}
          </button>
        </div>
      )}
      {license.state !== "owned" && <OwnerCode />}
    </Section>
  );
}

function updateWords(state: UpdateState): string {
  switch (state.step) {
    case "idle":
      return "TBV can look for a newer version and install it for you.";
    case "checking":
      return "Looking for a newer version…";
    case "checked":
      return state.info.version ? `Version ${state.info.version} is ready to install.` : "You have the newest version.";
    case "installing": {
      const p = state.progress;
      if (!p) return `Getting version ${state.info.version}…`;
      if (p.total && p.downloaded >= p.total) return "Installing. TBV will open again by itself.";
      return p.total ? `Getting version ${state.info.version}… ${Math.round((p.downloaded / p.total) * 100)}%` : `Getting version ${state.info.version}… ${formatBytes(p.downloaded)}`;
    }
    case "failed":
      return state.message;
  }
}

function Updates() {
  const { settings, change } = useAppSettings();
  const { state, check, install } = useUpdater();
  const ready = state.step === "checked" && state.info.version ? state.info : null;
  return (
    <Section id="updates" title="Updates" lede={updateWords(state)}>
      {ready?.notes && <p className="settings-row-hint update-notes">{ready.notes}</p>}
      <div className="settings-actions">
        {ready ? (
          <button type="button" className="btn btn-primary" onClick={() => install(ready)}>
            Install and restart
          </button>
        ) : (
          <button type="button" className="btn btn-quiet" disabled={state.step === "checking" || state.step === "installing"} onClick={check}>
            Check for updates
          </button>
        )}
      </div>
      <div className="toggle-list">
        <Toggle
          label="Look for updates when TBV opens"
          hint="TBV says when a newer version is ready."
          checked={settings.checkUpdates}
          onChange={(checkUpdates) => change({ checkUpdates })}
        />
        <Toggle
          label="Install updates by themselves"
          hint="When TBV opens and finds a newer version, it installs it straight away and starts again."
          checked={settings.checkUpdates && settings.autoInstallUpdates}
          disabled={!settings.checkUpdates}
          onChange={(autoInstallUpdates) => change({ autoInstallUpdates })}
        />
      </div>
    </Section>
  );
}

function AboutVersion({ version }: { version: string }) {
  return (
    <>
      <p className="about-lede">
        A quiet reader for the books you keep. Your library stays yours: on your computer, and in the cloud services you choose.
      </p>
      <Row label="Version">
        <span className="settings-value">{version}</span>
      </Row>
    </>
  );
}

export function AboutTab() {
  const [version, setVersion] = useState("1.57.0");
  useEffect(() => {
    if (!isApp) return;
    void import("@tauri-apps/api/app").then(({ getVersion }) => getVersion().then(setVersion, () => undefined));
  }, []);
  return (
    <>
      <Columns side={<YourCopy />}>
      {canSelfUpdate ? (
        <SectionGroup id="about" title="The Bound Vigil" holds={["updates"]}>
          <AboutVersion version={version} />
          <Updates />
        </SectionGroup>
      ) : (
        <Section id="about" title="The Bound Vigil">
          <AboutVersion version={version} />
        </Section>
      )}
      </Columns>
      <Section id="licences" title="Built with" lede="TBV stands on the work of these projects. Thank you to their authors.">
        <ul className="credit-list">
          {CREDITS.map((c) => (
            <li key={c.name}>
              {c.url ? (
                <button type="button" className="credit-name link-btn" onClick={() => void openExternal(c.url!)}>
                  {c.name}
                </button>
              ) : (
                <span className="credit-name">{c.name}</span>
              )}
              <span className="settings-row-hint">{c.what}</span>
              <span className="credit-licence">{c.licence}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
