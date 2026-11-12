import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// The bar along the bottom while an audiobook is loaded: what's playing, where
// you are, and the controls.
import { useState } from "react";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { chapterLength, clock, SPEEDS, usePlayer } from "./player";
export function PlayerBar({ onShowAudiobooks }) {
    const player = usePlayer();
    // While dragging, the bar shows where you'd land.
    const [dragging, setDragging] = useState(null);
    const { book } = player;
    if (!book)
        return null;
    const at = dragging ?? player.positionMs;
    const total = Math.max(1, book.durationMs);
    const chapter = book.chapters[player.chapterIndex];
    const percent = Math.round((at / total) * 100);
    return (_jsxs("div", { className: "player-bar", role: "region", "aria-label": "Audiobook player", children: [_jsxs("button", { type: "button", className: "player-book", onClick: onShowAudiobooks, title: "Show in Resonance", children: [_jsx(BookCover, { book: book.book, size: "s" }), _jsxs("span", { className: "player-book-text", children: [_jsx("strong", { children: book.book.title }), _jsx("span", { className: "muted", children: [book.book.authors.join(", "), chapter?.title].filter(Boolean).join(" · ") })] })] }), _jsxs("div", { className: "player-progress", children: [_jsx("input", { type: "range", className: "player-seek", min: 0, max: total, step: 1000, value: at, "aria-label": "Where you are", "aria-valuetext": `${clock(at)} of ${clock(total)}`, style: { "--fill": `${(at / total) * 100}%` }, onChange: (e) => setDragging(Number(e.target.value)), onPointerUp: () => {
                            if (dragging !== null)
                                player.seek(dragging);
                            setDragging(null);
                        }, onKeyUp: () => {
                            if (dragging !== null)
                                player.seek(dragging);
                            setDragging(null);
                        } }), _jsxs("span", { className: "player-times num muted", children: [clock(at), " / ", clock(total), " ", _jsxs("span", { className: "player-percent", children: [percent, "%"] })] })] }), _jsxs("div", { className: "player-controls", children: [_jsx("button", { type: "button", className: `icon-btn${player.shuffle ? " is-on" : ""}`, "aria-pressed": player.shuffle, "aria-label": "Shuffle", title: player.shuffle
                            ? "Shuffle is on: another unfinished audiobook plays when this one ends"
                            : "Shuffle: play another unfinished audiobook when this one ends", onClick: () => player.setShuffle(!player.shuffle), children: _jsx(Icon, { name: "shuffle", size: 18 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Previous chapter", title: "Previous chapter", onClick: () => player.chapter(-1), children: _jsx(Icon, { name: "skipBack", size: 18 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Back 30 seconds", title: "Back 30 seconds", onClick: () => player.skip(-30_000), children: _jsx(Icon, { name: "back30", size: 20 }) }), _jsx("button", { type: "button", className: "player-play", "aria-label": player.playing ? "Pause" : "Play", "aria-busy": player.loading, onClick: player.toggle, children: _jsx(Icon, { name: player.playing ? "pause" : "play", size: 22, filled: !player.playing }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Forward 30 seconds", title: "Forward 30 seconds", onClick: () => player.skip(30_000), children: _jsx(Icon, { name: "forward30", size: 20 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Next chapter", title: "Next chapter", onClick: () => player.chapter(1), children: _jsx(Icon, { name: "skipForward", size: 18 }) })] }), _jsxs("div", { className: "player-extras", children: [_jsx("button", { type: "button", className: "icon-btn", "aria-label": player.muted ? "Sound on" : "Mute", title: player.muted ? "Sound on" : "Mute", onClick: () => player.setMuted(!player.muted), children: _jsx(Icon, { name: player.muted || player.volume === 0 ? "volumeOff" : "volume", size: 18 }) }), _jsx("input", { type: "range", className: "player-volume", min: 0, max: 1, step: 0.05, value: player.muted ? 0 : player.volume, "aria-label": "Volume", style: { "--fill": `${(player.muted ? 0 : player.volume) * 100}%` }, onChange: (e) => player.setVolume(Number(e.target.value)) }), _jsx(Menu, { label: `Speed ${player.rate}×`, className: "toolbar-button player-speed", trigger: _jsxs("span", { className: "num", children: [player.rate, "\u00D7"] }), items: SPEEDS.map((s) => ({ label: `${s}×`, checked: s === player.rate, onSelect: () => player.setRate(s) })) }), book.chapters.length > 0 && (_jsx(Menu, { label: "Chapters", className: "icon-btn", trigger: _jsx(Icon, { name: "list", size: 18 }), items: book.chapters.map((c, i) => ({
                            label: `${i + 1}. ${c.title}`,
                            hint: clock(chapterLength(book, i)),
                            checked: i === player.chapterIndex,
                            onSelect: () => player.seek(c.startMs),
                        })) })), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Close the player", title: "Close the player", onClick: player.close, children: _jsx(Icon, { name: "close", size: 18 }) })] })] }));
}
