import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// A book's details: where its file is. This device, your other devices and
// your sync places each say whether they hold it, so the list is as fresh as
// the last sync. A book a phone fetched just to open can be kept there.
import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { useAppSettings } from "../settings/appSettings";
const ICON = { computer: "computer", phone: "phone", place: "cloud" };
function keepFor(days) {
    return days === 7 ? "a week" : days === 30 ? "a month" : `${days / 7} weeks`;
}
export function LocationsRow({ bookId, refreshKey, fallback }) {
    const toast = useToast();
    const { settings } = useAppSettings();
    const [places, setPlaces] = useState(null);
    const [reload, setReload] = useState(0);
    useEffect(() => {
        let current = true;
        api.bookLocations(bookId).then((list) => current && setPlaces(list), () => current && setPlaces([]));
        return () => {
            current = false;
        };
    }, [bookId, refreshKey, reload]);
    const keep = async () => {
        try {
            await api.keepDownload(bookId, true);
            setReload((n) => n + 1);
            toast("Kept on this device for good.");
        }
        catch (e) {
            toast(`Couldn't keep it: ${String(e)}`);
        }
    };
    const days = settings.sync.phoneKeepDays;
    return (_jsxs("div", { children: [_jsx("dt", { children: "Where it is" }), _jsx("dd", { children: places === null || places.length === 0 ? (fallback) : (_jsx("ul", { className: "details-locations", children: places.map((p) => (_jsxs("li", { children: [_jsx(Icon, { name: ICON[p.kind], size: 14 }), _jsx("span", { children: p.name }), p.here && _jsx("span", { className: "details-origin", children: "This device" }), p.temporary && days > 0 && (_jsxs(_Fragment, { children: [_jsxs("span", { className: "details-origin", children: ["Removed after ", keepFor(days), " unopened"] }), _jsx("button", { type: "button", className: "view-all", onClick: () => void keep(), children: "Keep" })] }))] }, `${p.kind}:${p.name}:${p.here}`))) })) })] }));
}
