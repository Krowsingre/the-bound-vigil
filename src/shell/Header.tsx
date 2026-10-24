import { forwardRef, useState, type ReactNode } from "react";
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
    onImportBooks: () => void;
    onImportFolder: () => void;
    onOpenSyncSettings: () => void;
    onOpenActivity?: () => void;
    onOpenPlaces?: () => void;
    onChooseAvatar: (from?: "photos" | "files") => void;
    onClearAvatar: () => void;
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
>(function Header({ sync, profile, search, placeholder, onSearchChange, onSearchSubmit, onOpenMenu, pageAction, address, searchStart, searchEnd, addressLabel, typingPanel, ...menu }, searchRef) {
  const [typing, setTyping] = useState(false);
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
          placeholder={placeholder ?? "Search books, authors or series…"}
          value={showing}
          onFocus={(e) => {
            if (address === undefined) return;
            setTyping(true);
            if (!search && address) {
              onSearchChange(address);
              const box = e.currentTarget;
              requestAnimationFrame(() => box.select());
            }
          }}
          onBlur={() => {
            setTyping(false);
            // Left without going anywhere: back to showing the page's address.
            if (address !== undefined && search === address) onSearchChange("");
          }}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onSearchChange("");
              e.currentTarget.blur();
            }
          }}
          autoComplete="off"
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
