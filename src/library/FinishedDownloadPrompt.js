import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
const event = "tbv:remove-finished-download";
/** Offer cleanup after a status change has succeeded, using the normal cloud-copy safeguard. */
export function offerFinishedDownloadRemoval(book, status, onRemoved, onDismiss) {
    if (book.availability !== "local" || book.status === status || (status !== "read" && status !== "dropped"))
        return false;
    window.dispatchEvent(new CustomEvent(event, { detail: { book, onRemoved, onDismiss } }));
    return true;
}
export function FinishedDownloadPrompt() {
    const [queue, setQueue] = useState([]);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    useEffect(() => {
        const receive = (e) => {
            const request = e.detail;
            setQueue((pending) => pending.some(({ book }) => book.id === request.book.id) ? pending : [...pending, request]);
        };
        window.addEventListener(event, receive);
        return () => window.removeEventListener(event, receive);
    }, []);
    const request = queue[0];
    if (!request)
        return null;
    const dismiss = () => {
        setQueue((pending) => pending.slice(1));
        request.onDismiss?.();
    };
    return _jsx(ConfirmDialog, { title: `Remove “${request.book.title}” from this device?`, body: request.book.inCloud
            ? "The book stays in your library and can be downloaded again."
            : "This device has the only copy. Sync the book file before removing the download.", confirm: "Remove download", cancel: "Keep on device", confirmDisabled: busy || !request.book.inCloud, onCancel: () => { if (!busy)
            dismiss(); }, onConfirm: () => {
            if (busy)
                return;
            setBusy(true);
            void api.removeDownload(request.book.id).then(() => {
                request.onRemoved?.();
                toast("Removed the download from this device.");
            }, (error) => toast(String(error))).finally(() => {
                setBusy(false);
                dismiss();
            });
        } }, request.book.id);
}
