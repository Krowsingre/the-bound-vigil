// A book's details: kept out of a Find alike group, with the way back in
// (embre, 21 November). Shown only while it's kept out.

import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "../components/Toast";

export function FindAlikeRow({ bookId, refreshKey }: { bookId: string; refreshKey: number }) {
  const toast = useToast();
  const [out, setOut] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    void api.keptOutOfAlike?.(bookId).then((o) => current && setOut(o), () => current && setOut(false));
    return () => {
      current = false;
    };
  }, [bookId, refreshKey, reload]);
  if (!out || !api.includeInAlike) return null;
  return (
    <div>
      <dt>Find alike</dt>
      <dd>
        Kept out of a group{" "}
        <button
          type="button"
          className="view-all"
          onClick={() => void api.includeInAlike?.(bookId).then(() => setReload((n) => n + 1), (e: unknown) => toast(String(e)))}
        >
          Include in Find alike
        </button>
      </dd>
    </div>
  );
}
