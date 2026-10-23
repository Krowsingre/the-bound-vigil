// Preferences › Sync › Books for your phone: whether Supabase (the phone's
// place) gets every book on this computer, or only the ones chosen for the
// phone. Books are chosen with "Send to device" on a book's menu, or asked
// for from the phone itself.

import type { SyncOverview } from "../api/types";
import { useAppSettings } from "./appSettings";
import { RadioList, Section } from "./controls";

export function PhoneSection({ overview }: { overview: SyncOverview }) {
  const { settings, changeSync } = useAppSettings();
  const supabase = (overview.provider.kind === "supabase" && !!overview.signedInAs) || overview.also?.provider.kind === "supabase";
  if (!supabase) return null;
  return (
    <Section id="phone" title="Books for your phone" lede="Which books Supabase keeps, so your phone can download them.">
      <RadioList<"all" | "chosen">
        label="Which books go to your phone"
        value={settings.sync.phoneChosenOnly ? "chosen" : "all"}
        options={[
          { value: "all", label: "Every book on this computer", hint: "As long as book files (and audiobook files) are synced to Supabase." },
          {
            value: "chosen",
            label: "Only the books I choose",
            hint: "Choose them with Send to device on a book's menu, or ask for one on the phone. Books the phone has downloaded always stay.",
          },
        ]}
        onChange={(v) => changeSync({ phoneChosenOnly: v === "chosen" })}
      />
      {settings.sync.phoneChosenOnly && (
        <p className="settings-row-hint">Tidy up Supabase (below) then removes the copies of books that weren't chosen.</p>
      )}
    </Section>
  );
}
