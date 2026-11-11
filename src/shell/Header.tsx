import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import type { Profile, SyncStatus } from "../api/types";
import { Icon } from "../components/Icon";
import { SyncMenu } from "./SyncMenu";
import { WindowControls } from "./WindowControls";

export const Header = forwardRef<
  HTMLInputElement,
  {
    sync: SyncStatus | null;
    profile: Profile | null;
    search: string;
    /** What the search box offers to find, when it isn't books. */
    placeholder?: string;
    onSearchChange: (query: string) => void;
    onSearchSubmit: () => void;
    onPasteAndGo?: (text: string) => void;
    onImportBooks: () => void;
    onImportFolder: () => void;
    onOpenSyncSettings: () => void;
    onOpenActivity?: () => void;
    onOpenPlaces?: () => void;
    onOpenProfile: () => void;
    onOpenPlan?: () => void;
    /** Opens the menu of pages, on a phone. */
    onOpenMenu?: () => void;
    /** A button for the page showing, beside the menu button. */
    pageAction?: ReactNode;
    /** On Discover: the page's address, shown in the search box while nothing's being typed. */
    address?: string;
    /** In place of the magnifier, inside the left of the search box (Discover's reload). */
    searchStart?: ReactNode;
    /** Inside the right end of the search box (Discover's row arrow). */
    searchEnd?: ReactNode;
    /** On Discover: the address as shown while not typing (just the site). */
    addressLabel?: string;
    /** Drops down under the box while typing (Discover's suggestions); `done` empties and leaves the box. */
    typingPanel?: (typed: string, done: () => void) => ReactNode;
  }
>(function Header({ sync, profile, search, placeholder, onSearchChange, onSearchSubmit, onPasteAndGo, onOpenMenu, pageAction, address, searchStart, searchEnd, addressLabel, typingPanel, ...menu }, searchRef) {
  const [typing, setTyping] = useState(false);
  const [clipboardReady, setClipboardReady] = useState(false);
  const revision = useRef(0);
  const pasteHint = !!onPasteAndGo && typing && !search && clipboardReady;
  const stopHint = () => {
    revision.current++;
    setClipboardReady(false);
  };
  useEffect(() => {
    const clearSearch = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "x") return;
      if (document.querySelector(".dialog-backdrop, dialog[open], [role=alertdialog], [role=menu]")) return;
      const input = document.getElementById("global-search") as HTMLInputElement | null;
      if (!input) return;
      const target = event.target;
      if (target === input) {
        if (input.selectionStart !== input.selectionEnd) return;
      } else if (target instanceof Element && (target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])") || window.getSelection()?.toString())) {
        return;
      }
      event.preventDefault();
      if (address !== undefined) {
        input.focus();
        setTyping(true);
        revision.current++;
        setClipboardReady(false);
      }
      onSearchChange("");
    };
    window.addEventListener("keydown", clearSearch);
    return () => window.removeEventListener("keydown", clearSearch);
  }, [address, onSearchChange]);
  const showing = address !== undefined && !typing && !search ? (addressLabel ?? address) : search;
  const done = () => {
    onSearchChange("");
    setTyping(false);
    (document.getElementById("global-search") as HTMLInputElement | null)?.blur();
  };
  return (
    <header className="header" data-tauri-drag-region>
      {onOpenMenu && (
        <button type="button" className="header-menu" aria-label="Menu" onClick={onOpenMenu}>
          <Icon name="menu" size={22} />
        </button>
      )}
      {pageAction}
      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          onSearchSubmit();
          // On Discover, going somewhere leaves the box, so the suggestions close and the page shows.
          if (address !== undefined) {
            setTyping(false);
            (document.getElementById("global-search") as HTMLInputElement | null)?.blur();
          }
        }}
      >
        {searchStart ?? <Icon name="search" size={18} />}
        <label className="visually-hidden" htmlFor="global-search">
          Search
        </label>
        <input
          id="global-search"
          ref={searchRef}
          type="search"
          placeholder={pasteHint ? "Press Enter to paste and go" : placeholder ?? "Search books, authors or series…"}
          value={showing}
          onFocus={(e) => {
            if (address === undefined) return;
            stopHint();
            setTyping(true);
            const blankTab = e.currentTarget.dataset.blankTab !== undefined;
            if (!search && address && !blankTab) {
              onSearchChange(address);
            } else if (!search && onPasteAndGo && navigator.clipboard) {
              const request = revision.current;
              void navigator.clipboard.readText().then((value) => {
                if (request === revision.current) setClipboardReady(!!value.trim());
              }, () => undefined);
            }
          }}
          onBlur={() => {
            stopHint();
            setTyping(false);
            if (address !== undefined && search === address) onSearchChange("");
          }}
          onChange={(e) => {
            stopHint();
            onSearchChange(e.target.value);
          }}
          onCompositionStart={stopHint}
          onKeyDown={(e) => {
            if (e.defaultPrevented || e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && pasteHint && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
              e.preventDefault();
              const request = ++revision.current;
              if (!navigator.clipboard) { setClipboardReady(false); return; }
              void navigator.clipboard.readText().then((value) => {
                if (request !== revision.current) return;
                const text = value.trim();
                if (text) {
                  onPasteAndGo?.(text);
                  done();
                } else setClipboardReady(false);
              }, () => { if (request === revision.current) setClipboardReady(false); });
            } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Delete", "Backspace"].includes(e.key)) {
              stopHint();
            }
            if (e.key === "Escape" && !e.nativeEvent.isComposing) {
              onSearchChange("");
              e.currentTarget.blur();
            }
          }}
          autoComplete="off"
          autoCorrect={address === undefined ? undefined : "off"}
          autoCapitalize={address === undefined ? undefined : "off"}
          spellCheck={false}
        />
        {searchEnd}
        {typing && typingPanel?.(search, done)}
      </form>
      <div className="header-spacer" data-tauri-drag-region />
      <SyncMenu sync={sync} profile={profile} {...menu} />
      <WindowControls />
    </header>
  );
});
