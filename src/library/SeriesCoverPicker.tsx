import { useEffect, useState } from "react";
import { api } from "../api";
import type { ItemKind, LibraryPage } from "../api/types";
import { BookCover } from "../components/BookCover";
import { ConfirmDialog } from "../components/ConfirmDialog";

export function SeriesCoverPicker({ name, kind, chosen, onChoose, onClose }: {
  name: string;
  kind: ItemKind;
  chosen?: string;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<LibraryPage>();
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(chosen ?? "");
  useEffect(() => {
    let current = true;
    void api.getLibrary({ kind, series: [name], shelf: "all", sort: "series", search: null, formats: [], location: null, page, pageSize: 16, omitFacets: true })
      .then((data) => { if (current) setResult(data); }, (failure) => { if (current) setError(String(failure)); });
    return () => { current = false; };
  }, [kind, name, page]);
  return <ConfirmDialog title={`Choose cover for ${name}`} confirm="Use this cover" confirmDisabled={!selected}
    onConfirm={() => onChoose(selected)} onCancel={onClose}
    body={error ? <p role="alert">{error}</p> : !result ? <p>Loading books…</p> : <>
      <fieldset className="series-cover-options">
        <legend>Books in this series</legend>
        {result.books.map((book) => <label key={book.id} className="series-cover-option">
          <input type="radio" name="series-cover" checked={selected === book.id} onChange={() => setSelected(book.id)} />
          <BookCover book={book} size="s" />
          <span>{book.seriesIndex != null && `#${book.seriesIndex} · `}{book.title}</span>
        </label>)}
      </fieldset>
      {result.total > result.pageSize && <div>
        <button type="button" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button>
        <button type="button" disabled={(page + 1) * result.pageSize >= result.total} onClick={() => setPage(page + 1)}>Next</button>
      </div>}
    </>} />;
}
