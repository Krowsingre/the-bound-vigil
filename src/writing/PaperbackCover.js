import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// The paperback cover maker: back, spine and front together, at the size the
// printer asks for, with the trim, spine and safe area shown while it's made.
import { AuthorLabel } from "./AuthorInfo";
import { useEffect, useRef, useState } from "react";
import { api, isWeb } from "../api";
import { useToast } from "../components/Toast";
import { BACKGROUNDS, COVER_FONTS } from "./CoverMaker";
import { CanvaLink } from "./CanvaLink";
import { FormattedText } from "./FormattedText";
import { imageMime } from "./fonts";
import { estimatePages } from "./printBook";
import { TRIMS } from "./printSettings";
import { bookFileName } from "./txt";
import { dpiFor, drawWrap, jpegPdf, PAPERS, SPINE_TEXT_PAGES, wrapFor } from "./paperbackWrap";
/** How many pages the book's PDF came to when it was last made, kept for the cover. */
export const pagesKey = (projectId) => `tbv.print.pages.${projectId}`;
const remembered = (projectId) => {
    try {
        const n = Number(localStorage.getItem(pagesKey(projectId)));
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    catch {
        return null;
    }
};
export function PaperbackCover({ project, trim: startTrim, onClose }) {
    const toast = useToast();
    const [trim, setTrim] = useState(startTrim);
    const lastPages = remembered(project.id);
    const [pages, setPages] = useState(() => lastPages ?? estimatePages(project.words, startTrim));
    const [printer, setPrinter] = useState("kdp");
    const [paper, setPaper] = useState("cream");
    const [guides, setGuides] = useState(true);
    const [design, setDesign] = useState({
        title: project.title,
        author: project.author ?? "",
        background: 0,
        font: "Lora",
        front: null,
        frontPicture: null,
        blurb: project.description ?? "",
        bio: "",
        photo: null,
        barcodeBox: true,
    });
    const [ownCover, setOwnCover] = useState(null);
    const [frontDpi, setFrontDpi] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const canvas = useRef(null);
    const photoPick = useRef(null);
    const picturePick = useRef(null);
    const set = (change) => setDesign((d) => ({ ...d, ...change }));
    // The book's own cover, for the front.
    useEffect(() => {
        if (!project.cover)
            return;
        let url = null;
        let gone = false;
        void api
            .writingCover(project.id)
            .then((bytes) => {
            const mime = bytes.length ? imageMime(bytes) : null;
            if (!mime || gone)
                return;
            url = URL.createObjectURL(new Blob([bytes], { type: mime }));
            setOwnCover(url);
            setDesign((d) => ({ ...d, front: url }));
        })
            .catch(() => undefined);
        return () => {
            gone = true;
            if (url)
                URL.revokeObjectURL(url);
        };
    }, [project.id, project.cover]);
    const usable = PAPERS.filter((p) => p.printers.includes(printer));
    const wrap = wrapFor(trim, pages, printer, usable.some((p) => p.value === paper) ? paper : "cream");
    // The preview is drawn small; the saved file at full size.
    useEffect(() => {
        const c = canvas.current;
        if (!c)
            return;
        let stale = false;
        const small = document.createElement("canvas");
        void drawWrap(small, design, wrap, 60, guides).then(({ frontDpi }) => {
            if (stale)
                return;
            c.width = small.width;
            c.height = small.height;
            c.getContext("2d").drawImage(small, 0, 0);
            setFrontDpi(frontDpi === null ? null : Math.round((frontDpi * 300) / 60));
        });
        return () => void (stale = true);
    }, [design, guides, trim, pages, printer, paper]);
    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            const fileName = bookFileName(`${project.title} (paperback cover)`, "pdf");
            const path = isWeb ? null : await api.pickExportPath(fileName, "pdf");
            if (!isWeb && !path)
                return;
            const dpi = dpiFor(wrap);
            const full = document.createElement("canvas");
            await drawWrap(full, design, wrap, dpi, false);
            const blob = await new Promise((resolve) => full.toBlob(resolve, "image/jpeg", 0.95));
            if (!blob)
                throw new Error("The cover couldn't be drawn.");
            const pdf = jpegPdf(new Uint8Array(await blob.arrayBuffer()), { width: full.width, height: full.height }, { width: wrap.width, height: wrap.height });
            await api.saveExportFile(pdf, fileName, path);
            toast(isWeb ? `${fileName} has been downloaded.` : `${fileName} has been saved.`);
            onClose();
        }
        catch (e) {
            setError(String(e).replace(/^Error: /, ""));
        }
        finally {
            setBusy(false);
        }
    };
    /** The cover made in Canva, as the PDF the printer takes, at the cover's exact size. */
    const saveFromCanva = async (jpeg) => {
        const fileName = bookFileName(`${project.title} (paperback cover)`, "pdf");
        const path = isWeb ? null : await api.pickExportPath(fileName, "pdf");
        if (!isWeb && !path)
            return;
        const picture = await createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }));
        const pixels = { width: picture.width, height: picture.height };
        picture.close();
        // A design that's been resized in Canva no longer fits the printer's size.
        if (Math.abs(pixels.width / pixels.height - wrap.width / wrap.height) > 0.01)
            throw new Error(`The Canva design isn't the cover's shape any more (it needs to be ${inches(wrap.width)} × ${inches(wrap.height)}). Start a new design, or change its size back in Canva.`);
        await api.saveExportFile(jpegPdf(jpeg, pixels, { width: wrap.width, height: wrap.height }), fileName, path);
        toast(isWeb ? `${fileName} has been downloaded.` : `${fileName} has been saved.`);
    };
    const inches = (n) => `${n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} in`;
    const lowFront = frontDpi !== null && frontDpi < 300;
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && !busy && onClose(), children: _jsxs("form", { className: "dialog writing-dialog paperback-cover", role: "dialog", "aria-label": "Paperback cover", onSubmit: (e) => {
                e.preventDefault();
                void save();
            }, onKeyDown: (e) => e.key === "Escape" && !busy && onClose(), children: [_jsx("h2", { children: "Paperback cover" }), _jsx("p", { className: "muted dialog-lede", children: "The back, spine and front in one file, sized for the printer. The spine's width comes from the page count and the paper." }), _jsxs("div", { className: "paperback-cover-view", children: [_jsx("canvas", { ref: canvas, className: "paperback-cover-preview", "aria-label": "The whole cover: back, spine and front" }), _jsxs("div", { className: "paperback-cover-sizes muted", children: [_jsxs("span", { children: ["Whole cover ", inches(wrap.width), " \u00D7 ", inches(wrap.height)] }), _jsxs("span", { children: ["Spine ", inches(wrap.spine)] }), !wrap.spineText && _jsxs("span", { children: ["Under ", SPINE_TEXT_PAGES, " pages, the spine stays plain (KDP's rule)"] })] }), _jsxs("label", { className: "check-row", children: [_jsx("input", { type: "checkbox", checked: guides, onChange: (e) => setGuides(e.target.checked) }), _jsx("span", { children: "Show the guides: trim (red), spine (blue) and where words are safe (green). They're never printed." })] }), _jsx(CanvaLink, { what: `the whole cover (bleed included, spine ${inches(wrap.spine)} in the middle)`, size: `${inches(wrap.width)} × ${inches(wrap.height)}`.replace(/ in × /, " × "), canva: {
                                project,
                                for: "paperback",
                                title: `${project.title} (paperback cover)`,
                                // At 300 dots an inch, what printers ask for.
                                width: Math.round(wrap.width * 300),
                                height: Math.round(wrap.height * 300),
                                format: "jpg",
                                backLabel: "Save the Canva cover as PDF",
                                onBack: (bytes) => saveFromCanva(bytes),
                            } })] }), _jsxs("fieldset", { className: "writing-export-group", children: [_jsx("legend", { children: "Printing" }), _jsxs("div", { className: "writing-export-styles", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Printer" }), _jsxs("select", { value: printer, onChange: (e) => setPrinter(e.target.value), children: [_jsx("option", { value: "kdp", children: "Amazon KDP" }), _jsx("option", { value: "ingram", children: "IngramSpark" })] })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Paper" }), _jsx("select", { value: usable.some((p) => p.value === paper) ? paper : "cream", onChange: (e) => setPaper(e.target.value), children: usable.map((p) => (_jsx("option", { value: p.value, children: p.label }, p.value))) })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Trim size" }), _jsx("select", { value: trim, onChange: (e) => setTrim(e.target.value), children: TRIMS.map((t) => (_jsx("option", { value: t.value, children: t.label }, t.value))) })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Pages" }), _jsx("input", { type: "number", min: 1, max: 1200, value: pages, onChange: (e) => setPages(Math.max(1, Math.min(1200, Math.round(Number(e.target.value) || 1)))) })] })] }), _jsxs("p", { className: "muted writing-export-note", children: [lastPages ? `${lastPages} pages is what the book's print PDF came to last time.` : "This is a guess from the word count. Make the print PDF first for the exact number.", " ", printer === "ingram" ? "IngramSpark asks for CMYK colours and converts others, so colours can shift a little. Its own cover template has the final say on the spine." : ""] })] }), _jsxs("fieldset", { className: "writing-export-group", children: [_jsx("legend", { children: "Front" }), ownCover && (_jsxs("div", { className: "segmented", role: "radiogroup", "aria-label": "The front", children: [_jsx("button", { type: "button", role: "radio", "aria-checked": !!design.front, onClick: () => set({ front: ownCover }), children: "The book's cover" }), _jsx("button", { type: "button", role: "radio", "aria-checked": !design.front, onClick: () => set({ front: null }), children: "Lettering here" })] })), design.front ? (lowFront && (_jsxs("p", { className: "form-error", children: ["The book's cover prints at ", frontDpi, " dots an inch at this size; printers ask for 300. Lettering it here prints sharp, or use a larger picture."] }))) : (_jsxs("span", { className: "cover-maker-picture", children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => picturePick.current?.click(), children: design.frontPicture ? "Change the picture" : "A picture behind the title" }), design.frontPicture && (_jsx("button", { type: "button", className: "link-btn", onClick: () => set({ frontPicture: null }), children: "Remove picture" }))] })), _jsxs("div", { className: "writing-export-styles", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Title" }), _jsx("input", { value: design.title, onChange: (e) => set({ title: e.target.value }), maxLength: 200 })] }), _jsxs("label", { className: "field", children: [_jsx(AuthorLabel, {}), _jsx("input", { value: design.author, onChange: (e) => set({ author: e.target.value }), maxLength: 200 })] })] })] }), _jsxs("fieldset", { className: "writing-export-group", children: [_jsx("legend", { children: "Back and spine" }), _jsxs("div", { className: "field", children: [_jsx("span", { children: "Colour" }), _jsx("div", { className: "cover-maker-swatches", role: "radiogroup", "aria-label": "Colour", children: BACKGROUNDS.map((b, i) => (_jsx("button", { type: "button", role: "radio", "aria-checked": design.background === i, "aria-label": b.name, title: b.name, className: "cover-maker-swatch", style: { background: `linear-gradient(${b.top}, ${b.bottom})` }, onClick: () => set({ background: i }) }, b.name))) })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Lettering" }), _jsx("select", { value: design.font, onChange: (e) => set({ font: e.target.value }), children: COVER_FONTS.map((f) => (_jsx("option", { value: f.value, children: f.label }, f.value))) })] }), _jsxs("div", { className: "field", children: [_jsx("span", { children: "On the back" }), _jsx(FormattedText, { rows: 5, value: design.blurb, onChange: (blurb) => set({ blurb }), placeholder: "What the book is about, to make a reader pick it up" })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "About the author" }), _jsx("textarea", { rows: 2, value: design.bio, onChange: (e) => set({ bio: e.target.value }), placeholder: "A line or two" })] }), _jsxs("span", { className: "cover-maker-picture", children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => photoPick.current?.click(), children: design.photo ? "Change the author's photo" : "Add the author's photo" }), design.photo && (_jsx("button", { type: "button", className: "link-btn", onClick: () => set({ photo: null }), children: "Remove photo" }))] }), _jsxs("label", { className: "check-row", children: [_jsx("input", { type: "checkbox", checked: design.barcodeBox, onChange: (e) => set({ barcodeBox: e.target.checked }) }), _jsx("span", { children: "Keep a white space for the barcode (KDP prints one there if you don't have your own)" })] })] }), ["photo", "frontPicture"].map((key) => (_jsx("input", { ref: key === "photo" ? photoPick : picturePick, type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true, onChange: (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                            if (design[key])
                                URL.revokeObjectURL(design[key]);
                            set({ [key]: URL.createObjectURL(file) });
                        }
                        e.target.value = "";
                    } }, key))), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onClose, disabled: busy, children: "Cancel" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy, children: busy ? "Making the cover…" : "Save the cover PDF" })] })] }) }));
}
