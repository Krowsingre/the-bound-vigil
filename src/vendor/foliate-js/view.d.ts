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
}

export interface Paginator extends HTMLElement {
  /** Only the flowing (paginator) renderer has this; fixed-layout books do not. */
  setStyles?(css: string | [string, string]): void;
  getContents(): { doc: Document; index: number }[];
  next(): Promise<void>;
  prev(): Promise<void>;
  focusView?(): void;
}

export interface View extends HTMLElement {
  book: FoliateBook;
  renderer: Paginator;
  lastLocation: Relocation | null;
  open(book: Blob | File): Promise<void>;
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
  resolveNavigation(target: string | number): { index: number } | undefined;
  deselect(): void;
}
