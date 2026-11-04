// Scribe's Books tab: a banner to start a book, the four ways to start one,
// and the books you're writing, as cards or a list. Each book has a menu
// (its ••• button, a right-click, or holding it on a phone) with the same
// windows the open book uses.

import { useMemo, useState } from "react";
import { api, isWeb } from "../api";
import type { WritingProject } from "../api/types";
import { GALLERY, galleryUrl } from "../collections/gallery";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { holdForMenu, openContextMenu } from "../components/ContextMenu";
import { Icon, type IconName } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { relativeTime } from "../lib/format";
import { CopyCheckDialog } from "./CopyCheck";
import { readExport } from "./epub";
import { TEMPLATES, type Template } from "./pages";
import { saveAsTbv } from "./saveTbv";
import { startNewEdition } from "./newEdition";
import { isSample } from "./sampleBook";
import { LinkBookDialog } from "./LinkBooks";
import { latestOf, LinkedBookView, shelve, type Shelf } from "./LinkedBooks";
import { useNarrow } from "../lib/useNarrow";
import { DetailsDialog } from "./WritingDialogs";

export type Projects = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; list: WritingProject[] };

const TEMPLATE_ICON: Record<Template, IconName> = { blank: "file", novel: "bookOpen", collection: "layers", nonfiction: "bookClosed" };
const KIND_NAME: Record<Template, string | null> = { blank: null, novel: "Novel", collection: "Short Story Collection", nonfiction: "Non-fiction" };

type BookSort = "edited" | "title" | "newest";
const SORTS: { sort: BookSort; label: string }[] = [
  { sort: "edited", label: "Last edited" },
  { sort: "title", label: "Title" },
  { sort: "newest", label: "Newest" },
];
type BookView = "grid" | "list";
const VIEW_KEY = "tbv.scribe.books";
/** The banner's painting: "" for a different one each time, or a gallery name. */
export const BANNER_KEY = "tbv.scribe.banner";

function readView(): { sort: BookSort; view: BookView } {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}");
    return { sort: SORTS.some((s) => s.sort === v.sort) ? v.sort : "edited", view: v.view === "list" ? "list" : "grid" };
  } catch {
    return { sort: "edited", view: "grid" };
  }
}

function readBanner(): string {
  try {
    return localStorage.getItem(BANNER_KEY) ?? "";
  } catch {
    return "";
  }
}

const words = (n: number) => `${n.toLocaleString()} ${n === 1 ? "word" : "words"}`;

/** "Novel · 12 chapters · 34,210 words". */
function metaLine(p: WritingProject): string {
  const { kind, edition } = readExport(p.export);
  return [edition?.name, kind && KIND_NAME[kind], `${p.chapters} ${p.chapters === 1 ? "chapter" : "chapters"}`, words(p.words)].filter(Boolean).join(" · ");
}

/** "3 editions · Novel". */
function linkedLine(s: Extract<Shelf, { kind: "linked" }>): string {
  const kind = readExport(latestOf(s).export).kind;
  return [`${s.editions.length} editions`, kind && KIND_NAME[kind]].filter(Boolean).join(" · ");
}

function coverOf(p: WritingProject): string | null {
  const path = p.coverSmallPath ?? p.coverPath;
  return path ? (isWeb ? path : api.coverUrl(path)) : null;
}

/** The thin rule with a small diamond in the middle, between sections. */
export function DiamondRule() {
  return <div className="rule-diamond" aria-hidden />;
}

