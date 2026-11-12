import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// A book's details: its files, when copies in other formats are kept with
// it. Each one opens on its own; your place and notes are the book's.
import { api } from "../api";
import { useToast } from "../components/Toast";
import { formatLabel } from "../lib/queryBooks";
import { formatBytes } from "../settings/controls";
export function FormatsRow({ bookId, files, onOpen, onChanged, }) {
    const toast = useToast();
    const apart = (f) => api.keepApart(f.id).then(() => {
        toast(`The ${formatLabel(f.format)} is listed on its own again. Your notes and place stay with this one.`);
        onChanged();
    }, (e) => toast(`Couldn't keep it apart: ${String(e)}`));
    return (_jsxs("div", { children: [_jsx("dt", { children: "Formats" }), _jsx("dd", { className: "details-formats", children: files.map((f) => (_jsxs("span", { className: "details-format", children: [formatLabel(f.format), f.size ? _jsxs("span", { className: "muted", children: [" \u00B7 ", formatBytes(f.size)] }) : null, " ", _jsx("button", { type: "button", className: "view-all", onClick: () => onOpen(f.id), children: "Open" }), f.id !== bookId && (_jsx("button", { type: "button", className: "view-all", onClick: () => void apart(f), children: "Keep apart" }))] }, f.id))) })] }));
}
