// A window over Attunement (embre, 28 November: "Manage…" lists and longer workflows open in
// windows rather than filling the page). Older sections drawn inside keep their own controls,
// without a card or heading of their own: the window's title names them.

import { Icon } from "../components/Icon";
import { AttuneFrame } from "./attune";
import { BareSections } from "./controls";

export function AtWindow({ title, onClose, className = "", children }: { title: string; onClose: () => void; className?: string; children: React.ReactNode }) {
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog at-window ${className}`.trim()} role="dialog" aria-label={title} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="shortcuts-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" autoFocus onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <AttuneFrame.Provider value={false}>
          <BareSections.Provider value={true}>
            <div className="at-window-body">{children}</div>
          </BareSections.Provider>
        </AttuneFrame.Provider>
      </div>
    </div>
  );
}
