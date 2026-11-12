import { useCallback, useLayoutEffect, useRef } from "react";
/** Session-only app screens. Webpage and book-location histories stay separate. */
export function useNavigationHistory(place, restore, same) {
    const history = useRef({ past: [], current: place, future: [] });
    const callbacks = useRef({ restore, same });
    callbacks.current = { restore, same };
    useLayoutEffect(() => {
        const h = history.current;
        if (callbacks.current.same(h.current, place))
            return;
        h.past = [...h.past.slice(-49), h.current];
        h.current = place;
        h.future = [];
    });
    const travel = useCallback((direction) => {
        const h = history.current;
        const from = direction === "back" ? h.past : h.future;
        if (!from.length)
            return;
        const next = from.pop();
        const to = direction === "back" ? h.future : h.past;
        to.push(h.current);
        h.current = next;
        callbacks.current.restore(next);
    }, []);
    const back = useCallback(() => travel("back"), [travel]);
    const forward = useCallback(() => travel("forward"), [travel]);
    return { back, forward };
}
