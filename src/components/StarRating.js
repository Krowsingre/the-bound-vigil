import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
const STAR = "M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z";
function Star({ fill, size }) {
    // `fill` is 0 to 1, so averages like 3.5 show a half star.
    const id = `star-${Math.round(fill * 100)}`;
    return (_jsxs("svg", { viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": true, className: "star", children: [_jsx("defs", { children: _jsxs("linearGradient", { id: id, children: [_jsx("stop", { offset: `${fill * 100}%`, stopColor: "currentColor" }), _jsx("stop", { offset: `${fill * 100}%`, stopColor: "transparent" })] }) }), _jsx("path", { d: STAR, fill: `url(#${id})`, stroke: "currentColor", strokeWidth: "1.5", strokeLinejoin: "round" })] }));
}
/** A rating in words: quarter stars as they are, averages to one place. */
export const starsText = (value) => (Number.isInteger(value) ? String(value) : Number.isInteger(value * 4) ? String(value) : value.toFixed(1));
/** Stars that show a rating, read-only. Shows nothing without one. */
export function Stars({ value, size = 14, label }) {
    if (value === null)
        return null;
    const text = label ?? `${starsText(value)} of 5 stars`;
    return (_jsx("span", { className: "stars", role: "img", "aria-label": text, title: text, children: [1, 2, 3, 4, 5].map((n) => (_jsx(Star, { size: size, fill: Math.max(0, Math.min(1, value - (n - 1))) }, n))) }));
}
const STEP = 0.25;
/**
 * Five stars to pick a rating from, in quarter stars: where the pointer is
 * across a star picks a quarter, half, three quarters or the whole of it.
 * Choosing the current rating again clears it. The arrow keys move a quarter
 * star at a time, and Delete clears.
 */
export function StarRating({ value, onChange, size = 20, }) {
    const [hover, setHover] = useState(null);
    // The choice shows at once, even where the menu holding the stars was
    // made before it (a book's ••• menu), and follows the book after that.
    const [picked, setPicked] = useState(value);
    useEffect(() => setPicked(value), [value]);
    const shown = hover ?? picked ?? 0;
    const at = (n, e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const across = Math.min(1, Math.max(0, (e.clientX - box.left) / Math.max(1, box.width)));
        return n - 1 + Math.max(STEP, Math.ceil(across / STEP) * STEP);
    };
    const pick = (rating) => {
        setPicked(rating);
        onChange(rating);
    };
    const choose = (rating) => pick(picked === rating ? null : rating);
    const step = (by) => pick(Math.min(5, Math.max(STEP, (picked ?? 0) + by)));
    return (_jsxs("span", { className: "star-rating-wrap", children: [_jsx("span", { className: "star-rating", role: "slider", tabIndex: 0, "aria-label": "Your rating", "aria-valuemin": 0, "aria-valuemax": 5, "aria-valuenow": picked ?? 0, "aria-valuetext": picked === null ? "Not rated" : `${starsText(picked)} of 5 stars`, onPointerLeave: () => setHover(null), onKeyDown: (e) => {
                    const moves = {
                        ArrowRight: () => step(STEP),
                        ArrowUp: () => step(STEP),
                        ArrowLeft: () => step(-STEP),
                        ArrowDown: () => step(-STEP),
                        Home: () => pick(STEP),
                        End: () => pick(5),
                        Delete: () => pick(null),
                        Backspace: () => pick(null),
                    };
                    if (!moves[e.key])
                        return;
                    e.preventDefault();
                    moves[e.key]();
                }, children: [1, 2, 3, 4, 5].map((n) => (_jsx("span", { className: `star-btn${n - 1 < shown ? " is-on" : ""}`, title: hover !== null ? `${starsText(hover)} stars` : picked !== null ? "Choose the same again to clear" : undefined, onPointerMove: (e) => setHover(at(n, e)), onClick: (e) => choose(at(n, e)), children: _jsx(Star, { size: size, fill: Math.max(0, Math.min(1, shown - (n - 1))) }) }, n))) }), _jsx("span", { className: "star-rating-value num", children: (hover ?? picked) !== null ? starsText((hover ?? picked)) : "" })] }));
}
