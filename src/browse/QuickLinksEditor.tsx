// The start page's Edit ›: add, rename, move, take off and choose the
// painting of each Quick Link. Changes save as they're made, and sync.

import { useState } from "react";
import { api } from "../api";
import type { QuickLink } from "../api/types";
import { GALLERY, galleryUrl } from "../collections/gallery";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { addressFor, isAddress, readableAddress } from "./browserPrefs";
import { SiteBadge } from "./SiteBadge";

/** A painting no Quick Link has yet, or any when all are taken. */
export function freePainting(used: string[]): string {
  const free = GALLERY.filter((g) => !used.includes(g.name));
  const from = free.length ? free : GALLERY;
  return from[Math.floor(Math.random() * from.length)].name;
}

interface Draft {
  /** Null for a new one. */
  id: string | null;
  title: string;
  url: string;
  picture: string;
}

export function QuickLinksEditor({ links, onChanged, onClose }: { links: QuickLink[]; onChanged: () => Promise<unknown>; onClose: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      await onChanged();
      return true;
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    // Typed without "https://" is fine; words alone aren't an address.
    const url = isAddress(draft.url) ? addressFor(draft.url) : null;
    if (!url) {
      toast("Type the site's address, such as standardebooks.org.");
      return;
    }
    const ok = await run(() => (draft.id ? api.updateQuickLink(draft.id, draft.title, url, draft.picture) : api.addQuickLink(draft.title, url, draft.picture)));
    if (ok) setDraft(null);
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog quick-links-editor" role="dialog" aria-label="Edit Quick Links" onKeyDown={(e) => e.key === "Escape" && (draft ? setDraft(null) : onClose())}>
        <header className="catalogues-head">
          <h2>{draft ? (draft.id ? "Change Quick Link" : "Add a Quick Link") : "Quick Links"}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        {draft ? (
          <form
            className="quick-link-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="field">
              <span>Name</span>
              <input value={draft.title} maxLength={80} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Standard Ebooks" />
            </label>
            <label className="field">
              <span>Address</span>
              <input value={draft.url} inputMode="url" autoCapitalize="off" spellCheck={false} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="standardebooks.org" />
            </label>
            <fieldset className="field">
              <legend>Painting</legend>
              <div className="picture-grid">
                {GALLERY.map((g) => (
                  <button key={g.name} type="button" aria-pressed={draft.picture === g.name} title={g.label} onClick={() => setDraft({ ...draft, picture: g.name })}>
                    <img src={galleryUrl(g.name, "square") ?? undefined} alt={g.label} loading="lazy" draggable={false} />
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="dialog-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setDraft(null)}>
                Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !draft.url.trim()}>
                {draft.id ? "Save" : "Add"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <ul className="browser-download-list quick-links-list">
              {links.map((l, i) => (
                <li key={l.id}>
                  <button type="button" className="browser-history-open" onClick={() => setDraft({ id: l.id, title: l.title, url: l.url, picture: l.picture })} title={`Change ${l.title}`}>
                    <SiteBadge url={l.url} title={l.title} size={24} />
                    <span className="browser-download-name">
                      <b>{l.title}</b>
                      <span className="muted">{readableAddress(l.url)}</span>
                    </span>
                    {galleryUrl(l.picture, "square") && <img className="quick-links-thumb" src={galleryUrl(l.picture, "square")!} alt="" />}
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Edit ${l.title}`} title="Edit" disabled={busy} onClick={() => setDraft({ id: l.id, title: l.title, url: l.url, picture: l.picture })}>
                    <Icon name="edit" size={16} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Move ${l.title} up`} disabled={busy || i === 0} onClick={() => void run(() => api.moveQuickLink(l.id, i - 1))}>
                    <Icon name="chevronUp" size={16} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Move ${l.title} down`} disabled={busy || i === links.length - 1} onClick={() => void run(() => api.moveQuickLink(l.id, i + 1))}>
                    <Icon name="chevronDown" size={16} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Take ${l.title} off`} disabled={busy} onClick={() => void run(() => api.removeQuickLink(l.id))}>
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
            {links.length === 0 && <p className="muted">No Quick Links yet.</p>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={() => setDraft({ id: null, title: "", url: "", picture: freePainting(links.map((l) => l.picture)) })}>
                <Icon name="plus" size={15} /> Add a Quick Link
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
