import { downloadable, useBatchDownloads } from "./BatchDownloads";
import { ofKind } from "../lib/queryBooks";
import { SeriesCoverPicker } from "./SeriesCoverPicker";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, isHome, isWeb } from "../api";
import type { BookPreview, CollectionPreview, ItemKind, LibraryPage } from "../api/types";
import { askAddToCollection } from "../collections/AddToCollection";
import { askAlbum, askEditDetails, askFetchManyDetails, showBookDetails } from "../details/openDetails";
import { askSendToEreader } from "../ereaders/SendToEreader";
import { askSendWithLocalSend, canSendWithLocalSend } from "../localsend/SendWithLocalSend";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry, type MenuItem } from "../components/Menu";
import { FindMissingButton, SeriesPanel, useSeriesReview } from "./SeriesPanel";
import { favouritesChanged, isFavouriteSeries, isTopFive, SeriesHeart, seriesTopKey, setSeriesFavourite, setTopFive, useFavourites } from "./favourites";
import { useToast } from "../components/Toast";
import { StarRating } from "../components/StarRating";
import { makeBookActions, phoneChoiceShown } from "../home/bookActions";
import { FindAlike } from "./FindAlike";
import { usePageSwipe } from "./pageSwipe";
import { pageScroller } from "../lib/pageScroller";
import { Spent, Stat } from "../home/ReadingActivity";
import { useTimeSpent } from "../home/useTimeSpent";
import { TagsDialog, deleteWarning, removeWarning } from "./BookDialogs";
import { BookGrid, BookList, BookTable, PhoneList, type LeadCard, type PinnedCard, type Selection } from "./BookViews";
import { CollectionsTab } from "./CollectionsTab";
import { LibraryToolbar } from "./LibraryToolbar";
import { excludeCount, NO_FILTERS, PAGE_SIZE, type LibraryView } from "./libraryView";
import { pageCount, Pagination } from "./Pagination";
import { usePageFit } from "./pageFit";
import { askHide } from "./hidden";
import { PHONE_LIST, useNarrow } from "../lib/useNarrow";
import { useAppSettings } from "../settings/appSettings";

type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };

const WORDS = {
  books: { title: "Archive", one: "book", many: "books", total: "Total" },
  documents: { title: "Archive", one: "document", many: "documents", total: "Total" },
  audiobooks: { title: "Resonance", one: "audiobook", many: "audiobooks", total: "Total" },
} as const;

