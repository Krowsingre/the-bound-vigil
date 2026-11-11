import { FinishedDownloadPrompt } from "../library/FinishedDownloadPrompt";
import { useEffect, useRef, useState } from "react";
import { App } from "../App";
import { SplitDivider } from "../browse/SplitDivider";
import { clearWorkspaceBrowser } from "../browse/workspaceBrowser";
import { api, isAndroid, isHome, isIOS, isWeb } from "../api";
import { runBeforeQuit } from "../lib/beforeQuit";
import { navFor, type Route } from "./routes";
import { workspaceFrame, workspaceHost } from "./workspaceFrame";

const routes = [...navFor({ web: isWeb, home: isHome, android: isAndroid }).map(({ route }) => route), "imports", "lining"];
const canSplit = !isHome && !isWeb && !isAndroid && (api.kind === "app" || api.kind === "preview");
const isAppBrowser = () => api.kind === "app" && !isAndroid;
function isRefreshShortcut(event: KeyboardEvent) {
  return (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "r";
}
const narrowSplit = "(max-width: 760px), (max-aspect-ratio: 1/1) and (pointer: coarse)";

function requestedRoute() {
  const route = new URLSearchParams(location.search).get("workspace");
  return routes.find((entry) => entry === route) as Route | undefined;
}

export function Workspace() {
  const [route, setRoute] = useState<Route | null>(null);
  const [ratio, setRatio] = useState(50);
  const [compactReader, setCompactReader] = useState(false);
  const [stacked, setStacked] = useState(() => matchMedia(narrowSplit).matches);
  const [primaryRoute, setPrimaryRoute] = useState<Route>();
  const [secondaryRoute, setSecondaryRoute] = useState<Route>();
  const frame = useRef<HTMLIFrameElement>(null);
  const primary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (workspaceFrame) return;
    const query = matchMedia(narrowSplit);
    const change = () => setStacked(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    if (workspaceFrame) {
      const host = workspaceHost.tbvWorkspace;
      if (host) host.flush = () => runBeforeQuit();
      const shortcut = (event: KeyboardEvent) => {
        if (!isRefreshShortcut(event)) return;
        event.preventDefault();
        void host?.refresh?.();
      };
      window.addEventListener("keydown", shortcut);
      return () => {
        window.removeEventListener("keydown", shortcut);
        if (host) delete host.flush;
      };
    }
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      frame.current?.setAttribute("data-tbv-closing", "");
      await Promise.allSettled([runBeforeQuit(), workspaceHost.tbvWorkspace?.flush?.()]);
      workspaceHost.tbvWorkspace?.dispose?.();
      if (isAppBrowser()) await clearWorkspaceBrowser(false).catch(() => undefined);
      window.location.reload();
    };
    const host = { refresh, open: (next: string) => {
      const found = routes.find((entry) => entry === next) as Route | undefined;
      if (found) setPrimaryRoute(found);
    } };
    workspaceHost.tbvWorkspace = host;
    const shortcut = (event: KeyboardEvent) => {
      if (!isRefreshShortcut(event)) return;
      event.preventDefault();
      void refresh();
    };
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("keydown", shortcut);
      delete workspaceHost.tbvWorkspace;
    };
  }, []);

  useEffect(() => {
    if (!secondaryRoute || !frame.current?.contentWindow) return;
    const target = frame.current.contentWindow;
    target.dispatchEvent(new CustomEvent("tbv:workspace-navigate", { detail: secondaryRoute }));
    setSecondaryRoute(undefined);
  }, [secondaryRoute]);

  useEffect(() => {
    if (workspaceFrame || !route) return;
    const watcher = new MutationObserver(() => window.dispatchEvent(new Event("tbv:workspace-layout")));
    watcher.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => watcher.disconnect();
  }, [route]);

  useEffect(() => {
    if (!route || !primary.current) return;
    const pane = primary.current;
    const measure = () => setCompactReader(pane.clientWidth <= 760);
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    measure();
    return () => observer.disconnect();
  }, [route]);

  if (workspaceFrame) return <>
    <App workspaceSplit initialRoute={requestedRoute()} onSplit={(next) => workspaceHost.tbvWorkspace?.open(next)} />
    <FinishedDownloadPrompt />
  </>;

  const open = (next: Route) => {
    if (!route) setRoute(next);
    else setSecondaryRoute(next);
  };
  const close = async () => {
    frame.current?.setAttribute("data-tbv-closing", "");
    await workspaceHost.tbvWorkspace?.flush?.().catch(() => undefined);
    workspaceHost.tbvWorkspace?.dispose?.();
    if (isAppBrowser()) void clearWorkspaceBrowser(true).catch(() => undefined);
    setRoute(null);
    primary.current?.focus();
  };

  return (
    <div className={`tbv-workspaces${route ? " is-split" : ""}${stacked ? " is-stacked" : ""}`}
      style={route ? { [stacked ? "gridTemplateRows" : "gridTemplateColumns"]: `minmax(0, ${ratio}fr) 12px minmax(0, ${100 - ratio}fr)` } : undefined}>
      <div ref={primary} tabIndex={-1} className="tbv-workspace-primary" aria-label="Primary TBV pane">
        <App onSplit={canSplit ? open : undefined} workspaceSplit={!!route} compactReader={!!route && compactReader} requestedRoute={primaryRoute}
          onRouteHandled={() => setPrimaryRoute(undefined)} />
        <FinishedDownloadPrompt />
      </div>
      {route && <>
        <SplitDivider value={ratio} onChange={setRatio} label="Resize TBV panes" minimum={isIOS || stacked ? 150 : 260} horizontal={stacked} />
        <div className="tbv-workspace-secondary">
          <div className="tbv-workspace-bar">
            <button type="button" className="btn btn-quiet" onClick={() => void close()}>Close split</button>
          </div>
          <iframe ref={frame} data-tbv-workspace="secondary" title="Secondary TBV pane"
            src={`${location.pathname}?workspace=${encodeURIComponent(route)}`} />
        </div>
      </>}
    </div>
  );
}
