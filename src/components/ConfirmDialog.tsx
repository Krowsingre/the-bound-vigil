import { useEffect, useRef } from "react";

/** Asks before something that can't be taken back. */
export function ConfirmDialog({
  title,
  body,
  confirm,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog confirm-dialog" role="alertdialog" aria-label={title} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
        <h2>{title}</h2>
        <p className="muted">{body}</p>
        <div className="dialog-actions">
          <button ref={cancel} type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
