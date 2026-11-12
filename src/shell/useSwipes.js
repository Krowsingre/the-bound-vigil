import { useEffect } from "react";
/** How far down the screen a pull from the top bar must reach to go Home. */
export const PULL_HOME = 0.6;
/** Whether something under the finger scrolls sideways, or takes the swipe itself. */
function takesSideways(target, root, overMenu = false) {
    for (let el = target; el && el !== root; el = el.parentElement) {
        if (el.matches("input, textarea, select, [contenteditable=true], [role=slider], [role=dialog], [data-own-swipe], .menu"))
            return true;
        if (!overMenu && el.matches(".sidebar"))
            return true;
        if (el.scrollWidth > el.clientWidth + 1) {
            const overflow = getComputedStyle(el).overflowX;
            if (overflow === "auto" || overflow === "scroll")
                return true;
        }
    }
    return false;
}
/**
 * Phone swipes on `root`. A sideways swipe counts when the finger moves
 * mostly sideways and either a third of the screen or quickly; anything
 * else is left to scroll. A pull down counts only when it starts in the top
 * bar and ends 60% of the way down. `pull` is drawn while pulling.
 */
export function useSwipes(root, pull, enabled, swipes) {
    const { onLeft, onRight, onPullDown, overMenu } = swipes;
    useEffect(() => {
        const el = root.current;
        if (!enabled || !el)
            return;
        let start = null;
        const showPull = (reach) => {
            const shown = pull.current;
            if (!shown)
                return;
            shown.style.opacity = reach === null ? "0" : String(Math.min(1, reach / PULL_HOME));
            shown.classList.toggle("is-ready", reach !== null && reach >= PULL_HOME);
        };
        const down = (e) => {
            if (e.touches.length !== 1) {
                start = null;
                showPull(null);
                return;
            }
            const t = e.touches[0];
            const target = e.target;
            start = {
                x: t.clientX,
                y: t.clientY,
                at: e.timeStamp,
                sideways: (!!onLeft || !!onRight) && !takesSideways(target, el, overMenu),
                fromTop: !!onPullDown && !!target.closest(".header") && !target.closest(".menu"),
            };
        };
        const move = (e) => {
            if (!start?.fromTop)
                return;
            const t = e.touches[0];
            const dy = t.clientY - start.y;
            showPull(dy > 24 && dy > Math.abs(t.clientX - start.x) ? t.clientY / window.innerHeight : null);
        };
        const up = (e) => {
            const began = start;
            start = null;
            showPull(null);
            const t = e.changedTouches[0];
            if (!began || !t)
                return;
            const dx = t.clientX - began.x;
            const dy = t.clientY - began.y;
            if (began.fromTop && dy > 0 && dy > Math.abs(dx) * 1.5 && t.clientY >= window.innerHeight * PULL_HOME) {
                onPullDown?.();
                return;
            }
            if (!began.sideways || Math.abs(dx) < Math.abs(dy) * 2)
                return;
            const speed = Math.abs(dx) / Math.max(1, e.timeStamp - began.at);
            if (Math.abs(dx) < window.innerWidth / 3 && !(Math.abs(dx) > 60 && speed > 0.5))
                return;
            if (dx < 0)
                onLeft?.();
            else
                onRight?.();
        };
        const cancel = () => {
            start = null;
            showPull(null);
        };
        el.addEventListener("touchstart", down, { passive: true });
        el.addEventListener("touchmove", move, { passive: true });
        el.addEventListener("touchend", up);
        el.addEventListener("touchcancel", cancel);
        return () => {
            el.removeEventListener("touchstart", down);
            el.removeEventListener("touchmove", move);
            el.removeEventListener("touchend", up);
            el.removeEventListener("touchcancel", cancel);
        };
    }, [root, pull, enabled, onLeft, onRight, onPullDown, overMenu]);
}
