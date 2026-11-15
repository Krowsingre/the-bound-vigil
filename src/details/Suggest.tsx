// Finishing what's typed from what the library already has: series, authors,
// genres, narrators, publishers and languages. The list comes from the books
// themselves, not from anything remembered about typing. Tab or Enter takes
// the highlighted one; the arrow keys move; Escape closes the list.

import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { api } from "../api";
import type { DetailFieldName } from "../api/types";
import { bestMatches } from "../lib/details";

/** What the library has for a field, loaded once while the editor is open. */
export function useSuggestions(field: DetailFieldName | null): string[] {
  const [all, setAll] = useState<string[]>([]);
  useEffect(() => {
    if (!field) return;
    let current = true;
    api.detailSuggestions(field).then(
      (names) => current && setAll(names),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [field]);
  return all;
}

/** The list's state and keys, for any input that suggests. */
export function useSuggestList(all: string[], typed: string, taken: string[], accept: (name: string) => void) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = open ? bestMatches(all, typed, taken) : [];
  const listId = useId();
  useEffect(() => setActive(0), [typed]);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (e.nativeEvent.isComposing || !matches.length) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + step + matches.length) % matches.length);
      return true;
    }
    if ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter") {
      e.preventDefault();
      accept(matches[Math.min(active, matches.length - 1)]);
      return true;
    }
    if (e.key === "Escape") {
      // Closes the list, not the dialog.
      e.stopPropagation();
      setOpen(false);
      return true;
    }
    return false;
  };
  const list: ReactNode = matches.length ? (
    <ul className="suggest-list" role="listbox" id={listId}>
      {matches.map((name, i) => (
        <li
          key={name}
          role="option"
          aria-selected={i === active}
          className={i === active ? "is-active" : undefined}
          // Keeps the input focused, so the choice lands in it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => accept(name)}
        >
          {name}
        </li>
      ))}
    </ul>
  ) : null;
  return {
    list,
    onKeyDown,
    inputProps: {
      autoComplete: "off",
      role: "combobox",
      "aria-autocomplete": "list" as const,
      "aria-expanded": matches.length > 0,
      "aria-controls": matches.length ? listId : undefined,
      onFocus: () => setOpen(true),
      onBlur: () => setOpen(false),
    },
    reopen: () => setOpen(true),
    close: () => setOpen(false),
  };
}

/** A text box that suggests from `all` as you type. */
export function SuggestInput({
  value,
  onChange,
  all,
  id,
  placeholder,
  label,
  className,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  all: string[];
  id?: string;
  placeholder?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  const suggest = useSuggestList(all, value, [], (name) => {
    onChange(name);
    suggest.close();
  });
  return (
    <div className={`suggest${className ? ` ${className}` : ""}`}>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
        {...suggest.inputProps}
        onChange={(e) => {
          onChange(e.target.value);
          suggest.reopen();
        }}
        onKeyDown={(e) => suggest.onKeyDown(e)}
      />
      {suggest.list}
    </div>
  );
}
