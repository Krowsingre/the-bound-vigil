// Making a Scribe book from an opened .tbv file (tbvFile.ts), exactly as it
// was saved: details, settings, cover, pages in order with their parts, and
// notes. Used by Import a manuscript and for the sample book.

import { api } from "../api";
import type { ImportAcknowledgment } from "../api/types";
import type { TbvBook } from "./tbvFile";

export interface TbvMaking {
  title: string;
  author: string | null;
  /** The signed confirmation for a file the person brought in; none for the sample book. */
  acknowledgment?: ImportAcknowledgment;
  /** The original file, kept beside the book. */
  source?: { name: string; bytes: Uint8Array };
  onStep?: (step: string) => void;
}

/** Makes the book and returns its id. Nothing half-made is left behind on a failure. */
export async function bookFromTbv(
  book: TbvBook,
  making: TbvMaking,
): Promise<string> {
  const step = making.onStep ?? (() => undefined);
  let made: string | null = null;
  try {
    step("Making the book…");
    const view = await api.createWritingProject(making.title, making.author);
    made = view.project.id;
    if (making.acknowledgment) {
      step("Signing the record…");
      await api.recordWritingImport(made, making.acknowledgment);
    }
    if (making.source) {
      step("Keeping the original…");
      await api.keepWritingSource(
        made,
        making.source.name,
        making.source.bytes,
      );
    }
    await api.updateWritingDetails(made, {
      title: view.project.title,
      author: view.project.author,
      series: book.series,
      seriesIndex: book.seriesIndex,
      language: book.language,
      description: book.description,
    });
    await api.setWritingExport(made, JSON.stringify(book.settings));
    if (book.coverPage) await api.setWritingCoverPage(made, book.coverPage);
    if (book.cover) {
      step("Adding the cover…");
      await api.setWritingCoverPicture(
        made,
        book.cover.bytes,
        book.cover.extension,
      );
    }
    // Poems' sounds, kept under the same names their pages give them.
    for (const sound of book.sounds) {
      step("Adding the poems' sounds…");
      await api.keepWritingSound(sound.file, sound.bytes).catch(() => undefined);
    }
    const ids: string[] = [];
    let previous: string | null = null;
    for (let i = 0; i < book.pages.length; i++) {
      step(`Adding page ${i + 1} of ${book.pages.length}…`);
      const p = book.pages[i];
      const added: { id: string } = await api.addWritingSection(made, {
        title: p.title,
        body: p.body,
        role: p.role,
        part: p.part === null ? null : (ids[p.part] ?? null),
        page: p.role === "part" ? "{}" : JSON.stringify(p.page),
        after: previous,
      });
      ids.push(added.id);
      previous = added.id;
    }
    // The empty chapter every new book starts with, unless the file had no pages at all.
    if (book.pages.length)
      for (const c of view.chapters)
        await api.deleteWritingChapter(c.id).catch(() => undefined);
    for (const n of book.notes) {
      const note = await api
        .savePersonalNote(null, n.title, n.body)
        .catch(() => null);
      if (!note) continue;
      await api.setNoteProject(note.id, made).catch(() => undefined);
      if (n.tags.length)
        await api.setNoteTags(note.id, n.tags).catch(() => undefined);
      if (n.pinned)
        await api.setNotePinned(note.id, true).catch(() => undefined);
    }
    return made;
  } catch (e) {
    if (made) await api.deleteWritingProject(made).catch(() => undefined);
    throw e;
  }
}
