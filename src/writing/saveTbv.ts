// Saving a Scribe book as a .tbv file (see tbvFile.ts): its pages, cover,
// notes and the records of where it came from, gathered from the core.

import { api, isApp, isWeb } from "../api";
import { tbvFileName, writeTbv } from "./tbvFile";

async function appVersion(): Promise<string> {
  if (!isApp) return "preview";
  try {
    return await (await import("@tauri-apps/api/app")).getVersion();
  } catch {
    return "unknown";
  }
}

/** The book as a .tbv file, and the name to give it. */
export async function makeTbv(projectId: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  const view = await api.writingProject(projectId);
  const cover = view.project.cover ? await api.writingCover(projectId).catch(() => null) : null;
  const notes = await api
    .getNotes({ tab: "personal", sort: "updated", search: null, bookId: null, colors: [], projectId })
    .then((page) => page.notes.filter((n) => n.project?.id === projectId))
    .catch(() => []);
  const records = await api
    .writingProvenance(projectId)
    .then((p) => p.records.filter((r) => r.projectId === projectId || r.event === "duplicate"))
    .catch(() => []);
  const bytes = writeTbv({ project: view.project, chapters: view.chapters, cover, notes, records, app: await appVersion() });
  return { bytes, fileName: tbvFileName(view.project.title) };
}

/** Asks where to save it, then saves it. False when the person cancelled. */
export async function saveAsTbv(projectId: string): Promise<boolean> {
  const { bytes, fileName } = await makeTbv(projectId);
  // The web version downloads it; the app asks where it goes.
  const path = isWeb ? null : await api.pickExportPath(fileName, "tbv");
  if (!isWeb && !path) return false;
  await api.saveExportFile(bytes, fileName, path);
  return true;
}
