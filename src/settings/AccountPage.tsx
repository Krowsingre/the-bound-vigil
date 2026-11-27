// Attunement › Account on a computer (embre, 27 November): Visage (picture, Moniker,
// Conduit, Signet with Copy and Share) and Oathkin, one under the other, each folding.
// No page title and no flavour text; spacing comes from the shared .attune tokens.

import { useEffect, useId, useState } from "react";
import { api } from "../api";
import type { Friend, Profile } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { FriendRow, PROFILE_CHANGED } from "./ProfileSection";
import { AtPage, AtSection } from "./attune";

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
    // A first sync can swap this device's new Signet for the library's own.
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
      () => toast("Signet copied."),
      () => toast("Couldn't copy it. Select the Signet and copy it instead."),
    );
  // Windows' own Share panel; elsewhere the browser's, if it has one.
  const share = (code: string) => {
    const shared = api.shareText
      ? api.shareText(code, "My Signet")
      : typeof navigator.share === "function"
        ? navigator.share({ title: "My Signet", text: code })
        : Promise.reject(new Error("Sharing isn't available here. Copy it instead."));
    void shared.catch((e: unknown) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast(sentence(e));
    });
  };
  return (
    <AtSection id="account-profile" title="Visage" also={["profile"]}>
      <div className="account-visage">
        <div className="account-visage-picture">
          <span className="profile-picture" aria-hidden>
            {avatar ? <img src={avatar} alt="" draggable={false} /> : <Icon name="image" size={22} />}
          </span>
          <button type="button" className="btn btn-quiet" onClick={() => void choose()}>
            Choose picture…
          </button>
          {avatar && (
            <button type="button" className="link-btn" onClick={() => void api.clearAvatar().then(saved, failed)}>
              Remove
            </button>
          )}
        </div>
        <div className="account-visage-fields">
          <Field label="Moniker">
            {(id) => <NameInput id={id} value={profile?.name ?? ""} placeholder="Your name" onSave={(name) => void api.setAccountName(name).then(saved, failed)} />}
          </Field>
          <Field label="Conduit">
            {(id) => <NameInput id={id} value={profile?.deviceName ?? ""} placeholder="This device's name" onSave={(name) => void api.setDeviceName(name).then(saved, failed)} />}
          </Field>
          {profile?.friendCode && (
            <Field label="Signet">
              {(id) => (
                <div className="attune-inline">
                  <output id={id} className="attune-input account-code" aria-label="Your Signet">
                    {profile.friendCode}
                  </output>
                  <button type="button" className="btn btn-quiet" onClick={() => copy(profile.friendCode!)}>
                    Copy
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => share(profile.friendCode!)}>
                    Share
                  </button>
                </div>
              )}
            </Field>
          )}
        </div>
      </div>
    </AtSection>
  );
}

/**
 * Oathkin: friends saved by their Signet. A computer can't bind new oaths yet, so there's no
 * Bind Oathkin or Sever bond here; Monikers can always be changed (embre, 27 November).
 */
function OathkinPart() {
  const toast = useToast();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  useEffect(() => {
    const load = () => void api.friends().then(setFriends, (e: unknown) => toast(sentence(e)));
    load();
    // Oathkin saved on another device arrive with a sync.
    return api.onSync({ libraryChanged: load });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rename = (friend: Friend, to: string) => api.saveFriend(friend.code, to).then(setFriends, (e: unknown) => toast(sentence(e)));
  return (
    <AtSection id="account-friends" title="Oathkin" also={["oathkin"]}>
      {friends === null ? null : friends.length === 0 ? (
        <p className="attune-hint">No oaths yet sworn.</p>
      ) : (
        <ul className="oathkin-list account-friends">
          {friends.map((friend) => (
            <FriendRow key={friend.code} friend={friend} onRename={(to) => void rename(friend, to)} />
          ))}
        </ul>
      )}
      <p className="attune-hint account-foot">This Conduit cannot bind new oaths, but honors those sworn through compatible Conduits.</p>
    </AtSection>
  );
}

export function AccountPage() {
  return (
    <AtPage>
      <ProfilePart />
      <OathkinPart />
    </AtPage>
  );
}
