// Importing from a server needs the desktop app. The web version answers with this.
export const SERVERS_DESKTOP_ONLY = "Importing from a server works in the desktop app.";
export const LOCALSEND_APP_ONLY = "Sending with Grimoire works in the TBV app, not the web version.";
export const NO_SERVER_QUEUE = {
    counts: { total: 0, waiting: 0, downloading: 0, downloaded: 0, done: 0, failed: 0, bytesTotal: 0, bytesDone: 0 },
    connections: 3,
    looking: [],
    problem: null,
    active: [],
    version: 0,
};
export function serverStub() {
    const no = async () => {
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
        serverQueue: async () => NO_SERVER_QUEUE,
        serverQueuePage: async () => [],
        retryServerFile: async () => undefined,
        removeServerFile: async () => undefined,
        cancelServerQueue: async () => undefined,
        clearServerFinished: async () => undefined,
        setServerConnections: async () => undefined,
        onServerQueue: () => () => undefined,
        localSendStatus: async () => ({ enabled: false, running: false, alias: "The Bound Vigil", problem: null }),
        setLocalSend: no,
        answerLocalSend: async () => undefined,
        onLocalSendOffer: () => () => undefined,
        localSendFiles: async () => [],
        clearLocalSendFinished: async () => undefined,
        onLocalSendChanged: () => () => undefined,
        localSendNearby: async () => [],
        localSendDeviceAt: async () => {
            throw new Error(LOCALSEND_APP_ONLY);
        },
        sendWithLocalSend: async () => {
            throw new Error(LOCALSEND_APP_ONLY);
        },
        stopSendingWithLocalSend: async () => undefined,
        onLocalSendSending: () => () => undefined,
        pickKeyFile: async () => null,
    };
}
