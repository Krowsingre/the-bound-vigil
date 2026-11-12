import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { DetailsEditor } from "./DetailsEditor";
import { FetchDetails } from "./FetchDetails";
import { onDetailsDialog } from "./openDetails";
/** Shows the details editor and the online search, wherever they're asked for. */
export function DetailsHost({ onChanged }) {
    const [ask, setAsk] = useState(null);
    useEffect(() => onDetailsDialog(setAsk), []);
    if (!ask)
        return null;
    const close = (changed) => {
        setAsk(null);
        if (changed)
            onChanged();
    };
    return ask.kind === "edit" ? (_jsx(DetailsEditor, { books: ask.books, onClose: close }, ask.books.map((b) => b.id).join())) : (_jsx(FetchDetails, { book: ask.book, onClose: close }, ask.book.id));
}
