import { useState } from "react";
import { api } from "../api";
import type { BookPreview } from "../api/types";
import { authorLine, hashOf } from "../lib/format";
import { isAudio, isDocument } from "../lib/queryBooks";
import { Icon } from "./Icon";

// Muted cloth tones for books that ship without cover art.
const CLOTH = ["#2f3a44", "#3d3a33", "#33403a", "#41323a", "#2e3540", "#463c2e"];

type CoverBook = Pick<BookPreview, "id" | "title" | "authors" | "coverPath"> & Partial<Pick<BookPreview, "availability" | "format" | "paired">>;

export function BookCover({ book, size = "m" }: { book: CoverBook; size?: "s" | "m" | "l" }) {
  const [failed, setFailed] = useState(false);
  const src = book.coverPath && !failed ? api.coverUrl(book.coverPath) : "";
  return (
    <div className={`cover cover-${size}${book.format && isAudio(book.format) ? " cover-audio" : ""}`}>
      {/* Privacy mode shows this instead of the cover; the cover stays loaded underneath. */}
      <div className="cover-private" aria-hidden>
        <span className="cover-title">{book.title}</span>
        <span className="cover-author">{authorLine(book.authors)}</span>
      </div>
      {src ? (
        <img src={src} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <div className="cover-generated" style={{ background: CLOTH[hashOf(book.id) % CLOTH.length] }}>
          <span className="cover-title">{book.title}</span>
          <span className="cover-author">{authorLine(book.authors)}</span>
        </div>
      )}
      {book.paired && book.format && (
        <span
          className="cover-pair"
          title={isAudio(book.format) ? "Its ebook is in your library" : "Its audiobook is in your library"}
        >
          <Icon name={isAudio(book.format) ? "library" : "headphones"} size={12} label={isAudio(book.format) ? "Has its ebook" : "Has its audiobook"} />
        </span>
      )}
      {book.format && isDocument(book.format) && (
        <span className="cover-doc" title={`A document (${book.format.toUpperCase()})`}>
          <Icon name="file" size={12} /> {book.format.toUpperCase()}
        </span>
      )}
      {book.availability === "cloud" && (
        <span className="cover-badge" title="In your library, not downloaded to this device">
          <Icon name="cloud" size={14} label="In the cloud" />
        </span>
      )}
      {book.availability === "missing" && (
        <span className="cover-badge cover-badge-warn" title="The file is missing from this device">
          <Icon name="warning" size={14} label="File missing" />
        </span>
      )}
    </div>
  );
}
