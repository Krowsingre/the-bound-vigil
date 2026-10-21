import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { NO_SERVER_QUEUE } from "../api/serverStub";
import type { QueuedServerFile, ServerQueueView } from "../api/types";

/** Rows fetched at first, and with each "Show more". */
export const ROWS = 200;

/** Follows the list of files coming down from servers. The rows are fetched
 *  again (at most once a second) when they change; progress comes with every update. */
export function useServerQueue(enabled: boolean) {
  const [view, setView] = useState<ServerQueueView>(NO_SERVER_QUEUE);
  const [rows, setRows] = useState<QueuedServerFile[]>([]);
  const [limit, setLimit] = useState(ROWS);
  const fetched = useRef<{ version: number; limit: number; at: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    if (!enabled) return;
    void api.serverQueue().then((next) => {
      setView(next);
      const last = fetched.current;
      if (last && last.version === next.version && last.limit === limit) return;
      const wait = last ? Math.max(0, 1000 - (Date.now() - last.at)) : 0;
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        fetched.current = { version: next.version, limit, at: Date.now() };
        void api.serverQueuePage(0, limit).then(setRows, () => undefined);
      }, wait);
    }, () => undefined);
  }, [enabled, limit]);

  useEffect(() => {
    refresh();
    if (!enabled) return;
    return api.onServerQueue(refresh);
  }, [enabled, refresh]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // Rows coming down show their progress from the view, which comes more often.
  const live = new Map(view.active.map((f) => [f.id, f]));
  return {
    view,
    rows: rows.map((r) => live.get(r.id) ?? r),
    showMore: () => setLimit((n) => n + ROWS),
  };
}

export type ServerQueue = ReturnType<typeof useServerQueue>;
