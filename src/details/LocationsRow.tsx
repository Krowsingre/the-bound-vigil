// A book's details: where its file is. This device, your other devices and
// your sync places each say whether they hold it, so the list is as fresh as
// the last sync. A book a phone fetched just to open can be kept there.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { BookLocation } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { useAppSettings } from "../settings/appSettings";

const ICON = { computer: "computer", phone: "phone", place: "cloud" } as const;

function keepFor(days: number): string {
  return days === 7 ? "a week" : days === 30 ? "a month" : `${days / 7} weeks`;
}

export function LocationsRow({ bookId, refreshKey, fallback }: { bookId: string; refreshKey: number; fallback: string }) {
  const toast = useToast();
  const { settings } = useAppSettings();
  const [places, setPlaces] = useState<BookLocation[] | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    api.bookLocations(bookId).then(
      (list) => current && setPlaces(list),
      () => current && setPlaces([]),
    );
    return () => {
      current = false;
    };
  }, [bookId, refreshKey, reload]);

  const keep = async () => {
    try {
      await api.keepDownload(bookId, true);
      setReload((n) => n + 1);
      toast("Kept on this device for good.");
    } catch (e) {
      toast(`Couldn't keep it: ${String(e)}`);
    }
  };

  const days = settings.sync.phoneKeepDays;
  return (
    <div>
      <dt>Where it is</dt>
      <dd>
        {places === null || places.length === 0 ? (
          fallback
        ) : (
          <ul className="details-locations">
            {places.map((p) => (
              <li key={`${p.kind}:${p.name}:${p.here}`}>
                <Icon name={ICON[p.kind]} size={14} />
                <span>{p.name}</span>
                {p.here && <span className="details-origin">This device</span>}
                {p.temporary && days > 0 && (
                  <>
                    <span className="details-origin">Removed after {keepFor(days)} unopened</span>
                    <button type="button" className="view-all" onClick={() => void keep()}>
                      Keep
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}
