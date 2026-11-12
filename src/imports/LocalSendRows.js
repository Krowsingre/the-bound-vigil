import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
// Files sent with LocalSend on the Imports page: every one, as it arrives,
// with why any failed or wasn't taken. Each book joins the import queue the
// moment it has arrived whole.
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { formatBytes } from "../settings/controls";
/** Every sent file, kept up to date (at most a few times a second). */
export function useLocalSendRows(enabled) {
    const [rows, setRows] = useState([]);
    const waiting = useRef(false);
    useEffect(() => {
        if (!enabled)
            return;
        let live = true;
        const load = () => {
            if (waiting.current)
                return;
            waiting.current = true;
            setTimeout(() => {
                waiting.current = false;
                api.localSendFiles().then((r) => live && setRows(r), () => undefined);
            }, 250);
        };
        load();
        const stop = api.onLocalSendChanged(load);
        return () => {
            live = false;
            stop();
        };
    }, [enabled]);
    return rows;
}
export function sentText(f) {
    switch (f.state) {
        case "waiting":
            return { text: `Waiting · ${formatBytes(f.size)}`, tone: "wait" };
        case "arriving":
            return { text: `Arriving ${formatBytes(f.bytes)} of ${formatBytes(Math.max(f.size, f.bytes))}`, tone: "now" };
        case "arrived":
            return { text: `Arrived · ${formatBytes(f.bytes)} · added to the import queue`, tone: "ok" };
        case "failed":
            return { text: `${f.reason ?? "It didn't arrive whole"}. Send it again from ${f.from}.`, tone: "bad" };
        case "skipped":
            return { text: `Not taken: ${f.reason ?? "TBV can't import it"}`, tone: "wait" };
    }
}
export function LocalSendRows({ rows }) {
    if (rows.length === 0)
        return null;
    const count = (s) => rows.filter((r) => r.state === s).length;
    const coming = count("waiting") + count("arriving");
    const [failed, skipped] = [count("failed"), count("skipped")];
    return (_jsxs("section", { className: "imports-group server-rows", "aria-label": "From Grimoire", children: [_jsxs("div", { className: "server-rows-head", children: [_jsxs("h3", { className: "section-label", children: ["From Grimoire \u00B7 ", rows.length, " ", rows.length === 1 ? "file" : "files", coming > 0 && ` · ${coming} still coming`, failed > 0 && ` · ${failed} failed`, skipped > 0 && ` · ${skipped} not taken`] }), rows.length > coming && (_jsx("div", { className: "imports-summary-actions", children: _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => void api.clearLocalSendFinished(), children: "Clear finished" }) }))] }), _jsx("ul", { className: "imports-list", children: rows.map((f) => {
                    const t = sentText(f);
                    return (_jsxs("li", { className: `import-row is-${t.tone === "now" ? "current" : t.tone}`, children: [_jsx(Icon, { name: t.tone === "bad" ? "warning" : t.tone === "ok" ? "check" : t.tone === "wait" ? "clock" : "download", size: 18 }), _jsxs("div", { className: "import-text", children: [_jsx("span", { className: "import-name", children: f.name }), _jsxs("span", { className: "import-detail", children: [f.from, " \u00B7 ", t.text] }), f.state === "arriving" && _jsx(ProgressBar, { value: f.size ? f.bytes / f.size : 0, label: `${f.name} progress` })] })] }, `${f.session}-${f.id}`));
                }) })] }));
}
