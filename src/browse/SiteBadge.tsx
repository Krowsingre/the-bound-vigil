// A site's icon on the start page and in the address suggestions.

import { siteOf } from "./browserPrefs";
import { useSiteIcon } from "./siteIcons";

/** A site's icon, or its first letter while there isn't one. */
export function SiteBadge({ url, title, size = 32 }: { url: string; title: string; size?: number }) {
  const icon = useSiteIcon(url);
  const letter = (title.trim() || siteOf(url) || "?").replace(/^www\./i, "")[0]?.toUpperCase() ?? "?";
  return (
    <span className="site-badge" style={{ width: size, height: size }} aria-hidden>
      {icon ? <img src={icon} alt="" width={size} height={size} /> : <span style={{ fontSize: size * 0.55 }}>{letter}</span>}
    </span>
  );
}
