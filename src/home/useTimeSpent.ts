import { useEffect, useState } from "react";
import { api } from "../api";
import { totals, type TimeTotals } from "../lib/timeSpent";

/** Time read and listened, every device's, fetched again when the page comes back into view or `refreshKey` changes. */
export function useTimeSpent(refreshKey = 0): TimeTotals | null {
  const [spent, setSpent] = useState<TimeTotals | null>(null);
  useEffect(() => {
    let current = true;
    const load = () =>
      api.timeSpent().then(
        (days) => current && setSpent(totals(days)),
        () => undefined,
      );
    void load();
    const shown = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", shown);
    return () => {
      current = false;
      document.removeEventListener("visibilitychange", shown);
    };
  }, [refreshKey]);
  return spent;
}
