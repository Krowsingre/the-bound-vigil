// Preferences › Appearance › Profile: the picture in the sync circle, the
// account's name (both the same on every device), and this device's own
// name, which other devices see in Grimoire and in sync's notes.

import { useEffect, useState } from "react";
import { api, isApp, isIOS, isWeb } from "../api";
import type { Profile } from "../api/types";
import { Icon } from "../components/Icon";
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

export function ProfileSection() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const toast = useToast();
  useEffect(() => {
    api.getProfile().then(setProfile, () => undefined);
  }, []);
  const saved = (p: Profile) => {
    setProfile(p);
    window.dispatchEvent(new CustomEvent(PROFILE_CHANGED, { detail: p }));
  };
  const choose = (from?: "photos" | "files") => {
    if (!isApp && !isWeb) return toast("Choosing a picture works in the desktop app.");
    api.chooseAvatar(from).then(
      (p) => p && saved(p),
      (e: unknown) => toast(`That picture couldn't be used: ${String(e)}`),
    );
  };
  const avatar = profile?.avatarPath ? api.coverUrl(profile.avatarPath) : "";
  return (
    <Section id="profile" title="Profile" lede="Your picture and name go to every device. Each device has a name of its own too.">
      <div className="profile-card">
        <span className="profile-picture" aria-hidden>
          {avatar ? <img src={avatar} alt="" draggable={false} /> : <Icon name="image" size={22} />}
        </span>
        <div className="profile-picture-actions">
          {isIOS ? (
            <>
              <button type="button" className="btn btn-quiet" onClick={() => choose("photos")}>
                <Icon name="image" size={16} /> From Photos
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => choose("files")}>
                <Icon name="folder" size={16} /> From Files
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => choose()}>
              <Icon name="image" size={16} /> {avatar ? "Change picture…" : "Choose a picture…"}
            </button>
          )}
          {avatar && (
            <button type="button" className="btn btn-quiet" onClick={() => api.clearAvatar().then(saved, (e: unknown) => toast(String(e)))}>
              Remove
            </button>
          )}
        </div>
      </div>
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
