import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Preferences › Appearance › Profile: the picture in the sync circle, the
// account's name (both the same on every device), and this device's own
// name, which other devices see in Grimoire and in sync's notes.
import { useEffect, useState } from "react";
import { api, isApp, isIOS, isWeb } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { Section } from "./controls";
/** Sent on window with the new profile, so the sync circle shows it at once. */
export const PROFILE_CHANGED = "tbv-profile-changed";
function NameField({ label, hint, value, placeholder, onSave }) {
    const [text, setText] = useState(value);
    useEffect(() => setText(value), [value]);
    const save = () => {
        if (text.trim() !== value.trim())
            void onSave(text);
    };
    return (_jsxs("label", { className: "field", children: [_jsx("span", { children: label }), _jsx("input", { value: text, maxLength: 60, placeholder: placeholder, onChange: (e) => setText(e.target.value), onBlur: save, onKeyDown: (e) => e.key === "Enter" && e.currentTarget.blur() }), _jsx("small", { className: "settings-row-hint", children: hint })] }));
}
export function ProfileSection() {
    const [profile, setProfile] = useState(null);
    const toast = useToast();
    useEffect(() => {
        api.getProfile().then(setProfile, () => undefined);
    }, []);
    const saved = (p) => {
        setProfile(p);
        window.dispatchEvent(new CustomEvent(PROFILE_CHANGED, { detail: p }));
    };
    const choose = (from) => {
        if (!isApp && !isWeb)
            return toast("Choosing a picture works in the desktop app.");
        api.chooseAvatar(from).then((p) => p && saved(p), (e) => toast(`That picture couldn't be used: ${String(e)}`));
    };
    const avatar = profile?.avatarPath ? api.coverUrl(profile.avatarPath) : "";
    return (_jsxs(Section, { id: "profile", title: "Profile", lede: "Your picture and name go to every device. Each device has a name of its own too.", children: [_jsxs("div", { className: "profile-card", children: [_jsx("span", { className: "profile-picture", "aria-hidden": true, children: avatar ? _jsx("img", { src: avatar, alt: "", draggable: false }) : _jsx(Icon, { name: "image", size: 22 }) }), _jsxs("div", { className: "profile-picture-actions", children: [isIOS ? (_jsxs(_Fragment, { children: [_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => choose("photos"), children: [_jsx(Icon, { name: "image", size: 16 }), " From Photos"] }), _jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => choose("files"), children: [_jsx(Icon, { name: "folder", size: 16 }), " From Files"] })] })) : (_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => choose(), children: [_jsx(Icon, { name: "image", size: 16 }), " ", avatar ? "Change picture…" : "Choose a picture…"] })), avatar && (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => api.clearAvatar().then(saved, (e) => toast(String(e))), children: "Remove" }))] })] }), _jsxs("div", { className: "names-fields", children: [_jsx(NameField, { label: "Your name", hint: "Shown with your picture on every device signed in to this library.", value: profile?.name ?? "", placeholder: "Your name", onSave: (name) => api.setAccountName(name).then(saved, (e) => toast(String(e))) }), _jsx(NameField, { label: "This device's name", hint: "What your other devices call this one, in Grimoire and in sync. Leave it empty for the name it started with.", value: profile?.deviceName ?? "", placeholder: "Like embre's iPad", onSave: (name) => api.setDeviceName(name).then(saved, (e) => toast(String(e))) })] })] }));
}
