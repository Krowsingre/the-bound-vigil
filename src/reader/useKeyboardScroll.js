import { useEffect, useRef } from "react";
const TAP_MS = 95;
export function useKeyboardScroll(scroll, speed, enabled) {
    const motion = useRef(null);
    const frame = useRef(0);
    const stop = () => {
        motion.current = null;
        cancelAnimationFrame(frame.current);
    };
    useEffect(() => {
        if (!enabled)
            return;
        window.addEventListener("blur", stop);
        document.addEventListener("visibilitychange", stop);
        return () => {
            stop();
            window.removeEventListener("blur", stop);
            document.removeEventListener("visibilitychange", stop);
        };
    }, [enabled]);
    const tick = (now) => {
        const current = motion.current;
        if (!current)
            return;
        const end = current.held ? now : Math.min(now, current.start + TAP_MS);
        current.carry += Math.max(0, Math.min(32, end - current.previous)) * speed / 1000;
        current.previous = now;
        const pixels = Math.floor(current.carry);
        current.carry -= pixels;
        if (pixels)
            scroll(pixels * current.direction);
        if (current.held || now < current.start + TAP_MS)
            frame.current = requestAnimationFrame(tick);
        else
            motion.current = null;
    };
    return {
        press(direction, repeat) {
            if (!enabled || repeat || motion.current?.held && motion.current.direction === direction)
                return;
            stop();
            const now = performance.now();
            motion.current = { direction, start: now, previous: now, held: true, carry: 0 };
            frame.current = requestAnimationFrame(tick);
        },
        release(event) {
            const current = motion.current;
            const key = current?.direction === 1 ? "ArrowDown" : "ArrowUp";
            if (!current || event.key !== key)
                return;
            if (performance.now() - current.start >= TAP_MS)
                stop();
            else
                current.held = false;
        },
    };
}
