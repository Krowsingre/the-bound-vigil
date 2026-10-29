// The Writing page's calls worked out from synced records, for the phone
// version (and the browser preview). Kept in step with writing.rs in the core,
// which does the same on the computer.

import type { Api } from "../api";
import type { WritingChapter, WritingProject, WritingProjectView } from "../api/types";

type Row = { [column: string]: unknown };

/** Where the records live: the phone's synced library, or the preview's memory. */
export interface WritingStore {
  rows(table: "writing_projects" | "writing_chapters"): Row[];
  write(kind: "writing_project" | "writing_chapter", row: Row): Promise<void>;
  /** A cover picture's address, from its `picture:<file>`. */
  pictureUrl(picture: string): string | null;
  newId(): string;
}

type WritingCalls = Pick<
  Api,
  | "writingProjects"
  | "writingProject"
  | "createWritingProject"
  | "updateWritingDetails"
  | "setWritingExport"
  | "deleteWritingProject"
  | "addWritingChapter"
  | "saveWritingChapter"
  | "orderWritingChapters"
  | "deleteWritingChapter"
  | "setWritingChapterRole"
  | "setWritingChapterPart"
  | "setWritingCoverPage"
  | "writingCover"
>;

const MAX_TITLE = 200;

/** Words in a chapter's HTML, as the core counts them: footnotes' words (kept in their attribute) count too. */
export function countWords(html: string): number {
  const notes = [...html.matchAll(/data-footnote="([^"]*)"/g)].map((m) => m[1]).join(" ");
  const text = `${html.replace(/<[^>]*>/g, " ")} ${notes}`.replace(/&[^;\s]*;?/g, " ");
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const clean = (text: string | null | undefined) => {
  const t = (text ?? "").trim();
  return t ? t : null;
};

export function writingCalls(store: WritingStore): WritingCalls {
  const now = () => new Date().toISOString();
  const live = (table: "writing_projects" | "writing_chapters") => store.rows(table).filter((r) => !r.deleted_at);
  const projectRow = (id: string) => {
    const row = live("writing_projects").find((p) => p.id === id);
    if (!row) throw new Error("That book no longer exists.");
    return row;
  };
  const chapterRows = (projectId: string) =>
    live("writing_chapters")
      .filter((c) => c.project_id === projectId)
      .sort((a, b) => Number(a.position) - Number(b.position) || String(a.created_at).localeCompare(String(b.created_at)));
  const chapter = (r: Row): WritingChapter => ({
    id: String(r.id),
    projectId: String(r.project_id),
    title: String(r.title ?? ""),
    body: String(r.body ?? ""),
    position: Number(r.position),
    words: countWords(String(r.body ?? "")),
    updatedAt: String(r.updated_at),
    role: r.role === "front" || r.role === "back" || r.role === "part" ? r.role : "chapter",
    part: typeof r.part === "string" ? r.part : null,
  });
  const project = (r: Row): WritingProject => {
    const chapters = chapterRows(String(r.id));
    const cover = (r.cover as string | null) ?? null;
    return {
      id: String(r.id),
      title: String(r.title),
      author: (r.author as string | null) ?? null,
      series: (r.series as string | null) ?? null,
      seriesIndex: (r.series_index as number | null) ?? null,
      language: (r.language as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      cover,
      coverPath: cover ? store.pictureUrl(cover) : null,
      coverPage: r.cover_page === "cover" || r.cover_page === "title" || r.cover_page === "none" ? r.cover_page : null,
      export: String(r.export ?? "{}"),
      chapters: chapters.filter((c) => c.role !== "part").length,
      words: chapters.filter((c) => c.role !== "part").reduce((sum, c) => sum + countWords(String(c.body ?? "")), 0),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  };
  const touch = (projectId: string) => store.write("writing_project", { ...projectRow(projectId), updated_at: now() });
  const view = (id: string): WritingProjectView => ({ project: project(projectRow(id)), chapters: chapterRows(id).map(chapter) });
  const chapterRow = (id: string) => {
    const row = live("writing_chapters").find((c) => c.id === id);
    if (!row) throw new Error("That chapter no longer exists.");
    return row;
  };

  const addChapter = async (projectId: string, title: string, after: string | null) => {
    const rows = chapterRows(projectId);
    const at = after ? rows.findIndex((c) => c.id === after) : -1;
    const position =
      at >= 0
        ? rows[at + 1]
          ? (Number(rows[at].position) + Number(rows[at + 1].position)) / 2
          : Number(rows[at].position) + 1
        : rows.length
          ? Number(rows[rows.length - 1].position) + 1
          : 1;
    const at_ = now();
    const row = { id: store.newId(), project_id: projectId, title: title.trim().slice(0, MAX_TITLE), body: "", position, created_at: at_, updated_at: at_, deleted_at: null, role: "chapter" };
    await store.write("writing_chapter", row);
    await touch(projectId);
    return chapter(row);
  };

  return {
    writingProjects: async () =>
      live("writing_projects")
        .map(project)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    writingProject: async (id) => view(id),
    createWritingProject: async (title, author) => {
      const t = title.trim().slice(0, MAX_TITLE);
      if (!t) throw new Error("Give the book a title.");
      const at = now();
      const id = store.newId();
      await store.write("writing_project", {
        id,
        title: t,
        author: clean(author),
        series: null,
        series_index: null,
        language: null,
        description: null,
        cover: null,
        export: "{}",
        created_at: at,
        updated_at: at,
        deleted_at: null,
      });
      await addChapter(id, "Chapter 1", null);
      return view(id);
    },
    updateWritingDetails: async (id, details) => {
      const title = details.title.trim().slice(0, MAX_TITLE);
      if (!title) throw new Error("Give the book a title.");
      await store.write("writing_project", {
        ...projectRow(id),
        title,
        author: clean(details.author),
        series: clean(details.series),
        series_index: details.seriesIndex,
        language: clean(details.language),
        description: clean(details.description),
        updated_at: now(),
      });
      return project(projectRow(id));
    },
    setWritingExport: async (id, exportSettings) => {
      const row = projectRow(id);
      if (row.export !== exportSettings) await store.write("writing_project", { ...row, export: exportSettings, updated_at: now() });
    },
    deleteWritingProject: async (id) => {
      const at = now();
      for (const c of chapterRows(id)) await store.write("writing_chapter", { ...c, deleted_at: at, updated_at: at });
      await store.write("writing_project", { ...projectRow(id), deleted_at: at, updated_at: at });
    },
    addWritingChapter: addChapter,
    saveWritingChapter: async (id, title, body) => {
      const row = chapterRow(id);
      const t = title.trim().slice(0, MAX_TITLE);
      if (row.title !== t || row.body !== body) {
        await store.write("writing_chapter", { ...row, title: t, body, updated_at: now() });
        await touch(String(row.project_id));
      }
      return chapter(chapterRow(id));
    },
    orderWritingChapters: async (projectId, order) => {
      const rows = chapterRows(projectId);
      const place = (id: unknown) => {
        const i = order.indexOf(String(id));
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      const sorted = [...rows].sort((a, b) => place(a.id) - place(b.id));
      const at = now();
      for (const [i, c] of sorted.entries()) if (Number(c.position) !== i + 1) await store.write("writing_chapter", { ...c, position: i + 1, updated_at: at });
      await touch(projectId);
      return chapterRows(projectId).map(chapter);
    },
    deleteWritingChapter: async (id) => {
      const row = chapterRow(id);
      const at = now();
      if (row.role === "part") for (const c of chapterRows(String(row.project_id))) if (c.part === id) await store.write("writing_chapter", { ...c, part: null, updated_at: at });
      await store.write("writing_chapter", { ...row, deleted_at: at, updated_at: at });
      await touch(String(row.project_id));
    },
    setWritingChapterRole: async (id, role) => {
      const row = chapterRow(id);
      if ((row.role ?? "chapter") !== role) {
        const at = now();
        // A part sits in no other part; one that stops being a part lets its sections go.
        if ((row.role ?? "chapter") === "part")
          for (const c of chapterRows(String(row.project_id))) if (c.part === id) await store.write("writing_chapter", { ...c, part: null, updated_at: at });
        await store.write("writing_chapter", { ...row, role, part: role === "part" ? null : (row.part ?? null), updated_at: at });
        await touch(String(row.project_id));
      }
      return chapter(chapterRow(id));
    },
    setWritingChapterPart: async (id, part) => {
      const row = chapterRow(id);
      if (part) {
        const host = chapterRow(part);
        if (host.role !== "part" || host.project_id !== row.project_id || row.role === "part") throw new Error("That section can't go in that part.");
      }
      if ((row.part ?? null) !== part) {
        await store.write("writing_chapter", { ...row, part, updated_at: now() });
        await touch(String(row.project_id));
      }
      return chapter(chapterRow(id));
    },
    setWritingCoverPage: async (id, page) => {
      const row = projectRow(id);
      if ((row.cover_page ?? null) !== page) await store.write("writing_project", { ...row, cover_page: page, updated_at: now() });
      return project(projectRow(id));
    },
    writingCover: async (id) => {
      const cover = project(projectRow(id)).coverPath;
      if (!cover) return new Uint8Array();
      const response = await fetch(cover).catch(() => null);
      return response?.ok ? new Uint8Array(await response.arrayBuffer()) : new Uint8Array();
    },
  };
}
