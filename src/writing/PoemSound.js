import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// A poem's sound, above the poem in the editor: a recording or a song made
// from it, and a web page where it can be heard. The plain EPUB and the
// Apple edition carry the sound itself; the Kindle and other store editions
// get the link, and the paperback a QR code of it.
import { useEffect, useRef, useState } from "react";
import { api, isWeb } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { webLink } from "./pages";
const ACCEPT = ".mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg,audio/flac";
const MIME = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac" };
export function PoemSound({ sound, onChange }) {
    const toast = useToast();
    const picker = useRef(null);
    const [busy, setBusy] = useState(false);
    const [url, setUrl] = useState(null);
    const [missing, setMissing] = useState(false);
    const [link, setLink] = useState(sound?.link ?? "");
    useEffect(() => setLink(sound?.link ?? ""), [sound?.link]);
    // The sound to play here, when this device has it.
    const file = sound?.file ?? null;
    useEffect(() => {
        setUrl(null);
        setMissing(false);
        if (!file)
            return;
        let made = null;
        let current = true;
        void api.writingSound(file).then((bytes) => {
            if (!current)
                return;
            if (!bytes)
                return setMissing(true);
            made = URL.createObjectURL(new Blob([bytes], { type: MIME[file.split(".").pop() ?? ""] ?? "audio/mpeg" }));
            setUrl(made);
        }, () => current && setMissing(true));
        return () => {
            current = false;
            if (made)
                URL.revokeObjectURL(made);
        };
    }, [file]);
    const add = async (picked) => {
        if (!picked)
            return;
        setBusy(true);
        try {
            const kept = await api.keepWritingSound(picked.name, new Uint8Array(await picked.arrayBuffer()));
            await onChange({ file: kept.file, name: picked.name, link: sound?.link ?? null });
        }
        catch (e) {
            toast(String(e).replace(/^Error: /, ""));
        }
        finally {
            setBusy(false);
            if (picker.current)
                picker.current.value = "";
        }
    };
    const saveLink = () => {
        const text = link.trim();
        const next = webLink(text);
        if (text && !next)
            return toast("That isn't a web address. Use one that starts with https://.");
        if (next === (sound?.link ?? null))
            return;
        void onChange(sound?.file || next ? { file: sound?.file ?? null, name: sound?.name ?? "", link: next } : null);
    };
    return (_jsxs("section", { className: "poem-sound-bar", "aria-label": "The poem's sound", children: [_jsxs("div", { className: "poem-sound-row", children: [_jsx(Icon, { name: "headphones", size: 18, className: "poem-sound-icon" }), file ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "poem-sound-what", children: [_jsx("strong", { title: sound?.name, children: sound?.name || "The poem's sound" }), url ? (_jsx("audio", { controls: true, src: url, preload: "metadata" })) : (_jsx("span", { className: "muted", children: missing ? "On another device. It comes here when your devices sync." : "Loading…" }))] }), !isWeb && (_jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: busy, onClick: () => picker.current?.click(), children: "Replace\u2026" })), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: busy, onClick: () => void onChange(sound?.link ? { file: null, name: "", link: sound.link } : null), children: "Remove" })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "poem-sound-what", children: [_jsx("strong", { children: "Add a sound to this poem" }), _jsx("span", { className: "muted", children: "A reading or a song of it. It plays inside the EPUB and the Apple edition." })] }), !isWeb && (_jsxs("button", { type: "button", className: "btn btn-small", disabled: busy, onClick: () => picker.current?.click(), children: [_jsx(Icon, { name: "plus", size: 14 }), " ", busy ? "Adding…" : "Add sound…"] }))] }))] }), _jsxs("label", { className: "field poem-sound-link", children: [_jsx("span", { children: "Where to hear it online, for Kindle and the paperback's QR code" }), _jsx("input", { type: "url", inputMode: "url", value: link, placeholder: "https://", onChange: (e) => setLink(e.target.value), onBlur: saveLink, onKeyDown: (e) => e.key === "Enter" && e.currentTarget.blur() })] }), _jsx("input", { ref: picker, type: "file", accept: ACCEPT, hidden: true, onChange: (e) => void add(e.target.files?.[0]) })] }));
}
