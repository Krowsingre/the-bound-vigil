import { RememberedDetails } from "../components/RememberedDetails";
import { useEffect, useRef, useState } from "react";
import { api, isAndroid, isApp, isIOS, openExternal } from "../api";
import type { DeletedBook, DuplicateGroup, GoodreadsImport, LibraryInfo, SortOrder, TagCount } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { DuplicatesDialog } from "./DuplicatesDialog";
import { canBuyIn, ManageSubscription, OwnerCode, PlanButtons, PRIVACY_POLICY, publisherWords, standardWords, TERMS, useLicense } from "../license/License";
import { PublisherPlans, PublisherTools } from "../license/Publisher";
import { canSelfUpdate, useUpdater, type UpdateState } from "./updates";
import { SORTS, type Layout } from "../library/libraryView";
import { TextSettings } from "../reader/ReaderPopovers";
import { PAGE_COLORS, resolveTheme } from "../reader/settings";
import { readLocal, useAppDark, useAppSettings, writeLocal, type SeriesCheckEvery } from "./appSettings";
import { canCheckSeries, checkAllSeries, useSeriesNews } from "../library/seriesCheck";
import { canWatch, unwatch, useWatch, watchAuthor, watchBook, whenLine } from "../library/watchList";
import { relativeTime } from "../lib/format";
import { useReaderSettings } from "./AppearanceTab";
import { ActionTile, Columns, formatBytes, RadioList, Row, Section, SectionGroup, Segmented, Select, Toggle, useDeskPrefs } from "./controls";
import { HardcoverSection } from "./HardcoverSection";
import { CanvaSection, canvaHere } from "./CanvaSection";
import { ReadingHistorySection } from "./ReadingHistory";
import { AtChoice, AtMore, AtRow, AtRows, AtSection, AtSwitch, useAttuneFrame, usePhone } from "./attune";
import { useShortcuts } from "../lib/shortcuts";

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
                maxWidth: reader.width / 1.6,
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
const LINE_UP_DEFAULTS: LineUpSettings = { auto: !isIOS && !isAndroid, model: "standard", effort: "gentle", background: true, agreed: false };
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
  const desk = useDeskPrefs();
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
  if (isAndroid)
    return (
      <Section id="read-along" title="Read-along">
        <p className="settings-row-hint">Confluence doesn't run in the Android test version yet. Pairs converged on your computer or iPhone sync here, and the others follow along by chapter.</p>
      </Section>
    );
  const change = (patch: Partial<LineUpSettings>) => {
    const next = { ...set, ...patch };
    setSet(next);
    void api.setSetting(LINE_UP_KEY, JSON.stringify(next)).then(() => api.wakeLiningUp());
  };
  const size = models.reduce((sum, [, bytes]) => sum + bytes, 0);
  const tune = (
    <>
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
    </>
  );
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
      {desk ? (
        <RememberedDetails className="settings-more" disclosure="prefs.readalong.tune">
          <summary>Fine-tune</summary>
          {tune}
        </RememberedDetails>
      ) : (
        tune
      )}
    </Section>
  );
}

/**
 * Attunement › Library › Read-along on a computer (embre, 27 November): the same settings
 * as above, in rows, with TBV's own words.
 */
export function DeskReadAlong() {
  const [set, setSet] = useState<LineUpSettings | null>(null);
  const [models, setModels] = useState<[string, number][]>([]);
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
  if (!set || !isApp) return null;
  const change = (patch: Partial<LineUpSettings>) => {
    const next = { ...set, ...patch };
    setSet(next);
    void api.setSetting(LINE_UP_KEY, JSON.stringify(next)).then(() => api.wakeLiningUp());
  };
  const size = models.reduce((sum, [, bytes]) => sum + bytes, 0);
  return (
    <AtSection id="read-along" title="Read-along">
      <AtRows>
        <AtSwitch
          label="Run Confluence by itself"
          hint="When it's off, nothing converges on this device. Pairs still follow along by chapter."
          checked={set.auto}
          onChange={(auto) => change({ auto })}
        />
        <AtRow label="Accuracy" hint="Applies to what converges from now on." wide>
          <AtChoice<LineUpSettings["model"]>
            label="Accuracy"
            value={set.model}
            options={[
              { value: "standard", label: "Standard" },
              { value: "faster", label: "Faster" },
            ]}
            onChange={(model) => change({ model })}
          />
        </AtRow>
        <AtRow label="Speed" hint="Gently uses half the processor, so everything else stays quick." wide>
          <AtChoice<LineUpSettings["effort"]>
            label="Speed"
            value={set.effort}
            options={[
              { value: "gentle", label: "Gently" },
              { value: "full", label: "As fast as possible" },
            ]}
            onChange={(effort) => change({ effort })}
          />
        </AtRow>
        <AtRow label="Speech model" hint={size ? `${formatBytes(size)} on this device.` : "Not downloaded yet. It's fetched the first time a pair converges."}>
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
        </AtRow>
      </AtRows>
    </AtSection>
  );
}

