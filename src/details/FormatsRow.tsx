// A book's details: its files, when copies in other formats are kept with
// it. Each one opens on its own; your place and notes are the book's.

import { api } from "../api";
import type { BookFile } from "../api/types";
import { useToast } from "../components/Toast";
import { formatLabel } from "../lib/queryBooks";
import { formatBytes } from "../settings/controls";

export function FormatsRow({
  bookId,
  files,
  onOpen,
  onChanged,
}: {
  bookId: string;
  files: BookFile[];
  onOpen: (fileId: string) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const apart = (f: BookFile) =>
    api.keepApart(f.id).then(
      () => {
        toast(`The ${formatLabel(f.format)} is listed on its own again. Your notes and place stay with this one.`);
        onChanged();
      },
      (e: unknown) => toast(`Couldn't keep it apart: ${String(e)}`),
    );
  return (
    <div>
      <dt>Formats</dt>
      <dd className="details-formats">
        {files.map((f) => (
          <span key={f.id} className="details-format">
            {formatLabel(f.format)}
            {f.size ? <span className="muted"> · {formatBytes(f.size)}</span> : null}{" "}
            <button type="button" className="view-all" onClick={() => onOpen(f.id)}>
              Open
            </button>
            {f.id !== bookId && (
              <button type="button" className="view-all" onClick={() => void apart(f)}>
                Keep apart
              </button>
            )}
          </span>
        ))}
      </dd>
    </div>
  );
}
