import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useAppSettings } from "./appSettings";
import { RadioList, Section } from "./controls";
export function PhoneSection({ overview }) {
    const { settings, changeSync } = useAppSettings();
    const supabase = (overview.provider.kind === "supabase" && !!overview.signedInAs) || overview.also?.provider.kind === "supabase";
    if (!supabase)
        return null;
    return (_jsxs(Section, { id: "phone", title: "Books for your phone", lede: "Which books Supabase keeps, so your phone can download them.", children: [_jsx(RadioList, { label: "Which books go to your phone", value: settings.sync.phoneChosenOnly ? "chosen" : "all", options: [
                    { value: "all", label: "Every book on this computer", hint: "As long as book files (and audiobook files) are synced to Supabase." },
                    {
                        value: "chosen",
                        label: "Only the books I choose",
                        hint: "Choose them with Send to device on a book's menu, or ask for one on the phone. Books the phone has downloaded always stay.",
                    },
                ], onChange: (v) => changeSync({ phoneChosenOnly: v === "chosen" }) }), settings.sync.phoneChosenOnly && (_jsx("p", { className: "settings-row-hint", children: "Tidy up Supabase (below) then removes the copies of books that weren't chosen." }))] }));
}
