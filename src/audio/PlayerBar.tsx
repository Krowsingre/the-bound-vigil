// The bar along the bottom while an audiobook is loaded: what's playing, where
// you are, and the controls.

import { useState } from "react";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { chapterLength, clock, SPEEDS, usePlayer } from "./player";

export function PlayerBar({ onShowAudiobooks }: { onShowAudiobooks: () => void }) {
  const player = usePlayer();
  // While dragging, the bar shows where you'd land.
  const [dragging, setDragging] = useState<number | null>(null);
  const { book } = player;
  if (!book) return null;

  const at = dragging ?? player.positionMs;
  const total = Math.max(1, book.durationMs);
  const chapter = book.chapters[player.chapterIndex];
  const percent = Math.round((at / total) * 100);

  return (
    <div className="player-bar" role="region" aria-label="Audiobook player">
      <button type="button" className="player-book" onClick={onShowAudiobooks} title="Show in Resonance">
        <BookCover book={book.book} size="s" />
        <span className="player-book-text">
          <strong>{book.book.title}</strong>
          <span className="muted">{[book.book.authors.join(", "), chapter?.title].filter(Boolean).join(" · ")}</span>
        </span>
      </button>

      <div className="player-progress">
        <input
          type="range"
          className="player-seek"
          min={0}
          max={total}
          step={1000}
          value={at}
          aria-label="Where you are"
          aria-valuetext={`${clock(at)} of ${clock(total)}`}
          style={{ "--fill": `${(at / total) * 100}%` } as React.CSSProperties}
          onChange={(e) => setDragging(Number(e.target.value))}
          onPointerUp={() => {
            if (dragging !== null) player.seek(dragging);
            setDragging(null);
          }}
          onKeyUp={() => {
            if (dragging !== null) player.seek(dragging);
            setDragging(null);
          }}
        />
        <span className="player-times num muted">
          {clock(at)} / {clock(total)} <span className="player-percent">{percent}%</span>
        </span>
      </div>

      <div className="player-controls">
        <button
          type="button"
          className={`icon-btn${player.shuffle ? " is-on" : ""}`}
          aria-pressed={player.shuffle}
          aria-label="Shuffle"
          title={
            player.shuffle
              ? "Shuffle is on: another unfinished audiobook plays when this one ends"
              : "Shuffle: play another unfinished audiobook when this one ends"
          }
          onClick={() => player.setShuffle(!player.shuffle)}
        >
          <Icon name="shuffle" size={18} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Previous chapter"
          title="Previous chapter"
          onClick={() => player.chapter(-1)}
        >
          <Icon name="skipBack" size={18} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Back 30 seconds"
          title="Back 30 seconds"
          onClick={() => player.skip(-30_000)}
        >
          <Icon name="back30" size={20} />
        </button>
        <button
          type="button"
          className="player-play"
          aria-label={player.playing ? "Pause" : "Play"}
          aria-busy={player.loading}
          onClick={player.toggle}
        >
          <Icon name={player.playing ? "pause" : "play"} size={22} filled={!player.playing} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Forward 30 seconds"
          title="Forward 30 seconds"
          onClick={() => player.skip(30_000)}
        >
          <Icon name="forward30" size={20} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Next chapter"
          title="Next chapter"
          onClick={() => player.chapter(1)}
        >
          <Icon name="skipForward" size={18} />
        </button>
      </div>

      <div className="player-extras">
        <button
          type="button"
          className="icon-btn"
          aria-label={player.muted ? "Sound on" : "Mute"}
          title={player.muted ? "Sound on" : "Mute"}
          onClick={() => player.setMuted(!player.muted)}
        >
          <Icon name={player.muted || player.volume === 0 ? "volumeOff" : "volume"} size={18} />
        </button>
        <input
          type="range"
          className="player-volume"
          min={0}
          max={1}
          step={0.05}
          value={player.muted ? 0 : player.volume}
          aria-label="Volume"
          style={{ "--fill": `${(player.muted ? 0 : player.volume) * 100}%` } as React.CSSProperties}
          onChange={(e) => player.setVolume(Number(e.target.value))}
        />
        <Menu
          label={`Speed ${player.rate}×`}
          className="toolbar-button player-speed"
          trigger={<span className="num">{player.rate}×</span>}
          items={SPEEDS.map((s) => ({ label: `${s}×`, checked: s === player.rate, onSelect: () => player.setRate(s) }))}
        />
        {book.chapters.length > 0 && (
          <Menu
            label="Chapters"
            className="icon-btn"
            trigger={<Icon name="list" size={18} />}
            items={book.chapters.map((c, i) => ({
              label: `${i + 1}. ${c.title}`,
              hint: clock(chapterLength(book, i)),
              checked: i === player.chapterIndex,
              onSelect: () => player.seek(c.startMs),
            }))}
          />
        )}
        <button type="button" className="icon-btn" aria-label="Close the player" title="Close the player" onClick={player.close}>
          <Icon name="close" size={18} />
        </button>
      </div>
    </div>
  );
}
