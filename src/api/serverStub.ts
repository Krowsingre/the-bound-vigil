// Importing from a server needs the desktop app. The web version answers with this.

import type { Api } from "./index";
import type { ServerDownloadStatus } from "./types";

export const SERVERS_DESKTOP_ONLY = "Importing from a server works in the desktop app.";

export const IDLE_SERVER_DOWNLOAD: ServerDownloadStatus = {
  running: false,
  server: null,
  progress: { stage: "looking", filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0, current: null },
  queued: null,
  stopped: false,
  error: null,
};

export type ServerApi = Pick<
  Api,
  | "listServers"
  | "saveServer"
  | "removeServer"
  | "trustServerKey"
  | "testServer"
  | "browseServer"
  | "downloadFromServer"
  | "serverDownloadStatus"
  | "cancelServerDownload"
  | "clearServerDownload"
  | "onServerDownload"
  | "pickKeyFile"
>;

export function serverStub(): ServerApi {
  const no = async (): Promise<never> => {
    throw new Error(SERVERS_DESKTOP_ONLY);
  };
  return {
    listServers: async () => [],
    saveServer: no,
    removeServer: async () => undefined,
    trustServerKey: no,
    testServer: no,
    browseServer: no,
    downloadFromServer: no,
    serverDownloadStatus: async () => IDLE_SERVER_DOWNLOAD,
    cancelServerDownload: async () => undefined,
    clearServerDownload: async () => undefined,
    onServerDownload: () => () => undefined,
    pickKeyFile: async () => null,
  };
}
