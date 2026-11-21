// Hidden books (embre, 21 November): chosen books leave every list and count
// and wait in a locked Hidden collection, opened with a TBV password, or with
// Face ID, Touch ID or Windows Hello as a shortcut. Hiding only: the files
// aren't scrambled. Hiding and the password reach every device.
//
// The password is never kept, only a salted PBKDF2-SHA256 of it, worked out
// here so every platform (the web version too) does it the same way.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { BookPreview, DeviceUnlockKind, HiddenLock } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { makeBookActions } from "../home/bookActions";
import { BookGrid } from "./BookViews";

const ROUNDS = 210_000;
const MIN_LENGTH = 4;

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));

async function derive(password: string, salt: string, rounds: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromHex(salt), iterations: rounds }, key, 256);
  return toHex(new Uint8Array(bits));
}

/** A new lock for a password: a fresh salt and its hash. */
export async function makeLock(password: string): Promise<HiddenLock> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await derive(password, salt, ROUNDS), rounds: ROUNDS };
}

/** Whether the password opens the lock. */
export async function checkPassword(password: string, lock: HiddenLock): Promise<boolean> {
  const hash = await derive(password, lock.salt, lock.rounds);
  // Every character compared, so how long it takes says nothing about the hash.
  let differs = hash.length ^ lock.hash.length;
  for (let i = 0; i < Math.min(hash.length, lock.hash.length); i++) differs |= hash.charCodeAt(i) ^ lock.hash.charCodeAt(i);
  return differs === 0;
}

/** Said when books are hidden or brought back, so lists and the Hidden card update. */
export const HIDDEN_CHANGED = "tbv:hidden-changed";
const changed = () => window.dispatchEvent(new Event(HIDDEN_CHANGED));

export const UNLOCK_NAME: Record<DeviceUnlockKind, string> = {
  faceId: "Face ID",
  touchId: "Touch ID",
  opticId: "Optic ID",
  windowsHello: "Windows Hello",
};

type Ask = { books: BookPreview[]; after?: () => void };
let listener: ((ask: Ask) => void) | null = null;
let toastHere: ((message: string, action?: { label: string; run: () => void }) => void) | null = null;

const named = (books: BookPreview[]) => (books.length === 1 ? `“${books[0].title}”` : `${books.length} books`);

async function hideNow(books: BookPreview[], after?: () => void) {
  try {
    await api.setHidden(books.map((b) => b.id), true);
    changed();
    after?.();
    toastHere?.(`Hid ${named(books)}. ${books.length === 1 ? "It's" : "They're"} in Hidden, in the Compendium.`, {
      label: "Undo",
      run: () => void api.setHidden(books.map((b) => b.id), false).then(() => (changed(), after?.())),
    });
  } catch (e) {
    toastHere?.(`Couldn't hide ${named(books)}: ${String(e)}`);
  }
}

/** Hides the books. The first time, a password for Hidden is set up first. */
export function askHide(books: BookPreview[], after?: () => void) {
  if (!books.length) return;
  void api.hiddenLock().then(
    (lock) => (lock ? hideNow(books, after) : listener?.({ books, after })),
    (e: unknown) => toastHere?.(`Couldn't hide ${named(books)}: ${String(e)}`),
  );
}

/** Brings hidden books back to the Archive and everywhere else. */
export async function unhide(books: BookPreview[], after?: () => void) {
  try {
    await api.setHidden(books.map((b) => b.id), false);
    changed();
    after?.();
    toastHere?.(`${named(books)} ${books.length === 1 ? "is" : "are"} back in your library.`);
  } catch (e) {
    toastHere?.(`Couldn't bring back ${named(books)}: ${String(e)}`);
  }
}

/** Shows the password setup the first time books are hidden. Mounted once, in App. */
export function HiddenDialogsHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const toast = useToast();
  useEffect(() => {
    listener = setAsk;
    toastHere = toast;
    return () => {
      listener = null;
      toastHere = null;
    };
  }, [toast]);
  if (!ask) return null;
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setAsk(null)}>
      <div className="dialog hidden-dialog" role="dialog" aria-label="Set a password for Hidden" onKeyDown={(e) => e.key === "Escape" && setAsk(null)}>
        <h2>Set a password for Hidden</h2>
        <PasswordSetup
          books={ask.books}
          onCancel={() => setAsk(null)}
          onSet={() => {
            const { books, after } = ask;
            setAsk(null);
            void hideNow(books, after);
          }}
        />
      </div>
    </div>
  );
}

