// Talking to the person's Supabase project from the browser: signing in,
// and the same table, function and file bucket the desktop app uses (see
// supabase/setup.sql and crates/tbv-core/src/sync/supabase.rs).

import type { SupabaseProject } from "../api/types";

export const BUCKET = "tbv-files";

/**
 * Supabase's free plan takes files of up to 50 MB, so bigger ones are kept in
 * pieces, `<path>.pieces/0000`… with an index, `<path>.pieces/pieces.json`,
 * sent last. The desktop app does the same (sync/supabase.rs).
 */
export const PIECE_BYTES = 45 * 1024 * 1024;
const PIECES = ".pieces";
const PIECE_INDEX = "pieces.json";

export interface Pieces {
  size: number;
  count: number;
  piece: number;
}

export const piecePath = (path: string, index: number) => `${path}${PIECES}/${String(index).padStart(4, "0")}`;

/** The logical name of a listed entry: a folder of pieces counts as its file. */
export function listedName(name: string, folder: boolean): string | null {
  if (!folder) return name;
  return name.endsWith(PIECES) ? name.slice(0, -PIECES.length) : null;
}

export interface Session {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  /** When the access token runs out, in seconds since 1970. */
  expiresAt: number;
}

/** One record as it travels, exactly as the desktop app sends it. */
export interface Record {
  kind: string;
  /** The row's key columns as a JSON array, e.g. `["sha256:…"]`. */
  key: string;
  data: { [column: string]: unknown } | null;
  changed_at: string;
}

/** The connection dropped or the project didn't answer: changes wait here. */
export class Offline extends Error {}
/** The sign-in ran out and couldn't be renewed. */
export class SignedOut extends Error {}

const SETUP_HINT = "TBV's tables aren't in this Supabase project yet. Run the setup script from the desktop app's Preferences › Sync, then try again";

const now = () => Math.floor(Date.now() / 1000);

/** Tries before giving up on a busy Supabase, waiting longer each time. */
const BUSY_TRIES = 6;

/**
 * Whether an answer means "too busy, try again soon" rather than a real
 * problem. Supabase's file service sometimes puts its real status (and
 * "too many connections") inside a 400 or 500 answer's body.
 */
export async function busy(answer: Response): Promise<boolean> {
  if ([429, 502, 503, 504, 544].includes(answer.status)) return true;
  if (answer.status !== 400 && answer.status !== 500) return false;
  const body = (await answer.clone().text().catch(() => "")).toLowerCase();
  return ["too many connections", "timeout", "timed out", "rate limit", '"statuscode":"429"', '"statuscode":"503"', '"statuscode":"544"'].some((w) =>
    body.includes(w),
  );
}

// A few requests with Supabase at once: the free plan's file service shares a
// small pool of database connections, and too many at once get turned away.
const AT_ONCE = 3;
let inFlight = 0;
const waiting: (() => void)[] = [];
function takeTurn(): Promise<void> {
  if (inFlight < AT_ONCE) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise((go) => waiting.push(go));
}
function endTurn() {
  const next = waiting.shift();
  if (next) next();
  else inFlight--;
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Offline("the connection failed");
  }
}

async function said(answer: Response): Promise<{ code: string; text: string }> {
  const body = await answer.text().catch(() => "");
  let parsed: { [k: string]: unknown } = {};
  try {
    parsed = JSON.parse(body);
  } catch {
    /* not JSON */
  }
  const text = ["msg", "message", "error_description", "error"].map((k) => parsed[k]).find((v) => typeof v === "string") as string | undefined;
  return { code: typeof parsed.code === "string" ? parsed.code : "", text: text ?? (body.trim() && body.length < 200 ? body.trim() : `status ${answer.status}`) };
}

async function problem(answer: Response): Promise<Error> {
  const { code, text } = await said(answer);
  if (["PGRST205", "PGRST202", "42P01", "42883"].includes(code)) return new Error(`${SETUP_HINT}. (Supabase said: ${text})`);
  return new Error(text);
}

function sessionFrom(answer: { access_token: string; refresh_token: string; expires_in: number; user: { id: string; email?: string } }, email: string): Session {
  return {
    userId: answer.user.id,
    email: answer.user.email ?? email,
    accessToken: answer.access_token,
    refreshToken: answer.refresh_token,
    expiresAt: now() + answer.expires_in,
  };
}

