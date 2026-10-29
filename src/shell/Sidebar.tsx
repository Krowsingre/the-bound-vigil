import emblem from "../assets/emblem.svg?raw";
import { Icon } from "../components/Icon";
import { navFor, navRouteOf, type Route } from "./routes";
import { isHome, isWeb } from "../api";
import { useEffect, useState } from "react";
import { showBookDetails } from "../details/openDetails";
import { liningUp as liningUpNow, onLiningUp, type LiningUp } from "../readAlong/lineUp";

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
  return (
    <>
      {drawerOpen && <div className="sidebar-backdrop" aria-hidden onClick={onCloseDrawer} />}
      <aside className={`sidebar${collapsed ? " is-collapsed" : ""}${drawerOpen ? " is-drawer-open" : ""}`}>
        {drawerOpen && (
          <button type="button" className="sidebar-close" aria-label="Close the menu" onClick={onCloseDrawer}>
            <Icon name="menu" size={22} />
          </button>
        )}
        <div className="sidebar-top" data-tauri-drag-region>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={`${collapsed ? "Expand" : "Collapse"} sidebar (Ctrl+\\)`}
          >
            <Icon name="more" size={20} />
          </button>
        </div>

        <div className="brand" data-tauri-drag-region>
          <span className="brand-emblem" aria-hidden dangerouslySetInnerHTML={{ __html: emblem }} />
          {!collapsed && (
            <>
              <span className="brand-name">The Bound Vigil</span>
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
                  onClick={() => showBookDetails(lining.ebookId)}
                  title={`Lining up ${lining.title || "a book"} with its audiobook: ${liningPercent}%`}
                >
                  <Icon name="headphones" size={20} />
                  <span className="nav-label">
                    Lining up
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
