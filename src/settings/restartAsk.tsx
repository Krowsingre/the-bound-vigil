import { useState, type ReactNode } from "react";
import { api } from "../api";
import type { ProviderChoice } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";

type Asking = { title: string; body: string; confirm: string; danger: boolean; run: () => void };

/**
 * Sync never starts over without asking first (embre, 28 November): choosing
 * another place, disconnecting or signing out each say what happens and wait
 * for a yes. Choosing the place already in use goes ahead at once.
 */
export function useRestartAsk(): {
  /** Runs `go` at once, or after a yes when `choice` would start sync over. */
  choose: (choice: ProviderChoice, where: string, go: () => void) => void;
  /** Asks before disconnecting or signing out, which ends syncing with that place. */
  leave: (title: string, go: () => void) => void;
  dialog: ReactNode;
} {
  const [asking, setAsking] = useState<Asking | null>(null);
  const choose = (choice: ProviderChoice, where: string, go: () => void) =>
    void api.wouldRestartSync(choice).then(
      (restarts) =>
        restarts
          ? setAsking({
              title: `Start sync over with ${where}?`,
              body: "Everything in your library is sent there, and everything there is read. This can take a while. Nothing is deleted.",
              confirm: "Start over",
              danger: false,
              run: go,
            })
          : go(),
      () => go(),
    );
  const leave = (title: string, go: () => void) =>
    setAsking({
      title,
      body: "Your library stays on this device, and nothing in the cloud is deleted. Connecting again later starts sync over.",
      confirm: "Disconnect",
      danger: true,
      run: go,
    });
  const dialog = asking && (
    <ConfirmDialog
      title={asking.title}
      body={asking.body}
      confirm={asking.confirm}
      danger={asking.danger}
      onCancel={() => setAsking(null)}
      onConfirm={() => {
        const go = asking.run;
        setAsking(null);
        go();
      }}
    />
  );
  return { choose, leave, dialog };
}