/** Choosing the password: typed twice. */
function PasswordSetup({ books, onSet, onCancel, change }: { books?: BookPreview[]; onSet: () => void; onCancel?: () => void; change?: boolean }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlockKind, setUnlockKind] = useState<DeviceUnlockKind | null>(null);
  useEffect(() => {
    void api.deviceUnlockKind().then(setUnlockKind, () => setUnlockKind(null));
  }, []);
  const short = password.length < MIN_LENGTH;
  const save = async () => {
    if (short) return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (password !== again) return setError("The two passwords aren't the same.");
    setBusy(true);
    try {
      await api.setHiddenLock(await makeLock(password));
      onSet();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  return (
    <form className="hidden-setup" onSubmit={(e) => (e.preventDefault(), void save())}>
      <p className="muted">
        {books ? `${named(books)} will be hidden from your library on every device. ` : ""}
        Hidden opens with this password on all your devices{unlockKind ? `, and with ${UNLOCK_NAME[unlockKind]} on this one` : ""}.
      </p>
      <label className="field">
        <span>{change ? "New password" : "Password"}</span>
        <input type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => (setPassword(e.target.value), setError(null))} />
      </label>
      <label className="field">
        <span>Type it again</span>
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => (setAgain(e.target.value), setError(null))} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn btn-primary" disabled={busy || !password || !again}>
          {books ? "Set password and hide" : change ? "Change password" : "Set password"}
        </button>
      </div>
    </form>
  );
}

/** How many books are hidden, kept up to date. Null until known. */
export function useHiddenCount(refreshKey: number): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let current = true;
    const load = () => void api.hiddenCount().then((n) => current && setCount(n), () => current && setCount(0));
    load();
    window.addEventListener(HIDDEN_CHANGED, load);
    return () => {
      current = false;
      window.removeEventListener(HIDDEN_CHANGED, load);
    };
  }, [refreshKey]);
  return count;
}

/** The Hidden card in the Compendium: locked, so it shows no covers or count. */
export function HiddenCard({ layout, onOpen }: { layout: "grid" | "list"; onOpen: () => void }) {
  return (
    <li className={`collection-card collection-card-${layout} hidden-card`}>
      <button type="button" className="collection-card-open" onClick={onOpen}>
        <span className="collection-card-head">
          <span className="collection-card-name">
            <Icon name="lock" size={16} />
            Hidden
          </span>
          <span className="collection-card-meta">Locked</span>
        </span>
        {layout === "grid" ? (
          <span className="hidden-card-lock" aria-hidden>
            <Icon name="lock" size={40} />
          </span>
        ) : (
          <span className="collection-card-desc">Books you've hidden from your library.</span>
        )}
      </button>
    </li>
  );
}

/**
 * The Hidden collection, full page. It opens locked every time: leaving it
 * (or closing TBV) locks it again, since being open lives only here.
 */
