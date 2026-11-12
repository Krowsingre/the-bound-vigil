import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { isApp, isIOS } from "../api";
import { formatRate, groupVoices, primaryLang, RATE_RANGE } from "./readAloud";
import { FONTS, HIGHLIGHT_COLORS, LINE_HEIGHT_NOTCHES, LINE_HEIGHT_RANGE, PAGE_COLORS, SIZE_RANGE, zoomStep, ZOOM_RANGE, } from "./settings";
import { liningUp, onLiningUp } from "../readAlong/lineUp";
import { PauseLiningUpButton, pausedUntilText, usePause } from "../readAlong/PauseLiningUp";
function Choice({ label, value, options, onChange, wrap = false, }) {
    return (_jsxs("fieldset", { className: "choice", children: [_jsx("legend", { children: label }), _jsx("div", { className: `choice-row${wrap ? " is-wrapping" : ""}`, role: "radiogroup", "aria-label": label, children: options.map((o) => (_jsx("button", { type: "button", role: "radio", "aria-checked": value === o.value, className: value === o.value ? "is-active" : undefined, style: o.style, onClick: () => onChange(o.value), children: o.label }, String(o.value)))) })] }));
}
const THEME_OPTIONS = [
    { value: "auto", label: "Auto" },
    { value: "light", label: "Light", style: { background: PAGE_COLORS.light.background, color: PAGE_COLORS.light.text } },
    { value: "paper", label: "Paper", style: { background: PAGE_COLORS.paper.background, color: PAGE_COLORS.paper.text } },
    { value: "dark", label: "Dark", style: { background: PAGE_COLORS.dark.background, color: PAGE_COLORS.dark.text } },
    { value: "vesper", label: "Vesper", style: { background: PAGE_COLORS.vesper.background, color: PAGE_COLORS.vesper.text } },
];
function ScrollSpeeds({ settings, onChange }) {
    return (_jsxs("div", { children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Manual scroll speed" }), _jsx("input", { type: "range", min: 120, max: 1200, step: 60, value: settings.keyboardScrollSpeed, onChange: (event) => onChange({ keyboardScrollSpeed: Number(event.target.value) }) })] }), _jsxs("label", { className: "field", children: [_jsxs("span", { children: ["Auto-scroll speed ", _jsxs("output", { children: [settings.autoScrollSpeed, "%"] })] }), _jsx("input", { type: "range", "aria-label": "Auto-scroll speed", min: 1, max: 100, value: settings.autoScrollSpeed, onChange: (event) => onChange({ autoScrollSpeed: Number(event.target.value) }) })] })] }));
}
/** The Aa panel: how the book text looks. */
export function TextSettings({ settings, onChange }) {
    return (_jsxs("div", { className: "text-settings", children: [_jsx(Choice, { label: "Font", wrap: true, value: settings.font, options: FONTS.map((f) => ({
                    ...f,
                    style: { fontFamily: f.value === "lora" ? '"Lora", serif' : f.value === "georgia" ? "var(--font-serif)" : f.value === "sans" ? "var(--font-sans)" : f.value === "echolume" ? '"Echolume", sans-serif' : undefined },
                })), onChange: (font) => onChange({ font }) }), _jsxs("fieldset", { className: "choice", children: [_jsx("legend", { children: "Text size" }), _jsxs("div", { className: "size-row", children: [_jsx("button", { type: "button", className: "icon-btn", "aria-label": "Smaller text", disabled: settings.size <= SIZE_RANGE.min, onClick: () => onChange({ size: settings.size - SIZE_RANGE.step }), children: _jsx("span", { className: "size-a size-a-small", children: "A" }) }), _jsx("input", { type: "range", min: SIZE_RANGE.min, max: SIZE_RANGE.max, step: SIZE_RANGE.step, value: settings.size, "aria-label": "Text size", onChange: (e) => onChange({ size: Number(e.target.value) }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Larger text", disabled: settings.size >= SIZE_RANGE.max, onClick: () => onChange({ size: settings.size + SIZE_RANGE.step }), children: _jsx("span", { className: "size-a size-a-large", children: "A" }) }), _jsx("span", { className: "size-value", children: settings.size })] })] }), _jsxs("fieldset", { className: "choice", children: [_jsx("legend", { children: "Line spacing" }), _jsxs("div", { className: "size-row line-row", children: [_jsx("input", { type: "range", min: LINE_HEIGHT_RANGE.min, max: LINE_HEIGHT_RANGE.max, step: LINE_HEIGHT_RANGE.step, value: settings.lineHeight, list: "reader-line-notches", "aria-label": "Line spacing", onChange: (e) => onChange({ lineHeight: Math.round(Number(e.target.value) * 10) / 10 }) }), _jsx("datalist", { id: "reader-line-notches", children: LINE_HEIGHT_NOTCHES.map((n) => (_jsx("option", { value: n, label: n.toFixed(1) }, n))) }), _jsx("span", { className: "size-value", children: settings.lineHeight.toFixed(1) })] })] }), _jsx(Choice, { label: "Page width", value: settings.width, options: [
                    { value: "narrow", label: "Narrow" },
                    { value: "medium", label: "Medium" },
                    { value: "wide", label: "Wide" },
                ], onChange: (width) => onChange({ width }) }), _jsx(Choice, { label: "Moving through the book", value: settings.flow, options: [
                    { value: "paginated", label: "Turn pages" },
                    { value: "scrolled", label: "Scroll" },
                ], onChange: (flow) => onChange({ flow }) }), _jsx(ScrollSpeeds, { settings: settings, onChange: onChange }), settings.flow === "paginated" && (_jsx(Choice, { label: "Pages at a time", value: settings.textSpread, options: [
                    { value: "one", label: "One" },
                    { value: "auto", label: "Two when there's room" },
                ], onChange: (textSpread) => onChange({ textSpread }) })), _jsx(Choice, { label: "Page colour", value: settings.theme, options: THEME_OPTIONS, onChange: (theme) => onChange({ theme }) }), _jsxs("label", { className: "check-row", children: [_jsx("input", { type: "checkbox", checked: settings.justify, onChange: (e) => onChange({ justify: e.target.checked }) }), "Justify text (even right edge)"] })] }));
}
/** The zoom buttons: smaller, the size shown now (or how it fits), larger. */
export function ZoomControls({ zoom, scale, onChange, compact = false, }) {
    const label = zoom === "fit-page" ? "Fit page" : zoom === "fit-width" ? "Fit width" : `${Math.round(scale * 100)}%`;
    const next = zoom === "fit-page" ? "fit-width" : "fit-page";
    return (_jsxs("span", { className: `zoom-controls${compact ? " is-compact" : ""}`, role: "group", "aria-label": "Zoom", children: [_jsx("button", { type: "button", className: "icon-btn", "aria-label": "Zoom out (Ctrl \u2212)", title: "Zoom out (Ctrl \u2212)", disabled: scale <= ZOOM_RANGE.min + 0.001, onClick: () => onChange(zoomStep(scale, -1)), children: _jsx(Icon, { name: "minus", size: 18 }) }), _jsx("button", { type: "button", className: "zoom-value", title: next === "fit-width" ? "Fit the page's width to the screen" : "Fit the whole page on screen (Ctrl 0)", "aria-label": `${label}. ${next === "fit-width" ? "Switch to fit width" : "Switch to fit page"}`, onClick: () => onChange(next), children: label }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Zoom in (Ctrl +)", title: "Zoom in (Ctrl +)", disabled: scale >= ZOOM_RANGE.max - 0.001, onClick: () => onChange(zoomStep(scale, 1)), children: _jsx(Icon, { name: "plus", size: 18 }) })] }));
}
/** The page panel for PDFs and comics: size, one or two pages, turning or scrolling. */
export function PageSettings({ settings, scale, onChange, }) {
    return (_jsxs("div", { className: "text-settings", children: [_jsxs("fieldset", { className: "choice", children: [_jsx("legend", { children: "Size" }), _jsx(ZoomControls, { zoom: settings.pageZoom, scale: scale, onChange: (pageZoom) => onChange({ pageZoom }) })] }), _jsx(Choice, { label: "Fit", value: typeof settings.pageZoom === "number" ? "set" : settings.pageZoom, options: [
                    { value: "fit-page", label: "Whole page" },
                    { value: "fit-width", label: "Page width" },
                    { value: "set", label: "Set size" },
                ], onChange: (fit) => onChange({ pageZoom: fit === "set" ? Math.round(scale * 100) / 100 : fit }) }), _jsx(Choice, { label: "Pages at a time", value: settings.pageSpread, options: [
                    { value: "one", label: "One" },
                    { value: "two", label: "Two" },
                    { value: "auto", label: "Two when wide" },
                ], onChange: (pageSpread) => onChange({ pageSpread }) }), settings.pageSpread !== "one" && settings.pageFlow === "paginated" && (_jsx("p", { className: "settings-hint", children: "The first page (the cover) shows on its own." })), settings.pageSpread !== "one" && settings.pageFlow === "scrolled" && (_jsx("p", { className: "settings-hint", children: "Scrolling shows one page under another." })), _jsx(Choice, { label: "Moving through the book", value: settings.pageFlow, options: [
                    { value: "paginated", label: "Turn pages" },
                    { value: "scrolled", label: "Scroll" },
                ], onChange: (pageFlow) => onChange({ pageFlow }) }), _jsx(ScrollSpeeds, { settings: settings, onChange: onChange }), _jsx(Choice, { label: "Colour around the pages", value: settings.theme, options: THEME_OPTIONS, onChange: (theme) => onChange({ theme }) })] }));
}
/** The read aloud player: play and pause, sentence by sentence, voice and speed. */
export function ReadAloudPlayer({ readAloud: ra, lang, settings, onChange, }) {
    if (ra.unavailable)
        return _jsx("p", { className: "read-aloud-note", children: ra.unavailable });
    const playing = ra.status === "playing";
    const stopped = ra.status === "stopped";
    const noVoices = ra.voices.length === 0;
    const { matching, other } = groupVoices(ra.voices, lang);
    const key = primaryLang(lang);
    const chosen = settings.voices[key] ?? "";
    const option = (v) => (_jsxs("option", { value: v.voiceURI, children: [v.name, v.lang ? ` (${v.lang})` : ""] }, v.voiceURI));
    return (_jsxs("div", { className: "read-aloud", children: [_jsxs("div", { className: "read-aloud-controls", role: "group", "aria-label": "Read aloud", children: [_jsx("button", { type: "button", className: "icon-btn", "aria-label": "Previous sentence", title: "Previous sentence", disabled: stopped, onClick: ra.prevSentence, children: _jsx(Icon, { name: "skipBack", size: 20 }) }), _jsx("button", { type: "button", className: "read-aloud-play", "aria-label": playing ? "Pause (R)" : "Read aloud (R)", title: playing ? "Pause (R)" : "Read aloud (R)", onClick: ra.toggle, children: _jsx(Icon, { name: playing ? "pause" : "play", size: 22, filled: !playing }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Next sentence", title: "Next sentence", disabled: stopped, onClick: ra.nextSentence, children: _jsx(Icon, { name: "skipForward", size: 20 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Stop", title: "Stop", disabled: stopped, onClick: ra.stop, children: _jsx(Icon, { name: "stop", size: 18 }) })] }), _jsx("p", { className: "read-aloud-note", role: "status", children: ra.error ??
                    (noVoices && stopped
                        ? isApp
                            ? "No voices were listed yet. If nothing is heard, add voices in Windows Settings › Time & language › Speech."
                            : "Uses this device's own voice. Others can be chosen here once the device lists them."
                        : playing
                            ? "Reading. The pages turn as it goes."
                            : ra.status === "paused"
                                ? "Paused."
                                : "Starts from the first sentence on this page.") }), _jsxs("fieldset", { className: "choice", children: [_jsx("legend", { children: "Voice" }), _jsxs("select", { className: "settings-select read-aloud-voice", "aria-label": "Voice", value: chosen, disabled: noVoices, onChange: (e) => {
                            const voices = { ...settings.voices };
                            if (e.target.value)
                                voices[key] = e.target.value;
                            else
                                delete voices[key];
                            onChange({ voices });
                        }, children: [_jsx("option", { value: "", children: ra.voice && !chosen ? `Automatic: ${ra.voice.name}` : "Automatic" }), matching.length > 0 && _jsx("optgroup", { label: "For this book's language", children: matching.map(option) }), other.length > 0 && (matching.length > 0 ? _jsx("optgroup", { label: "Other languages", children: other.map(option) }) : other.map(option))] })] }), _jsxs("fieldset", { className: "choice", children: [_jsx("legend", { children: "Speed" }), _jsxs("div", { className: "size-row", children: [_jsx("input", { type: "range", min: RATE_RANGE.min, max: RATE_RANGE.max, step: RATE_RANGE.step, value: settings.rate, "aria-label": "Speed", "aria-valuetext": formatRate(settings.rate), onChange: (e) => onChange({ rate: Math.round(Number(e.target.value) * 10) / 10 }) }), _jsx("button", { type: "button", className: "read-aloud-rate", title: "Back to normal speed", onClick: () => onChange({ rate: 1 }), children: formatRate(settings.rate) })] })] })] }));
}
/** Keeps a floating toolbar inside the window, above (or below) a rectangle. */
function useFloating(rect) {
    const ref = useRef(null);
    const [pos, setPos] = useState(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el)
            return;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const left = Math.min(window.innerWidth - w - 8, Math.max(8, rect.left + rect.width / 2 - w / 2));
        const above = rect.top - h - 10;
        const top = above > 60 ? above : Math.min(window.innerHeight - h - 8, rect.bottom + 10);
        setPos({ left, top });
    }, [rect]);
    return { ref, style: pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" } };
}
/** Shown over selected words: four colours, a note, copy, and looking the words up. */
export function SelectionToolbar({ rect, activeColor, hasNote, onColor, onNote, onCopy, onDelete, onDefine, onSearch, onTranslate, }) {
    const { ref, style } = useFloating(rect);
    return (_jsxs("div", { ref: ref, className: "selection-toolbar", style: style, role: "toolbar", "aria-label": "Highlight", onPointerDown: (e) => e.preventDefault(), children: [HIGHLIGHT_COLORS.map((c) => (_jsx("button", { type: "button", className: `swatch${activeColor === c.value ? " is-active" : ""}`, style: { ["--swatch"]: c.hex }, "aria-label": `Highlight ${c.label}`, title: `Highlight ${c.label}`, onClick: () => onColor(c.value) }, c.value))), _jsx("span", { className: "selection-rule", "aria-hidden": true }), _jsxs("button", { type: "button", className: "selection-btn", onClick: onNote, children: [_jsx(Icon, { name: "note", size: 16 }), " ", _jsx("span", { className: "selection-label", children: hasNote ? "Edit note" : "Add a note" })] }), _jsx("button", { type: "button", className: "icon-btn icon-btn-s", "aria-label": "Copy", title: "Copy", onClick: onCopy, children: _jsx(Icon, { name: "copy", size: 16 }) }), onDefine && (_jsx("button", { type: "button", className: "icon-btn icon-btn-s", "aria-label": "Define", title: "Define", onClick: onDefine, children: _jsx(Icon, { name: "bookOpen", size: 16 }) })), onSearch && (_jsx("button", { type: "button", className: "icon-btn icon-btn-s", "aria-label": "Search the web", title: "Search the web", onClick: onSearch, children: _jsx(Icon, { name: "search", size: 16 }) })), onTranslate && (_jsx("button", { type: "button", className: "icon-btn icon-btn-s", "aria-label": "Translate", title: "Translate", onClick: onTranslate, children: _jsx(Icon, { name: "translate", size: 16 }) })), onDelete && (_jsx("button", { type: "button", className: "icon-btn icon-btn-s", "aria-label": "Remove highlight", title: "Remove highlight", onClick: onDelete, children: _jsx(Icon, { name: "trash", size: 16 }) }))] }));
}
/** Writing or editing the note attached to a highlight. */
export function NoteDialog({ excerpt, initial, onSave, onCancel, }) {
    const [text, setText] = useState(initial);
    const area = useRef(null);
    useEffect(() => {
        area.current?.focus();
        area.current?.setSelectionRange(text.length, text.length);
        // Focus once, when the dialog opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onCancel(), children: _jsxs("form", { className: "dialog note-dialog", role: "dialog", "aria-label": initial ? "Edit note" : "Add a note", onSubmit: (e) => {
                e.preventDefault();
                onSave(text);
            }, onKeyDown: (e) => {
                if (e.key === "Escape")
                    onCancel();
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                    onSave(text);
            }, children: [_jsx("h2", { children: initial ? "Edit note" : "Add a note" }), _jsx("blockquote", { children: excerpt }), _jsx("textarea", { ref: area, value: text, onChange: (e) => setText(e.target.value), rows: 6, placeholder: "Your thoughts\u2026" }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onCancel, children: "Cancel" }), _jsx("button", { type: "submit", className: "btn btn-primary", children: "Save note" })] })] }) }));
}
/** Listening along with the linked audiobook, and how far the pair is lined up. */
export function ListenAlongPanel({ readAlong, ebookId }) {
    const [work, setWork] = useState(liningUp());
    const { paused, until } = usePause();
    useEffect(() => onLiningUp(setWork), []);
    const audiobookId = readAlong.audiobookId;
    const ours = work && work.ebookId === ebookId && work.audiobookId === audiobookId ? work : null;
    const lineUp = readAlong.lineUp;
    const waiting = readAlong.linesUp && !lineUp?.done && !lineUp?.failed;
    const percent = Math.floor((ours && ours.stage === "listening" ? ours.fraction : (lineUp?.fraction ?? 0)) * 100);
    const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`;
    if (readAlong.manual)
        return (_jsxs("div", { className: "read-aloud listen-along", children: [_jsxs("button", { type: "button", className: "btn btn-primary", onClick: readAlong.toggle, children: [_jsx(Icon, { name: readAlong.playing ? "pause" : "play", size: 16 }), " ", readAlong.playing ? "Pause the audiobook" : "Play the audiobook"] }), _jsx("p", { className: "read-aloud-note", role: "status", children: "This is a document, so TBV can't follow the narrator through it. Turn the pages yourself as it plays." })] }));
    return (_jsxs("div", { className: "read-aloud listen-along", children: [_jsxs("button", { type: "button", className: "btn btn-primary", disabled: waiting, onClick: readAlong.toggle, children: [_jsx(Icon, { name: readAlong.following ? "pause" : "headphones", size: 16 }), " ", readAlong.following ? "Stop following" : "Play and follow"] }), !waiting ? (_jsx("p", { className: "read-aloud-note", role: "status", children: lineUp?.failed
                    ? `TBV couldn't line this book up with the audiobook word by word (${lineUp.failed}), so it follows by chapter. The highlight can be a sentence or two out.`
                    : lineUp?.done
                        ? "Follows the narrator word by word."
                        : "Follows by chapter, so the highlight can be a sentence or two out." })) : (_jsxs("div", { className: "listen-along-timing", role: "status", children: [_jsxs("p", { className: "read-aloud-note", children: [_jsxs("strong", { children: ["Converging\u2026 ", percent, "%"] }), ours?.stage === "model" && ours.modelTotal ? ` Getting the speech model: ${mb(ours.modelLoaded)} of ${mb(ours.modelTotal)}.` : ""] }), _jsxs("p", { className: "read-aloud-note", children: [paused
                                ? `Confluence is paused on this device ${pausedUntilText(until)}.`
                                : ours?.stage === "cooling"
                                    ? "Confluence is paused while the phone cools down. It carries on by itself."
                                    : ours
                                        ? "TBV is listening through the audiobook and matching every word to the book, in the background."
                                        : isApp
                                            ? isIOS
                                                ? "TBV lines up every word in the background on a computer with TBV open, or on this phone if you turn it on in Preferences › Reading › Read-along."
                                                : "TBV lines up every word in the background, one pair at a time, on each device that has both the book and the audiobook downloaded."
                                            : "TBV lines up every word in the app on your computer or phone.", " ", "Until it's done you can read the book or listen to the audiobook, but not both together."] }), isApp && _jsx(PauseLiningUpButton, { pauseLabel: "Pause Confluence", resumeLabel: "Carry on with Confluence" })] }))] }));
}
const PART_LABEL = { noun: "noun", verb: "verb", adjective: "adjective", adverb: "adverb" };
/** What the selected word means, from the offline dictionary (Windows and Android). */
export function DefineCard({ rect, text, definitions, onSearch, onClose, }) {
    const { ref, style } = useFloating(rect);
    useEffect(() => {
        const away = (e) => {
            if (!ref.current?.contains(e.target))
                onClose();
        };
        const key = (e) => e.key === "Escape" && onClose();
        document.addEventListener("pointerdown", away);
        document.addEventListener("keydown", key);
        return () => {
            document.removeEventListener("pointerdown", away);
            document.removeEventListener("keydown", key);
        };
    }, [ref, onClose]);
    return (_jsxs("div", { ref: ref, className: "define-card", style: style, role: "dialog", "aria-label": `Meaning of ${text}`, children: [definitions.length === 0 ? (_jsxs("p", { className: "define-none", children: ["No meaning found for ", _jsx("strong", { children: text }), "."] })) : (_jsx("div", { className: "define-entries", children: definitions.map((d) => {
                    const parts = [...new Set(d.senses.map((s) => s.part))];
                    return (_jsxs("section", { className: "define-entry", children: [_jsx("h3", { className: "define-word", children: d.word }), parts.map((part) => (_jsxs("div", { className: "define-part", children: [_jsx("p", { className: "define-part-name", children: PART_LABEL[part] }), _jsx("ol", { children: d.senses
                                            .filter((s) => s.part === part)
                                            .map((s, i) => (_jsxs("li", { children: [s.definition, s.example && _jsxs("span", { className: "define-example", children: [" \u201C", s.example, "\u201D"] })] }, i))) })] }, part)))] }, d.word));
                }) })), _jsxs("div", { className: "define-foot", children: [_jsx("span", { className: "define-source", children: "WordNet 3.1, Princeton University" }), _jsxs("button", { type: "button", className: "selection-btn", onClick: onSearch, children: [_jsx(Icon, { name: "search", size: 14 }), " Search the web"] })] })] }));
}
