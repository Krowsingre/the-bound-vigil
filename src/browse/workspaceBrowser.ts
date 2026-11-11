import { api } from "../api";
import type { BrowserPane } from "../api/types";
import { workspaceFrame, workspaceHost } from "../shell/workspaceFrame";

interface Placement {
  panes: BrowserPane[];
  active: string;
}

const host = workspaceHost as Window & {
  tbvBrowserLayout?: { panes: [Placement?, Placement?]; queue: Promise<unknown>; suspended?: boolean };
};

export function workspaceOffset() {
  const rect = workspaceFrame ? window.frameElement?.getBoundingClientRect() : null;
  return {
    x: rect?.left ?? 0,
    y: rect?.top ?? 0,
    resizing: host.document.body.classList.contains("split-resizing"),
  };
}

export function placeWorkspaceBrowser(panes: BrowserPane[], active: string) {
  if (workspaceFrame && (!window.frameElement?.isConnected || window.frameElement.hasAttribute("data-tbv-closing"))) return Promise.resolve();
  return queuePlacement(workspaceFrame ? 1 : 0, active ? { panes, active } : undefined);
}

export function clearWorkspaceBrowser(secondaryOnly: boolean) {
  return queuePlacement(1, undefined, !secondaryOnly);
}

function queuePlacement(index: 0 | 1, placement?: Placement, clearPrimary = false) {
  const layout = host.tbvBrowserLayout ??= { panes: [], queue: Promise.resolve() };
  if (clearPrimary) {
    layout.panes[0] = undefined;
    layout.suspended = true;
  } else if (layout.suspended) return layout.queue;
  layout.panes[index] = placement;
  const apply = () => {
    const placements = layout.panes.filter((entry): entry is Placement => !!entry);
    const shown = placements.flatMap((entry) => entry.panes).slice(0, 2);
    return shown.length ? api.browserLayout(shown, shown.find((pane) => pane.tab === placement?.active)?.tab ?? shown[0].tab) : api.browserHide();
  };
  const next = layout.queue.then(apply, apply);
  layout.queue = next;
  return next;
}
