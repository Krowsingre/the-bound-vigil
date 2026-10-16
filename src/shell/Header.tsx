import { forwardRef, useState } from "react";
import type { SyncStatus } from "../api/types";
import { Icon } from "../components/Icon";
import { SyncMenu } from "./SyncMenu";
import { WindowControls } from "./WindowControls";

export const Header = forwardRef<
  HTMLInputElement,
  {
    sync: SyncStatus | null;
    onSearch: (query: string) => void;
    onImportBooks: () => void;
    onImportFolder: () => void;
    onOpenSyncSettings: () => void;
  }
>(function Header({ sync, onSearch, ...menu }, searchRef) {
  const [query, setQuery] = useState("");
  return (
    <header className="header" data-tauri-drag-region>
      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) onSearch(query.trim());
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
          placeholder="Search books, authors, or collections…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              e.currentTarget.blur();
            }
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </form>
      <div className="header-spacer" data-tauri-drag-region />
      <SyncMenu sync={sync} {...menu} />
      <WindowControls />
    </header>
  );
});
