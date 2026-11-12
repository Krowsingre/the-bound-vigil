import { jsx as _jsx } from "react/jsx-runtime";
export function AddOrReplace({ mode, onChange, label }) {
    return (_jsx("div", { className: "segmented add-or-replace", role: "radiogroup", "aria-label": label, children: [
            ["add", "Add to them"],
            ["replace", "Replace them"],
        ].map(([m, text]) => (_jsx("button", { type: "button", role: "radio", "aria-checked": mode === m, onClick: () => onChange(m), children: text }, m))) }));
}
/** `names` added to `had`, each once, keeping the spelling already there. */
export function joined(had, names) {
    const out = [...had];
    for (const n of names)
        if (!out.some((x) => x.toLowerCase() === n.toLowerCase()))
            out.push(n);
    return out;
}
