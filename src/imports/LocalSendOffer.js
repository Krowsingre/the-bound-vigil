import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
// Someone is sending files with LocalSend: TBV asks first. Accepted books
// go into the import queue.
import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { formatBytes } from "../settings/controls";
export function LocalSendOffers() {
    const [offers, setOffers] = useState([]);
    const toast = useToast();
    useEffect(() => api.onLocalSendOffer((offer) => setOffers((list) => [...list, offer])), []);
    const offer = offers[0];
    if (!offer)
        return null;
    const answer = (accept) => {
        void api.answerLocalSend(offer.session, accept);
        if (accept)
            toast("Accepted. Follow each file on the Imports page.");
        setOffers((list) => list.slice(1));
    };
    const taken = offer.files.filter((f) => f.importable);
    const skipped = offer.files.length - taken.length;
    return (_jsx("div", { className: "dialog-backdrop", children: _jsxs("div", { className: "dialog", role: "alertdialog", "aria-label": `${offer.from} wants to send files`, children: [_jsxs("h2", { children: [offer.from, " wants to send ", taken.length === 1 ? "a book" : `${taken.length} books`] }), _jsx("ul", { className: "localsend-files", children: taken.map((f) => (_jsxs("li", { children: [_jsx(Icon, { name: /\.(mp3|m4a|m4b|aac|ogg|opus|flac)$/i.test(f.name) ? "headphones" : "file", size: 16 }), _jsx("span", { className: "browse-name", children: f.name }), _jsx("span", { className: "browse-size", children: formatBytes(f.size) })] }, f.id))) }), skipped > 0 && (_jsxs("p", { className: "settings-row-hint", children: [skipped === 1 ? "1 other file isn't" : `${skipped} other files aren't`, " a book, document or audiobook, so TBV won't take", " ", skipped === 1 ? "it" : "them", "."] })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => answer(false), children: "Decline" }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: () => answer(true), children: "Accept" })] })] }) }));
}
