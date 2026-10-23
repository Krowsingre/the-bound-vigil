// Free OPDS catalogs known to work (checked October 2026), offered when
// adding a catalogue. Project Gutenberg comes built in, and is offered again
// here if it was removed.

export interface SuggestedCatalog {
  name: string;
  url: string;
  /** What it holds, in a few words. */
  about: string;
}

export const SUGGESTED_CATALOGS: SuggestedCatalog[] = [
  { name: "Project Gutenberg", url: "https://www.gutenberg.org/ebooks.opds/", about: "Over 70,000 free classics, in English and many other languages." },
  {
    name: "Standard Ebooks",
    url: "https://standardebooks.org/feeds/opds",
    about: "Carefully edited classics. Its catalog is for Patrons Circle members: sign in with the email you joined with.",
  },
  { name: "Open Library", url: "https://openlibrary.org/opds/", about: "English and more. Many books are borrow-only on its website." },
  { name: "Ebooks libres et gratuits", url: "https://www.ebooksgratuits.com/opds/", about: "French classics" },
  { name: "textos.info", url: "https://textos.info/opds", about: "Spanish classics" },
  { name: "Wolne Lektury", url: "https://wolnelektury.pl/opds/", about: "Polish literature" },
  { name: "Bokselskap", url: "https://www.bokselskap.no/wp-content/themes/bokselskap/tekster/opds/root.xml", about: "Norwegian literature" },
  { name: "ImWerden", url: "https://imwerden.de/opds/", about: "Russian literature, poetry and magazines" },
  { name: "Chitanka", url: "https://chitanka.info/catalog.opds", about: "Bulgarian literature" },
  { name: "Knihi.com", url: "https://knihi.com/opds.xml", about: "Belarusian literature" },
  { name: "Aozora Bunko", url: "http://aozora.textlive.net/catalog.opds", about: "Japanese classics" },
  { name: "CBETA", url: "https://www.cbeta.org/opds", about: "The Chinese Buddhist canon" },
];

/** An address as it compares: no scheme, no trailing slash, any case. */
export const sameAddress = (a: string, b: string) => {
  const plain = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return plain(a) === plain(b);
};
