import { useRef, useState } from "react";
import { Icon } from "../components/Icon";

/** A list of names as chips, for authors and genres. Enter or a comma adds what's typed. */
export function ChipInput({
  value,
  onChange,
  label,
  placeholder,
  disabled = false,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  label: string;
  placeholder: string;
  disabled?: boolean;
}) {
  const [typed, setTyped] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const add = (text: string) => {
    const clean = text.split(/\s+/).filter(Boolean).join(" ");
    if (clean && !value.some((v) => v.toLowerCase() === clean.toLowerCase()) && value.length < 20) onChange([...value, clean]);
    setTyped("");
  };
  return (
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
        onChange={(e) => setTyped(e.target.value)}
        // Whatever is left typed counts too, so nothing is lost by clicking Save.
        onBlur={() => typed.trim() && add(typed)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === ",") && typed.trim()) {
            e.preventDefault();
            add(typed);
          } else if (e.key === "Backspace" && !typed && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
      />
    </div>
  );
}
