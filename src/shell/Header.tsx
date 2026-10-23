import { forwardRef, type ReactNode } from "react";
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
    /** A button for the page showing, beside the menu button (Discover's catalogues). */
    pageAction?: ReactNode;
  }
>(function Header({ sync, profile, search, placeholder, onSearchChange, onSearchSubmit, onOpenMenu, pageAction, ...menu }, searchRef) {
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
        }}
      >
        <Icon name="search" size={18} />
        <label className="visually-hidden" htmlFor="global-search">
          Search
        </label>
        <input
          id="global-search"
          ref={searchRef}
          type="search"
          placeholder={placeholder ?? "Search books, authors or series…"}
          value={search}
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
      </form>
      <div className="header-spacer" data-tauri-drag-region />
      <SyncMenu sync={sync} profile={profile} {...menu} />
      <WindowControls />
    </header>
  );
});
