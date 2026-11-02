// A poem's sound, above the poem in the editor: a recording or a song made
// from it, and a web page where it can be heard. The plain EPUB and the
// Apple edition carry the sound itself; the Kindle and other store editions
// get the link, and the paperback a QR code of it.

import { useEffect, useRef, useState } from "react";
import { api, isWeb } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { webLink, type PoemSound as Sound } from "./pages";

const ACCEPT = ".mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg,audio/flac";

const MIME: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac" };

export function PoemSound({ sound, onChange }: { sound: Sound | null; onChange: (sound: Sound | null) => Promise<void> | void }) {
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [link, setLink] = useState(sound?.link ?? "");
  useEffect(() => setLink(sound?.link ?? ""), [sound?.link]);

  // The sound to play here, when this device has it.
  const file = sound?.file ?? null;
  useEffect(() => {
    setUrl(null);
    setMissing(false);
    if (!file) return;
    let made: string | null = null;
    let current = true;
    void api.writingSound(file).then(
      (bytes) => {
        if (!current) return;
        if (!bytes) return setMissing(true);
        made = URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[file.split(".").pop() ?? ""] ?? "audio/mpeg" }));
        setUrl(made);
      },
      () => current && setMissing(true),
    );
    return () => {
      current = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [file]);

  const add = async (picked: File | undefined) => {
    if (!picked) return;
    setBusy(true);
    try {
      const kept = await api.keepWritingSound(picked.name, new Uint8Array(await picked.arrayBuffer()));
      await onChange({ file: kept.file, name: picked.name, link: sound?.link ?? null });
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  };

  const saveLink = () => {
    const text = link.trim();
    const next = webLink(text);
    if (text && !next) return toast("That isn't a web address. Use one that starts with https://.");
    if (next === (sound?.link ?? null)) return;
    void onChange(sound?.file || next ? { file: sound?.file ?? null, name: sound?.name ?? "", link: next } : null);
  };

  return (
    <section className="poem-sound-bar" aria-label="The poem's sound">
      <div className="poem-sound-row">
        <Icon name="headphones" size={18} className="poem-sound-icon" />
        {file ? (
          <>
            <div className="poem-sound-what">
              <strong title={sound?.name}>{sound?.name || "The poem's sound"}</strong>
              {url ? (
                <audio controls src={url} preload="metadata" />
              ) : (
                <span className="muted">{missing ? "On another device. It comes here when your devices sync." : "Loading…"}</span>
              )}
            </div>
            {!isWeb && (
              <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => picker.current?.click()}>
                Replace…
              </button>
            )}
            <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => void onChange(sound?.link ? { file: null, name: "", link: sound.link } : null)}>
              Remove
            </button>
          </>
        ) : (
          <>
            <div className="poem-sound-what">
              <strong>Add a sound to this poem</strong>
              <span className="muted">A reading or a song of it. It plays inside the EPUB and the Apple edition.</span>
            </div>
            {!isWeb && (
              <button type="button" className="btn btn-small" disabled={busy} onClick={() => picker.current?.click()}>
                <Icon name="plus" size={14} /> {busy ? "Adding…" : "Add sound…"}
              </button>
            )}
          </>
        )}
      </div>
      <label className="field poem-sound-link">
        <span>Where to hear it online, for Kindle and the paperback's QR code</span>
        <input
          type="url"
          inputMode="url"
          value={link}
          placeholder="https://"
          onChange={(e) => setLink(e.target.value)}
          onBlur={saveLink}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        />
      </label>
      <input ref={picker} type="file" accept={ACCEPT} hidden onChange={(e) => void add(e.target.files?.[0])} />
    </section>
  );
}
