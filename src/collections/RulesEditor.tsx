// Settings for a collection that fills itself: "Include books that match
// all of these rules", then one row per rule, with how many books match.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { CollectionRules, Rule, RuleField, RuleOp } from "../api/types";
import { Icon } from "../components/Icon";
import { FIELDS, fieldInfo, MAX_RULES, newRule, usable, valueKind } from "./rules";

export function RulesEditor({ rules, onChange }: { rules: CollectionRules; onChange: (rules: CollectionRules) => void }) {
  const [matching, setMatching] = useState<number | null>(null);

  // How many books match, as the rules are written.
  const key = JSON.stringify(rules);
  useEffect(() => {
    let current = true;
    const t = window.setTimeout(() => {
      const ready = { ...rules, rules: rules.rules.filter(usable) };
      if (!ready.rules.length) return current && setMatching(null);
      void api.countRuleMatches(ready).then(
        (n) => current && setMatching(n),
        () => current && setMatching(null),
      );
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(t);
    };
    // `key` stands in for `rules`, which is a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const change = (i: number, edit: Partial<Rule>) => {
    const next = rules.rules.map((r, n) => {
      if (n !== i) return r;
      if (edit.field && edit.field !== r.field) return newRule(edit.field);
      const changed = { ...r, ...edit };
      // A test that takes no value, or a new kind of value, starts fresh.
      if (edit.op && valueKind(changed) !== valueKind(r)) changed.value = newRule(r.field).value;
      return changed;
    });
    onChange({ ...rules, rules: next });
  };

  return (
    <div className="rules-editor">
      <p className="rules-match">
        Include books that match{" "}
        <select aria-label="Match" value={rules.any ? "any" : "all"} onChange={(e) => onChange({ ...rules, any: e.target.value === "any" })}>
          <option value="all">all</option>
          <option value="any">any</option>
        </select>{" "}
        of these rules
      </p>
      <ul className="rules-list">
        {rules.rules.map((rule, i) => {
          const info = fieldInfo(rule.field);
          const kind = valueKind(rule);
          return (
            <li key={i} className="rule-row">
              <select aria-label="Detail" value={rule.field} onChange={(e) => change(i, { field: e.target.value as RuleField })}>
                {FIELDS.map((f) => (
                  <option key={f.field} value={f.field}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select aria-label="Test" value={rule.op} onChange={(e) => change(i, { op: e.target.value as RuleOp })}>
                {info.ops.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </select>
              {kind === "choice" && (
                <select aria-label="Value" value={rule.value} onChange={(e) => change(i, { value: e.target.value })}>
                  {info.choices!.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              )}
              {kind === "text" && (
                <input
                  aria-label="Value"
                  value={rule.value}
                  maxLength={200}
                  placeholder={rule.field === "author" ? "Le Fanu" : rule.field === "language" ? "en" : ""}
                  onChange={(e) => change(i, { value: e.target.value })}
                />
              )}
              {kind === "number" && (
                <span className="rule-number">
                  <input
                    aria-label="Value"
                    inputMode="numeric"
                    value={rule.value}
                    onChange={(e) => change(i, { value: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                  />
                  {rule.op === "olderThanDays" ? "days ago" : info.unit}
                </span>
              )}
              {kind === "none" && <span />}
              <button
                type="button"
                className="icon-btn"
                aria-label="Remove this rule"
                title="Remove this rule"
                disabled={rules.rules.length === 1}
                onClick={() => onChange({ ...rules, rules: rules.rules.filter((_, n) => n !== i) })}
              >
                <Icon name="close" size={16} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="rules-foot">
        <button
          type="button"
          className="link-btn"
          disabled={rules.rules.length >= MAX_RULES}
          onClick={() => onChange({ ...rules, rules: [...rules.rules, newRule()] })}
        >
          + Add a rule
        </button>
        <small className="muted" aria-live="polite">
          {matching === null ? "Finish a rule to see what matches." : `${matching} ${matching === 1 ? "book matches" : "books match"} now. It keeps up as your books change.`}
        </small>
      </div>
    </div>
  );
}
