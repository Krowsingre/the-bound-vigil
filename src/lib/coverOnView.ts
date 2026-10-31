// The iPhone app fetches a cover from the cloud only when it's shown, rather
// than every cover at each sync. A few come down at a time, each book's is
// asked for once while TBV is open, and one the cloud hasn't got isn't asked
// for again until next time.

import { useEffect, useState } from "react";
import { api } from "../api";

/** The iPhone app, as `isIOS` in the api says, worked out here so pages tested with a stand-in api are left alone. */
const onIPhone =
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in window &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
/** Audiobookshelf books ("abs~…") have their own covers. */
const fromServer = (bookId: string) => bookId.startsWith("abs~");

const AT_ONCE = 3;
const asked = new Map<string, Promise<string | null>>();
const waiting: (() => void)[] = [];
let running = 0;

function next() {
  while (running < AT_ONCE && waiting.length) {
    running++;
    waiting.shift()!();
  }
}

/** The cover's file, fetched once. Null if the cloud has none or it couldn't come down. */
export function coverOnView(bookId: string): Promise<string | null> {
  let found = asked.get(bookId);
  if (!found) {
    found = new Promise<string | null>((resolve) => {
      waiting.push(() =>
        api.coverOnView(bookId).then(
          (path) => resolve(path),
          () => resolve(null),
        ).finally(() => {
          running--;
          next();
        }),
      );
      next();
    });
    asked.set(bookId, found);
  }
  return found;
}

/**
 * A cover to show for a book that has none on this device: on iPhone, fetched
 * once `element` comes into view. Null until then, or if there's none.
 */
export function useCoverOnView(bookId: string, has: boolean, element: Element | null): string | null {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    setPath(null);
    if (!onIPhone || has || !element || fromServer(bookId)) return;
    let current = true;
    const seen = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        seen.disconnect();
        void coverOnView(bookId).then((p) => current && setPath(p));
      },
      { rootMargin: "200px" },
    );
    seen.observe(element);
    return () => {
      current = false;
      seen.disconnect();
    };
  }, [bookId, has, element]);
  return path;
}
