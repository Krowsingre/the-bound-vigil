import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useRef, useState } from "react";
import { api } from "../api";
import { useToast } from "../components/Toast";
export const downloadable = (book) => !book.fileUnavailable && (book.availability === "cloud" || book.availability === "missing");
export function useBatchDownloads(onChanged) {
    const toast = useToast();
    const running = useRef(false);
    const [progress, setProgress] = useState("");
    const [failed, setFailed] = useState([]);
    const download = async (load) => {
        if (running.current)
            return;
        running.current = true;
        setProgress("Finding downloads…");
        try {
            const books = (await load()).filter(downloadable);
            const errors = [];
            for (const [index, book] of books.entries()) {
                setProgress(`Downloading ${index + 1} of ${books.length}…`);
                try {
                    await api.downloadBook(book.id);
                }
                catch {
                    errors.push(book);
                }
            }
            setFailed(errors);
            if (books.length)
                onChanged();
            const completed = books.length - errors.length;
            toast(books.length ? `Downloaded ${completed} of ${books.length} to this device.` : "There are no files to download.");
        }
        catch (error) {
            toast(String(error));
        }
        finally {
            running.current = false;
            setProgress("");
        }
    };
    const feedback = (_jsxs(_Fragment, { children: [progress && _jsx("p", { role: "status", children: progress }), failed.length > 0 && (_jsxs("section", { "aria-label": "Failed downloads", children: [_jsx("p", { children: "These files couldn\u2019t be downloaded." }), _jsx("ul", { children: failed.map((book) => _jsx("li", { children: book.title }, book.id)) }), _jsx("button", { type: "button", className: "btn btn-quiet", disabled: !!progress, onClick: () => void download(async () => failed), children: "Retry failed" })] }))] }));
    return { download, feedback, progress };
}