/** The wide banner: a painting, the words, and Create a Book. */
function Banner({ onCreate }: { onCreate: () => void }) {
  const [choice, setChoice] = useState(readBanner);
  // A different painting each visit, unless one was chosen.
  const [random] = useState(() => GALLERY[Math.floor(Math.random() * GALLERY.length)]?.name ?? "");
  const [choosing, setChoosing] = useState(false);
  const picture = galleryUrl(choice || random, "wide");
  const choose = (name: string) => {
    setChoice(name);
    try {
      localStorage.setItem(BANNER_KEY, name);
    } catch {
      /* just for this visit */
    }
  };
  return (
    <section className="scribe-banner" aria-labelledby="scribe-banner-title">
      {picture && <div className="scribe-banner-art" style={{ backgroundImage: `url(${picture})` }} aria-hidden />}
      <div className="scribe-banner-text">
        <span className="scribe-banner-rule" aria-hidden />
        <h2 id="scribe-banner-title">Your next book begins here</h2>
        <p>
          Write, organize, and shape your manuscript in one place. Begin with a blank page or a prepared structure, then refine its appearance,
          preview the finished work, and export when it's ready.
        </p>
        <button type="button" className="btn btn-primary scribe-banner-go" onClick={onCreate}>
          Create a Book <Icon name="arrowRight" size={16} />
        </button>
      </div>
      <button type="button" className="scribe-banner-change" title="Change the picture" aria-label="Change the picture" onClick={() => setChoosing(true)}>
        <Icon name="image" size={16} />
      </button>
      {choosing && (
        <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setChoosing(false)}>
          <div className="dialog scribe-banner-dialog" role="dialog" aria-label="Banner picture" onKeyDown={(e) => e.key === "Escape" && setChoosing(false)}>
            <h2>Banner picture</h2>
            <div className="discover-backgrounds" role="radiogroup" aria-label="Banner picture">
              <button type="button" role="radio" aria-checked={choice === ""} className="picture-choice discover-background-none" onClick={() => choose("")}>
                <Icon name="shuffle" size={22} />
                <span className="picture-choice-label">A different one each time</span>
              </button>
              {GALLERY.map((g) => {
                const url = galleryUrl(g.name, "wide");
                return (
                  <button
                    key={g.name}
                    type="button"
                    role="radio"
                    aria-checked={choice === g.name}
                    className="picture-choice"
                    style={url ? { backgroundImage: `url(${url})` } : undefined}
                    onClick={() => choose(g.name)}
                  >
                    <span className="picture-choice-label">{g.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={() => setChoosing(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** The four ways to start a book. */
function StartCards({ onStart }: { onStart: (t: Template) => void }) {
  return (
    <section className="scribe-start" aria-labelledby="scribe-start">
      <h2 id="scribe-start" className="scribe-section-title">
        Start a new book
      </h2>
      <ul className="scribe-templates">
        {TEMPLATES.map((t) => (
          <li key={t.value}>
            <button type="button" className="scribe-template" onClick={() => onStart(t.value)}>
              <Icon name={TEMPLATE_ICON[t.value]} size={30} className="scribe-template-icon" />
              <span className="scribe-template-text">
                <strong>{t.label}</strong>
                <span>{t.about}</span>
              </span>
              <Icon name="chevronRight" size={16} className="scribe-template-go" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Dialog = { kind: "details"; project: WritingProject; focus: "author" | "cover" } | { kind: "copies"; project: WritingProject } | { kind: "delete"; project: WritingProject } | { kind: "link"; project: WritingProject };

export function ScribeBooks({
  projects,
  search,
  onOpen,
  onStart,
  onChanged,
  onRetry,
  onOpenBook,
}: {
  projects: Projects;
  /** The header's search, which finds your books by title and author here. */
  search: string;
  onOpen: (id: string) => void;
  /** Starts a new book from a template (or the plain New book window). */
  onStart: (template: Template) => void;
  onChanged: () => void;
  onRetry: () => void;
  /** Opens a locked draft to read. */
  onOpenBook: (bookId: string) => void;
}) {
  const toast = useToast();
  const narrow = useNarrow();
  const [prefs, setPrefs] = useState(readView);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // The linked book whose editions and drafts are showing, by its edition group.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const change = (next: Partial<typeof prefs>) =>
    setPrefs((p) => {
      const v = { ...p, ...next };
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(v));
      } catch {
        /* just for this visit */
      }
      return v;
    });

  const list = projects.state === "ready" ? projects.list : [];
  // Editions of one book share a card; it's found when any of them matches, and sorts by the one that sorts first.
  const shelves = useMemo(() => {
    const sorted = [...list];
    if (prefs.sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (prefs.sort === "newest") sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const q = search.trim().toLowerCase();
    const matches = (p: WritingProject) => [p.title, p.author ?? "", p.series ?? ""].some((t) => t.toLowerCase().includes(q));
    return shelve(sorted).filter((s) => !q || (s.kind === "book" ? matches(s.book) : s.editions.some((e) => matches(e.book))));
  }, [list, search, prefs.sort]);
  const openShelf = shelves.find((s): s is Extract<Shelf, { kind: "linked" }> => s.kind === "linked" && s.group === openGroup) ?? null;

  const menuFor = (p: WritingProject): MenuEntry[] => [
    { label: "Open Book", icon: "bookOpen", onSelect: () => onOpen(p.id) },
    { label: "Change Cover", icon: "image", onSelect: () => setDialog({ kind: "details", project: p, focus: "cover" }) },
    { label: "Change Author", icon: "edit", onSelect: () => setDialog({ kind: "details", project: p, focus: "author" }) },
    { label: "Plagiarism Check", icon: "checkCircle", onSelect: () => setDialog({ kind: "copies", project: p }) },
    {
      label: "Save as .tbv File",
      icon: "download",
      onSelect: () =>
        void saveAsTbv(p.id).then(
          (saved) => saved && toast(`Saved “${p.title}” as a Scribe book file. Open it in Scribe with Import a manuscript.`),
          (e: unknown) => toast(`Couldn't save the book file: ${String(e).replace(/^Error: /, "")}`),
        ),
    },
    ...(isWeb
      ? []
      : [
          {
            label: "Duplicate Book",
            icon: "copy" as const,
            onSelect: () =>
              void api.duplicateWritingProject(p.id).then(
                (copy) => {
                  onChanged();
                  toast(`Made “${copy.project.title}”. Where the original came from stays in its Book details.`);
                },
                (e: unknown) => toast(`Couldn't duplicate the book: ${String(e).replace(/^Error: /, "")}`),
              ),
          },
          // The sample book is Milton's, not the writer's, so it's never linked to theirs.
          ...(isSample(p) || !list.some((b) => b.id !== p.id && !isSample(b))
            ? []
            : [{ label: "Link to Another Book…", icon: "link" as const, onSelect: () => setDialog({ kind: "link", project: p }) }]),
          {
            label: "Start a New Edition",
            icon: "layers" as const,
            onSelect: () =>
              void startNewEdition(p).then(
                (made) => {
                  onChanged();
                  toast(`Made the ${readExport(made.project.export).edition?.name.toLowerCase() ?? "new edition"} of “${made.project.title}”, with every page of the last one. Add its ISBNs on the copyright page if you have them.`);
                },
                (e: unknown) => toast(`Couldn't start a new edition: ${String(e).replace(/^Error: /, "")}`),
              ),
          },
        ]),
    "divider",
    { label: "Delete Book", icon: "trash", danger: true, onSelect: () => setDialog({ kind: "delete", project: p }) },
  ];
  // A linked book's menu leads with its editions and drafts; the rest is for its latest edition.
  const cardMenu = (p: WritingProject, linked: Extract<Shelf, { kind: "linked" }> | null): MenuEntry[] =>
    linked
      ? [
          { label: "Editions and Drafts", icon: "layers", onSelect: () => setOpenGroup(linked.group) },
          { label: "Open Latest Edition", icon: "bookOpen", onSelect: () => onOpen(p.id) },
          ...menuFor(p).filter((m) => typeof m !== "object" || !("label" in m) || m.label !== "Open Book"),
        ]
      : menuFor(p);
  const cardProps = (p: WritingProject, linked: Extract<Shelf, { kind: "linked" }> | null = null) => ({
    ...holdForMenu(`${p.title}: book`, () => cardMenu(p, linked)),
    onContextMenu: (e: React.MouseEvent) => openContextMenu(e, `${p.title}: book`, cardMenu(p, linked)),
  });
  const more = (p: WritingProject, linked: Extract<Shelf, { kind: "linked" }> | null = null) => (
    <Menu label={`More for ${p.title}`} className="icon-btn scribe-book-more" trigger={<Icon name="more" size={18} />} items={cardMenu(p, linked)} />
  );

  let books: React.ReactNode;
  if (projects.state === "error")
    books = (
      <div className="library-empty" role="alert">
        <h2>Your writing couldn't be loaded</h2>
        <p className="muted">{projects.message}</p>
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  else if (projects.state === "loading") books = <div className="library-loading" aria-busy="true" aria-label="Loading your writing" />;
  else if (openShelf)
    books = (
      <LinkedBookView shelf={openShelf} cover={coverOf} menuFor={menuFor} onOpen={onOpen} onOpenDraft={onOpenBook} onBack={() => setOpenGroup(null)} />
    );
  else if (shelves.length === 0)
    books = (
      <p className="muted scribe-books-none">
        No book you're writing matches “{search.trim()}”.
      </p>
    );
  else if (prefs.view === "list")
    books = (
      <ul className="scribe-book-rows">
        {shelves.map((s) => {
          const p = s.kind === "book" ? s.book : latestOf(s);
          const linked = s.kind === "linked" ? s : null;
          const cover = coverOf(p);
          return (
            <li key={linked ? linked.group : p.id} className={`scribe-book-row${linked ? " is-linked" : ""}`} {...cardProps(p, linked)}>
              <button type="button" className="scribe-book-open" onClick={() => (linked ? setOpenGroup(linked.group) : onOpen(p.id))}>
                <span className="scribe-book-thumb">{cover ? <img src={cover} alt="" /> : <span className="scribe-book-blank">{p.title}</span>}</span>
                <span className="scribe-book-text">
                  <strong>{p.title}</strong>
                  <span className="muted">{p.author || "No author yet"}</span>
                </span>
                <span className="muted scribe-book-meta">{linked ? linkedLine(linked) : metaLine(p)}</span>
                <span className="muted scribe-book-when">Edited {relativeTime(p.updatedAt)}</span>
              </button>
              {more(p, linked)}
            </li>
          );
        })}
      </ul>
    );
  else
    books = (
      <ul className="scribe-book-cards">
        {shelves.map((s) => {
          const p = s.kind === "book" ? s.book : latestOf(s);
          const linked = s.kind === "linked" ? s : null;
          const cover = coverOf(p);
          return (
            <li key={linked ? linked.group : p.id} className={`scribe-book-card${linked ? " is-linked" : ""}`} {...cardProps(p, linked)}>
              <button type="button" className="scribe-book-open" onClick={() => (linked ? setOpenGroup(linked.group) : onOpen(p.id))}>
                <span className="scribe-book-art">
                  {cover ? <img src={cover} alt="" draggable={false} /> : <span className="scribe-book-blank">{p.title}</span>}
                </span>
                <span className="scribe-book-text">
                  <strong>{p.title}</strong>
                  <span className="muted">{p.author || "No author yet"}</span>
                  <span className="muted scribe-book-meta">{linked ? linkedLine(linked) : metaLine(p)}</span>
                </span>
              </button>
              {more(p, linked)}
            </li>
          );
        })}
      </ul>
    );

  // The writer's own books: the sample doesn't count. Until there's one, the
  // banner invites them to begin; after, their books come first. On a phone the
  // start cards are left out, since New and the banner's button do the same.
  const own = list.some((p) => !isSample(p));
  const yours = (
    <section className="scribe-yours" aria-labelledby="scribe-yours">
      <div className="scribe-yours-head">
        <h2 id="scribe-yours" className="scribe-section-title">
          Your books
        </h2>
        {!openShelf && <div className="scribe-yours-tools">
          <Menu
            label={`Sort: ${SORTS.find((s) => s.sort === prefs.sort)?.label}`}
            className="notes-filter notes-sort"
            trigger={
              <>
                <span className="muted">Sort:</span> <span>{SORTS.find((s) => s.sort === prefs.sort)?.label}</span>
                <Icon name="chevronDown" size={13} />
              </>
            }
            items={SORTS.map((s) => ({ label: s.label, checked: prefs.sort === s.sort, onSelect: () => change({ sort: s.sort }) }))}
          />
          <div className="layout-switch" role="radiogroup" aria-label="Layout">
            {(
              [
                ["grid", "Cards", "grid"],
                ["list", "List", "list"],
              ] as const
            ).map(([view, label, icon]) => (
              <button
                key={view}
                type="button"
                role="radio"
                aria-checked={prefs.view === view}
                aria-label={label}
                title={label}
                className={prefs.view === view ? "is-active" : undefined}
                onClick={() => change({ view })}
              >
                <Icon name={icon} size={16} />
              </button>
            ))}
          </div>
        </div>}
      </div>
      {books}
    </section>
  );
  return (
    <div className="scribe-books-page">
      {projects.state === "ready" && !own && <Banner onCreate={() => onStart("blank")} />}
      {own && list.length > 0 && yours}
      {!narrow && (
        <>
          {own && <DiamondRule />}
          <StartCards onStart={onStart} />
        </>
      )}
      {!own && list.length > 0 && (
        <>
          {!narrow && <DiamondRule />}
          {yours}
        </>
      )}
      {dialog?.kind === "details" && (
        <DetailsDialog
          project={dialog.project}
          focus={dialog.focus}
          onSaved={() => {
            setDialog(null);
            onChanged();
          }}
          onCancel={() => {
            setDialog(null);
            onChanged();
          }}
        />
      )}
      {dialog?.kind === "link" && (
        <LinkBookDialog
          project={dialog.project}
          books={list}
          onCancel={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null);
            onChanged();
            toast(message);
          }}
        />
      )}
      {dialog?.kind === "copies" && (
        <CopyCheckDialog project={dialog.project} onFlush={() => api.writingProject(dialog.project.id).then((v) => v.chapters)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${dialog.project.title}?`}
          body="Every chapter goes, on all your devices. Copies you've already exported stay as they are."
          confirm="Delete Book"
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const id = dialog.project.id;
            setDialog(null);
            void api.deleteWritingProject(id).then(onChanged, (e: unknown) => toast(String(e)));
          }}
        />
      )}
    </div>
  );
}
