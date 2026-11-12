export const APP_HISTORY_NAVIGATION = "tbv:app-history-navigation";
/** Browser's native key bridge asks the shell to change app screens. */
export function requestAppHistory(direction) {
    window.dispatchEvent(new CustomEvent(APP_HISTORY_NAVIGATION, { detail: direction }));
}
/** Shift distinguishes app/reader navigation from Discover's webpage history. */
export function navigationDirection(e, shifted) {
    if (!e.altKey || e.shiftKey !== shifted || e.ctrlKey || e.metaKey)
        return null;
    return e.key === "ArrowLeft" ? "back" : e.key === "ArrowRight" ? "forward" : null;
}
