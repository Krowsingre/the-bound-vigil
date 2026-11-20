// Preferences › Visage (its own page, below About): the picture in the sync circle, the
// account's name (both the same on every device), this device's own name,
// which other devices see in Grimoire and in sync's notes, and the friend code.
// Oathkin, on the switch at the top in place of a heading (embre, 20 November),
// keeps the friends saved by their friend codes.

import { useEffect, useState } from "react";
import { api, isAndroid, isApp, isIOS, isWeb } from "../api";
import type { Friend, Profile } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { READER_NARROW, useNarrow } from "../lib/useNarrow";
import { PageSwitch } from "../library/Library";
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

type Side = "visage" | "oathkin";

/** The page: Visage or Oathkin, on a switch at the top centre. */
export function ProfileSection() {
  const [side, setSide] = useState<Side>("visage");
  // A search result for Oathkin, or the sync circle's Visage card, picks its side.
  useEffect(() => {
    const pick = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id === "oathkin") setSide("oathkin");
      else if (id === "profile") setSide("visage");
    };
    window.addEventListener("tbv:unfold-section", pick);
    return () => window.removeEventListener("tbv:unfold-section", pick);
  }, []);
  return (
    <>
      <div className="profile-switch">
        <PageSwitch
          label="Visage or Oathkin"
          value={side}
          options={[
            { value: "visage", label: "Visage" },
            { value: "oathkin", label: "Oathkin" },
          ]}
          onChange={setSide}
        />
      </div>
      {side === "visage" ? <Visage /> : <Oathkin />}
    </>
  );
}

function Visage() {
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
      <section className="settings-section profile-phone" id="settings-profile" aria-label="Visage">
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
      {profile?.friendCode && (
        <div className="profile-code-row">
          <FriendCode code={profile.friendCode} />
        </div>
      )}
    </Section>
  );
}

/** The library's friend code, to give to friends for their Oathkin. */
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
      <small className="settings-row-hint">The same on all your devices. Give it to friends so they can save you in their Oathkin.</small>
    </div>
  );
}

/** Where friends can't be reached yet: only the Apple devices will connect to friends. */
const NO_FRIENDS_YET = !isIOS && !isAndroid;

/** Oathkin: friends saved by their friend codes, on every device. */
function Oathkin() {
  const toast = useToast();
  const phone = useNarrow(PROFILE_PHONE);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.friends().then(setFriends, (e: unknown) => setError(String(e).replace(/^Error: /, "")));
  }, []);
  const words = (e: unknown) => {
    const text = String(e).replace(/^Error: /, "");
    return text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? "" : ".");
  };
  const save = async () => {
    if (busy || !code.trim()) return;
    setBusy(true);
    setError("");
    try {
      setFriends(await api.saveFriend(code, name));
      setCode("");
      setName("");
      toast("Friend saved.");
    } catch (e) {
      setError(words(e));
    } finally {
      setBusy(false);
    }
  };
  const rename = (friend: Friend, to: string) =>
    api.saveFriend(friend.code, to).then(setFriends, (e: unknown) => toast(words(e)));
  const remove = (friend: Friend) =>
    api.removeFriend(friend.code).then(setFriends, (e: unknown) => toast(words(e)));
  return (
    <section className={`settings-section oathkin${phone ? " profile-phone" : ""}`} id="settings-oathkin" aria-label="Oathkin">
      <form
        className="oathkin-add"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="field profile-field">
          <span className="profile-field-label">
            <span className="profile-field-icon" aria-hidden>
              <Icon name="connections" size={18} />
            </span>
            Friend code
          </span>
          <input
            className="oathkin-code-input"
            value={code}
            placeholder="TBV-7K3Q-9F2M"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            onChange={(e) => (setCode(e.target.value), setError(""))}
          />
        </label>
        <label className="field profile-field">
          <span className="profile-field-label">
            <span className="profile-field-icon" aria-hidden>
              <Icon name="person" size={18} />
            </span>
            What to call them
          </span>
          <input value={name} maxLength={60} placeholder="Their name (you can leave it empty)" onChange={(e) => setName(e.target.value)} />
        </label>
        {error && (
          <p className="oathkin-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
          <Icon name="plus" size={18} /> {busy ? "Saving…" : "Save friend"}
        </button>
        <small className="settings-row-hint">
          {NO_FRIENDS_YET
            ? "Friends can't connect on the computer yet. Codes you save here go to all your devices."
            : "Codes you save here go to all your devices."}
        </small>
      </form>
      <div className="oathkin-list-head">Your Oathkin</div>
      {friends === null ? (
        <p className="muted">Loading…</p>
      ) : friends.length === 0 ? (
        <p className="muted">No friends saved yet. Ask a friend for the code on their Visage.</p>
      ) : (
        <ul className="oathkin-list">
          {friends.map((friend) => (
            <FriendRow key={friend.code} friend={friend} onRename={(to) => void rename(friend, to)} onRemove={() => void remove(friend)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FriendRow({ friend, onRename, onRemove }: { friend: Friend; onRename: (name: string) => void; onRemove: () => void }) {
  const [text, setText] = useState(friend.name ?? "");
  useEffect(() => setText(friend.name ?? ""), [friend.name]);
  const save = () => {
    if (text.trim() !== (friend.name ?? "").trim()) onRename(text);
  };
  return (
    <li className="oathkin-friend">
      <span className="profile-field-icon" aria-hidden>
        <Icon name="person" size={18} />
      </span>
      <span className="oathkin-friend-text">
        <input
          className="oathkin-friend-name"
          aria-label={`What to call ${friend.code}`}
          value={text}
          maxLength={60}
          placeholder="No name yet"
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        />
        <span className="oathkin-friend-code">{friend.code}</span>
      </span>
      <button type="button" className="btn btn-quiet" onClick={onRemove} aria-label={`Remove ${friend.name || friend.code}`}>
        <Icon name="trash" size={18} /> Remove
      </button>
    </li>
  );
}
