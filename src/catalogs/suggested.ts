// Free, legal places to find books, offered under "Add a catalogue" (checked
// October 2026). None comes built in: the focus is the catalogues people add
// themselves, and these are suggestions. Catalogues (OPDS) are browsed inside
// TBV; websites open in Discover's browser, where any ebook downloaded joins
// the library.
//
// Left out on purpose: Feedbooks (closed in 2024, now Cantook), the Unbound
// Bible (discontinued by Biola University), Bible Gateway (read online only;
// its ebooks are sold and most of its translations are copyrighted).

export interface SuggestedCatalog {
  name: string;
  url: string;
  /** What it holds, in a few words. */
  about: string;
  /** An OPDS catalogue to add, or a website to open in Discover. */
  kind: "opds" | "site";
}

export interface SuggestedGroup {
  title: string;
  /** One line under the heading. */
  about: string;
  items: SuggestedCatalog[];
}

const opds = (name: string, url: string, about: string): SuggestedCatalog => ({ name, url, about, kind: "opds" });
const site = (name: string, url: string, about: string): SuggestedCatalog => ({ name, url, about, kind: "site" });

export const SUGGESTED_GROUPS: SuggestedGroup[] = [
  {
    title: "Catalogues",
    about: "Browse and search them here, and bring a book in with one tap.",
    items: [
      opds("Project Gutenberg", "https://www.gutenberg.org/ebooks.opds/", "Over 70,000 free classics, in English and many other languages."),
      site("eBible.org", "https://ebible.org/download.php", "Over 1,000 Bible translations, free to share. Opens in Discover; an EPUB you download comes into your library."),
      opds("Internet Archive", "https://archive.org/services/opds", "Millions of open-access and public-domain books, and audiobooks."),
      opds("Open Library", "https://openlibrary.org/opds/", "English and more. Many books are borrow-only on its website."),
      opds("Ebooks libres et gratuits", "https://www.ebooksgratuits.com/opds/", "French classics"),
      opds("textos.info", "https://textos.info/opds", "Spanish classics"),
      opds("Wolne Lektury", "https://wolnelektury.pl/opds/", "Polish literature"),
      opds("Bokselskap", "https://www.bokselskap.no/wp-content/themes/bokselskap/tekster/opds/root.xml", "Norwegian literature"),
      opds("ImWerden", "https://imwerden.de/opds/", "Russian literature, poetry and magazines"),
      opds("Chitanka", "https://chitanka.info/catalog.opds", "Bulgarian literature"),
      opds("Knihi.com", "https://knihi.com/opds.xml", "Belarusian literature"),
      opds("Aozora Bunko", "http://aozora.textlive.net/catalog.opds", "Japanese classics"),
      opds("CBETA", "https://www.cbeta.org/opds", "The Chinese Buddhist canon"),
    ],
  },
  {
    title: "Websites with free downloads",
    about: "They open in Discover. Any ebook you download comes into your library.",
    items: [
      site("Standard Ebooks", "https://standardebooks.org/ebooks", "Carefully edited, beautifully set classics. Free to download from the website."),
      site("Alice & Books", "https://www.aliceandbooks.com/", "Well-made editions of public-domain classics."),
      site("Global Grey", "https://www.globalgreyebooks.com/", "Thousands of public-domain books, free and without ads."),
      site("ManyBooks", "https://manybooks.net/", "Free classics and books authors give away. Downloads ask for a free account."),
      site("Google Books (free)", "https://www.google.com/search?tbm=bks&tbs=bkv:f&q=classics", "Public-domain books Google scanned. Search shows only the free ones."),
    ],
  },
  {
    title: "Audiobooks, research and religious texts",
    about: "They open in Discover.",
    items: [
      site("LibriVox", "https://librivox.org/", "Public-domain audiobooks, read by volunteers."),
      site("HathiTrust", "https://www.hathitrust.org/", "Millions of scanned library books. Public-domain ones are free to read; whole-book downloads may need a member library's sign-in."),
      site("Sefaria", "https://www.sefaria.org/texts", "Jewish texts in Hebrew and English, from the Torah to modern works."),
      site("Christian Classics Ethereal Library", "https://www.ccel.org/", "Classic Christian writings, mostly public domain, free for personal use."),
    ],
  },
  {
    title: "Whole collections",
    about: "For your own server. Very large.",
    items: [
      site("Project Gutenberg offline copies", "https://www.gutenberg.org/help/mirroring.html", "The whole collection as mirrors and disc images, to serve from your own computer, for example with Calibre."),
    ],
  },
];

/** Every catalogue (OPDS) suggestion. */
export const SUGGESTED_CATALOGS: SuggestedCatalog[] = SUGGESTED_GROUPS.flatMap((g) => g.items).filter((s) => s.kind === "opds");

/** An address as it compares: no scheme, no trailing slash, any case. */
export const sameAddress = (a: string, b: string) => {
  const plain = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return plain(a) === plain(b);
};
