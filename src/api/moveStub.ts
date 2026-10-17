// Moving the library to another cloud service needs the desktop app. The web
// version and the browser preview answer with this.

import type { Api } from "./index";
import type { MoveStatus } from "./types";

export const MOVE_DESKTOP_ONLY = "Moving your library works in the desktop app.";

export const TIDY_DESKTOP_ONLY = "Tidying up Supabase works in the desktop app.";

export const IDLE_MOVE: MoveStatus = {
  running: false,
  mode: null,
  scope: "all",
  from: null,
  to: null,
  progress: { stage: "looking", done: 0, total: 0 },
  report: null,
  switched: false,
  error: null,
  audioReady: false,
  supabaseAccount: null,
};

type MoveApi = Pick<
  Api,
  | "moveStatus"
  | "moveSignIn"
  | "moveSignOut"
  | "startMove"
  | "retryMove"
  | "cancelMove"
  | "clearMove"
  | "onMove"
  | "planTidyCloud"
  | "tidyCloud"
>;

export function moveStub(): MoveApi {
  const no = async (): Promise<never> => {
    throw new Error(MOVE_DESKTOP_ONLY);
  };
  const tidyNo = async (): Promise<never> => {
    throw new Error(TIDY_DESKTOP_ONLY);
  };
  return {
    moveStatus: async () => IDLE_MOVE,
    moveSignIn: no,
    moveSignOut: async () => undefined,
    startMove: no,
    retryMove: no,
    cancelMove: async () => undefined,
    clearMove: async () => undefined,
    onMove: () => () => undefined,
    planTidyCloud: tidyNo,
    tidyCloud: tidyNo,
  };
}
