// A pretend move for the browser preview, so its screens can be looked at:
// `?move` lets the wizard run one, `?move=done` opens on a finished move and
// `?move=missing` on one whose check found gaps. Without it, the preview says
// moving works in the desktop app.

import type { Api } from "../api";
import { IDLE_MOVE, moveStub } from "../api/moveStub";
import type { MoveMode, MoveScope, MoveStatus, ProviderChoice, ProviderView } from "../api/types";

const SUPABASE: ProviderView = { kind: "supabase", service: null, location: null, username: null };
const DROPBOX: ProviderView = { kind: "folder", service: "dropbox", location: "C:\\Users\\you\\Dropbox", username: null };

function viewOf(choice: ProviderChoice): ProviderView {
  if (choice.kind === "folder") return { kind: "folder", service: choice.service, location: choice.path, username: null };
  if (choice.kind === "webdav") return { kind: "webdav", service: null, location: choice.url, username: choice.username };
  return SUPABASE;
}

function finished(mode: MoveMode, scope: MoveScope, to: ProviderView, missing: boolean): MoveStatus {
  return {
    ...IDLE_MOVE,
    mode,
    scope,
    from: SUPABASE,
    to,
    progress: { stage: "checking", done: 40, total: 40 },
    switched: mode === "migrate" && !missing,
    report: {
      recordsCopied: 214,
      filesCopied: missing ? 26 : 28,
      alreadyThere: 12,
      cancelled: false,
      check: {
        records: 226,
        recordsFound: 226,
        files: 40,
        filesFound: missing ? 38 : 40,
        missing: missing ? ["The book file of Dracula (the server stopped answering)", "The cover of Carmilla"] : [],
        moreMissing: 0,
        notes: missing
          ? []
          : ["The book file of The Complete Works didn't go (too big for this service). It wasn't in the old place either."],
      },
    },
  };
}

export function previewMove(
  params: URLSearchParams,
): Pick<Api, "moveStatus" | "moveSignIn" | "moveSignOut" | "startMove" | "retryMove" | "cancelMove" | "clearMove" | "onMove"> {
  if (!params.has("move")) return moveStub();
  const mode = params.get("move");
  let status: MoveStatus =
    mode === "done" || mode === "missing" ? finished("migrate", "all", DROPBOX, mode === "missing") : { ...IDLE_MOVE };
  const listeners = new Set<(s: MoveStatus) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const set = (next: MoveStatus) => {
    status = next;
    listeners.forEach((l) => l(status));
  };
  const run = (mode: MoveMode, scope: MoveScope, to: ProviderView) => {
    set({ ...IDLE_MOVE, running: true, mode, scope, from: SUPABASE, to, supabaseAccount: status.supabaseAccount });
    let done = 0;
    timer = setInterval(() => {
      done += 4;
      if (done > 44) {
        clearInterval(timer!);
        set({ ...finished(mode, scope, to, false), supabaseAccount: status.supabaseAccount });
        return;
      }
      const stage = done <= 4 ? "looking" : done <= 20 ? "records" : done <= 40 ? "files" : "checking";
      set({ ...status, progress: { stage, done: Math.min(done, 40), total: 40 } });
    }, 500);
  };
  return {
    moveStatus: async () => status,
    moveSignIn: async (_project, email) => (set({ ...status, supabaseAccount: email }), true),
    moveSignOut: async () => set({ ...status, supabaseAccount: null }),
    startMove: async (mode, scope, to) => run(mode, scope, viewOf(to)),
    retryMove: async () => run(status.mode ?? "migrate", status.scope, status.to ?? DROPBOX),
    cancelMove: async () => {
      if (timer) clearInterval(timer);
      set({
        ...status,
        running: false,
        report: { recordsCopied: 80, filesCopied: 3, alreadyThere: 0, cancelled: true, check: null },
      });
    },
    clearMove: async () => set({ ...IDLE_MOVE, supabaseAccount: status.supabaseAccount }),
    onMove: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
