// Book details' "Where it came from", for a book imported into Scribe or
// duplicated from one: the signed record of the person confirming they may
// publish it, checked each time it's shown, the original file when this
// device keeps it, and this device's own history. Nothing here is part of
// the book itself, and none of it goes into an exported file.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { ProvenanceRecord, WritingProvenance } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { formatBytes } from "../settings/controls";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });

const APPLE_CHECK: Record<string, string> = {
  valid: "Apple vouched for it: made by genuine TBV on a real Apple device, and checked against Apple's certificate",
  development: "Apple vouched for it from a test build of TBV, checked against Apple's certificate",
  invalid: "Apple's stamp is attached, but it doesn't match this record",
  unreadable: "Apple's stamp is attached, but it can't be read",
};

const source = (r: ProvenanceRecord) => (r.record.source ?? {}) as { name?: string; sha256?: string; bytes?: number; format?: string };

function RecordRow({ record, own }: { record: ProvenanceRecord; own: boolean }) {
  const s = source(record);
  const what =
    record.event === "duplicate"
      ? "Duplicated from another book"
      : `${own ? "Imported" : "The original book was imported"} from ${s.name ?? "a file"}, after you confirmed you own it or may publish it`;
  const at = typeof record.record.at === "string" ? record.record.at : record.createdAt;
  return (
    <li className="provenance-record">
      <p>
        <strong>{what}</strong>
        <br />
        <span className="muted">
          {when(at)}
          {record.device ? `, on ${record.device}` : ""}
        </span>
      </p>
      <p className={`provenance-check is-${record.signature}`}>
        <Icon name={record.signature === "valid" ? "checkCircle" : "info"} size={14} />
        {record.signature === "valid" ? "Signed, and the signature checks" : record.signature === "invalid" ? "This record doesn't match its signature: it was changed after it was made" : "This record can't be read"}
      </p>
      {record.appleStamp && (
        <p className={`provenance-check is-${record.appleCheck === "valid" || record.appleCheck === "development" ? "valid" : "invalid"}`}>
          <Icon name={record.appleCheck === "valid" || record.appleCheck === "development" ? "checkCircle" : "info"} size={14} />
          {APPLE_CHECK[record.appleCheck ?? "unreadable"]}
        </p>
      )}
      <details className="provenance-more">
        <summary>The record</summary>
        <dl>
          {record.event === "import" && (
            <>
              <dt>Confirmation</dt>
              <dd>Version {String(record.record.policyVersion ?? "?")}, ticked by you</dd>
              <dt>File</dt>
              <dd>
                {s.name} {typeof s.bytes === "number" ? `(${formatBytes(s.bytes)})` : ""}
              </dd>
              <dt>Its fingerprint</dt>
              <dd className="provenance-hash">SHA-256 {s.sha256}</dd>
            </>
          )}
          <dt>Signed with</dt>
          <dd className="provenance-hash">
            {String(record.record.algorithm ?? "Ed25519")} key {record.keyId}
          </dd>
        </dl>
      </details>
    </li>
  );
}

export function WhereItCameFrom({ projectId }: { projectId: string }) {
  const [seen, setSeen] = useState<WritingProvenance | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    api.writingProvenance(projectId).then(
      (p) => current && setSeen(p),
      () => current && setSeen(null),
    );
    return () => {
      current = false;
    };
  }, [projectId, reload]);

  if (!seen || (!seen.records.length && !seen.sources.length)) return null;
  const imported = seen.records.some((r) => r.event === "import");
  return (
    <section className="provenance" aria-labelledby="provenance-title">
      <h3 id="provenance-title">Where it came from</h3>
      <ul className="provenance-records">
        {seen.records.map((r) => (
          <RecordRow key={r.id} record={r} own={r.projectId === projectId} />
        ))}
      </ul>
      {seen.sources.map((s) => (
        <div key={s.sha256} className="provenance-source">
          <Icon name="file" size={15} />
          <span>
            The original, {s.name} ({formatBytes(s.bytes)}), is kept on this device, and copied to your cloud when notes sync.
          </span>
          <button type="button" className="link-btn" onClick={() => setDeleting(s.sha256)}>
            Delete the original
          </button>
        </div>
      ))}
      {imported && !seen.sources.length && <p className="muted provenance-note">The original file isn't on this device. A computer copies it down from your cloud when notes sync; its fingerprint stays in the record either way.</p>}
      <p className="muted provenance-note">This record is your own confirmation, kept with the book. It isn't a check of who wrote it, and it's never put into a book you export.</p>
      {seen.history.length > 0 && (
        <details className="provenance-more">
          <summary>This device's history</summary>
          <ul className="provenance-history">
            {seen.history.map((h, i) => (
              <li key={i}>
                <span className="muted">{when(h.at)}</span> {h.detail}
              </li>
            ))}
          </ul>
        </details>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete the original file?"
          body="The book stays as it is, and the signed record keeps the file's fingerprint. The original is deleted from this device and from your cloud. Another computer that already copied it keeps its copy until you delete it there too."
          confirm="Delete the original"
          danger
          onConfirm={() => {
            const sha = deleting;
            setDeleting(null);
            void api.deleteWritingSource(projectId, sha).then(() => setReload((n) => n + 1));
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
