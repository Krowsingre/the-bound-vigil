import { useEffect, useRef } from "react";
import { api, isAndroid, isApp, isIOS, isMac } from "../api";
import { Icon } from "../components/Icon";

/** The reader's own translation page, apart from Discover's tabs. */
const TAB = "reader-translate";

/**
 * Where the reader can show Google Translate beside the book: the computer
 * apps, outside a split (Apple's devices have their own card; Android has no
 * browser yet).
 */
export const canTranslateInReader = () => isApp && !isIOS && !isMac && !isAndroid && !window.frameElement;

/** What covers the panel's page for a moment (a menu or dialog), so the page steps aside. */
const COVERING = ".dialog-backdrop, [role=menu], [role=alertdialog], dialog[open], .popover";

/**
 * A panel inside the reader with Google Translate for the chosen words. The
 * page sits in the panel; closing it leaves you on the same page of the book.
 */
export function TranslatePanel({ url, words, onClose }: { url: string; words: string; onClose: () => void }) {
  const spot = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    const box = spot.current;
    if (!box) return;
    const frame = () => {
      const r = box.getBoundingClientRect();
      return { x: r.left, y: r.top, width: Math.max(1, r.width), height: Math.max(1, r.height) };
    };
    let hidden = false;
    const place = () => {
      if (document.querySelector(COVERING)) {
        if (!hidden) void api.browserHide().catch(() => undefined);
        hidden = true;
        return;
      }
      hidden = false;
      // The address only on the first showing; later ones only move it.
      void api.browserShow(TAB, first.current ? url : null, frame()).catch(() => undefined);
      first.current = false;
    };
    place();
    const resized = new ResizeObserver(place);
    resized.observe(box);
    const covered = new MutationObserver(() => {
      if (!!document.querySelector(COVERING) !== hidden) place();
    });
    covered.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", place);
    return () => {
      resized.disconnect();
      covered.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [url]);

  // New words go to the same page.
  const shownUrl = useRef(url);
  useEffect(() => {
    if (shownUrl.current === url) return;
    shownUrl.current = url;
    void api.browserAct(TAB, "go", url).catch(() => undefined);
  }, [url]);

  useEffect(() => () => void api.browserAct(TAB, "close").catch(() => undefined), []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <aside className="reader-translate" aria-label="Translation">
      <header className="reader-translate-head">
        <div>
          <h2>Translate</h2>
          <p className="muted" title={words}>{words}</p>
        </div>
        <button type="button" className="icon-btn" aria-label="Close translation" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </header>
      <div ref={spot} className="reader-translate-page" />
    </aside>
  );
}
