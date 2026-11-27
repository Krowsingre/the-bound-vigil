// Attune › Account on a computer (embre, 27 November): the first page built to the
// Attune design framework. Two sections side by side when there's room: Profile
// (picture, your name, this device's name, friend code) and Friends. No page title
// and no flavour text; spacing comes from the shared .attune tokens in settings.css.
// The older Visage page stays until embre says it can go.

import { useEffect, useId, useState } from "react";
import { api, isAndroid, isIOS } from "../api";
import type { Friend, Profile } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { FriendRow, PROFILE_CHANGED } from "./ProfileSection";

/** Error text as a sentence. */
const sentence = (e: unknown) => {
  const text = String(e).replace(/^Error: /, "");
  return text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? "" : ".");
};

/** One labelled control with an optional hint under it. */
function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="attune-field">
      <label className="attune-label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <small className="attune-hint">{hint}</small>}
    </div>
  );
}

/** A name saved when it loses focus or Enter is pressed. */
function NameInput({ id, value, placeholder, onSave }: { id: string; value: string; placeholder: string; onSave: (name: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      id={id}
      className="attune-input"
      value={text}
      maxLength={60}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== value.trim() && onSave(text)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

function ProfilePart() {
  const toast = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
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
  const failed = (e: unknown) => toast(sentence(e));
  const choose = () =>
    api.chooseAvatar().then(
      (p) => p && saved(p),
      (e: unknown) => toast(`That picture couldn't be used: ${String(e)}`),
    );
  const avatar = profile?.avatarPath ? api.coverUrl(profile.avatarPath) : "";
  const copy = (code: string) =>
    void navigator.clipboard?.writeText(code).then(
      () => toast("Friend code copied."),
      () => toast("Couldn't copy it. Select the code and copy it instead."),
    );
  return (
    <section className="attune-section" id="settings-account-profile" aria-labelledby="account-profile-head">
      <h2 className="attune-section-head" id="account-profile-head">
        Profile
      </h2>
      <div className="account-picture-row">
        <span className="profile-picture" aria-hidden>
          {avatar ? <img src={avatar} alt="" draggable={false} /> : <Icon name="image" size={22} />}
        </span>
        <div className="attune-buttons">
          <button type="button" className="btn btn-quiet" onClick={() => void choose()}>
            <Icon name="image" size={16} /> {avatar ? "Change picture…" : "Choose a picture…"}
          </button>
          {avatar && (
            <button type="button" className="btn btn-quiet" onClick={() => void api.clearAvatar().then(saved, failed)}>
              Remove
            </button>
          )}
        </div>
      </div>
      <div className="attune-columns">
        <Field label="Your name" hint="Shown with your picture on every device signed in to this library.">
          {(id) => <NameInput id={id} value={profile?.name ?? ""} placeholder="Your name" onSave={(name) => void api.setAccountName(name).then(saved, failed)} />}
        </Field>
        <Field label="This device's name" hint="What your other devices call this one. Leave it empty for the name it started with.">
          {(id) => <NameInput id={id} value={profile?.deviceName ?? ""} placeholder="Like embre's PC" onSave={(name) => void api.setDeviceName(name).then(saved, failed)} />}
        </Field>
      </div>
      {profile?.friendCode && (
        <Field label="Friend code" hint="The same on all your devices. Give it to friends so they can save you.">
          {(id) => (
            <div className="attune-inline">
              <output id={id} className="attune-input account-code" aria-label="Your friend code">
                {profile.friendCode}
              </output>
              <button type="button" className="btn btn-quiet" onClick={() => copy(profile.friendCode!)}>
                <Icon name="copy" size={16} /> Copy
              </button>
            </div>
          )}
        </Field>
      )}
    </section>
  );
}

/** Where friends can't be reached yet: only the Apple devices will connect to friends. */
const NO_FRIENDS_YET = !isIOS && !isAndroid;

function FriendsPart() {
  const toast = useToast();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const load = () => void api.friends().then(setFriends, (e: unknown) => setError(sentence(e)));
    load();
    // Friends saved on another device arrive with a sync.
    return api.onSync({ libraryChanged: load });
  }, []);
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
      setError(sentence(e));
    } finally {
      setBusy(false);
    }
  };
  const rename = (friend: Friend, to: string) => api.saveFriend(friend.code, to).then(setFriends, (e: unknown) => toast(sentence(e)));
  const remove = (friend: Friend) => api.removeFriend(friend.code).then(setFriends, (e: unknown) => toast(sentence(e)));
  return (
    <section className="attune-section" id="settings-account-friends" aria-labelledby="account-friends-head">
      <h2 className="attune-section-head" id="account-friends-head">
        Friends
      </h2>
      <form
        className="account-add"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Friend code">
          {(id) => (
            <input
              id={id}
              className="attune-input oathkin-code-input"
              value={code}
              placeholder="TBV-7K3Q-9F2M"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              maxLength={20}
              onChange={(e) => (setCode(e.target.value), setError(""))}
            />
          )}
        </Field>
        <Field label="What to call them">
          {(id) => <input id={id} className="attune-input" value={name} maxLength={60} placeholder="Optional" onChange={(e) => setName(e.target.value)} />}
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
          <Icon name="plus" size={16} /> {busy ? "Saving…" : "Save friend"}
        </button>
      </form>
      {error ? (
        <p className="attune-error" role="alert">
          {error}
        </p>
      ) : (
        <small className="attune-hint">
          {NO_FRIENDS_YET ? "Friends can't connect on the computer yet. Codes you save here go to all your devices." : "Codes you save here go to all your devices."}
        </small>
      )}
      {friends === null ? (
        <p className="attune-hint">Loading…</p>
      ) : friends.length === 0 ? (
        <p className="attune-hint account-empty">No friends saved yet.</p>
      ) : (
        <ul className="oathkin-list account-friends">
          {friends.map((friend) => (
            <FriendRow key={friend.code} friend={friend} onRename={(to) => void rename(friend, to)} onRemove={() => void remove(friend)} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function AccountPage() {
  return (
    <div className="attune-page">
      <ProfilePart />
      <FriendsPart />
    </div>
  );
}
