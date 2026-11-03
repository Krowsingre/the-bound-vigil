// Making a cover or picture in Canva (embre, 3 November 2026): until TBV can
// sign in to Canva, this opens Canva with the size to use, and the finished
// file comes back through the button beside it.

import type { ReactNode } from "react";
import { openExternal } from "../api";
import { useToast } from "../components/Toast";

export const CANVA_URL = "https://www.canva.com/";

export function CanvaLink({ what, size, extra }: { what: string; size: string; extra?: ReactNode }) {
  const toast = useToast();
  return (
    <div className="canva-link">
      <span className="canva-link-head">Rather design it in Canva?</span>
      <p className="settings-row-hint">
        Open Canva, choose Create a design › Custom size, and make {what} at <strong>{size}</strong>. Download it when it's done
        {extra ? ", then bring it back here." : "."}
      </p>
      <span className="canva-link-buttons">
        <button type="button" className="btn btn-quiet btn-small" onClick={() => void openExternal(CANVA_URL)}>
          Open Canva
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-small"
          onClick={() => void navigator.clipboard?.writeText(size).then(() => toast(`Copied ${size}.`), () => toast(`The size is ${size}.`))}
        >
          Copy the size
        </button>
        {extra}
      </span>
    </div>
  );
}
