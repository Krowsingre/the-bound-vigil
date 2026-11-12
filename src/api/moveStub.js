// Moving the library to another cloud service needs the desktop app. The web
// version and the browser preview answer with this.
export const MOVE_DESKTOP_ONLY = "Moving your library works in the desktop app.";
export const TIDY_DESKTOP_ONLY = "Tidying up Supabase works in the desktop app.";
export const PLACES_DESKTOP_ONLY = "Seeing where every book is works in the desktop app.";
export const IDLE_MOVE = {
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
export function moveStub() {
    const no = async () => {
        throw new Error(MOVE_DESKTOP_ONLY);
    };
    const tidyNo = async () => {
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
        supabaseUsage: tidyNo,
        supabaseContents: tidyNo,
        removeSupabaseFiles: tidyNo,
        bookPlaces: async () => {
            throw new Error(PLACES_DESKTOP_ONLY);
        },
    };
}
