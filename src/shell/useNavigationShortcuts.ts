import { useEffect } from "react";
import { APP_HISTORY_NAVIGATION, navigationDirection } from "./navigationKeys";

/** App controls and native browser pages have separate keyboard event paths. */
export function useNavigationShortcuts({ back, forward, reading, discover, webpage }: {
  back: () => void;
  forward: () => void;
  reading: boolean;
  discover: boolean;
  webpage: (direction: "back" | "forward") => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (reading || event.defaultPrevented) return;
      const direction = navigationDirection(event, true);
      if (direction) {
        event.preventDefault();
        (direction === "back" ? back : forward)();
      } else if (discover) {
        const page = navigationDirection(event, false);
        if (page) {
          event.preventDefault();
          webpage(page);
        }
      }
    };
    // Keep the existing mouse Back behavior, independently of the new keys.
    const onMouse = (event: MouseEvent) => {
      if (event.button !== 3 || reading) return;
      event.preventDefault();
      back();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    const onNativeNavigation = (event: Event) => {
      if (reading || !discover) return;
      const direction = (event as CustomEvent<string>).detail;
      if (direction === "back") back();
      else if (direction === "forward") forward();
    };
    window.addEventListener(APP_HISTORY_NAVIGATION, onNativeNavigation);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
      window.removeEventListener(APP_HISTORY_NAVIGATION, onNativeNavigation);
    };
  }, [back, forward, reading, discover, webpage]);
}
