// Preferences › Profile (its own page, below About): the picture in the sync circle, the
// account's name (both the same on every device), and this device's own
// name, which other devices see in Grimoire and in sync's notes.

import { useEffect, useState } from "react";
import { api, isApp, isIOS, isWeb } from "../api";
import type { Profile } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { READER_NARROW, useNarrow } from "../lib/useNarrow";
import { Section } from "./controls";

/** Where Profile takes embre's phone design (20 November): phones, an iPad held upright, and the Duo folded. */
export const PROFILE_PHONE = READER_NARROW;

/** Sent on window with the new profile, so the sync circle shows it at once. */
export const PROFILE_CHANGED = "tbv-profile-changed";

function NameField({ label, hint, value, placeholder, onSave, icon }: { label: string; hint: string; value: string; placeholder: string; onSave: (name: string) => Promise<void>; icon?: "person" | "phone" }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const save = () => {
    if (text.trim() !== value.trim()) void onSave(text);
  };
  return (
    <label className={`field${icon ? " profile-field" : ""}`}>
      {icon ? (
        <span className="profile-field-label">
          <span className="profile-field-icon" aria-hidden>
            <Icon name={icon} size={18} />
          </span>
          {label}
        </span>
      ) : (
        <span>{label}</span>
      )}
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
    const load = () => void api.getProfile().then(setProfile, () => undefined);
    load();
    // A first sync can swap this device's new friend code for the library's own.
    return api.onSync({ libraryChanged: load });
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
  const phone = useNarrow(PROFILE_PHONE);
  const removeAvatar = () => api.clearAvatar().then(saved, (e: unknown) => toast(String(e)));
  const names = (icons: boolean) => (
    <>
      <NameField
        label="Your name"
        icon={icons ? "person" : undefined}
        hint="Shown with your picture on every device signed in to this library."
        value={profile?.name ?? ""}
        placeholder="Your name"
        onSave={(name) => api.setAccountName(name).then(saved, (e: unknown) => toast(String(e)))}
      />
      <NameField
        label="This device's name"
        icon={icons ? "phone" : undefined}
        hint="What your other devices call this one, in Grimoire and in sync. Leave it empty for the name it started with."
        value={profile?.deviceName ?? ""}
        placeholder="Like embre's iPad"
        onSave={(name) => api.setDeviceName(name).then(saved, (e: unknown) => toast(String(e)))}
      />
    </>
  );
  // embre's design for phones, an upright iPad and the folded Duo: no headings or
  // flavour text, the picture with its buttons beside it, then the names and the friend code.
  if (phone)
    return (
      <section className="settings-section profile-phone" id="settings-profile" aria-label="Profile">
        <div className="profile-phone-picture">
          <span className="profile-picture is-large" aria-hidden>
            {avatar ? <img src={avatar} alt="" draggable={false} /> : <Icon name="image" size={28} />}
          </span>
          <div className="profile-phone-buttons">
            <button type="button" className="btn btn-primary" onClick={() => choose(isIOS ? "photos" : undefined)}>
              <Icon name="image" size={18} /> {isIOS ? "Choose Photo" : avatar ? "Change picture" : "Choose picture"}
            </button>
            <div className="profile-phone-row">
              {isIOS && (
                <button type="button" className="btn btn-quiet" onClick={() => choose("files")}>
                  <Icon name="folder" size={18} /> Choose File
                </button>
              )}
              {avatar && (
                <button type="button" className="btn btn-quiet" onClick={removeAvatar}>
                  <Icon name="trash" size={18} /> Remove
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="profile-phone-fields">
          {names(true)}
          {profile?.friendCode && <FriendCode code={profile.friendCode} />}
        </div>
      </section>
    );
  return (
    <Section id="profile" title="Picture and names" lede="Your picture and name go to every device. Each device has a name of its own too.">
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
        {names(false)}
      </div>
    </Section>
  );
}

/** The library's friend code, to give to friends once the friends list arrives. */
function FriendCode({ code }: { code: string }) {
  const toast = useToast();
  const copy = () =>
    void navigator.clipboard?.writeText(code).then(
      () => toast("Friend code copied."),
      () => toast("Couldn't copy it. Press and hold the code to copy it instead."),
    );
  return (
    <div className="field profile-field">
      <span className="profile-field-label">
        <span className="profile-field-icon" aria-hidden>
          <Icon name="connections" size={18} />
        </span>
        Friend code
      </span>
      <div className="profile-code">
        <output className="profile-code-text" aria-label="Your friend code">
          {code}
        </output>
        <button type="button" className="btn btn-quiet" onClick={copy}>
          <Icon name="copy" size={18} /> Copy
        </button>
      </div>
      <small className="settings-row-hint">The same on all your devices. Friends will add you with it once the friends list arrives.</small>
    </div>
  );
}
