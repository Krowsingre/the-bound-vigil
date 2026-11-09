import { useEffect, useRef, type ReactNode } from "react";

/** Asks before something that can't be taken back. */
export function ConfirmDialog({
  title,
  body,
  confirm,
  danger = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirm: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog confirm-dialog" role="alertdialog" aria-label={title} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
        <h2>{title}</h2>
        {typeof body === "string" ? <p className="muted">{body}</p> : body}
        <div className="dialog-actions">
          <button ref={cancel} type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={confirmDisabled} onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
