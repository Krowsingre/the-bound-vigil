import { forwardRef, useRef, useState, type ReactNode } from "react";
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
  const [edited, setEdited] = useState(false);
  const revision = useRef(0);
  const pasteHint = !!onPasteAndGo && typing && !edited;
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
          className={pasteHint ? "search-paste-hint-input" : undefined}
          aria-describedby={pasteHint ? "search-paste-hint" : undefined}
          placeholder={placeholder ?? "Search books, authors or series…"}
          value={showing}
          onFocus={(e) => {
            if (address === undefined) return;
            setEdited(false);
            setTyping(true);
            if (!search && address && e.currentTarget.dataset.blankTab === undefined) {
              onSearchChange(address);
              // Replace the display label before selecting, in the same event.
              // A deferred selection can select text the user has just typed.
              e.currentTarget.value = address;
              e.currentTarget.select();
            }
          }}
          onBlur={() => {
            revision.current++;
            setTyping(false);
            // Left without going anywhere: back to showing the page's address.
            if (address !== undefined && search === address) onSearchChange("");
          }}
          onChange={(e) => {
            revision.current++;
            setEdited(true);
            onSearchChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.defaultPrevented || e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && pasteHint && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
              e.preventDefault();
              const request = ++revision.current;
              if (!navigator.clipboard) { setEdited(true); return; }
              void navigator.clipboard.readText().then((value) => {
                if (request !== revision.current) return;
                const text = value.trim();
                if (text) {
                  onPasteAndGo?.(text);
                  done();
                } else setEdited(true);
              }, () => { if (request === revision.current) setEdited(true); });
            } else if (pasteHint && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Delete", "Backspace"].includes(e.key)) {
              revision.current++;
              setEdited(true);
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
        {pasteHint && <span id="search-paste-hint" className="search-paste-hint">Press Enter to paste and go</span>}
        {searchEnd}
        {typing && typingPanel?.(search, done)}
      </form>
      <div className="header-spacer" data-tauri-drag-region />
      <SyncMenu sync={sync} profile={profile} {...menu} />
      <WindowControls />
    </header>
  );
});
