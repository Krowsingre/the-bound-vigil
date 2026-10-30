// What a writer needs to know about ISBNs before publishing: which versions
// need one, that each version needs its own, and where to get them. TBV
// doesn't give them out, and says so plainly. Prices and rules as the
// agencies and stores published them in October 2026.

export function IsbnGuide({ open = false }: { open?: boolean }) {
  return (
    <details className="isbn-guide" open={open}>
      <summary>About ISBNs: The Bound Vigil doesn't provide them</summary>
      <p>
        An ISBN is the number that tells shops and libraries which book, and which version of it, they have. The Bound Vigil doesn't give them out: you get them yourself, from
        your country's ISBN agency or from the store you publish with.
      </p>
      <h4>Which versions need one</h4>
      <ul>
        <li>
          <b>Kindle e-books</b> don't need one. Amazon gives each its own number (an ASIN).
        </li>
        <li>
          <b>Apple Books, Kobo and Google Play e-books</b> don't need one either, though you can add your own.
        </li>
        <li>
          <b>Barnes &amp; Noble Press e-books</b> use your own ISBN if you give one, because B&amp;N's free ISBNs are for print books only.
        </li>
        <li>
          <b>Paperbacks and hardcovers</b> need one everywhere: KDP, IngramSpark and B&amp;N Press.
        </li>
      </ul>
      <h4>Each version needs its own</h4>
      <p>
        Every version with an ISBN needs a separate one: the e-book, the paperback, the hardcover, the audiobook, a large-print edition, a box set, and a new edition with real
        changes. The same version sold in several stores keeps the same ISBN.
      </p>
      <h4>Where to get them</h4>
      <ul>
        <li>
          <b>Bowker</b> (myidentifiers.com) is the official ISBN agency in the US. One costs $125, ten cost $295, a hundred $575 and a thousand $1,500. Your own ISBNs work in
          every store and carry your own imprint (publisher name), which must match what you register with Bowker exactly.
        </li>
        <li>
          <b>Amazon KDP</b> gives a free ISBN for paperbacks and hardcovers. It can only be used on KDP, and the publisher shows as "Independently published".
        </li>
        <li>
          <b>Barnes &amp; Noble Press</b> gives a free ISBN for print books. It can only be used on B&amp;N Press, the publisher shows as "Barnes &amp; Noble Press", and you
          can take up to 5 a week and 10 a month.
        </li>
        <li>
          <b>IngramSpark</b> gives free ISBNs to US self-publishers. They only work on IngramSpark, under its imprint Indy Pub.
        </li>
        <li>
          <b>Outside the US</b>, use your own country's agency: Nielsen in the UK and Ireland, Thorpe-Bowker in Australia, and ISBN Canada (free) in Canada.
        </li>
      </ul>
      <p className="muted">A free ISBN from a store ties that version to the store. If you want to sell it everywhere under your own name, buy your own.</p>
    </details>
  );
}