const auth = (project: SupabaseProject, path: string, body: unknown) =>
  send(`${project.url}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: project.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export async function signIn(project: SupabaseProject, email: string, password: string): Promise<Session> {
  const answer = await auth(project, "token?grant_type=password", { email, password });
  if (!answer.ok) {
    const { text } = await said(answer);
    if (text.includes("Email not confirmed")) throw new Error("Confirm your email first: open the link Supabase sent you, then sign in.");
    if (text.includes("Invalid login credentials")) throw new Error("That email and password don't match an account in this project.");
    throw new Error(text);
  }
  return sessionFrom(await answer.json(), email);
}

/** Makes an account. Null means Supabase emailed a link to confirm first. */
export async function signUp(project: SupabaseProject, email: string, password: string): Promise<Session | null> {
  const answer = await auth(project, "signup", { email, password });
  if (!answer.ok) throw new Error((await said(answer)).text);
  const body = await answer.json();
  return body.access_token ? sessionFrom(body, email) : null;
}

export function signOut(project: SupabaseProject, session: Session): void {
  void send(`${project.url}/auth/v1/logout`, {
    method: "POST",
    headers: { apikey: project.anonKey, Authorization: `Bearer ${session.accessToken}` },
  }).catch(() => undefined);
}

/** A signed-in connection. Renews the sign-in when it runs out and hands the new one to `onRenewed`. */
export class Supabase {
  private renewing: Promise<void> | null = null;

  constructor(
    readonly project: SupabaseProject,
    public session: Session,
    private readonly deviceId: string,
    private readonly onRenewed: (session: Session) => void,
  ) {}

  private renew(): Promise<void> {
    this.renewing ??= (async () => {
      try {
        const answer = await auth(this.project, "token?grant_type=refresh_token", { refresh_token: this.session.refreshToken });
        if (!answer.ok) {
          if (answer.status >= 400 && answer.status < 500) throw new SignedOut("signed out");
          throw new Error((await said(answer)).text);
        }
        this.session = sessionFrom(await answer.json(), this.session.email);
        this.onRenewed(this.session);
      } finally {
        this.renewing = null;
      }
    })();
    return this.renewing;
  }

  /** Waits and tries again when Supabase is too busy, rather than failing the whole sync. */
  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    if (this.session.expiresAt - 60 < now()) await this.renew();
    let renewed = false;
    for (let tries = 1; ; tries++) {
      await takeTurn();
      let answer: Response;
      try {
        answer = await send(`${this.project.url}${path}`, {
          ...init,
          headers: { ...init.headers, apikey: this.project.anonKey, Authorization: `Bearer ${this.session.accessToken}` },
        });
      } finally {
        endTurn();
      }
      if (answer.status === 401) {
        if (renewed) throw new SignedOut("signed out");
        renewed = true;
        await this.renew();
        continue;
      }
      if (tries >= BUSY_TRIES || !(await busy(answer))) return answer;
      await new Promise((done) => setTimeout(done, 500 * 2 ** tries));
    }
  }

  async push(records: Record[]): Promise<void> {
    const rows = records.map((r) => ({ ...r, device_id: this.deviceId }));
    const answer = await this.call("/rest/v1/rpc/tbv_push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: rows }),
    });
    if (!answer.ok) throw await problem(answer);
  }

  /** Records changed after `after` (the last `seq` seen), oldest first. */
  async pull(after: number, limit: number): Promise<{ records: Record[]; cursor: number }> {
    const answer = await this.call(`/rest/v1/tbv_records?select=seq,kind,key,data,changed_at&seq=gt.${after}&order=seq.asc&limit=${limit}`);
    if (!answer.ok) throw await problem(answer);
    const rows: (Record & { seq: number })[] = await answer.json();
    return {
      records: rows.map(({ kind, key, data, changed_at }) => ({ kind, key, data, changed_at })),
      cursor: rows.length ? rows[rows.length - 1].seq : after,
    };
  }

  private object(path: string) {
    return `${BUCKET}/${this.session.userId}/${path}`;
  }

  /** A file from the bucket, joined from its pieces if it's kept in them, or null if it isn't there. */
  async download(path: string): Promise<Blob | null> {
    const whole = await this.downloadWhole(path);
    if (whole) return whole;
    const pieces = await this.piecesOf(path);
    if (!pieces) return null;
    const parts: Blob[] = [];
    for (let i = 0; i < pieces.count; i++) {
      const part = await this.downloadWhole(piecePath(path, i));
      if (!part) throw new Error("A piece of this file is missing from Supabase.");
      parts.push(part);
    }
    const joined = new Blob(parts);
    if (joined.size !== pieces.size) throw new Error("This file's pieces in Supabase don't add up.");
    return joined;
  }

  private async downloadWhole(path: string): Promise<Blob | null> {
    const answer = await this.call(`/storage/v1/object/authenticated/${this.object(path)}`);
    if (answer.status === 404 || answer.status === 400) return null;
    if (!answer.ok) throw await problem(answer);
    return answer.blob();
  }

  /** What a file's piece index says, or null if it isn't kept in pieces. */
  async piecesOf(path: string): Promise<Pieces | null> {
    const index = await this.downloadWhole(`${path}${PIECES}/${PIECE_INDEX}`);
    if (!index) return null;
    try {
      const pieces = JSON.parse(await index.text()) as Pieces;
      return pieces.piece > 0 && pieces.count > 0 ? pieces : null;
    } catch {
      return null;
    }
  }

  /** A link that plays a file straight from the bucket for a few hours, or null if it isn't there. */
  async signedUrl(path: string, seconds: number): Promise<string | null> {
    const answer = await this.call(`/storage/v1/object/sign/${this.object(path)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: seconds }),
    });
    if (answer.status === 404 || answer.status === 400) return null;
    if (!answer.ok) throw await problem(answer);
    const { signedURL } = (await answer.json()) as { signedURL: string };
    return `${this.project.url}/storage/v1${signedURL}`;
  }

  async upload(path: string, file: Blob): Promise<void> {
    if (file.size <= PIECE_BYTES) return this.uploadWhole(path, file);
    // Pieces first and the index last, so a half-sent file is never read as whole.
    const pieces: Pieces = { size: file.size, count: Math.ceil(file.size / PIECE_BYTES), piece: PIECE_BYTES };
    for (let i = 0; i < pieces.count; i++) await this.uploadWhole(piecePath(path, i), file.slice(i * PIECE_BYTES, (i + 1) * PIECE_BYTES));
    await this.uploadWhole(`${path}${PIECES}/${PIECE_INDEX}`, new Blob([JSON.stringify(pieces)]));
    await this.remove(path, false);
  }

  private async uploadWhole(path: string, file: Blob): Promise<void> {
    const answer = await this.call(`/storage/v1/object/${this.object(path)}`, {
      method: "POST",
      headers: { "x-upsert": "true", "Content-Type": "application/octet-stream" },
      body: file,
    });
    if (answer.status === 413) throw new Error("too big for this Supabase plan's file size limit");
    if (!answer.ok) throw await problem(answer);
  }

  /** Erases a file, and its pieces too unless `pieces` is false. Fine if it isn't there. */
  async remove(path: string, pieces = true): Promise<void> {
    const answer = await this.call(`/storage/v1/object/${this.object(path)}`, { method: "DELETE" });
    if (!answer.ok && answer.status !== 404 && answer.status !== 400) throw await problem(answer);
    if (!pieces) return;
    const folder = `${path}${PIECES}/`;
    for (const name of await this.listRaw(folder)) if (!name.folder) await this.remove(`${folder}${name.name}`, false);
  }

  /** The names of the files in one folder of the bucket. A file kept in pieces is listed as itself. */
  async list(folder: string): Promise<string[]> {
    return (await this.listRaw(folder)).map((n) => listedName(n.name, n.folder)).filter((n): n is string => n !== null);
  }

  private async listRaw(folder: string): Promise<{ name: string; folder: boolean }[]> {
    const names: { name: string; folder: boolean }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const answer = await this.call(`/storage/v1/object/list/${BUCKET}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: `${this.session.userId}/${folder.replace(/\/$/, "")}`, limit: 1000, offset }),
      });
      if (!answer.ok) throw await problem(answer);
      const page: { name: string; id: string | null }[] = await answer.json();
      names.push(...page.map((f) => ({ name: f.name, folder: f.id === null })));
      if (page.length < 1000) return names;
    }
  }
}
