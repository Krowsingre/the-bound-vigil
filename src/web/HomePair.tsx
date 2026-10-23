import { useEffect, useState } from "react";
import { homeKey, pairHome } from "../api/homeCore";

/**
 * The phone version served by the computer at home: pairs the phone once
 * with the code TBV shows on the computer, then shows the app. A QR code
 * from the computer carries the code, so scanning it pairs at once.
 */
export function HomePair({ children }: { children: React.ReactNode }) {
  const fromLink = /[#&]pair=(\d{6})/.exec(location.hash)?.[1] ?? "";
  const [paired, setPaired] = useState(() => !!homeKey());
  const [code, setCode] = useState(fromLink);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pair = async (value: string) => {
    setBusy(true);
    setProblem(null);
    try {
      await pairHome(value);
      history.replaceState(null, "", location.pathname);
      // The app loads afresh with the key.
      location.reload();
      setPaired(true);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!paired && fromLink) void pair(fromLink);
    // Only for the code the link brought.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (paired) return <>{children}</>;
  return (
    <div className="web-connect">
      <form
        className="web-connect-card"
        onSubmit={(e) => {
          e.preventDefault();
          void pair(code);
        }}
      >
        <h1>The Bound Vigil</h1>
        <p className="muted">
          Enter the code TBV shows on your computer, in Preferences › Sync › Use on your phone at home. This phone only needs it
          once.
        </p>
        <label className="field">
          <span>Pairing code</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
        </label>
        {problem && (
          <p className="form-error" role="alert">
            {problem}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
          {busy ? "Pairing…" : "Pair this phone"}
        </button>
      </form>
    </div>
  );
}
