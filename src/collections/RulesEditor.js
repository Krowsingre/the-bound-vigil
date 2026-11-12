import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Settings for a collection that fills itself: "Include books that match
// all of these rules", then one row per rule, with how many books match.
import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { FIELDS, fieldInfo, MAX_RULES, newRule, usable, valueKind } from "./rules";
export function RulesEditor({ rules, onChange }) {
    const [matching, setMatching] = useState(null);
    // How many books match, as the rules are written.
    const key = JSON.stringify(rules);
    useEffect(() => {
        let current = true;
        const t = window.setTimeout(() => {
            const ready = { ...rules, rules: rules.rules.filter(usable) };
            if (!ready.rules.length)
                return current && setMatching(null);
            void api.countRuleMatches(ready).then((n) => current && setMatching(n), () => current && setMatching(null));
        }, 250);
        return () => {
            current = false;
            window.clearTimeout(t);
        };
        // `key` stands in for `rules`, which is a new object on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    const change = (i, edit) => {
        const next = rules.rules.map((r, n) => {
            if (n !== i)
                return r;
            if (edit.field && edit.field !== r.field)
                return newRule(edit.field);
            const changed = { ...r, ...edit };
            // A test that takes no value, or a new kind of value, starts fresh.
            if (edit.op && valueKind(changed) !== valueKind(r))
                changed.value = newRule(r.field).value;
            return changed;
        });
        onChange({ ...rules, rules: next });
    };
    return (_jsxs("div", { className: "rules-editor", children: [_jsxs("p", { className: "rules-match", children: ["Include books that match", " ", _jsxs("select", { "aria-label": "Match", value: rules.any ? "any" : "all", onChange: (e) => onChange({ ...rules, any: e.target.value === "any" }), children: [_jsx("option", { value: "all", children: "all" }), _jsx("option", { value: "any", children: "any" })] }), " ", "of these rules"] }), _jsx("ul", { className: "rules-list", children: rules.rules.map((rule, i) => {
                    const info = fieldInfo(rule.field);
                    const kind = valueKind(rule);
                    return (_jsxs("li", { className: "rule-row", children: [_jsx("select", { "aria-label": "Detail", value: rule.field, onChange: (e) => change(i, { field: e.target.value }), children: FIELDS.map((f) => (_jsx("option", { value: f.field, children: f.label }, f.field))) }), _jsx("select", { "aria-label": "Test", value: rule.op, onChange: (e) => change(i, { op: e.target.value }), children: info.ops.map((o) => (_jsx("option", { value: o.op, children: o.label }, o.op))) }), kind === "choice" && (_jsx("select", { "aria-label": "Value", value: rule.value, onChange: (e) => change(i, { value: e.target.value }), children: info.choices.map((c) => (_jsx("option", { value: c.value, children: c.label }, c.value))) })), kind === "text" && (_jsx("input", { "aria-label": "Value", value: rule.value, maxLength: 200, placeholder: rule.field === "author" ? "Le Fanu" : rule.field === "language" ? "en" : "", onChange: (e) => change(i, { value: e.target.value }) })), kind === "number" && (_jsxs("span", { className: "rule-number", children: [_jsx("input", { "aria-label": "Value", inputMode: "numeric", value: rule.value, onChange: (e) => change(i, { value: e.target.value.replace(/\D/g, "").slice(0, 5) }) }), rule.op === "olderThanDays" ? "days ago" : info.unit] })), kind === "none" && _jsx("span", {}), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Remove this rule", title: "Remove this rule", disabled: rules.rules.length === 1, onClick: () => onChange({ ...rules, rules: rules.rules.filter((_, n) => n !== i) }), children: _jsx(Icon, { name: "close", size: 16 }) })] }, i));
                }) }), _jsxs("div", { className: "rules-foot", children: [_jsx("button", { type: "button", className: "link-btn", disabled: rules.rules.length >= MAX_RULES, onClick: () => onChange({ ...rules, rules: [...rules.rules, newRule()] }), children: "+ Add a rule" }), _jsx("small", { className: "muted", "aria-live": "polite", children: matching === null ? "Finish a rule to see what matches." : `${matching} ${matching === 1 ? "book matches" : "books match"} now. It keeps up as your books change.` })] })] }));
}
