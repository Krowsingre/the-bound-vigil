// Types for the parts of foliate-js that TBV uses. Not part of upstream.
export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[] | null;
}

export interface Relocation {
  fraction: number;
  location: { current: number; next: number; total: number };
  section: { current: number; total: number };
  tocItem?: { label: string; href: string; id?: number } | null;
  pageItem?: { label: string } | null;
  cfi: string;
  range?: Range;
}

export interface SearchExcerpt {
  pre: string;
  match: string;
  post: string;
}

export type SearchResult =
  | "done"
  | { progress: number }
  | { label: string; subitems: { cfi: string; excerpt: SearchExcerpt }[] };

export interface FoliateBook {
  metadata?: { title?: unknown; author?: unknown; language?: unknown };
  toc?: TocItem[];
  sections: { id?: string; linear?: string }[];
  dir?: string;
  splitTOCHref?(href: string): [string, unknown];
  resolveHref(href: string): { index: number; anchor?: unknown } | null;
  getCover?(): Promise<Blob | null> | null;
  /** Lets go of what the book holds open (PDF.js workers, chapter URLs). */
  destroy?(): void | Promise<void>;
}

export interface Paginator extends HTMLElement {
  /** Only the flowing (paginator) renderer has this; fixed-layout books do not. */
  setStyles?(css: string | [string, string]): void;
  getContents(): { doc: Document; index: number; overlayer?: import("./overlayer.js").Overlayer }[];
  next(): Promise<void>;
  prev(): Promise<void>;
  focusView?(): void;
  /** Brings a range into view, a page turn or scroll if needed. */
  scrollToAnchor?(anchor: Range | Element, select?: boolean): Promise<void>;
  nextSection?(): Promise<void>;
  /** Shows a section, at a fraction of the way through it or at a range. */
  goTo(target: { index: number; anchor?: number | ((doc: Document) => Range) }): Promise<void>;
}

/** Reads a section aloud a block at a time, as SSML with a mark before each sentence or word. */
export interface TTS {
  doc: Document;
  start(): string | undefined;
  /** From the block holding this range, beginning at its first mark there. */
  from(range: Range): string | undefined;
  next(paused?: boolean): string | undefined;
  prev(paused?: boolean): string | undefined;
  /** Highlights the marked sentence through the function given to initTTS. */
  setMark(mark: string): void;
}

export interface View extends HTMLElement {
  book: FoliateBook;
  renderer: Paginator;
  /** PDFs, comics and pre-paginated EPUBs, laid out page by page. */
  isFixedLayout: boolean;
  lastLocation: Relocation | null;
  /** A file, or a book object built by TBV (see src/reader/formats). */
  open(book: Blob | File | object): Promise<void>;
  init(options: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
  close(): void;
  goTo(target: string | number): Promise<unknown>;
  goToFraction(fraction: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  next(distance?: number): Promise<void>;
  goLeft(): Promise<void>;
  goRight(): Promise<void>;
  addAnnotation(annotation: { value: string; [key: string]: unknown }, remove?: boolean): Promise<unknown>;
  deleteAnnotation(annotation: { value: string }): Promise<unknown>;
  search(options: { query: string; matchCase?: boolean; matchDiacritics?: boolean; matchWholeWords?: boolean;
    draw?: unknown;
    drawOptions?: Record<string, unknown>;
  }): AsyncGenerator<SearchResult>;
  clearSearch(): void;
  getSectionFractions(): number[];
  getCFI(index: number, range?: Range): string;
  resolveNavigation(target: string | number | { fraction: number }): { index: number; anchor?: unknown } | undefined;
  deselect(): void;
  /** Sets up `tts` for the section on screen; kept while that section stays. */
  initTTS(granularity?: "word" | "sentence", highlight?: (range: Range) => void): Promise<void>;
  tts?: TTS | null;
}
