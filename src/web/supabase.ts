// Talking to the person's Supabase project from the browser: signing in,
// and the same table, function and file bucket the desktop app uses (see
// supabase/setup.sql and crates/tbv-core/src/sync/supabase.rs).

import type { SupabaseProject } from "../api/types";

export const BUCKET = "tbv-files";

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

const SETUP_HINT = "TBV's tables aren't in this Supabase project yet. Run the setup script from the desktop app's Settings › Sync, then try again";

const now = () => Math.floor(Date.now() / 1000);

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

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    if (this.session.expiresAt - 60 < now()) await this.renew();
    for (let attempt = 0; attempt < 2; attempt++) {
      const answer = await send(`${this.project.url}${path}`, {
        ...init,
        headers: { ...init.headers, apikey: this.project.anonKey, Authorization: `Bearer ${this.session.accessToken}` },
      });
      if (answer.status === 401 && attempt === 0) {
        await this.renew();
        continue;
      }
      return answer;
    }
    throw new SignedOut("signed out");
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

  /** A file from the bucket, or null if it isn't there. */
  async download(path: string): Promise<Blob | null> {
    const answer = await this.call(`/storage/v1/object/authenticated/${this.object(path)}`);
    if (answer.status === 404 || answer.status === 400) return null;
    if (!answer.ok) throw await problem(answer);
    return answer.blob();
  }

  async upload(path: string, file: Blob): Promise<void> {
    const answer = await this.call(`/storage/v1/object/${this.object(path)}`, {
      method: "POST",
      headers: { "x-upsert": "true", "Content-Type": "application/octet-stream" },
      body: file,
    });
    if (answer.status === 413) throw new Error("too big for this Supabase plan's file size limit");
    if (!answer.ok) throw await problem(answer);
  }

  /** The names of the files in one folder of the bucket. */
  async list(folder: string): Promise<string[]> {
    const names: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const answer = await this.call(`/storage/v1/object/list/${BUCKET}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: `${this.session.userId}/${folder}`, limit: 1000, offset }),
      });
      if (!answer.ok) throw await problem(answer);
      const page: { name: string; id: string | null }[] = await answer.json();
      names.push(...page.filter((f) => f.id !== null).map((f) => f.name));
      if (page.length < 1000) return names;
    }
  }
}