/** The switch at the top right of the Archive and Resonance: Books or Documents, Paired or Audiobooks only. */
export function PageSwitch<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented page-switch" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Library({
  kind = "books",
  view,
  search,
  refreshKey,
  onChange,
  onClearSearch,
  onImportBooks,
  onImportFolder,
  onOpenBook,
  onOpenCollection,
  intro,
  switcher,
  paired = null,
  onPairing,
  onOpenSeries,
  seriesBack,
  onShowAllSeries,
  restoreScroll,
  onScrollRestored,
  lead,
  onFirstShown,
  onLibraryChanged,
}: {
  /** Books (the Library), documents (PDF, Word and text files) or audiobooks. */
  kind?: ItemKind;
  view: LibraryView;
  search: string;
  refreshKey: number;
  onChange: (change: Partial<LibraryView>) => void;
  onClearSearch: () => void;
  onImportBooks: () => void;
  onImportFolder: () => void;
  onOpenBook: (bookId: string) => void;
  onOpenCollection: (id: string) => void;
  /** Shown above the books, like Continue listening. */
  intro?: React.ReactNode;
  /** Beside the page's name, like the Books / Documents switch. */
  switcher?: React.ReactNode;
  /** Resonance: only audiobooks with (true) or without (false) their ebook. */
  paired?: boolean | null;
  onPairing?: (value: boolean | null) => void;
  onOpenSeries?: (name: string) => void;
  seriesBack?: () => void;
  onShowAllSeries?: () => void;
  restoreScroll?: number | null;
  onScrollRestored?: () => void;
  /** Resonance: the item last listened to, always shown first whatever the sort (embre, 20 November). */
  lead?: BookPreview | null;
  /** Says which item the list shows first, so Resonance's side bar can show it. */
  onFirstShown?: (bookId: string | null) => void;
  /** Something in the library changed here (a book's type, a delete, a download…). */
  onLibraryChanged?: () => void;
}) {
  const [load, setLoad] = useState<Load<LibraryPage>>({ state: "loading" });
  const loadedView = useRef("");
  const spent = useTimeSpent(refreshKey);
  const [collections, setCollections] = useState<CollectionPreview[] | null>(null);
  const [reload, setReload] = useState(0);
  // Choosing books to change many at once.
  const [selected, setSelected] = useState<Map<string, BookPreview> | null>(null);
  /** Find alike is open: starting from these books, or from the whole library when empty. */
  const [findingAlike, setFindingAlike] = useState<BookPreview[] | null>(null);
  /** The book picked last, where a Shift-click range starts. */
  const lastPicked = useRef<string | null>(null);
  /** The books of each series chosen as a stack, by series name. */
  const [stackBooks, setStackBooks] = useState<Map<string, BookPreview[]>>(() => new Map());
  const [tagging, setTagging] = useState(false);
  const [asking, setAsking] = useState<"remove" | "delete" | "download" | null>(null);
  const [seriesRemoval, setSeriesRemoval] = useState<{ name: string; books: BookPreview[] } | null>(null);
  const [bulkBusy, setBusy] = useState<string | null>(null);
  const downloads = useBatchDownloads(() => setReload((n) => n + 1));
  const busy = bulkBusy || downloads.progress || null;
  const seriesBooks = async (name: string) => {
    const detail = await api.getCollection({ kind: "series", name });
    return detail.books.filter((book) => ofKind(book, kind));
  };
  const downloadSeries = (name: string) => downloads.download(() => seriesBooks(name));
  /** The search and filters everything was last chosen for. */
  const toast = useToast();
  const askRemoveSeriesDownloads = async (name: string) => {
    setBusy("Checking downloads…");
    try {
      const books = (await seriesBooks(name)).filter((book) => book.availability === "local");
      if (!books.some((book) => book.inCloud)) {
        toast(books.length ? "The downloaded files are the only copies and will stay on this device." : `This ${albums ? "album" : "series"} has no downloads on this device.`);
        return;
      }
      setSeriesRemoval({ name, books });
      setAsking("download");
    } catch (error) {
      toast(String(error));
    } finally {
      setBusy(null);
    }
  };
  const words = WORDS[kind];
  // On a phone there are no pages: more books load as the list nears its end.
  // A computer can ask for the same in Settings.
  const narrow = useNarrow();
  const { settings: { scrollLibrary }, change: changeSettings } = useAppSettings();
  const [pins, setPins] = useState<BookPreview[]>([]);
  const [pinnedSeries, setPinnedSeries] = useState<string[]>([]);
  const favourites = useFavourites(refreshKey);
  const [pinnedStacks, setPinnedStacks] = useState<LibraryPage | null>(null);
  const [facets, setFacets] = useState<LibraryPage | null>(null);
  const [searching, setSearching] = useState(false);
  const [coverPicker, setCoverPicker] = useState<string | null>(null);
  const coverKey = `tbv.stackCovers.${kind}`;
  const [coverChoices, setCoverChoices] = useState<Record<string, string>>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(coverKey) ?? "{}");
      return Object.fromEntries(Object.entries(value ?? {}).filter(([, id]) => typeof id === "string"));
    } catch { return {}; }
  });
  const changeCover = (name: string, id?: string) => {
    const key = name.trim().toLowerCase();
    const next = { ...coverChoices };
    if (id) next[key] = id;
    else delete next[key];
    setCoverChoices(next);
    try { localStorage.setItem(coverKey, JSON.stringify(next)); } catch { /* Keep this session's choice. */ }
  };
  const toggleSeriesPin = (name: string, pinned: boolean) => {
    void api.setArchiveSeriesPin(name, pinned).then(() => {
      setReload((n) => n + 1);
      if (!pinned) toast("Series unpinned.", { label: "Undo", run: () => toggleSeriesPin(name, true) });
    }, (error: unknown) => toast(String(error)));
  };
  const toggleSeriesFavourite = (name: string, favourite: boolean) =>
    void setSeriesFavourite(name, favourite).then(() => {
      if (!favourite) toast(`Took “${name}” out of favourites.`, { label: "Undo", run: () => toggleSeriesFavourite(name, true) });
    }, (error: unknown) => toast(String(error).replace(/^Error: /, "")));
  const toggleSeriesTop = (name: string, top: boolean) =>
    void setTopFive(seriesTopKey(name), name, top).catch((error: unknown) => toast(String(error).replace(/^Error: /, "")));
  /** The series' own page. */
  const goToSeries = (name: string) => {
    if (onOpenSeries) onOpenSeries(name);
    else {
      onClearSearch();
      onChange({ ...NO_FILTERS, tab: "all", series: [name], sort: "series", page: 0 });
    }
  };
  // On a computer, a stack fans its books out in place instead of leaving the page, so
  // nothing reloads and no other books show while it opens (embre, 27 November).
  // Each open stack's books, or null while they're being fetched.
  const [fanned, setFanned] = useState<Record<string, BookPreview[] | null>>({});
  const toggleFan = (name: string) => {
    if (name in fanned) {
      setFanned(({ [name]: _gone, ...rest }) => rest);
      return;
    }
    setFanned((f) => ({ ...f, [name]: null }));
    void seriesBooks(name).then(
      (books) => setFanned((f) => (name in f ? { ...f, [name]: books } : f)),
      (e: unknown) => {
        setFanned(({ [name]: _gone, ...rest }) => rest);
        toast(String(e).replace(/^Error: /, ""));
      },
    );
  };
  const seriesMenu = (name: string): import("../components/Menu").MenuEntry[] => {
    const key = name.trim().toLowerCase();
    const favourite = isFavouriteSeries(name, favourites.series);
    const pinned = pinnedSeries.some((value) => value.trim().toLowerCase() === key);
    // Edit a whole series or album at once, without choosing it first (embre, 20 November).
    const withBooks = (then: (books: BookPreview[]) => void) => () =>
      void wholeSeries(name).then((books) => books.length && then(books), (e: unknown) => toast(String(e)));
    const stackActions = withSubmenus(groupActions
      .filter((a) => a === "divider" || (a.label !== "Group as album" && !a.bookOnly))
      .map((a) => {
        if (a === "divider") return a;
        // A stack's downloads cover the whole series, whatever the filters show.
        if (a.label === "Download") return { label: a.label, icon: a.icon, disabled: !!busy || !canGetSeries(name), onSelect: () => void downloadSeries(name) };
        if (a.label === "Remove download") return { label: a.label, icon: a.icon, disabled: !!busy || !hasSeriesHere(name), onSelect: () => void askRemoveSeriesDownloads(name) };
        return {
          label: a.label, icon: a.icon, hint: a.hint, danger: a.danger, disabled: !!busy, group: a.group,
          onSelect: withBooks((books) => (a.can && !a.can(books) ? toast(`Nothing in “${name}” for that.`) : a.run(books, name))),
        };
      }));
    // Albums aren't series, so they're never favourite series (embre, 20 November).
    const favouriteItems: MenuEntry[] = albums
      ? []
      : [
          favourite
            ? { label: "Remove series from favourites", icon: "heart", onSelect: () => toggleSeriesFavourite(name, false) }
            : { label: "Add series to favourites", icon: "heart", onSelect: () => toggleSeriesFavourite(name, true) },
          ...(favourite
            ? [isTopFive(seriesTopKey(name), favourites.top)
                ? { label: "Take out of Top five", icon: "star" as const, onSelect: () => toggleSeriesTop(name, false) }
                : { label: "Add to Top five", icon: "star" as const, onSelect: () => toggleSeriesTop(name, true) }]
            : []),
        ];
    // A rating for the whole stack rates each of its books (embre, 20 November).
    const rating: MenuEntry = {
      heading: (
        <span className="menu-rating">
          Rate every {albums ? "song" : "book"}
          <StarRating value={null} size={18} onChange={(r) => withBooks(each((b) => api.setRating(b.id, r)))()} />
        </span>
      ),
    };
    return [
      // On a computer a click fans the stack out; the series page is a menu choice away (embre, 27 November).
      ...(!narrow ? [{ label: albums ? "Open album page" : "Open series page", icon: "chevronRight" as const, onSelect: () => goToSeries(name) }] : []),
      // Start choosing with this whole stack, without going back to the top (embre, 21 November).
      { label: "Select", icon: "check", onSelect: () => void chooseSeries([name], true) },
      ...favouriteItems,
      rating,
      ...stackActions,
      "divider",
      { label: "Choose stack cover", onSelect: () => setCoverPicker(name) },
      ...(coverChoices[key] ? [{ label: "Reset to automatic", onSelect: () => changeCover(name) }] : []),
      ...(kind === "books" ? [{ label: pinned ? "Unpin series" : "Pin series", onSelect: () => toggleSeriesPin(name, !pinned) }] : []),
    ];
  };
  // Pinned books and series open as their own stack, the first card in the list (embre, 20 November).
  const [showPinned, setShowPinned] = useState(false);
  useEffect(() => {
    if (reload > 0) onLibraryChanged?.();
  }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const endless = narrow || scrollLibrary;
  /** Phone: how many pages are shown, and the books of every page after the first. */
  const [pages, setPages] = useState(1);
  const [later, setLater] = useState<LibraryPage[]>([]);
  const loadingMore = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  // Find alike (embre, 21 November): books and audiobooks, not documents or music.
  const canFindAlike = !!api.findAlike && kind !== "documents" && !(kind === "audiobooks" && view.audioType === "music");
  const actions = useMemo(
    () => ({
      ...makeBookActions(api, toast, () => setReload((n) => n + 1), onOpenBook),
      // Start choosing from the book itself, wherever it is on the page (embre, 21 November).
      select: (book: BookPreview) => setSelected((s) => new Map(s ?? []).set(book.id, book)),
      ...(canFindAlike && !narrow ? { findAlike: (book: BookPreview) => setFindingAlike([book]) } : {}),
    }),
    [toast, onOpenBook, canFindAlike, narrow],
  );

  const shelf = view.tab === "collections" ? "all" : view.tab;
  // iPhone, portrait iPad and an upright Duo: covers, or the list of names (embre, 20 November).
  const phoneList = useNarrow(PHONE_LIST);
  const Layout = phoneList && view.layout !== "grid" ? PhoneList : { grid: BookGrid, list: BookList, compact: BookTable }[view.layout];
  /** An open stack's books, under a header with the way to its own page. */
  const fanOf = (name: string) => {
    if (!(name in fanned)) return null;
    const books = fanned[name];
    return (
      <>
        <div className="series-fan-head">
          <span className="series-fan-name">{name}</span>
          {books && <span className="muted num">{books.length.toLocaleString()} {books.length === 1 ? words.one : words.many}</span>}
          <button type="button" className="btn btn-quiet btn-small series-fan-open" onClick={() => goToSeries(name)}>
            {albums ? "Open album" : "Open series"} <Icon name="chevronRight" size={14} />
          </button>
          <button type="button" className="icon-btn icon-btn-s" aria-label={`Fold ${name}`} title="Fold" onClick={() => toggleFan(name)}>
            <Icon name="chevronUp" size={16} />
          </button>
        </div>
        {books ? <Layout books={books} actions={actions} selection={selection} showStatus inSeries={name} /> : <div className="library-loading series-fan-loading" aria-busy="true" aria-label={`Opening ${name}`} />}
      </>
    );
  };
  // Series stay stacked while choosing: a stack is chosen whole.
  // In Music an album is always one stack: grouping songs as an album means
  // seeing them as one item (embre, 20 November).
  const albums = kind === "audiobooks" && view.audioType === "music";
  const groupSeries = kind !== "documents" && (albums || view.seriesGrouping !== "individual") && !seriesBack;
  const inSeries = !!seriesBack;
  const seriesName = inSeries ? view.series[0] : undefined;
  // Opening a pinned series leaves the Pinned view, so the series' own books show.
  useEffect(() => {
    if (seriesName) setShowPinned(false);
  }, [seriesName]);
  const [seriesTotal, setSeriesTotal] = useState<{ name: string; count: number } | null>(null);
  useEffect(() => {
    if (!seriesName) return;
    let current = true;
    void api.getLibrary({ kind, shelf: "all", sort: "series", search: null, formats: [], location: null, series: [seriesName], page: 0, pageSize: 1, omitFacets: true })
      .then((data) => { if (current) setSeriesTotal({ name: seriesName, count: data.total }); }, () => { if (current) setSeriesTotal(null); });
    return () => { current = false; };
  }, [seriesName, kind, refreshKey, reload]);
  const separatePins = (kind === "books" || kind === "audiobooks") && !inSeries;
  const pinnedFirst = !inSeries;
  const pinned = separatePins ? false : undefined;
  const query = {
    shelf,
    sort: view.sort,
    search: search.trim() || null,
    formats: view.formats,
    location: view.location,
    tags: view.tags,
    genres: view.genres,
    languages: view.languages,
    downloadable: view.downloadable,
    authors: view.authors,
    series: view.series,
    narrators: view.narrators,
    hideRead: view.hideRead,
    exclude: view.exclude,
    kind,
    paired,
    audioType: view.audioType,
    pinnedFirst,
    pinned,
    groupSeries,
    mixSeries: groupSeries && (view.seriesGrouping === "mixed" || (albums && view.seriesGrouping === "individual")),
    omitFacets: true,
    seriesCoverChoices: coverChoices,
  };
  const queryKey = JSON.stringify(query);
  // A new search, filter, sort or page folds every stack back.
  useEffect(() => setFanned({}), [queryKey, view.page]);
  // Paged on a computer: each page is as many full rows as fit the window, with the
  // Pinned and Last read cards counted inside the first page (embre, 21 November).
  const libraryRoot = useRef<HTMLDivElement>(null);
  const [leadSlots, setLeadSlots] = useState(0);
  const [measured, setMeasured] = useState(0);
  const fit = usePageFit(libraryRoot, view.layout, !endless, measured);
  const pageSize = endless ? PAGE_SIZE : fit;
  const slots = endless ? 0 : leadSlots;
  const requestKey = queryKey + ":" + (endless ? 0 : `${view.page}:${pageSize}:${slots}`);
  const inFlight = useRef(false);
  const pendingRequest = useRef<(() => void) | null>(null);
  const previousSearch = useRef(query.search);
  // Which series still have books to download here, and which have books on this device:
  // a series' Download and Remove download are greyed out when there's nothing for them to do
  // (embre, 20 November). Whole series, whatever the filters show.
  const [seriesHere, setSeriesHere] = useState<{ toGet: Set<string>; here: Set<string> } | null>(null);
  useEffect(() => {
    if (kind === "documents") return;
    let current = true;
    const named = async (location: "on_device" | "cloud_only") => {
      const found = new Set<string>();
      for (let p = 0; ; p++) {
        const got = await api.getLibrary({
          kind, shelf: "all", sort: "series", search: null, formats: [], location, audioType: view.audioType,
          groupSeries: true, mixSeries: true, page: p, pageSize: 200, omitFacets: true,
        });
        for (const b of got.books) if (got.seriesCounts?.[b.id] && b.series?.trim()) found.add(b.series.trim().toLowerCase());
        if (got.page < p || (got.page + 1) * got.pageSize >= got.total) break;
      }
      return found;
    };
    // The app answers in one quick look; the web version and preview look through their own lists.
    const looked = api.seriesHere
      ? api.seriesHere(kind, view.audioType ?? null).then(({ toGet, here }) => [new Set(toGet), new Set(here)] as const)
      : Promise.all([named("cloud_only"), named("on_device")]);
    void looked.then(
      ([toGet, here]) => { if (current) setSeriesHere({ toGet, here }); },
      () => { if (current) setSeriesHere(null); },
    );
    return () => { current = false; };
  }, [kind, view.audioType, refreshKey, reload]);
  const canGetSeries = (name: string) => !seriesHere || seriesHere.toGet.has(name.trim().toLowerCase());
  const hasSeriesHere = (name: string) => !seriesHere || seriesHere.here.has(name.trim().toLowerCase());

  useEffect(() => {
    let current = true;
    // Resonance's counts and filter lists are for the tab showing (Audiobooks, Podcasts…).
    void api.getLibrary({ kind, shelf: "all", sort: "recently_added", search: null, formats: [], location: null, audioType: view.audioType, page: 0, pageSize: 1 })
      .then((data) => { if (current) setFacets(data); }, () => undefined);
    if (kind === "books") void api.archiveSeriesPins?.().then((names) => {
      if (current) setPinnedSeries(names);
    }, () => undefined);
    return () => { current = false; };
  }, [kind, view.audioType, refreshKey, reload]);

  useEffect(() => {
    let current = true;
    let scheduled = false;
    let indicator: number | undefined;
    setSearching(false);
    const wait = previousSearch.current !== query.search && !!query.search;
    previousSearch.current = query.search;
    const run = () => {
      if (!current) return;
      inFlight.current = true;
      if (query.search) indicator = window.setTimeout(() => { if (current) setSearching(true); }, 180);
      const results = api.getLibrary({ ...query, page: endless ? 0 : view.page, pageSize, leadSlots: slots }).then(
        (data) => {
          if (!current) return;
          window.clearTimeout(indicator);
          loadedView.current = requestKey;
          setLoad({ state: "ready", data });
          setSearching(false);
        },
        (error: unknown) => {
          if (!current) return;
          setSearching(false);
          window.clearTimeout(indicator);
          setLoad({ state: "error", message: String(error) });
        },
      );
      const pinnedRequests: Promise<unknown>[] = [];
      if (separatePins && view.tab !== "collections") {
        pinnedRequests.push(api.getLibrary({ ...query, pinned: true, groupSeries: false, page: 0, pageSize: 200 })
          .then((data) => { if (current) setPins(data.books.filter((book) => book.pinnedAt)); }, () => { if (current) setPins([]); }));
        const matching = pinnedSeries.filter((name) => !query.series.length || query.series.some((value) => value.toLowerCase() === name.toLowerCase()));
        if (matching.length) pinnedRequests.push(api.getLibrary({
          ...query, pinned: undefined, pinnedFirst: false, groupSeries: true, mixSeries: false, series: matching, page: 0, pageSize: 200,
        }).then((data) => { if (current) setPinnedStacks(data); }, () => { if (current) setPinnedStacks(null); }));
        else setPinnedStacks(null);
      }
      void Promise.all([results, ...pinnedRequests]).finally(() => {
        inFlight.current = false;
        const next = pendingRequest.current;
        pendingRequest.current = null;
        next?.();
      });
    };
    const submit = () => {
      if (scheduled) return;
      scheduled = true;
      if (inFlight.current) pendingRequest.current = run;
      else run();
    };
    const timer = wait ? window.setTimeout(submit, 150) : undefined;
    if (!wait) submit();
    window.addEventListener("tbv:submit-library-search", submit);
    return () => {
      current = false;
      window.clearTimeout(timer);
      window.clearTimeout(indicator);
      window.removeEventListener("tbv:submit-library-search", submit);
      if (pendingRequest.current === run) pendingRequest.current = null;
    };
  }, [requestKey, pinnedSeries, separatePins, refreshKey, reload]);

  // A new search, filter, shelf or sort starts the phone's list from the top.
  useEffect(() => {
    setPages(1);
    setLater([]);
    loadingMore.current = false;
  }, [queryKey, endless]);

  // The later pages come again after a change (a book moved shelf, say), so the list keeps its place.
  useEffect(() => {
    if (!endless || pages < 2) return;
    let current = true;
    loadingMore.current = true;
    Promise.all(Array.from({ length: pages - 1 }, (_, i) => api.getLibrary({ ...query, page: i + 1, pageSize: PAGE_SIZE })))
      .then(
        (got) => current && setLater(got.filter((p, i) => p.page === i + 1)),
        () => {},
      )
      .finally(() => {
        if (current) loadingMore.current = false;
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endless, refreshKey, reload]);

  // The next page, once more of it is wanted.
  useEffect(() => {
    if (!endless || pages < 2 || later.length >= pages - 1) return;
    let current = true;
    loadingMore.current = true;
    const want = pages - 1;
    api
      .getLibrary({ ...query, page: want, pageSize: PAGE_SIZE })
      .then(
        (p) => current && setLater((l) => (l.length === want - 1 && p.page === want ? [...l, p] : l)),
        () => {},
      )
      .finally(() => {
        loadingMore.current = false;
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endless, pages, later.length]);
  useEffect(() => {
    if (view.tab !== "collections") return;
    let current = true;
    api.getCollections().then(
      (c) => current && setCollections(c),
      () => current && setCollections([]),
    );
    return () => {
      current = false;
    };
  }, [view.tab, refreshKey]);

  // Chosen books keep up with changes made to them, like a tag just added.
  useEffect(() => {
    if (load.state !== "ready") return;
    setSelected((s) => {
      if (!s || !load.data.books.some((b) => s.has(b.id))) return s;
      const next = new Map(s);
      load.data.books.forEach((b) => next.has(b.id) && next.set(b.id, b));
      return next;
    });
  }, [load]);
  // Pinned books come in their own list (the main one leaves them out), so they keep up from it.
  useEffect(() => {
    setSelected((s) => {
      if (!s || !pins.some((b) => s.has(b.id))) return s;
      const next = new Map(s);
      pins.forEach((b) => next.has(b.id) && next.set(b.id, b));
      return next;
    });
  }, [pins]);

  // Only books the search and filters show stay chosen: when they change,
  // chosen books they now leave out are let go, so changing many never
  // reaches a book you can't see.
  const chosenIds = useRef<string[]>([]);
  chosenIds.current = selected ? [...selected.keys()] : [];
  useEffect(() => {
    // A series' books are looked up again under the new search and filters.
    setStackBooks((m) => (m.size ? new Map() : m));
    const ids = chosenIds.current;
    if (!ids.length) return;
    let current = true;
    const chunks = Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200));
    Promise.all(chunks.map((chunk) => api.getLibrary({ ...query, pinned: undefined, groupSeries: false, ids: chunk, page: 0, pageSize: 200 }))).then(
      (pages) => {
        if (!current) return;
        const shown = new Set<string>(pages.flatMap((p) => p.books.map((b) => b.id)));
        setSelected((s) => {
          if (!s || [...s.keys()].every((id) => shown.has(id))) return s;
          return new Map([...s].filter(([id]) => shown.has(id)));
        });
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [queryKey, refreshKey, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new page starts at the top, like turning a page.
  useEffect(() => {
    if (!endless || inSeries) pageScroller(libraryRoot.current)?.scrollTo({ top: 0 });
  }, [view.page, endless, inSeries]);

  const first = load.state === "ready" ? load.data : null;
  // On a phone, the first page with every later one loaded so far.
  const page = useMemo(
    () => (first && endless && later.length ? {
      ...first,
      books: [...first.books, ...later.flatMap((p) => p.books)],
      seriesCounts: Object.assign({}, first.seriesCounts, ...later.map((p) => p.seriesCounts)),
      seriesAuthors: Object.assign({}, first.seriesAuthors, ...later.map((p) => p.seriesAuthors)),
      seriesPublished: Object.assign({}, first.seriesPublished, ...later.map((p) => p.seriesPublished)),
      seriesCovers: Object.assign({}, first.seriesCovers, ...later.map((p) => p.seriesCovers)),
    } : first),
    [first, endless, later],
  );
  // Paged mode on a computer: swipes and wheel tilt turn the page (embre, 21 November).
  const pageTotal = page && !endless ? pageCount(page.total, page.pageSize, slots) : 1;
  usePageSwipe(libraryRoot, !endless && !narrow && pageTotal > 1, (step) => {
    const to = view.page + step;
    if (to >= 0 && to < pageTotal) onChange({ page: to });
  });
  // One series shown: its check for missing books (button up top, list under the books).
  // An album isn't a series: nothing is missing from it to look for.
  const checkedSeries = !isWeb && !isHome && !albums && view.tab !== "collections" && view.series.length === 1 ? view.series[0] : null;
  const seriesAuthor = page?.books[0]?.authors[0] ?? "";
  const seriesCheckState = useSeriesReview(checkedSeries, seriesAuthor, refreshKey + reload, () => setReload((n) => n + 1));
  const seriesCheck = checkedSeries ? seriesCheckState : null;
  useEffect(() => {
    if (restoreScroll == null || !first || loadedView.current !== requestKey || (endless && hasPendingScroll())) return;
    const id = requestAnimationFrame(() => {
      pageScroller(libraryRoot.current)?.scrollTo({ top: restoreScroll });
      onScrollRestored?.();
    });
    return () => cancelAnimationFrame(id);

    function hasPendingScroll() {
      const content = pageScroller(libraryRoot.current);
      if (!content || content.scrollHeight - content.clientHeight >= restoreScroll!) return false;
      if ((later.length + 1) * PAGE_SIZE >= first!.total) return false;
      if (!loadingMore.current) setPages((n) => Math.max(n, later.length + 2));
      return true;
    }
  }, [restoreScroll, first, later.length, endless, onScrollRestored, requestKey]);
  const hasMore = endless && loadedView.current === requestKey && page !== null && (later.length + 1) * PAGE_SIZE < page.total;

  // Genres, tags, formats and languages come from the books themselves: a
  // filter on one that no book has any more (its last book changed or went)
  // is dropped, so the lists never hold names the library doesn't.
  useEffect(() => {
    if (!facets) return;
    const change = gone(view, facets);
    if (change) onChange(change);
  }, [facets]); // eslint-disable-line react-hooks/exhaustive-deps

  // Near the end of the list, the next page loads.
  useEffect(() => {
    const target = end.current;
    if (!hasMore || !target || typeof IntersectionObserver !== "function") return;
    const watch = new IntersectionObserver(
      (seen) => {
        if (seen.some((s) => s.isIntersecting) && !loadingMore.current) setPages((n) => Math.max(n, later.length + 2));
      },
      { root: pageScroller(libraryRoot.current), rootMargin: "800px 0px" },
    );
    watch.observe(target);
    return () => watch.disconnect();
  }, [hasMore, later.length]);
  const counts = facets?.counts ?? null;
  const filtered =
    view.formats.length > 0 || view.location !== null || view.tags.length > 0 || view.genres.length > 0 || view.languages.length > 0 || view.downloadable || view.authors.length > 0 || view.series.length > 0 || view.narrators.length > 0 || view.hideRead || excludeCount(view.exclude) > 0;
  const selection: Selection | null = selected && {
    has: (id) => selected.has(id),
    toggle: (book, range) => {
      if (pickRange(book, range)) return;
      setSelected((s) => {
        const next = new Map(s);
        if (next.has(book.id)) next.delete(book.id);
        else next.set(book.id, book);
        return next;
      });
    },
    hasSeries: (name) => {
      const books = stackBooks.get(name);
      return !!books?.length && books.every((b) => selected.has(b.id));
    },
    toggleSeries: (name, book, range) => {
      if (book && pickRange(book, range)) return;
      void chooseSeries([name], !selection?.hasSeries?.(name));
    },
  };
  /**
   * Shift: everything shown between the last book or series picked and this
   * one is chosen, series stacks whole. Says whether it was a range.
   */
  function pickRange(book: BookPreview, range?: BookPreview[]): boolean {
    const from = range?.findIndex((b) => b.id === lastPicked.current) ?? -1;
    const to = range?.findIndex((b) => b.id === book.id) ?? -1;
    lastPicked.current = book.id;
    if (!range || from < 0 || to < 0) return false;
    const between = range.slice(Math.min(from, to), Math.max(from, to) + 1);
    const names = [...new Set(between.flatMap((b) => stackOf(b) ?? []))];
    const single = between.filter((b) => !stackOf(b));
    if (names.length) void chooseSeries(names, true, single);
    else
      setSelected((s) => {
        const next = new Map(s);
        for (const b of single) next.set(b.id, b);
        return next;
      });
    return true;
  }
  /** Every book of these series (as the filters show them), chosen or let go together. */
  async function booksOfSeries(name: string): Promise<BookPreview[]> {
    const known = stackBooks.get(name);
    if (known) return known;
    const found: BookPreview[] = [];
    for (let p = 0; ; p++) {
      const got = await api.getLibrary({ ...query, series: [name], pinned: undefined, groupSeries: false, page: p, pageSize: 200 });
      found.push(...got.books);
      if (got.page < p || (got.page + 1) * got.pageSize >= got.total) break;
    }
    return found;
  }
  /** Every book of a stack, whatever search or filter is on: a stack's own menu acts on all of it. */
  async function wholeSeries(name: string): Promise<BookPreview[]> {
    const found: BookPreview[] = [];
    for (let p = 0; ; p++) {
      const got = await api.getLibrary({
        kind, shelf: "all", sort: "series", search: null, formats: [], location: null, audioType: query.audioType,
        series: [name], groupSeries: false, page: p, pageSize: 200, omitFacets: true,
      });
      found.push(...got.books);
      if (got.page < p || (got.page + 1) * got.pageSize >= got.total) break;
    }
    return found;
  }
  async function chooseSeries(names: string[], on: boolean, alsoBooks: BookPreview[] = []) {
    try {
      const lists = await Promise.all(names.map(async (n) => [n, await booksOfSeries(n)] as const));
      setStackBooks((m) => {
        const next = new Map(m);
        for (const [n, books] of lists) next.set(n, books);
        return next;
      });
      setSelected((s) => {
        const next = new Map(s ?? []);
        for (const b of [...lists.flatMap(([, books]) => books), ...alsoBooks]) {
          if (on) next.set(b.id, b);
          else next.delete(b.id);
        }
        return next;
      });
    } catch (e) {
      toast(`Couldn't choose that series: ${String(e)}`);
    }
  }
  /**
   * A series with one book in the library, or just one of its books on this
   * device, opens that book's page (which shows the rest of the series too);
   * any other series opens as a series.
   */
  const openStack = (name: string, openAsSeries: (name: string) => void) => {
    void seriesBooks(name).then(
      (books) => {
        const here = books.filter((b) => b.availability === "local");
        const only = books.length === 1 ? books[0] : here.length === 1 ? here[0] : null;
        if (only) showBookDetails(only.id);
        else openAsSeries(name);
      },
      () => openAsSeries(name),
    );
  };
  /** A book shown as its series' stack, or null for a book shown on its own. */
  const stackOf = (b: BookPreview) => (groupSeries && page?.seriesCounts?.[b.id] && b.series?.trim() ? b.series.trim() : null);
  const chosen = selected ? [...selected.values()] : [];

  /** Chooses every book the current filters and search show, on every page. */
  const chooseAll = async () => {
    setBusy("Choosing…");
    try {
      const all = new Map(selected ?? []);
      for (let p = 0; ; p++) {
        const got = await api.getLibrary({ ...query, pinned: undefined, groupSeries: false, page: p, pageSize: 200 });
        got.books.forEach((b) => all.set(b.id, b));
        if (got.page < p || (got.page + 1) * got.pageSize >= got.total) break;
      }
      setSelected(all);
      setEverything(all.size);
      if (groupSeries) {
        // Every stack is chosen too, so its tick shows and choosing it again lets it go.
        const bySeries = new Map<string, BookPreview[]>();
        for (const b of all.values()) {
          const name = b.series?.trim();
          if (name) bySeries.set(name, [...(bySeries.get(name) ?? []), b]);
        }
        setStackBooks(bySeries);
      }
    } catch (e) {
      toast(`Couldn't choose them all: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const none = !selected?.size;
  const pageAllChosen = !!page?.books.length && page.books.every((b) => {
    const name = stackOf(b);
    return name ? !!selection?.hasSeries?.(name) : selected?.has(b.id);
  });
  // Books a search or filter hides are let go from the choice, so this many means all of them.
  const matchingBooks = (page?.total ?? 0) + pins.length;
  const [everything, setEverything] = useState<number | null>(null);
  // Stacked series count once in the total, so "all" is the number of books "Select all" found.
  const libraryAllChosen = groupSeries
    ? everything !== null && everything > 0 && (selected?.size ?? 0) >= everything
    : matchingBooks > 0 && (selected?.size ?? 0) >= matchingBooks;
  /**
   * What can be done to several items at once. The same list is the
   * selection's Actions menu and a stack's right-click menu, so nothing is
   * only reachable by choosing first (embre, 20 November). `stack` names the
   * series or album when the books are a stack's.
   */
  type GroupAction = {
    label: string;
    icon?: MenuItem["icon"];
    hint?: string;
    danger?: boolean;
    /** Shown inside this submenu, as a book's menu has them (Organize, Reading status). */
    group?: { label: string; icon: MenuItem["icon"] };
    /** Left out of a series' or album's own menu (a series has its own favourite). */
    bookOnly?: boolean;
    can?: (books: BookPreview[]) => boolean;
    run: (books: BookPreview[], stack?: string) => void;
  };
  /** Does the same to each book, then shows the change. */
  const each = (work: (book: BookPreview) => Promise<unknown>) => (books: BookPreview[]) =>
    void books.reduce<Promise<unknown>>((done, book) => done.then(() => work(book)), Promise.resolve()).then(
      () => (setReload((n) => n + 1), favouritesChanged()),
      (e: unknown) => (setReload((n) => n + 1), toast(String(e).replace(/^Error: /, ""))),
    );
  const listening = kind === "audiobooks";
  const organize = { label: "Organize", icon: "collections" as const };
  const statusGroup = { label: listening ? "Listening status" : "Reading status", icon: "checkCircle" as const };
  const audioGroup = { label: "Audio type", icon: "headphones" as const };
  // Everything a book's own menu offers, for many books at once (embre, 20 November).
  const bookOptions: GroupAction[] = [
    { label: "Add to favourites", icon: "heart", group: organize, bookOnly: true, can: (books) => books.some((b) => !b.favorite), run: each((b) => (b.favorite ? Promise.resolve() : api.setFavorite(b.id, true))) },
    { label: "Remove from favourites", icon: "heart", group: organize, bookOnly: true, can: (books) => books.some((b) => b.favorite), run: each((b) => (b.favorite ? api.setFavorite(b.id, false) : Promise.resolve())) },
    { label: "Add to Up next", icon: "bookmark", group: organize, can: (books) => books.some((b) => !b.wantToRead), run: each((b) => (b.wantToRead ? Promise.resolve() : api.setWantToRead(b.id, true))) },
    { label: "Remove from Up next", icon: "bookmark", group: organize, can: (books) => books.some((b) => b.wantToRead), run: each((b) => (b.wantToRead ? api.setWantToRead(b.id, false) : Promise.resolve())) },
    ...(listening && api.setAudioType
      ? ([["audiobook", "Audiobook"], ["podcast", "Podcast"], ["music", "Music"], ["other", "Other"]] as const).map(
          ([type, label]): GroupAction => ({ label, group: audioGroup, run: each((b) => api.setAudioType!(b.id, type)) }),
        )
      : []),
    { label: listening ? "Mark as listened" : "Mark as read", group: statusGroup, can: (books) => books.some((b) => b.status !== "read"), run: each((b) => api.setBookStatus(b.id, "read")) },
    { label: listening ? "Mark as unplayed" : "Mark as unread", group: statusGroup, can: (books) => books.some((b) => b.status !== "unread"), run: each((b) => api.setBookStatus(b.id, "unread")) },
    { label: "Mark as dropped", hint: "Stopped, not going back", group: statusGroup, can: (books) => books.some((b) => b.status !== "dropped"), run: each((b) => api.setBookStatus(b.id, "dropped")) },
  ];
  /** Puts grouped actions into their submenus, where the first of each group stood. */
  const withSubmenus = (entries: (MenuEntry & { group?: GroupAction["group"] })[]): MenuEntry[] => {
    const out: MenuEntry[] = [];
    const subs = new Map<string, MenuEntry[]>();
    for (const e of entries) {
      const group = e !== "divider" && "group" in e ? e.group : undefined;
      if (!group) { out.push(e); continue; }
      const { group: _, ...item } = e as MenuItem & { group?: unknown };
      if (!subs.has(group.label)) {
        const list: MenuEntry[] = [];
        subs.set(group.label, list);
        out.push({ label: group.label, icon: group.icon, submenu: list });
      }
      subs.get(group.label)!.push(item as MenuEntry);
    }
    return out;
  };
  const ask = (what: "remove" | "delete" | "download") => (books: BookPreview[], stack?: string) => {
    setSeriesRemoval(stack ? { name: stack, books } : null);
    setAsking(what);
  };
  const groupActions: (GroupAction | "divider")[] = [
    { label: "Edit details", icon: "edit", run: (books) => askEditDetails(books) },
    { label: "Find details online", icon: "search", run: (books) => askFetchManyDetails(books) },
    ...bookOptions,
    // Music albums: songs kept together, each still its own item (embre, 19 November).
    ...(kind === "audiobooks"
      ? [
          { label: "Group as album", icon: "layers", can: (books) => books.length > 1, run: (books) => askAlbum(books, false) } as GroupAction,
          { label: "Ungroup", icon: "close", can: (books) => books.some((b) => b.series), run: (books) => askAlbum(books.filter((b) => b.series), true) } as GroupAction,
        ]
      : []),
    { label: "Tags", icon: "tag", run: (books, stack) => { setSeriesRemoval(stack ? { name: stack, books } : null); setTagging(true); } },
    { label: "Add to or take out of a collection", icon: "collections", run: (books) => askAddToCollection(books) },
    ...(kind !== "audiobooks" ? [{ label: "Send to e-reader", icon: "ereader", run: (books) => askSendToEreader(books) } as GroupAction] : []),
    ...(canSendWithLocalSend ? [{ label: "Send with Grimoire", icon: "upload", run: (books) => askSendWithLocalSend(books) } as GroupAction] : []),
    ...(actions.sendToFriend ? [{ label: "Send to a TBV friend", icon: "person", run: (books) => actions.sendToFriend?.(books) } as GroupAction] : []),
    ...(actions.shareFiles ? [{ label: "Share the files", icon: "share", run: (books) => actions.shareFiles?.(books) } as GroupAction] : []),
    ...(!isWeb && phoneChoiceShown()
      ? [
          { label: "Send to device", icon: "upload", run: (books) => actions.setPhoneWanted?.(books, true) } as GroupAction,
          { label: "Stop sending to device", icon: "cloudOff", can: (books) => books.some((b) => b.phoneWanted), run: (books) => actions.setPhoneWanted?.(books.filter((b) => b.phoneWanted), false) } as GroupAction,
        ]
      : []),
    { label: "Save copies", icon: "copy", run: (books) => void saveCopies(books) },
    { label: "Download", icon: "download", can: (books) => books.some(downloadable), run: (books) => void downloads.download(async () => books) },
    {
      label: "Remove download",
      icon: "cloudOff",
      hint: "Keeps the cloud copy",
      can: (books) => books.some((b) => b.availability === "local" && b.inCloud),
      run: ask("download"),
    },
    { label: "Hide", icon: "eyeOff", run: (books) => askHide(books, () => { setSelected(null); setReload((n) => n + 1); }) },
    "divider",
    { label: "Remove from library", icon: "close", run: ask("remove") },
    { label: "Delete", icon: "trash", danger: true, run: ask("delete") },
  ];
  const chosenActions: MenuEntry[] = [
    ...(none ? [] : [{
      heading: (
        <span className="menu-rating">
          Rate the chosen ones
          <StarRating value={null} size={18} onChange={(r) => each((b) => api.setRating(b.id, r))(chosen)} />
        </span>
      ),
    } as MenuEntry]),
    ...withSubmenus(groupActions.map((a) => a === "divider" ? a : {
      label: a.label === "Share the files" && chosen.length === 1 ? "Share the file" : a.label,
      icon: a.icon, hint: a.hint, danger: a.danger, group: a.group,
      disabled: none || busy !== null || (a.can ? !a.can(chosen) : false),
      onSelect: () => a.run(chosen),
    })),
    { label: "Clear choice", icon: "close", disabled: none || busy !== null, onSelect: () => setSelected(new Map()) },
    // Find alike (embre, 21 November): a toolbar button on the computer; phones and iPads keep it here.
    ...(api.findAlike && kind !== "documents" && narrow
      ? ["divider" as const, { label: "Find alike…", icon: "search" as const, onSelect: () => setFindingAlike(chosen) }]
      : []),
  ];

  /** Removes downloads, removes from the library, or deletes, one book at a time. */
  const changeChosen = async (what: "remove" | "delete" | "download") => {
    const targets = seriesRemoval?.books ?? chosen;
    setAsking(null);
    setSeriesRemoval(null);
    const local = what === "download" ? targets.filter((book) => book.availability === "local") : targets;
    const list = what === "download" ? local.filter((book) => book.inCloud) : targets;
    const verb = { remove: "Removing", delete: "Deleting", download: "Removing downloads" }[what];
    const work = { remove: api.removeFromLibrary, delete: api.deleteBook, download: api.removeDownload }[what];
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      setBusy(`${verb}: ${i + 1} of ${list.length}…`);
      try {
        await work(list[i].id);
      } catch {
        failed++;
      }
    }
    setBusy(null);
    if (what !== "download") setSelected(new Map());
    setReload((n) => n + 1);
    const done = list.length - failed;
    const count = (n: number) => (n === 1 ? `1 ${words.one}` : `${n} ${words.many}`);
    const skipped = local.length - list.length;
    toast(
      what === "download"
        ? `Removed the downloads of ${count(done)}. They're still in the cloud.` +
            (skipped ? ` ${count(skipped)} ${skipped === 1 ? "isn't" : "aren't"} in the cloud yet, so ${skipped === 1 ? "it was" : "they were"} kept here.` : "") +
            (failed ? ` ${count(failed)} couldn't be removed.` : "")
        : failed
          ? `${what === "remove" ? "Removed" : "Deleted"} ${done} of ${list.length}. ${failed} couldn't be changed.`
          : `${what === "remove" ? "Removed" : "Deleted"} ${count(done)}.`,
    );
  };

  const saveCopies = async (books: BookPreview[]) => {
    try {
      setBusy("Saving copies…");
      const done = await api.saveCopies(books.map((b) => b.id));
      if (done) toast(`Saved ${done.saved === 1 ? "a copy" : `${done.saved} copies`} to ${done.folder}.`);
    } catch (e) {
      toast(`Couldn't save the copies: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  // The last thing read (the Archive) or listened to (Resonance, which passes its own for the tab)
  // leads the first page, marked, and stays in its own place too (embre, 20 November).
  const [ownLead, setOwnLead] = useState<BookPreview | null>(null);
  useEffect(() => {
    if (lead !== undefined) return;
    let current = true;
    void api.getLibrary({ kind, shelf: "all", sort: "recently_opened", search: null, formats: [], location: null, page: 0, pageSize: 1, omitFacets: true })
      .then((got) => { if (current) setOwnLead(got.books.find((b) => b.lastOpenedAt) ?? null); }, () => { if (current) setOwnLead(null); });
    return () => { current = false; };
  }, [kind, lead === undefined, refreshKey, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const leadBook = lead === undefined ? ownLead : lead;
  const leadHere = leadBook && !inSeries && view.tab === "all" && !filtered && !search.trim() ? leadBook : null;
  const firstPage = endless || (page?.page ?? 0) === 0;
  const leadCard: LeadCard | undefined = leadHere && firstPage && page
    ? { book: leadHere, label: kind === "audiobooks" ? "Last listened" : "Last read" }
    : undefined;
  const shownBooks = page?.books ?? [];
  const firstShown = leadCard?.book.id ?? shownBooks[0]?.id ?? null;
  const pageReady = !!page;
  useEffect(() => {
    if (pageReady) onFirstShown?.(firstShown);
  }, [firstShown, pageReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const pinCount = pins.length + (pinnedStacks?.books.length ?? 0);
  const pinnedCover = pins[0] ?? pinnedStacks?.books[0];
  const pinnedNames = (pinnedStacks?.books ?? []).flatMap((b) => (pinnedStacks?.seriesCounts?.[b.id] && b.series?.trim() ? [b.series.trim()] : []));
  const pinnedAllChosen = pinCount > 0 && pins.every((b) => selected?.has(b.id)) && pinnedNames.every((n) => !!selection?.hasSeries?.(n));
  /** Every pinned book, and every book of every pinned series, as the filters show them (as choosing one stack does). */
  const choosePinned = async () => {
    setBusy("Choosing…");
    try {
      const lists = await Promise.all(pinnedNames.map(async (n) => [n, await booksOfSeries(n)] as const));
      setStackBooks((m) => {
        const next = new Map(m);
        for (const [n, books] of lists) next.set(n, books);
        return next;
      });
      setSelected((s) => {
        const next = new Map(s ?? []);
        for (const b of [...pins, ...lists.flatMap(([, books]) => books)]) next.set(b.id, b);
        return next;
      });
    } catch (e) {
      toast(`Couldn't choose them all: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const pinnedCard: PinnedCard | undefined = separatePins && firstPage && view.tab !== "collections" && pinCount > 0 && pinnedCover
    ? { count: pinCount, cover: pinnedCover, onOpen: () => { setSelected(null); setShowPinned(true); } }
    : undefined;
  // The cards that lead the first page take its first places; every page counts them, so
  // later pages start where the first one stopped.
  const cardSlots = (separatePins && view.tab !== "collections" && pinCount > 0 && pinnedCover ? 1 : 0) + (leadHere ? 1 : 0);
  useEffect(() => setLeadSlots(cardSlots), [cardSlots]);
  // New books on screen: the page is measured again.
  useEffect(() => {
    if (load.state === "ready") setMeasured((n) => n + 1);
  }, [load, view.layout]);
  // The page size changed (a bigger window, another layout): stay with the books that were showing.
  const lastSize = useRef(pageSize);
  useEffect(() => {
    const was = lastSize.current;
    lastSize.current = pageSize;
    if (endless || was === pageSize || view.page === 0) return;
    const firstIndex = view.page * was - slots;
    onChange({ page: Math.floor((firstIndex + slots) / pageSize) });
  }, [pageSize]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nothing pinned any more: back to the list.
  useEffect(() => {
    if (showPinned && pageReady && pinCount === 0) setShowPinned(false);
  }, [showPinned, pageReady, pinCount]);

  let body: React.ReactNode;
  if (load.state === "error") {
    body = (
      <div className="library-empty" role="alert">
        <h2>Your {kind === "documents" ? "documents" : "library"} couldn't be loaded</h2>
        <p className="muted">{load.message}</p>
        <button type="button" className="btn btn-primary" onClick={() => setReload((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  } else if (view.tab === "collections") {
    body = <CollectionsTab collections={collections} onOpenCollection={onOpenCollection} />;
  } else if (showPinned && !inSeries) {
    body = (
      <>
        <Layout books={pins} actions={actions} selection={selection} />
        {pinnedStacks && pinnedStacks.books.length > 0 && (
          <Layout books={pinnedStacks.books} actions={actions} selection={selection} seriesCounts={pinnedStacks.seriesCounts}
            seriesCovers={pinnedStacks.seriesCovers} seriesPublished={pinnedStacks.seriesPublished} seriesAuthors={pinnedStacks.seriesAuthors} onOpenSeries={narrow ? onOpenSeries && ((name) => openStack(name, onOpenSeries)) : toggleFan} fan={narrow ? undefined : fanOf} seriesMenu={seriesMenu} />
        )}
      </>
    );
  } else if (!page) {
    body = <div className="library-loading" aria-busy="true" aria-label="Loading your library" />;
  } else if (facets?.counts.all === 0) {
    body = (
      <div className="library-empty">
        <h2>No {words.many} yet</h2>
        <p className="muted">
          {kind === "documents"
            ? "PDF, Word and text files you import show up here, apart from your books. TBV keeps its own copy and never changes your files."
            : "Import the books you already have. TBV keeps its own copy and never changes your files."}
        </p>
        <div className="hero-actions">
          <button type="button" className="btn btn-primary" onClick={onImportBooks}>
            <Icon name="importFile" size={16} /> Import {words.many}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onImportFolder}>
            <Icon name="folder" size={16} /> Import a folder
          </button>
        </div>
      </div>
    );
  } else if (page.total === 0 && !pinnedCard && !leadHere) {
    body = (
      <div className="library-empty">
        <h2>Nothing matches</h2>
        <p className="muted">
          {search.trim() ? `No ${words.many} on this shelf match “${search.trim()}”.` : `No ${words.many} on this shelf yet.`}
          {filtered && " Filters are also narrowing the list."}
        </p>
        <div className="hero-actions">
          {search.trim() && (
            <button type="button" className="btn btn-quiet" onClick={onClearSearch}>
              Clear search
            </button>
          )}
          {filtered && (
            <button type="button" className="btn btn-quiet" onClick={() => onChange(NO_FILTERS)}>
              Clear filters
            </button>
          )}
          {view.tab !== "all" && (
            <button type="button" className="btn btn-quiet" onClick={() => onChange({ tab: "all" })}>
              Show all {words.many}
            </button>
          )}
        </div>
      </div>
    );
  } else {
    const noun: [string, string] = groupSeries ? ["item", "items"] : [words.one, words.many];
    const items = <Layout books={shownBooks} pinnedCard={pinnedCard} lead={leadCard} actions={actions} selection={selection} seriesCounts={groupSeries ? page.seriesCounts : undefined} seriesCovers={page.seriesCovers} seriesPublished={page.seriesPublished} seriesAuthors={page.seriesAuthors} seriesMenu={seriesMenu} showStatus={inSeries} inSeries={seriesName} onOpenSeries={narrow ? (name) => openStack(name, goToSeries) : toggleFan} fan={narrow ? undefined : fanOf} />;
    body = endless ? (
      <>
        {items}
        <div ref={end} className="library-end muted num">
          {hasMore ? <span className="library-more" aria-busy="true" aria-label={`Loading more ${words.many}`} /> : `${page.total.toLocaleString()} ${page.total === 1 ? noun[0] : noun[1]}`}
        </div>
      </>
    ) : (
      <>
        {items}
        <Pagination noun={noun} page={page.page} pageSize={page.pageSize} lead={slots} total={page.total} onPage={(p) => onChange({ page: p })} />
      </>
    );
  }

  return (
    <div className="library" ref={libraryRoot}>
      <header className="library-head is-stacked">
        {seriesBack && <button type="button" className="back-link" onClick={seriesBack}><Icon name="chevronLeft" size={14} /> Back to {words.title}</button>}
        {showPinned && !seriesBack && <button type="button" className="back-link" onClick={() => { setSelected(null); setShowPinned(false); }}><Icon name="chevronLeft" size={14} /> Back to {words.title}</button>}
        <div className="library-title-row">
          <h1 className="library-title">{inSeries ? view.series[0] : showPinned ? "Pinned" : words.title}</h1>
          {!showPinned && switcher}
        </div>
        {showPinned && !seriesName && (
          <div className="settings-actions">
            {/* Choosing among the pinned books and series, as inside a series (embre, 20 November). */}
            <button type="button" className={`btn btn-quiet select-button${selected ? " is-lit" : ""}`} aria-pressed={selected !== null}
              onClick={() => setSelected(selected ? null : new Map())}>
              <Icon name="check" size={16} /> Select
            </button>
          </div>
        )}
        {seriesName && (
          <div className="settings-actions">
            {/* Choosing books inside a series, as on the main page (embre, 20 November). */}
            <button type="button" className={`btn btn-quiet select-button${selected ? " is-lit" : ""}`} aria-pressed={selected !== null}
              onClick={() => setSelected(selected ? null : new Map())}>
              <Icon name="check" size={16} /> Select
            </button>
            <button type="button" className="btn btn-quiet" disabled={!!busy || !canGetSeries(seriesName)} onClick={() => void downloadSeries(seriesName)}>Download</button>
            <button type="button" className="btn btn-quiet" disabled={!!busy || !hasSeriesHere(seriesName)} onClick={() => void askRemoveSeriesDownloads(seriesName)}>Remove download</button>
            {seriesCheck && <FindMissingButton state={seriesCheck} />}
            {!albums && <SeriesHeart name={seriesName} favourite={isFavouriteSeries(seriesName, favourites.series)} onChange={(on) => toggleSeriesFavourite(seriesName, on)} />}
          </div>
        )}
        {!seriesName && seriesCheck && (
          <div className="settings-actions">
            <FindMissingButton state={seriesCheck} />
          </div>
        )}
        {seriesName && seriesTotal?.name === seriesName && page && page.total < seriesTotal.count && (
          <div className="search-note">
            <span>{page.total} of {seriesTotal.count} {albums ? "songs" : "books"} shown</span>
            {onShowAllSeries && <button type="button" className="view-all" onClick={onShowAllSeries}>{albums ? "Show all songs in this album" : "Show all books in this series"}</button>}
          </div>
        )}
        {/* Inside a series (or Pinned) the page is about those books: no counts (embre, 20 November). */}
        {counts && !inSeries && !showPinned && (
          <div className="stats stats-5 library-stats">
            <Stat icon="circleProgress" value={counts.inProgress} label="In progress" />
            <Stat icon="checkCircle" value={counts.read} label="Read" />
            <Stat icon="circle" value={counts.unread} label="Unread" />
            <Stat icon={kind === "audiobooks" ? "headphones" : "bookOpen"} value={counts.all} label={words.total} />
            {spent &&
              (kind === "audiobooks" ? (
                <Stat icon="clock" value={<Spent seconds={spent.listen} />} label="Listened" />
              ) : (
                <Stat icon="clock" value={<Spent seconds={spent.read} />} label="Time read" />
              ))}
          </div>
        )}
      </header>

      {isWeb && (
        <div className="segmented library-reach" role="radiogroup" aria-label="Which books to show">
          {[
            { on: false, label: "Full library" },
            { on: true, label: "Available to download" },
          ].map(({ on, label }) => (
            <button key={label} type="button" role="radio" aria-checked={view.downloadable === on} onClick={() => onChange({ downloadable: on, page: 0 })}>
              {label}
            </button>
          ))}
        </div>
      )}

      {!seriesBack && !showPinned && <LibraryToolbar
        view={view}
        counts={counts}
        formats={facets?.formats ?? []}
        tags={facets?.tags ?? []}
        genres={facets?.genres ?? []}
        languages={facets?.languages ?? []}
        authors={facets?.authors ?? undefined}
        narrators={facets?.narrators ?? undefined}
        allLabel={kind === "books" ? undefined : `All ${words.many}`}
        allowSeries={kind !== "documents" && !albums}
        seriesNames={facets?.seriesNames ?? []}
        paired={paired}
        onPairing={onPairing}
        continuous={scrollLibrary}
        pages={!endless && page ? { page: page.page, count: pageCount(page.total, page.pageSize, slots), onPage: (p) => onChange({ page: p }) } : null}
        onFindAlike={canFindAlike && !narrow ? () => setFindingAlike(selected ? [...selected.values()] : []) : undefined}
        onContinuous={narrow ? undefined : (enabled) => {
          changeSettings({ scrollLibrary: enabled });
          onChange({ page: 0 });
          pageScroller(libraryRoot.current)?.scrollTo({ top: 0 });
        }}
        selecting={selected !== null}
        onSelecting={(on) => setSelected(on ? new Map() : null)}
        onChange={onChange}
      />}

      {selected && view.tab !== "collections" && (
        <div className="select-bar" role="toolbar" aria-label={`Change many ${words.many}`}>
          <span className="select-count">
            {selected.size ? `${selected.size} chosen` : `Click ${words.many} to choose them`}
          </span>
          {busy && <span className="select-count">{busy}</span>}
          <span className="select-actions">
            <Menu
              label={`Do something with the chosen ${words.many}`}
              className="btn btn-quiet"
              align="start"
              trigger={
                <>
                  Actions <Icon name="chevronDown" size={13} />
                </>
              }
              items={chosenActions}
            />
            {/* The phone has no pages, so only "Select all" there. */}
            {!endless && !showPinned && (
              <label className="select-all">
                <input
                  type="checkbox"
                  checked={pageAllChosen}
                  disabled={!page?.books.length || busy !== null}
                  onChange={(e) => {
                    if (!page) return;
                    const on = e.target.checked;
                    const stacks = page.books.map(stackOf).filter((n): n is string => !!n);
                    const single = page.books.filter((b) => !stackOf(b));
                    void chooseSeries(stacks, on, single);
                  }}
                />
                Select page
              </label>
            )}
            <label className="select-all">
              <input
                type="checkbox"
                checked={showPinned ? pinnedAllChosen : libraryAllChosen}
                disabled={(showPinned ? !pinCount : !page?.total) || busy !== null}
                onChange={(e) => (e.target.checked ? void (showPinned ? choosePinned() : chooseAll()) : setSelected(new Map()))}
              />
              Select all
            </label>
            <button type="button" className="btn btn-quiet" disabled={none || busy !== null} onClick={() => setSelected(new Map())}>
              Deselect all
            </button>
          </span>
        </div>
      )}
      {findingAlike && <FindAlike kind={kind} from={findingAlike} onClose={() => setFindingAlike(null)} onChanged={() => setReload((n) => n + 1)} />}
      {asking && (
        <ConfirmDialog
          title={
            {
              download: seriesRemoval ? `Remove downloads for “${seriesRemoval.name}”?` :
                `Remove the downloads of ${chosen.length === 1 ? `“${chosen[0].title}”` : `${chosen.length} ${words.many}`}?`,
              remove: seriesRemoval ? `Remove “${seriesRemoval.name}” (${seriesRemoval.books.length} ${seriesRemoval.books.length === 1 ? words.one : words.many}) from your library?` :
                `Remove ${chosen.length === 1 ? `“${chosen[0].title}”` : `${chosen.length} ${words.many}`} from your library?`,
              delete: seriesRemoval ? `Delete “${seriesRemoval.name}” (${seriesRemoval.books.length} ${seriesRemoval.books.length === 1 ? words.one : words.many}) for good?` :
                `Delete ${chosen.length === 1 ? `“${chosen[0].title}”` : `${chosen.length} ${words.many}`} for good?`,
            }[asking]
          }
          body={
            asking === "download"
              ? "This frees up space on this device. The books stay in your library and in the cloud, and download again when you open them. Books that aren't in the cloud yet are kept here."
              : (asking === "remove" ? removeWarning : deleteWarning)((seriesRemoval?.books ?? chosen).length > 1)
          }
          confirm={{ download: "Remove downloads", remove: "Remove from library", delete: "Delete for good" }[asking]}
          danger={asking !== "download"}
          onCancel={() => { setAsking(null); setSeriesRemoval(null); }}
          onConfirm={() => void changeChosen(asking)}
        />
      )}
      {tagging && (
        <TagsDialog
          books={seriesRemoval?.books ?? chosen}
          onClose={(changed) => {
            setTagging(false);
            setSeriesRemoval(null);
            if (changed) setReload((n) => n + 1);
          }}
        />
      )}

      {search.trim() && view.tab !== "collections" && (
        <p className="search-note">
          Showing results for “{search.trim()}”
          <button type="button" className="view-all" onClick={onClearSearch}>
            Clear
          </button>
        </p>
      )}

      {view.tab !== "collections" && intro}


      {searching && <p className="muted library-searching" role="status">Searching…</p>}
      {coverPicker && <SeriesCoverPicker name={coverPicker} kind={kind} chosen={coverChoices[coverPicker.trim().toLowerCase()]}
        onChoose={(id) => { changeCover(coverPicker, id); setCoverPicker(null); }} onClose={() => setCoverPicker(null)} />}
      {downloads.feedback}
      <div className="library-body">
        {body}
      </div>
      {seriesCheck && checkedSeries && (
        <SeriesPanel
          name={checkedSeries}
          author={seriesAuthor}
          refreshKey={refreshKey + reload}
          onChanged={() => setReload((n) => n + 1)}
          state={seriesCheck}
        />
      )}
    </div>
  );
}

/** A book that can be downloaded here: only in the cloud, or its file gone from here. */


const KNOWN_LISTS = ["formats", "tags", "genres", "languages"] as const;

/** The filters to keep when some of `view`'s names aren't in the library any more, or null when all are. */
export function gone(view: LibraryView, page: Pick<LibraryPage, (typeof KNOWN_LISTS)[number]>): Partial<LibraryView> | null {
  const change: Partial<LibraryView> = {};
  const exclude = { ...view.exclude };
  let changed = false;
  for (const list of KNOWN_LISTS) {
    const known = new Set(page[list].map((n) => n.toLowerCase()));
    const keep = (names: string[]) => names.filter((n) => known.has(n.toLowerCase()));
    const shown = keep(view[list]);
    const hidden = keep(view.exclude[list]);
    if (shown.length !== view[list].length) change[list] = shown;
    if (hidden.length !== view.exclude[list].length) exclude[list] = hidden;
    changed ||= shown.length !== view[list].length || hidden.length !== view.exclude[list].length;
  }
  if (!changed) return null;
  return { ...change, exclude, page: 0 };
}
