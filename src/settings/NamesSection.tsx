// Preferences › Sync & Accounts › Names: the account's name, the same on every
// device, and this device's own name, which other devices see in Grimoire
// and in sync's notes.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { Profile } from "../api/types";
import { useToast } from "../components/Toast";
import { Section } from "./controls";

/** Sent on window with the new profile, so the sync circle shows it at once. */
export const PROFILE_CHANGED = "tbv-profile-changed";

function NameField({ label, hint, value, placeholder, onSave }: { label: string; hint: string; value: string; placeholder: string; onSave: (name: string) => Promise<void> }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const save = () => {
    if (text.trim() !== value.trim()) void onSave(text);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={text}
        maxLength={60}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
      <small className="settings-row-hint">{hint}</small>
    </label>
  );
}

export function NamesSection() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const toast = useToast();
  useEffect(() => {
    api.getProfile().then(setProfile, () => undefined);
  }, []);
  const saved = (p: Profile) => {
    setProfile(p);
    window.dispatchEvent(new CustomEvent(PROFILE_CHANGED, { detail: p }));
  };
  return (
    <Section id="names" title="Names" lede="Your name goes with your profile picture to every device. Each device has a name of its own too.">
      <div className="names-fields">
        <NameField
          label="Your name"
          hint="Shown with your picture on every device signed in to this library."
          value={profile?.name ?? ""}
          placeholder="Your name"
          onSave={(name) => api.setAccountName(name).then(saved, (e: unknown) => toast(String(e)))}
        />
        <NameField
          label="This device's name"
          hint="What your other devices call this one, in Grimoire and in sync. Leave it empty for the name it started with."
          value={profile?.deviceName ?? ""}
          placeholder="Like embre's iPad"
          onSave={(name) => api.setDeviceName(name).then(saved, (e: unknown) => toast(String(e)))}
        />
      </div>
    </Section>
  );
}