export function HiddenView({ refreshKey, onBack, onOpenBook, onChanged }: {
  refreshKey: number;
  onBack: () => void;
  onOpenBook: (bookId: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="collection-view hidden-view">
      <button type="button" className="back-link" onClick={onBack}>
        <Icon name="chevronLeft" size={14} /> Back to Compendium
      </button>
      {open ? <HiddenBooks refreshKey={refreshKey} onOpenBook={onOpenBook} onChanged={onChanged} /> : <Unlock onOpen={() => setOpen(true)} />}
    </div>
  );
}

function Unlock({ onOpen }: { onOpen: () => void }) {
  const [lock, setLock] = useState<HiddenLock | null | undefined>(undefined);
  const [unlockKind, setUnlockKind] = useState<DeviceUnlockKind | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void api.hiddenLock().then(setLock, (e: unknown) => (setLock(null), setError(String(e))));
    void api.deviceUnlockKind().then(setUnlockKind, () => setUnlockKind(null));
  }, []);
  const tryPassword = async () => {
    if (!lock || !password) return;
    setBusy(true);
    const right = await checkPassword(password, lock).catch(() => false);
    setBusy(false);
    if (right) return onOpen();
    setError("That isn't the password.");
    setPassword("");
    field.current?.focus();
  };
  const tryDevice = async () => {
    if (!unlockKind) return;
    setError(null);
    const passed = await api.deviceUnlock("Open your Hidden collection").catch(() => false);
    if (passed) onOpen();
    else setError(`${UNLOCK_NAME[unlockKind]} didn't open Hidden. Use the password instead.`);
  };
  if (lock === undefined) return <div className="library-loading" aria-busy="true" />;
  return (
    <div className="hidden-unlock">
      <span className="hidden-unlock-icon" aria-hidden><Icon name="lock" size={32} /></span>
      <h1 className="library-title">Hidden</h1>
      {lock === null ? (
        <PasswordSetup onSet={onOpen} />
      ) : (
        <form onSubmit={(e) => (e.preventDefault(), void tryPassword())}>
          <label className="field">
            <span>Password</span>
            <input ref={field} type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => (setPassword(e.target.value), setError(null))} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="hidden-unlock-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !password}>Open</button>
            {unlockKind && (
              <button type="button" className="btn btn-quiet" onClick={() => void tryDevice()}>
                Use {UNLOCK_NAME[unlockKind]}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

/** Changing the password: the current one (or the device's own unlock) first, then the new one twice. */
function ChangePassword({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [lock, setLock] = useState<HiddenLock | null>(null);
  const [unlockKind, setUnlockKind] = useState<DeviceUnlockKind | null>(null);
  const [passed, setPassed] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void api.hiddenLock().then(setLock, (e: unknown) => setError(String(e)));
    void api.deviceUnlockKind().then(setUnlockKind, () => setUnlockKind(null));
  }, []);
  const tryPassword = async () => {
    if (!lock || !password) return;
    setBusy(true);
    const right = await checkPassword(password, lock).catch(() => false);
    setBusy(false);
    if (right) return setPassed(true);
    setError("That isn't the password.");
    setPassword("");
    field.current?.focus();
  };
  const tryDevice = async () => {
    if (!unlockKind) return;
    setError(null);
    const ok = await api.deviceUnlock("Change the password for Hidden").catch(() => false);
    if (ok) setPassed(true);
    else setError(`${UNLOCK_NAME[unlockKind]} didn't work. Use the password instead.`);
  };
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog hidden-dialog" role="dialog" aria-label="Change the password for Hidden" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h2>Change the password for Hidden</h2>
        {passed ? (
          <PasswordSetup
            change
            onCancel={onClose}
            onSet={() => {
              onClose();
              toast("Password changed.");
            }}
          />
        ) : (
          <form className="hidden-setup" onSubmit={(e) => (e.preventDefault(), void tryPassword())}>
            <label className="field">
              <span>Current password</span>
              <input ref={field} type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => (setPassword(e.target.value), setError(null))} />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
              {unlockKind && (
                <button type="button" className="btn btn-quiet" onClick={() => void tryDevice()}>
                  Use {UNLOCK_NAME[unlockKind]}
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={busy || !lock || !password}>Next</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const PAGE = 200;

function HiddenBooks({ refreshKey, onOpenBook, onChanged }: { refreshKey: number; onOpenBook: (bookId: string) => void; onChanged: () => void }) {
  const toast = useToast();
  const [books, setBooks] = useState<BookPreview[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [reload, setReload] = useState(0);
  const [changing, setChanging] = useState(false);
  useEffect(() => {
    let current = true;
    void Promise.all(Array.from({ length: pages }, (_, page) =>
      api.getLibrary({ shelf: "all", sort: "title", search: null, formats: [], location: null, kind: null, hidden: true, omitFacets: true, page, pageSize: PAGE })))
      .then((got) => {
        if (!current) return;
        setBooks(got.flatMap((p, i) => (p.page === i ? p.books : [])));
        setTotal(got[0]?.total ?? 0);
      }, () => current && setBooks([]));
    const again = () => setReload((n) => n + 1);
    window.addEventListener(HIDDEN_CHANGED, again);
    return () => {
      current = false;
      window.removeEventListener(HIDDEN_CHANGED, again);
    };
  }, [pages, refreshKey, reload]);
  const actions = useMemo(
    () => ({
      ...makeBookActions(api, toast, () => (setReload((n) => n + 1), onChanged()), onOpenBook),
      unhide: (book: BookPreview) => void unhide([book], onChanged),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, onOpenBook],
  );
  if (!books) return <div className="library-loading" aria-busy="true" aria-label="Loading your hidden books" />;
  return (
    <>
      <div className="library-title-row">
        <h1 className="library-title">Hidden</h1>
        <button type="button" className="btn btn-quiet" onClick={() => setChanging(true)}>
          <Icon name="lock" size={15} /> Change password
        </button>
      </div>
      {changing && <ChangePassword onClose={() => setChanging(false)} />}
      <p className="muted">{total === 1 ? "1 book" : `${total.toLocaleString()} books`}, hidden from your library on every device.</p>
      {books.length === 0 ? (
        <div className="library-empty">
          <h2>Nothing hidden</h2>
          <p className="muted">Choose Hide in a book's menu to keep it here, out of your library.</p>
        </div>
      ) : (
        <BookGrid books={books} actions={actions} />
      )}
      {books.length < total && (
        <div className="library-end">
          <button type="button" className="btn btn-quiet" onClick={() => setPages((n) => n + 1)}>Show more</button>
        </div>
      )}
    </>
  );
}
