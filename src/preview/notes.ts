// Notes for the browser preview, mirroring the core closely enough to look
// at the Notes page while designing. Never used in the app. The quotations
// are from public-domain books.

import type { Api } from "../api";
import type { Annotation, BookPreview, HighlightColor, NoteItem, NoteKind, NotesQuery } from "../api/types";
import { cleanTags, notesPageOf } from "../notes/noteQuery";

const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();
const stamp = () => new Date().toISOString();

interface Personal {
  id: string;
  title: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

/** Sample highlights, attached to the sample books by title. */
export function sampleAnnotations(books: BookPreview[]): Annotation[] {
  const find = (title: string) => books.find((b) => b.title === title);
  const make = (
    title: string,
    kind: Annotation["kind"],
    excerpt: string,
    note: string | null,
    color: HighlightColor | null,
    chapter: string,
    at: number,
    daysAgo: number,
  ): Annotation[] => {
    const b = find(title);
    if (!b) return [];
    return [
      {
        id: `sample-${title}-${at}`,
        bookId: b.id,
        kind,
        excerpt,
        note,
        color,
        locator: { chapter, totalProgression: at, pageIndex: Math.floor(at * 600) },
        createdAt: ago(daysAgo),
        updatedAt: ago(daysAgo),
      },
    ];
  };
  return [
    ...make("The Count of Monte Cristo", "highlight", "All human wisdom is contained in these two words, Wait and Hope.", null, "amber", "Chapter 117", 0.98, 0.2),
    ...make(
      "Middlemarch",
      "highlight",
      "the growing good of the world is partly dependent on unhistoric acts",
      "Use as the epigraph? It says what the whole book is about: small lives counting.",
      "sage",
      "Finale",
      0.99,
      3,
    ),
    ...make("Jane Eyre", "highlight", "I am no bird; and no net ensnares me: I am a free human being with an independent will.", null, "rose", "Chapter 23", 0.52, 5),
    ...make(
      "Persuasion",
      "highlight",
      "You pierce my soul. I am half agony, half hope.",
      "The letter. Austen saves the whole book for this page.",
      "rose",
      "Chapter 23",
      0.93,
      8,
    ),
    ...make("Moby-Dick", "highlight", "Call me Ishmael.", null, "slate", "Loomings", 0.01, 12),
    ...make(
      "Frankenstein",
      "highlight",
      "Beware; for I am fearless, and therefore powerful.",
      "Compare with the creature's first words. Who is the monster here?",
      "slate",
      "Chapter 20",
      0.71,
      15,
    ),
    ...make("The Moonstone", "highlight", "I am not ashamed to own that I can't help feeling a certain respect for him.", null, "sage", "First Period", 0.18, 20),
  ];
}

const sampleBookNote = (books: BookPreview[]): Annotation[] => {
  const b = books.find((x) => x.title === "Middlemarch");
  return b
    ? [
        {
          id: "sample-booknote-middlemarch",
          bookId: b.id,
          kind: "book_note" as Annotation["kind"],
          excerpt: "",
          note: "Slow to start, then impossible to put down. Dorothea and Lydgate are the same mistake made twice. Reread in ten years.",
          color: null,
          locator: {},
          createdAt: ago(2),
          updatedAt: ago(2),
        },
      ]
    : [];
};

type NotesApi = Pick<Api, "getNotes" | "saveBookNote" | "savePersonalNote" | "setAnnotationNote" | "deleteNote" | "setNotePinned" | "setNoteTags" | "setNoteProject">;

export function previewNotes(
  books: () => BookPreview[],
  annotations: { get: () => Annotation[]; set: (list: Annotation[]) => void },
  empty: boolean,
): NotesApi {
  let personal: Personal[] = empty
    ? []
    : [
        {
          id: "p1",
          title: "Reading plan",
          body: "One long Victorian each winter. Short stories between them, so it never feels like homework.",
          createdAt: ago(1),
          updatedAt: ago(1),
        },
        {
          id: "p2",
          title: null,
          body: "Look for a good translation of Anna Karenina before starting it.",
          createdAt: ago(9),
          updatedAt: ago(9),
        },
      ];
  if (!empty) annotations.set([...annotations.get(), ...sampleBookNote(books())]);
  // Pins and tags, by note.
  const marks = new Map<string, { pinnedAt: string | null; tags: string[] }>(
    empty
      ? []
      : [
          ["p1", { pinnedAt: ago(1), tags: ["plans", "reading"] }],
          ["sample-booknote-middlemarch", { pinnedAt: ago(2), tags: ["reread"] }],
          ["sample-Middlemarch-0.99", { pinnedAt: null, tags: ["epigraph", "themes"] }],
          ["sample-Persuasion-0.93", { pinnedAt: null, tags: ["letters"] }],
        ],
  );
  const markOf = (id: string) => marks.get(id) ?? { pinnedAt: null, tags: [] };
  // The Scribe book each personal note belongs to.
  const projects = new Map<string, { id: string; title: string }>();

  const toItem = (a: Annotation): NoteItem | null => {
    const b = books().find((x) => x.id === a.bookId);
    if (!b || a.kind === "bookmark") return null;
    const bookNote = (a.kind as string) === "book_note";
    const kind: NoteKind = bookNote ? "book_note" : a.note?.trim() || a.kind === "note" ? "annotation" : "highlight";
    return {
      id: a.id,
      kind,
      book: { id: b.id, title: b.title, authors: b.authors, coverPath: b.coverPath },
      excerpt: a.excerpt,
      note: a.note,
      title: null,
      color: a.color,
      locator: bookNote ? null : a.locator,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  };
  const all = (): NoteItem[] =>
    [
      ...annotations.get().map(toItem),
      ...personal.map(
        (p): NoteItem => ({
          id: p.id,
          kind: "personal",
          book: null,
          excerpt: "",
          note: p.body,
          title: p.title,
          color: null,
          locator: null,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        }),
      ),
    ]
      .filter((n): n is NoteItem => !!n)
      .map((n) => ({ ...n, ...markOf(n.id), project: projects.get(n.id) ?? null }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const one = (id: string) => {
    const n = all().find((x) => x.id === id);
    if (!n) throw new Error("that note no longer exists");
    return n;
  };
  const editAnnotation = (id: string, change: Partial<Annotation>) =>
    annotations.set(annotations.get().map((a) => (a.id === id ? { ...a, ...change, updatedAt: stamp() } : a)));

  return {
    getNotes: async (q: NotesQuery) => notesPageOf(all(), q),
    setNotePinned: async (id, pinned) => {
      one(id);
      marks.set(id, { ...markOf(id), pinnedAt: pinned ? stamp() : null });
    },
    setNoteProject: async (id, projectId) => {
      one(id);
      if (projectId) {
        const { api } = await import("../api");
        const title = (await api.writingProjects()).find((w) => w.id === projectId)?.title ?? "Your book";
        projects.set(id, { id: projectId, title });
      }
      else projects.delete(id);
      return one(id);
    },
    setNoteTags: async (id, tags) => {
      one(id);
      const kept = cleanTags(tags);
      marks.set(id, { ...markOf(id), tags: kept });
      return kept;
    },
    saveBookNote: async (bookId, id, text) => {
      if (!text.trim()) throw new Error("the note is empty");
      if (id) editAnnotation(id, { note: text.trim() });
      else {
        id = `bn-${Math.random().toString(36).slice(2)}`;
        annotations.set([
          ...annotations.get(),
          {
            id,
            bookId: bookId as Annotation["bookId"],
            kind: "book_note" as Annotation["kind"],
            excerpt: "",
            note: text.trim(),
            color: null,
            locator: {},
            createdAt: stamp(),
            updatedAt: stamp(),
          },
        ]);
      }
      return one(id);
    },
    savePersonalNote: async (id, title, body) => {
      if (!title?.trim() && !body.trim()) throw new Error("the note is empty");
      const t = title?.trim() || null;
      if (id) personal = personal.map((p) => (p.id === id ? { ...p, title: t, body: body.trim(), updatedAt: stamp() } : p));
      else {
        id = `p-${Math.random().toString(36).slice(2)}`;
        personal = [...personal, { id, title: t, body: body.trim(), createdAt: stamp(), updatedAt: stamp() }];
      }
      return one(id);
    },
    setAnnotationNote: async (id, note) => {
      editAnnotation(id, { note: note?.trim() || null });
      return one(id);
    },
    deleteNote: async (id, kind) => {
      if (kind === "personal") personal = personal.filter((p) => p.id !== id);
      else annotations.set(annotations.get().filter((a) => a.id !== id));
    },
  };
}
