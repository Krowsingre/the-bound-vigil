// The Site information sheet, from the lock in the address box: whether the
// connection is secure, and this site's own choices (protection, zoom, the
// desktop version on iPhone and iPad), clearing its data, and sharing it.

import { useEffect, useState } from "react";
import { isIOS } from "../api";
import { Icon } from "../components/Icon";
import { Toggle } from "../settings/controls";
import { onBrowserPrefs, readBrowserPrefs, siteOf, siteSettings, ZOOMS, zoomLabel } from "./browserPrefs";
import { SiteBadge } from "./SiteBadge";

export interface SiteActions {
  onProtection: (lowered: boolean) => void;
  onZoom: (zoom: number) => void;
  onDesktop: (desktop: boolean) => void;
  onClearData: () => void;
  onCopy: () => void;
  onShare: () => void;
  onClose: () => void;
}

export function SiteInfo({ url, actions }: { url: string; actions: SiteActions }) {
  const [prefs, setPrefs] = useState(readBrowserPrefs);
  const [clearing, setClearing] = useState(false);
  useEffect(() => onBrowserPrefs(() => setPrefs(readBrowserPrefs())), []);
  const site = siteOf(url) ?? url;
  const secure = /^https:/i.test(url);
  const own = siteSettings(site, prefs);
  const zoom = own.zoom ?? 1;
  const at = ZOOMS.indexOf(zoom);
  const step = (by: number) => {
    // A size between the steps (none today) goes to the nearest one.
    const from = at >= 0 ? at : ZOOMS.findIndex((z) => z > zoom) - (by > 0 ? 1 : 0);
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, from + by))];
    if (next !== zoom) actions.onZoom(next);
  };
  const lowered = prefs.lowered.includes(site);

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && actions.onClose()}>
      <div className="dialog site-info" role="dialog" aria-label={`About ${site}`} onKeyDown={(e) => e.key === "Escape" && actions.onClose()}>
        <header className="catalogues-head">
          <SiteBadge url={url} title={site} size={28} />
          <h2>{site}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={actions.onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <p className={`site-info-secure${secure ? "" : " is-unsafe"}`}>
          <Icon name={secure ? "lock" : "warning"} size={18} />
          <span>
            <b>{secure ? "Connection is secure" : "Not secure"}</b>
            <span className="muted">
              {secure ? "What you send and see here is private between you and the site." : "Don't type passwords or card numbers on this page."}
            </span>
          </span>
        </p>

        <div className="site-info-rows">
          <Toggle
            label="Protection"
            hint={prefs.protection === "off" ? "Protection is off for every site in Preferences › Discover." : lowered ? "Lowered for this site, so it can work properly." : "Trackers and the like are blocked here."}
            checked={prefs.protection !== "off" && !lowered}
            disabled={prefs.protection === "off"}
            onChange={(on) => actions.onProtection(!on)}
          />

          <div className="site-info-row">
            <span>
              <b>Zoom</b>
              <span className="muted">How large its pages are.</span>
            </span>
            <span className="site-info-zoom">
              <button type="button" className="icon-btn" aria-label="Smaller" disabled={zoom <= ZOOMS[0]} onClick={() => step(-1)}>
                <Icon name="minus" size={16} />
              </button>
              <output aria-live="polite">{zoomLabel(zoom)}</output>
              <button type="button" className="icon-btn" aria-label="Larger" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => step(1)}>
                <Icon name="plus" size={16} />
              </button>
              {zoom !== 1 && (
                <button type="button" className="btn btn-quiet btn-small" onClick={() => actions.onZoom(1)}>
                  Reset
                </button>
              )}
            </span>
          </div>

          {isIOS && <Toggle label="Desktop version" hint="Show this site as it looks on a computer." checked={!!own.desktop} onChange={actions.onDesktop} />}

          <div className="site-info-row">
            <span>
              <b>This site's data</b>
              <span className="muted">Its cookies and stored data. Clearing them signs you out of {site}.</span>
            </span>
            {clearing ? (
              <span className="site-info-confirm">
                <button type="button" className="btn btn-danger btn-small" onClick={() => (setClearing(false), actions.onClearData())}>
                  Clear
                </button>
                <button type="button" className="btn btn-quiet btn-small" onClick={() => setClearing(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setClearing(true)}>
                Clear…
              </button>
            )}
          </div>
        </div>

        <div className="site-info-actions">
          <button type="button" className="btn btn-quiet" onClick={actions.onCopy}>
            <Icon name="copy" size={15} /> Copy link
          </button>
          <button type="button" className="btn btn-quiet" onClick={actions.onShare}>
            <Icon name="share" size={15} /> Share…
          </button>
        </div>
      </div>
    </div>
  );
}
