import emblem from "../assets/emblem.svg?raw";
import { Icon } from "../components/Icon";
import { navFor, navRouteOf, type Route } from "./routes";
import { isHome, isWeb } from "../api";
import { useEffect, useState } from "react";
import { liningUp as liningUpNow, onLiningUp, type LiningUp } from "../readAlong/lineUp";

// The emblem's two arches (assets/emblem.svg), drawn apart so each can turn on its own.
const OUTER_ARCH = "M10 42V22a14 14 0 0 1 28 0v20";
const INNER_ARCH = "M16 42V22.5a8 8 0 0 1 16 0V42";

export function Sidebar({
  route,
  collapsed,
  drawerOpen = false,
  onCloseDrawer,
  onNavigate,
  onToggle,
  preview,
  imports,
}: {
  /** Books imported so far and in all, while there's an import to show. */
  imports: { done: number; total: number; running: boolean } | null;
  route: Route;
  collapsed: boolean;
  /** On a phone: the menu is open over the page. */
  drawerOpen?: boolean;
  onCloseDrawer?: () => void;
  onNavigate: (route: Route) => void;
  onToggle: () => void;
  preview: boolean;
}) {
  const active = navRouteOf(route);
  // A book and its audiobook being lined up word by word, in the background.
  const [lining, setLining] = useState<LiningUp | null>(liningUpNow());
  useEffect(() => onLiningUp(setLining), []);
  const liningPercent = lining ? Math.floor(lining.fraction * 100) : 0;
  const [spin, setSpin] = useState<"inner" | "outer" | null>(null);
  const fold = () => {
    setSpin(collapsed ? "outer" : "inner");
    onToggle();
  };
  return (
    <>
      {drawerOpen && <div className="sidebar-backdrop" aria-hidden onClick={onCloseDrawer} />}
      <aside className={`sidebar${collapsed ? " is-collapsed" : ""}${drawerOpen ? " is-drawer-open" : ""}`}>
        {drawerOpen && (
          <button type="button" className="sidebar-close" aria-label="Close the menu" onClick={onCloseDrawer}>
            <Icon name="menu" size={22} />
          </button>
        )}
        <div className="sidebar-top" data-tauri-drag-region />

        <div className="brand" data-tauri-drag-region>
          {drawerOpen ? (
            <span className="brand-emblem" aria-hidden dangerouslySetInnerHTML={{ __html: emblem }} />
          ) : (
            // The emblem folds the sidebar away and back: closing turns the inner arch left, opening turns the outer arch right.
            <button
              type="button"
              className={`brand-emblem brand-toggle${spin ? ` is-spinning-${spin}` : ""}`}
              onClick={fold}
              onAnimationEnd={() => setSpin(null)}
              aria-label={collapsed ? "Expand menu" : "Collapse menu"}
              aria-expanded={!collapsed}
              title={`${collapsed ? "Expand" : "Collapse"} menu (Ctrl+\\)`}
            >
              <svg className="arch arch-outer" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d={OUTER_ARCH} />
              </svg>
              <svg className="arch arch-inner" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d={INNER_ARCH} />
              </svg>
            </button>
          )}
          {!collapsed && (
            <>
              {drawerOpen ? (
                <span className="brand-name">The Bound Vigil</span>
              ) : (
                // The name folds the sidebar too; the emblem is the button for the keyboard.
                <button type="button" className="brand-name brand-name-toggle" tabIndex={-1} aria-hidden onClick={fold}>
                  The Bound Vigil
                </button>
              )}
              <span className="brand-tagline">Books endure</span>
              <span className="brand-divider" aria-hidden />
            </>
          )}
        </div>

        <nav aria-label="Main">
          <ul className="nav">
            {navFor({ web: isWeb, home: isHome }).map((item, i) => (
              <li key={item.route}>
                <button
                  type="button"
                  className={`nav-item${active === item.route ? " is-active" : ""}`}
                  aria-current={active === item.route ? "page" : undefined}
                  onClick={() => onNavigate(item.route)}
                  title={collapsed ? `${item.label} (Ctrl+${i + 1})` : undefined}
                >
                  <Icon name={item.icon} size={22} />
                  <span className="nav-label">
                    {item.label}
                    <span className="nav-caption">{item.caption}</span>
                  </span>
                </button>
              </li>
            ))}
            {imports && (
              <li>
                <button
                  type="button"
                  className={`nav-item nav-imports${active === "imports" ? " is-active" : ""}`}
                  aria-current={active === "imports" ? "page" : undefined}
                  onClick={() => onNavigate("imports")}
                  title={collapsed ? `Imports: ${imports.done} of ${imports.total}` : undefined}
                >
                  <Icon name="download" size={20} />
                  <span className="nav-label">Imports</span>
                  <span className="nav-count">{imports.running ? `${imports.done}/${imports.total}` : "✓"}</span>
                  {imports.running && (
                    <span className="nav-progress" aria-hidden>
                      <span style={{ width: `${(imports.done / Math.max(1, imports.total)) * 100}%` }} />
                    </span>
                  )}
                </button>
              </li>
            )}
            {lining && (
              <li>
                <button
                  type="button"
                  className="nav-item nav-imports nav-lining"
                  onClick={() => onNavigate("lining")}
                  title={`${lining.title || "A book"} is converging with its audiobook: ${liningPercent}%`}
                >
                  <Icon name="confluence" size={20} />
                  <span className="nav-label">
                    Converging
                    {lining.title && <span className="nav-caption">{lining.title}</span>}
                  </span>
                  <span className="nav-count">{liningPercent}%</span>
                  <span className="nav-progress" aria-hidden>
                    <span style={{ width: `${liningPercent}%` }} />
                  </span>
                </button>
              </li>
            )}
          </ul>
        </nav>

        {!collapsed && (
          <figure className="sidebar-quote" aria-hidden>
            <span className="sidebar-rule" />
            <blockquote>A wider world lives in these pages.</blockquote>
            <figcaption className="sidebar-quote-by">Krowsingre</figcaption>
            <span className="sidebar-rule" />
          </figure>
        )}
        {preview && (
          <p className="preview-badge" title="Sample books for design previews. The desktop app shows your own library.">
            {collapsed ? "P" : "Preview · sample books"}
          </p>
        )}
      </aside>
    </>
  );
}
