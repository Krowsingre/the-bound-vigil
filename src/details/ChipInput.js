import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from "react";
import { Icon } from "../components/Icon";
/** A list of names as chips, for authors and genres. Enter or a comma adds what's typed. */
export function ChipInput({ value, onChange, label, placeholder, disabled = false, }) {
    const [typed, setTyped] = useState("");
    const input = useRef(null);
    const add = (text) => {
        const clean = text.split(/\s+/).filter(Boolean).join(" ");
        if (clean && !value.some((v) => v.toLowerCase() === clean.toLowerCase()) && value.length < 20)
            onChange([...value, clean]);
        setTyped("");
    };
    return (_jsxs("div", { className: `tag-field${disabled ? " is-disabled" : ""}`, onClick: () => input.current?.focus(), children: [value.map((v) => (_jsxs("span", { className: "tag-chip", children: [v, !disabled && (_jsx("button", { type: "button", "aria-label": `Remove ${v}`, onClick: () => onChange(value.filter((x) => x !== v)), children: _jsx(Icon, { name: "close", size: 12 }) }))] }, v))), _jsx("input", { ref: input, value: typed, disabled: disabled, maxLength: 200, "aria-label": label, placeholder: value.length ? "Add another" : placeholder, onChange: (e) => setTyped(e.target.value), 
                // Whatever is left typed counts too, so nothing is lost by clicking Save.
                onBlur: () => typed.trim() && add(typed), onKeyDown: (e) => {
                    if ((e.key === "Enter" || e.key === ",") && typed.trim()) {
                        e.preventDefault();
                        add(typed);
                    }
                    else if (e.key === "Backspace" && !typed && value.length) {
                        onChange(value.slice(0, -1));
                    }
                } })] }));
}