const LIBRARY_LAYOUTS: { value: Layout; label: string }[] = [
  { value: "grid", label: "Covers" },
  { value: "list", label: "List" },
  { value: "compact", label: "Compact" },
];

export function useLibraryInfo() {
  const [info, setInfo] = useState<LibraryInfo | null>(null);
  useEffect(() => {
    api.libraryInfo().then(setInfo, () => setInfo(null));
  }, []);
  return info;
}

export function ShowButton({ path, label = "Show in File Explorer" }: { path: string; label?: string }) {
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

function ArchiveFolderSection({ info }: { info: LibraryInfo | null }) {
  return (
    <Section id="folder" title="Archive folder" lede="TBV keeps its own copy of every book you import here. The originals you imported from are left alone.">
      {info ? (
        <Row label="Folder" hint={`${info.bookCount} ${info.bookCount === 1 ? "book" : "books"}, ${formatBytes(info.booksBytes)}`} stack>
          <div className="path-row">
            <code className="path">{info.booksDir}</code>
            <ShowButton path={info.booksDir} />
          </div>
        </Row>
      ) : (
        <p className="settings-row-hint">The library folder couldn't be read.</p>
      )}
    </Section>
  );
}

/**
 * The computer's Library page (embre, 21 November): the Archive, Compendium, Scribe and file
 * pages in one. The views each page's own toolbar already sets are left out.
 */
export function DeskLibraryTab() {
  const info = useLibraryInfo();
  const { settings, change } = useAppSettings();
  const toast = useToast();
  const side = (
    <>
      <Section id="show" title="Compendium">
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
      </Section>
      <SectionGroup id="series-authors" title="Series & authors" holds={["series-check", "watching"]}>
        <SeriesCheckSection />
        <WatchSection />
      </SectionGroup>
      <Section id="view" title="Scribe">
        <Row label="Export notes" hint="Every highlight and note in one Markdown file, grouped by book.">
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
  return (
    <Columns side={side}>
      <SectionGroup id="where" title="Your files" holds={["folder", "files", "formats"]}>
        <ArchiveFolderSection info={info} />
        <BookFilesSection />
        <BookFormatsSection />
      </SectionGroup>
      <SectionGroup id="tidying" title="Tidy your library" holds={["tags", "duplicates", "deleted"]}>
        <TagsSection />
        <DuplicatesSection />
        <DeletedBooksSection />
      </SectionGroup>
      <ReadingHistorySection />
    </Columns>
  );
}

/** The computer's Connections page: the other services TBV works with, in one place. */
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
        <Row label="Pages" hint="Applies to Archive and Resonance on desktop. Phones always scroll continuously.">
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
  // Phones and iPads hold a book where a computer right-clicks it.
  const keys = useShortcuts();
  return (
    <Section id="tags" title="Tags" lede={`Your own labels for books. Add them from any book's menu, ${keys ? "right-click" : "hold"} a book, or filter the Archive by them.`}>
      <TagChips />
    </Section>
  );
}

/** Every tag with how many books have it, each with a button to take it off every book. */
export function TagChips({ after }: { /** Under the chips, e.g. where tags come from. */ after?: React.ReactNode } = {}) {
  const keys = useShortcuts();
  const phone = usePhone();
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
  // A phone: one row that opens to every tag and how many books have it (embre, 28 November).
  if (phone)
    return tags === null ? null : tags.length === 0 ? (
      <p className="settings-row-hint">No tags yet. Hold a book, or open its … menu, and choose Add tags.</p>
    ) : (
      <AtMore id="tags" label="Tags" count={tags.length}>
        <ul className="at-ios-tags">
          {tags.map((t) => (
            <li key={t.name}>
              <span>{t.name}</span>
              <span className="muted">
                {t.count} {t.count === 1 ? "book" : "books"}
              </span>
            </li>
          ))}
        </ul>
      </AtMore>
    );
  return (
    <>
      {tags === null ? null : tags.length === 0 ? (
        <p className="settings-row-hint">No tags yet. {keys ? "Right-click" : "Hold"} a book, or open its … menu, and choose Add tags.</p>
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
      {tags && tags.length > 0 && after}
    </>
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
          label="Never re-import"
          hint={
            settings.skipDeletedImports
              ? "Imports leave them out. The Imports page lists them as skipped."
              : "Imports bring them back and put them in the Previously deleted collection, so you can look them over."
          }
          checked={settings.skipDeletedImports}
          onChange={(skipDeletedImports) => change({ skipDeletedImports })}
        />
      </div>
      <DeletedBooksList />
    </Section>
  );
}

/** The bin: deleted books wait 15 days, each with Restore and Delete now (embre, 28 November). */
export function DeletedBooksList() {
  const [books, setBooks] = useState<DeletedBook[] | null>(null);
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState<DeletedBook | null>(null);
  const toast = useToast();
  // On the computer's Attunement page the list scrolls in its own frame.
  const framed = useAttuneFrame();
  useEffect(() => {
    let live = true;
    api.deletedBooks().then((list) => live && setBooks(list), () => live && setBooks([]));
    return () => {
      live = false;
    };
  }, []);
  if (books === null) return null;
  if (books.length === 0) return <p className="settings-row-hint">The bin is empty.</p>;
  const words = query.trim().toLowerCase();
  const shown = words ? books.filter((b) => `${b.title} ${b.authors.join(" ")}`.toLowerCase().includes(words)) : books;
  const act = async (book: DeletedBook, how: "restore" | "delete") => {
    try {
      if (how === "restore") await api.restoreDeleted(book.id);
      else await api.deleteNow(book.id);
      setBooks((list) => list && list.filter((b) => b.id !== book.id));
      if (how === "restore") toast(`${book.title} is back in your library.`);
    } catch (e) {
      toast(`That didn't work: ${String(e)}`);
    }
  };
  const search = (
    <input
      type="search"
      className="input deleted-books-search"
      placeholder="Search deleted books"
      aria-label="Search deleted books"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
    />
  );
  return (
    <div className={`deleted-books${framed ? " is-framed" : ""}`}>
      {framed ? <div className="deleted-books-top">{search}</div> : (books.length > 8 || query) && search}
      <ul className="deleted-books-list">
        {shown.map((b) => (
          <li key={b.id} className="deleted-books-item">
            <span className="deleted-books-text">
              <MarqueeTitle text={b.title} />
              <span className="settings-row-hint">{goneIn(b.daysLeft)}</span>
            </span>
            <button type="button" className="btn btn-quiet" onClick={() => void act(b, "restore")}>
              Restore
            </button>
            <button type="button" className="btn btn-quiet btn-danger-text" onClick={() => setAsking(b)}>
              Delete now
            </button>
          </li>
        ))}
      </ul>
      {asking && (
        <ConfirmDialog
          title={`Delete ${asking.title} now?`}
          body="It's deleted for good on every device, with its notes and highlights. This can't be undone."
          confirm="Delete now"
          danger
          onConfirm={() => {
            const book = asking;
            setAsking(null);
            void act(book, "delete");
          }}
          onCancel={() => setAsking(null)}
        />
      )}
    </div>
  );
}

/** "Gone in 12 days" (embre's words, 28 November). */
function goneIn(days: number): string {
  return days <= 1 ? "Gone in 1 day" : `Gone in ${days} days`;
}

/** A title cut with an ellipsis; when it's cut, it scrolls slowly to show the rest, unless Reduce motion is on (embre, 28 November). */
function MarqueeTitle({ text }: { text: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const inner = el.firstElementChild as HTMLElement | null;
      setOver(inner ? Math.max(0, Math.ceil(inner.scrollWidth - el.clientWidth)) : 0);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [text]);
  const style = over > 0 ? ({ "--marquee-shift": `-${over}px`, "--marquee-time": `${Math.round(Math.max(6, over / 18 + 4))}s` } as React.CSSProperties) : undefined;
  return (
    <span ref={box} className={`settings-row-label marquee${over > 0 ? " is-over" : ""}`} title={text} style={style}>
      <span className="marquee-text">{text}</span>
    </span>
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


/** Goodreads by file: bring an export in, or make one for Goodreads (and the report after importing). */
export function useGoodreads() {
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
  const shown = report && <GoodreadsReport report={report} onClose={() => setReport(null)} />;
  return { busy, start, exportFile, report: shown };
}

function GoodreadsSection() {
  const { busy, start, exportFile, report } = useGoodreads();
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
      {report}
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
    !!report.upNextSkipped && `${books(report.upNextSkipped)} left out because Up Next is full.`,
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
          <RememberedDetails disclosure="preferences.goodreadsReport">
            <summary>
              {books(report.notFound.length)} from Goodreads aren't in your library
            </summary>
            <ul className="goodreads-missing">
              {report.notFound.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </RememberedDetails>
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

/** Authors and books watched for news: announced, then out (watchList.ts). */
function WatchSection() {
  const { list } = useWatch();
  const [author, setAuthor] = useState("");
  const [title, setTitle] = useState("");
  const [by, setBy] = useState("");
  if (!canWatch()) return null;
  const authors = list.flatMap((w) => (w.kind === "author" ? [w] : []));
  const books = list.flatMap((w) => (w.kind === "book" && !w.auto ? [w] : []));
  return (
    <Section id="watching" title="Watching" lede="Authors and books you follow. When a new book is announced, and when it comes out, you get a message and it shows in Sanctum. They're looked up with the series check above, and straight away when you add one.">
      <Row label="Authors" hint={authors.length ? undefined : "No authors yet. You can also watch one from a book's menu, under Find related."}>
        <form
          className="watch-add"
          onSubmit={(e) => {
            e.preventDefault();
            watchAuthor(author);
            setAuthor("");
          }}
        >
          <input className="input" aria-label="Author to watch" placeholder="Author's name" value={author} onChange={(e) => setAuthor(e.target.value)} />
          <button type="submit" className="btn btn-quiet" disabled={!author.trim()}>
            <Icon name="bell" size={16} /> Watch
          </button>
        </form>
      </Row>
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
      <Row label="Books" hint={books.length ? undefined : "No books yet. You can also watch one from its series' missing books."}>
        <form
          className="watch-add"
          onSubmit={(e) => {
            e.preventDefault();
            watchBook(title, by);
            setTitle("");
            setBy("");
          }}
        >
          <input className="input" aria-label="Title of the book to watch" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="input" aria-label="Its author" placeholder="Author" value={by} onChange={(e) => setBy(e.target.value)} />
          <button type="submit" className="btn btn-quiet" disabled={!title.trim()}>
            <Icon name="bell" size={16} /> Watch
          </button>
        </form>
      </Row>
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
    </Section>
  );
}

const COLLECTIONS_PREFS = "tbv.collections.view";

/** How often series are looked up online for books you don't have yet (seriesCheck.ts). */
function SeriesCheckSection() {
  const { settings, change } = useAppSettings();
  const { last, progress } = useSeriesNews();
  const [days, setDays] = useState(String(settings.seriesCheckDays));
  if (!canCheckSeries) return null;
  return (
    <Section id="series-check" title="Check for new books in a series" lede="Every series in your library is looked up online for books you don't have yet, and so are the authors and books you watch. New finds show on the series page and in Sanctum. Nothing is added to your library without you.">
      <Row label="Check" hint="It runs quietly in the background, one series at a time.">
        <Select<SeriesCheckEvery>
          label="How often to check series"
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
      </Row>
      {settings.seriesCheck === "custom" && (
        <Row label="Days between checks">
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
        </Row>
      )}
      <Row label="Last check" hint={progress ? `Checking ${Math.min(progress.done + 1, progress.total)} of ${progress.total} series…` : last ? relativeTime(last) : "Not checked yet"}>
        <button type="button" className="btn btn-quiet" disabled={!!progress} onClick={() => void checkAllSeries()}>
          <Icon name="search" size={16} /> {progress ? "Checking…" : "Check now"}
        </button>
      </Row>
    </Section>
  );
}

export function CollectionsTab() {
  const { settings, change } = useAppSettings();
  const [layout, setLayout] = useState<"grid" | "list">(() => (readLocal(COLLECTIONS_PREFS).layout === "list" ? "list" : "grid"));
  return (
    <>
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
    <SeriesCheckSection />
    <WatchSection />
    </>
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
      {canvaHere && <CanvaSection />}
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

function BookFormatsSection() {
  return (
      <Section id="formats" title="Book formats" lede="TBV imports and reads all of these.">
        <BookFormatsList />
      </Section>
  );
}

/** The formats TBV opens, and the word on DRM. */
export function BookFormatsList() {
  return (
      <>
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
      </>
  );
}

function BookFilesSection() {
  return (
      <Section id="files" title="Your book files" lede="What TBV does, and never does, with your books.">
        <BookFilesList />
      </Section>
  );
}

/** What TBV does, and never does, with your books. */
export function BookFilesList() {
  return (
        <ul className="promise-list">
          <li>
            <Icon name="check" size={18} /> Importing copies a book into TBV's library folder. The file you imported from stays where it was.
          </li>
          <li>
            <Icon name="check" size={18} /> TBV never changes a book file. Titles, authors, covers and other details you correct are kept beside the
            book, and a reset brings back the details in the file.
          </li>
          <li>
            <Icon name="check" size={18} /> The same book imported twice is recognised from its contents, so it appears once.
          </li>
          <li>
            <Icon name="check" size={18} /> Removing a book from this device keeps your progress and notes. Deleting it removes it everywhere.
          </li>
        </ul>
  );
}

export function FilesTab() {
  return (
    <Columns side={<BookFormatsSection />}>
      <BookFilesSection />
    </Columns>
  );
}

export function AccessibilityTab({ onShortcuts }: { onShortcuts?: () => void } = {}) {
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
      {onShortcuts && (
        <Section id="keys" title="Keyboard shortcuts">
          <button type="button" className="btn btn-quiet" onClick={onShortcuts}>
            <Icon name="keyboard" size={16} /> Show keyboard shortcuts
          </button>
        </Section>
      )}
    </>
  );
}

const EVERYWHERE: [string, string][] = [
  ["Alt + ← / →", "Back / Forward through app screens"],
  ["Alt + ← / → in Nexus", "Back / Forward through webpages (add Shift for app screens)"],
  ["Ctrl + 1 to 7", "Go to Sanctum, Archive, Resonance, Compendium, Scribe, Discover or Attunement"],
  ["Ctrl + F  or  Ctrl + K", "Search"],
  ["Ctrl + O", "Import books"],
  ["Ctrl + \\", "Show or hide the sidebar"],
  ["Alt + arrow keys", "Move a collection when sorted by Your order"],
];

const READER: [string, string][] = [
  ["Alt + ←", "Return from a book jump, or leave the book"],
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
        <Section id="reader" title="While reading" lede="Page keys turn pages when Swipe is chosen; with Scroll they scroll.">
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
  const desk = useDeskPrefs();
  const info = useLibraryInfo();
  const { reset } = useAppSettings();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const resetSection = (
    <Section
      id="reset"
      title="Reset settings"
      lede="Puts Appearance, Compendium, Accessibility and Sync choices back as they came. Your books, notes and collections are not touched."
    >
      <button type="button" className="btn btn-quiet" onClick={() => setConfirming(true)}>
        Reset settings…
      </button>
    </Section>
  );
  const data = (
    <Section id="data" title="Data on this device" lede="Your library's details, progress, notes and collections live in one database file.">
      {info ? (
        <>
          <Row label="Database" hint={formatBytes(info.databaseBytes)} stack>
            <div className="path-row">
              <code className="path">{info.database}</code>
              <ShowButton path={info.database} />
            </div>
          </Row>
        </>
      ) : (
        <p className="settings-row-hint">The data folder couldn't be read.</p>
      )}
    </Section>
  );
  const dialog = confirming && (
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
  );
  // On a computer, folded at the bottom of You & TBV (embre, 21 November).
  if (desk)
    return (
      <>
        <SectionGroup id="trouble" title="Troubleshooting" holds={["data", "reset"]} collapsible>
          {data}
          {resetSection}
        </SectionGroup>
        {dialog}
      </>
    );
  return (
    <Columns side={resetSection}>
      {data}
      {dialog}
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
    name: "WordNet 3.1",
    what: "The reader's offline dictionary on Windows and Android. WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved. Provided as is, without warranties.",
    licence: "WordNet licence",
    url: "https://wordnet.princeton.edu/license-and-commercial-use",
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
    name: "adblock-rust",
    what: "Discover's blocking engine, by Brave",
    licence: "MPL 2.0",
    url: "https://github.com/brave/adblock-rust",
  },
  {
    name: "EasyList and EasyPrivacy",
    what: "Discover's advert and tracker lists, by the EasyList authors (downloaded to your device)",
    licence: "GPLv3 or CC BY-SA 3.0",
    url: "https://easylist.to/",
  },
  {
    name: "Malicious URL Blocklist",
    what: "Discover's list of harmful sites, by curbengh, from abuse.ch's URLhaus (downloaded to your device)",
    licence: "CC0 or MIT",
    url: "https://gitlab.com/malware-filter/urlhaus-filter",
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
    name: "Crimson Pro",
    what: "A book font in Scribe, by Jacques Le Bailly",
    licence: "SIL Open Font License 1.1",
    url: "https://github.com/Fonthausen/CrimsonPro",
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
  // TBV for life with Publisher on a subscription on top.
  const publisherOnTop = license.state === "owned" && license.plan === "lifetime" && !!license.publisher && !license.publisherForLife && canBuyIn(license);
  const words =
    license.state === "owned"
      ? standardWords(license)
      : license.trialDays > 0
        ? `${license.daysLeft === 1 ? "1 day" : `${license.daysLeft} days`} left of your free trial (until ${ends}). Choose a plan to keep using it after that.`
        : "Choose a plan to use The Bound Vigil.";
  return (
    <Section id="licence" title="TBV Standard" lede={words} status>
      {license.state !== "owned" && canBuyIn(license) && (
        <div className="settings-actions">
          <PlanButtons />
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void restore()}>
            I bought it already
          </button>
        </div>
      )}
      {license.state !== "owned" && !canBuyIn(license) && (
        <p className="settings-row-hint">This copy didn't come from a store, so it can't be bought in. The Bound Vigil will be sold in the Microsoft Store and the App Store.</p>
      )}
      {license.state === "owned" && canBuyIn(license) && (
        <div className="settings-actions">
          {(license.plan === "monthly" || license.plan === "yearly") && (
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void buy(license.publisher ? "publisherLifetime" : "lifetime")}>
              Switch to lifetime{(license.publisher ? license.publisherPrice : license.price) ? ` for ${license.publisher ? license.publisherPrice : license.price}` : ""}
            </button>
          )}
          {!publisherOnTop && <ManageSubscription />}
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void restore()}>
            Restore purchases
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
    <Section id="updates" title="Updates" lede={updateWords(state)} status>
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
      <p className="about-made muted">The Bound Vigil was designed by Krowsingre Publishing and built with the help of AI (Anthropic's Claude).</p>
      <p className="about-links muted">
        <button type="button" className="link-btn" onClick={() => void openExternal(TERMS)}>
          Terms of use
        </button>
        {" · "}
        <button type="button" className="link-btn" onClick={() => void openExternal(PRIVACY_POLICY)}>
          Privacy policy
        </button>
      </p>
    </>
  );
}

/** Attune › Your plan: TBV itself beside Publisher. */
export function PlanTab() {
  return (
    <Columns side={<PublisherPlan />}>
      <YourCopy />
    </Columns>
  );
}

function PublisherPlan() {
  const { license, busy, buy } = useLicense();
  if (!license) return null;
  // TBV for life with Publisher on a subscription on top: keeping Publisher for good is
  // the upgrade for those who bought TBV for life themselves, otherwise full price.
  const onTop = license.state === "owned" && license.plan === "lifetime" && !!license.publisher && !license.publisherForLife && canBuyIn(license);
  const keep = license.lifetimeShared ? "publisherLifetime" : "publisherUpgrade";
  const keepPrice = keep === "publisherUpgrade" ? license.upgradePrice : license.publisherPrice;
  const lede = license.publisher
    ? publisherWords(license)
    // TBV's trial doesn't include Publisher (embre, 27 November).
    : "Everything you need to publish, on top of all of TBV. Your writing and exports to EPUB, Word and text stay free to use either way.";
  return (
    <Section id="publisher" title="TBV Publisher" lede={lede} status>
      <PublisherTools />
      {!license.publisher && canBuyIn(license) && <PublisherPlans license={license} />}
      {onTop && (
        <div className="settings-actions">
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void buy(keep)}>
            Keep Publisher for life{keepPrice ? ` for ${keepPrice}` : ""}
          </button>
          <ManageSubscription />
        </div>
      )}
    </Section>
  );
}

export function AboutTab() {
  const desk = useDeskPrefs();
  const [version, setVersion] = useState("0.171.0");
  useEffect(() => {
    if (!isApp) return;
    void import("@tauri-apps/api/app").then(({ getVersion }) => getVersion().then(setVersion, () => undefined));
  }, []);
  return (
    <>
      <Columns>
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
      <Section id="licences" title="Built with" lede="TBV stands on the work of these projects. Thank you to their authors." collapsible={desk}>
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
