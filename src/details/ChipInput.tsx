import { useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { useSuggestList } from "./Suggest";

/** A list of names as chips, for authors and genres. Enter or a comma adds
 *  what's typed; Tab or Enter takes a name the library already has. */
export function ChipInput({
  value,
  onChange,
  label,
  placeholder,
  disabled = false,
  suggestions = [],
}: {
  value: string[];
  onChange: (value: string[]) => void;
  label: string;
  placeholder: string;
  disabled?: boolean;
  suggestions?: string[];
}) {
  const [typed, setTyped] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const add = (text: string) => {
    const clean = text.split(/\s+/).filter(Boolean).join(" ");
    // A name the library has keeps the spelling it already has.
    const kept = suggestions.find((s) => s.toLowerCase() === clean.toLowerCase()) ?? clean;
    if (kept && !value.some((v) => v.toLowerCase() === kept.toLowerCase()) && value.length < 20) onChange([...value, kept]);
    setTyped("");
  };
  const suggest = useSuggestList(suggestions, typed, value, add);
  return (
    <div className="suggest">
    <div className={`tag-field${disabled ? " is-disabled" : ""}`} onClick={() => input.current?.focus()}>
      {value.map((v) => (
        <span key={v} className="tag-chip">
          {v}
          {!disabled && (
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
              <Icon name="close" size={12} />
            </button>
          )}
        </span>
      ))}
      <input
        ref={input}
        value={typed}
        disabled={disabled}
        maxLength={200}
        aria-label={label}
        placeholder={value.length ? "Add another" : placeholder}
        {...suggest.inputProps}
        onChange={(e) => {
          setTyped(e.target.value);
          suggest.reopen();
        }}
        // Whatever is left typed counts too, so nothing is lost by clicking Save.
        onBlur={() => {
          suggest.close();
          if (typed.trim()) add(typed);
        }}
        onKeyDown={(e) => {
          if (suggest.onKeyDown(e)) return;
          if ((e.key === "Enter" || e.key === ",") && typed.trim()) {
            e.preventDefault();
            add(typed);
          } else if (e.key === "Backspace" && !typed && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
      />
    </div>
    {suggest.list}
    </div>
  );
}
