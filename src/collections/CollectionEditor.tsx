import { useEffect, useRef, useState } from "react";
import { api, isApp } from "../api";
import type { CollectionKind, CollectionRules, CollectionSummary, CoverRef } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Badge, BADGE_NAMES } from "./badges";
import { CollectionPicture } from "./CollectionCards";
import { GALLERY, galleryName, galleryUrl } from "./gallery";
import { newRule, usable } from "./rules";
import { RulesEditor } from "./RulesEditor";

type PictureTab = "gallery" | "covers" | "computer";

/** What the picture will be once saved. `file` asks for one after saving a new collection. */
/** A picture already in TBV, or one picked on the computer that is copied in on Save. */
type PictureChoice = { picture: string | null; picturePath: string | null } | { file: string };

/**
 * Making a new collection or changing one: name, description, type, badge,
 * picture and pinning. A shelf keeps its name and type.
 */
export function CollectionEditor({
  collection,
  books,
  addBookIds = [],
  onSaved,
  onCancel,
}: {
  collection?: CollectionSummary;
  /** The collection's books, for using one of their covers as the picture. */
  books: CoverRef[];
  /** Books to put in a new collection straight away. */
  addBookIds?: string[];
  onSaved: (saved: CollectionSummary) => void;
  onCancel: () => void;
}) {
  const shelf = collection?.kind === "shelf";
  const [name, setName] = useState(collection?.name ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");
  const [kind, setKind] = useState<CollectionKind>(collection?.kind ?? "collection");
  const [badge, setBadge] = useState<string | null>(collection?.badge ?? null);
  const [pinned, setPinned] = useState(collection?.pinned ?? false);
  // Kept while switching to "by hand" and back, so nothing typed is lost.
  const [rules, setRules] = useState<CollectionRules>(collection?.rules ?? { any: false, rules: [newRule()] });
  const [byRules, setByRules] = useState(!!collection?.rules);
  const [picture, setPicture] = useState<PictureChoice>({
    picture: collection?.picture ?? null,
    picturePath: collection?.picturePath ?? null,
  });
  const [tab, setTab] = useState<PictureTab>(collection?.picture?.startsWith("cover:") ? "covers" : "gallery");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!shelf) nameRef.current?.focus();
  }, [shelf]);

  const chooseFile = async () => {
    if (!isApp) return setError("Choosing a picture from your computer works in the desktop app.");
    try {
      const file = await api.pickCollectionPicture();
      if (file) setPicture({ file });
    } catch (e) {
      setError(`That picture couldn't be used: ${String(e)}`);
    }
  };

  const save = async () => {
    if (!shelf && !name.trim()) return setError("Give the collection a name.");
    setBusy(true);
    setError(null);
    const ready = { ...rules, rules: rules.rules.filter(usable) };
    if (byRules && !ready.rules.length) return setError("Finish at least one rule, or choose books by hand.");
    const input = {
      name,
      description: description.trim() || null,
      kind: byRules ? ("collection" as const) : kind,
      badge,
      pinned,
      rules: byRules ? ready : null,
    };
    try {
      let saved = collection ? await api.updateCollection(collection.id, input) : await api.createCollection(input);
      if (!collection && addBookIds.length && !byRules) await api.addToCollection(saved.id, addBookIds);
      if ("file" in picture) saved = await api.setCollectionPictureFile(saved.id, picture.file);
      else if (picture.picture !== saved.picture) saved = await api.setCollectionPicture(saved.id, picture.picture);
      onSaved(saved);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const shown = "file" in picture ? { picture: null, picturePath: null } : picture;
  const preview = { id: collection?.id ?? "new", covers: books.slice(0, 3), ...shown };
  const current = "file" in picture ? null : picture.picture;
  // A picture chosen before the paintings arrived shows as the one standing in for it.
  const currentGallery = current?.startsWith("gallery:") ? `gallery:${galleryName(current.slice("gallery:".length))}` : null;
  const title = collection ? `Edit ${shelf ? "shelf" : kind === "reading_list" ? "reading list" : "collection"}` : "New collection";

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <form
        className="dialog collection-editor"
        role="dialog"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => e.key === "Escape" && !busy && onCancel()}
      >
        <div className="editor-preview">
          <CollectionPicture collection={preview} />
          <span className="editor-preview-name">
            <Badge name={badge} size={18} />
            {name.trim() || "Untitled collection"}
          </span>
        </div>

        <div className="editor-body">
          <h2>{title}</h2>
          <label className="field">
            <span>Name</span>
            <input
              ref={nameRef}
              value={name}
              maxLength={80}
              disabled={shelf}
              onChange={(e) => setName(e.target.value)}
              placeholder="Winter reading, Gothic, Book club…"
            />
            {shelf && <small className="muted">The built-in shelves keep their names.</small>}
          </label>
          {!shelf && (
            <>
              <label className="field">
                <span>Description</span>
                <textarea
                  value={description}
                  maxLength={600}
                  rows={2}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional. A line about what belongs here."
                />
              </label>
              <fieldset className="field">
                <legend>Books</legend>
                <div className="segmented" role="radiogroup" aria-label="Books">
                  <button type="button" role="radio" aria-checked={!byRules} onClick={() => setByRules(false)}>
                    Chosen by hand
                  </button>
                  <button type="button" role="radio" aria-checked={byRules} onClick={() => setByRules(true)}>
                    Filled by rules
                  </button>
                </div>
                {byRules ? (
                  <RulesEditor rules={rules} onChange={setRules} />
                ) : (
                  <small className="muted">You add books yourself, from any book’s menu.</small>
                )}
              </fieldset>
              {!byRules && (
              <fieldset className="field">
                <legend>Type</legend>
                <div className="segmented" role="radiogroup" aria-label="Type">
                  {(
                    [
                      ["collection", "Collection"],
                      ["reading_list", "Reading list"],
                    ] as const
                  ).map(([value, label]) => (
                    <button key={value} type="button" role="radio" aria-checked={kind === value} onClick={() => setKind(value)}>
                      {label}
                    </button>
                  ))}
                </div>
                <small className="muted">
                  {kind === "reading_list"
                    ? "A reading list keeps its books in the order you set."
                    : "A collection lists its newest additions first."}
                </small>
              </fieldset>
              )}
            </>
          )}

          <fieldset className="field">
            <legend>Badge</legend>
            <div className="badge-grid" role="radiogroup" aria-label="Badge">
              <button type="button" role="radio" aria-checked={badge === null} className="badge-none" onClick={() => setBadge(null)}>
                None
              </button>
              {BADGE_NAMES.map((b) => (
                <button key={b} type="button" role="radio" aria-checked={badge === b} aria-label={b} title={b} onClick={() => setBadge(b)}>
                  <Badge name={b} size={20} />
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend>Picture</legend>
            <div className="tabs picture-tabs" role="tablist">
              {(
                [
                  ["gallery", "TBV gallery"],
                  ["covers", "Book covers"],
                  ["computer", "From your computer"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  className={`tab${tab === value ? " is-active" : ""}`}
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "gallery" && (
              <>
                <div className="picture-grid">
                  {GALLERY.map((g) => {
                    const value = `gallery:${g.name}`;
                    return (
                      <button
                        key={g.name}
                        type="button"
                        aria-pressed={currentGallery === value}
                        title={g.label}
                        onClick={() => setPicture({ picture: value, picturePath: null })}
                      >
                        <img src={galleryUrl(g.name, "square") ?? undefined} alt={g.label} loading="lazy" draggable={false} />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {tab === "covers" &&
              (books.length ? (
                <div className="picture-grid picture-grid-covers">
                  {books.map((b) => {
                    const value = `cover:${b.id}`;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={current === value}
                        title={b.title}
                        onClick={() => setPicture({ picture: value, picturePath: b.coverPath })}
                      >
                        <BookCover book={b} size="m" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="muted picture-empty">Add books first, then pick one of their covers.</p>
              ))}
            {tab === "computer" && (
              <div className="picture-computer">
                <button type="button" className="btn btn-quiet" onClick={() => void chooseFile()}>
                  <Icon name="image" size={16} /> Choose a picture…
                </button>
                <small className="muted">
                  {"file" in picture
                    ? `Picked ${picture.file.split(/[\\/]/).pop()}. It's used when you save.`
                    : "TBV keeps its own copy, and it goes to your other devices with sync."}
                </small>
              </div>
            )}
            {current && (
              <button type="button" className="link-btn" onClick={() => setPicture({ picture: null, picturePath: null })}>
                Use the book covers instead of a picture
              </button>
            )}
          </fieldset>

          <label className="check-row">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Pin to the top of Collections
          </label>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {collection ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
