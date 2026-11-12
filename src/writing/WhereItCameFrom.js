import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { RememberedDetails } from "../components/RememberedDetails";
// Book details' "Where it came from", for a book imported into Scribe or
// duplicated from one: the signed record of the person confirming they may
// publish it, checked each time it's shown, the original file when this
// device keeps it, and this device's own history. Nothing here is part of
// the book itself, and none of it goes into an exported file.
import { useEffect, useState } from "react";
import { api } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { formatBytes } from "../settings/controls";
const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
const APPLE_CHECK = {
    valid: "Apple vouched for it: made by genuine TBV on a real Apple device, and checked against Apple's certificate",
    development: "Apple vouched for it from a test build of TBV, checked against Apple's certificate",
    invalid: "Apple's stamp is attached, but it doesn't match this record",
    unreadable: "Apple's stamp is attached, but it can't be read",
};
const source = (r) => (r.record.source ?? {});
/** The earlier records a Scribe book file brought with it, as it had them. */
function carried(r) {
    const list = Array.isArray(r.record.carriedRecords) ? r.record.carriedRecords : [];
    return list
        .filter((x) => !!x && typeof x === "object")
        .map((x) => {
        const inner = (x.record && typeof x.record === "object" ? x.record : {});
        const src = (inner.source && typeof inner.source === "object" ? inner.source : {});
        return {
            event: x.event === "duplicate" ? "duplicate" : "import",
            at: typeof inner.at === "string" ? inner.at : typeof x.createdAt === "string" ? x.createdAt : null,
            name: typeof src.name === "string" ? src.name : null,
            signature: typeof x.signature === "string" ? x.signature : null,
            device: typeof x.device === "string" ? x.device : null,
        };
    });
}
function RecordRow({ record, own }) {
    const s = source(record);
    const what = record.event === "duplicate"
        ? "Duplicated from another book"
        : `${own ? "Imported" : "The original book was imported"} from ${s.name ?? "a file"}, after you confirmed you own it or may publish it`;
    const at = typeof record.record.at === "string" ? record.record.at : record.createdAt;
    return (_jsxs("li", { className: "provenance-record", children: [_jsxs("p", { children: [_jsx("strong", { children: what }), _jsx("br", {}), _jsxs("span", { className: "muted", children: [when(at), record.device ? `, on ${record.device}` : ""] })] }), _jsxs("p", { className: `provenance-check is-${record.signature}`, children: [_jsx(Icon, { name: record.signature === "valid" ? "checkCircle" : "info", size: 14 }), record.signature === "valid" ? "Signed, and the signature checks" : record.signature === "invalid" ? "This record doesn't match its signature: it was changed after it was made" : "This record can't be read"] }), record.appleStamp && (_jsxs("p", { className: `provenance-check is-${record.appleCheck === "valid" || record.appleCheck === "development" ? "valid" : "invalid"}`, children: [_jsx(Icon, { name: record.appleCheck === "valid" || record.appleCheck === "development" ? "checkCircle" : "info", size: 14 }), APPLE_CHECK[record.appleCheck ?? "unreadable"]] })), carried(record).length > 0 && (_jsxs("div", { className: "provenance-carried", children: [_jsx("p", { className: "muted", children: "The book file brought its earlier history, signed into this record:" }), _jsx("ul", { children: carried(record).map((c, i) => (_jsxs("li", { children: [c.event === "duplicate" ? "Duplicated from another book" : `Imported from ${c.name ?? "a file"}`, _jsxs("span", { className: "muted", children: [c.at ? `, ${when(c.at)}` : "", c.device ? `, on ${c.device}` : "", c.signature === "valid" ? ", its signature checked on the device that saved the file" : c.signature ? ", its signature didn't check on the device that saved the file" : ""] })] }, i))) })] })), _jsxs(RememberedDetails, { disclosure: "writing.provenance", className: "provenance-more", children: [_jsx("summary", { children: "The record" }), _jsxs("dl", { children: [record.event === "import" && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "Confirmation" }), _jsxs("dd", { children: ["Version ", String(record.record.policyVersion ?? "?"), ", ticked by you"] }), _jsx("dt", { children: "File" }), _jsxs("dd", { children: [s.name, " ", typeof s.bytes === "number" ? `(${formatBytes(s.bytes)})` : ""] }), _jsx("dt", { children: "Its fingerprint" }), _jsxs("dd", { className: "provenance-hash", children: ["SHA-256 ", s.sha256] })] })), _jsx("dt", { children: "Signed with" }), _jsxs("dd", { className: "provenance-hash", children: [String(record.record.algorithm ?? "Ed25519"), " key ", record.keyId] })] })] })] }));
}
export function WhereItCameFrom({ projectId }) {
    const [seen, setSeen] = useState(null);
    const [deleting, setDeleting] = useState(null);
    const [reload, setReload] = useState(0);
    useEffect(() => {
        let current = true;
        api.writingProvenance(projectId).then((p) => current && setSeen(p), () => current && setSeen(null));
        return () => {
            current = false;
        };
    }, [projectId, reload]);
    if (!seen || (!seen.records.length && !seen.sources.length))
        return null;
    const imported = seen.records.some((r) => r.event === "import");
    return (_jsxs("section", { className: "provenance", "aria-labelledby": "provenance-title", children: [_jsx("h3", { id: "provenance-title", children: "Where it came from" }), _jsx("ul", { className: "provenance-records", children: seen.records.map((r) => (_jsx(RecordRow, { record: r, own: r.projectId === projectId }, r.id))) }), seen.sources.map((s) => (_jsxs("div", { className: "provenance-source", children: [_jsx(Icon, { name: "file", size: 15 }), _jsxs("span", { children: ["The original, ", s.name, " (", formatBytes(s.bytes), "), is kept on this device, and copied to your cloud when notes sync."] }), _jsx("button", { type: "button", className: "link-btn", onClick: () => setDeleting(s.sha256), children: "Delete the original" })] }, s.sha256))), imported && !seen.sources.length && _jsx("p", { className: "muted provenance-note", children: "The original file isn't on this device. A computer copies it down from your cloud when notes sync; its fingerprint stays in the record either way." }), _jsx("p", { className: "muted provenance-note", children: "This record is your own confirmation, kept with the book. It isn't a check of who wrote it, and it's never put into a book you export." }), seen.history.length > 0 && (_jsxs(RememberedDetails, { disclosure: "writing.source", className: "provenance-more", children: [_jsx("summary", { children: "This device's history" }), _jsx("ul", { className: "provenance-history", children: seen.history.map((h, i) => (_jsxs("li", { children: [_jsx("span", { className: "muted", children: when(h.at) }), " ", h.detail] }, i))) })] })), deleting && (_jsx(ConfirmDialog, { title: "Delete the original file?", body: "The book stays as it is, and the signed record keeps the file's fingerprint. The original is deleted from this device and from your cloud. Another computer that already copied it keeps its copy until you delete it there too.", confirm: "Delete the original", danger: true, onConfirm: () => {
                    const sha = deleting;
                    setDeleting(null);
                    void api.deleteWritingSource(projectId, sha).then(() => setReload((n) => n + 1));
                }, onCancel: () => setDeleting(null) }))] }));
}
