import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { forwardRef, useEffect, useLayoutEffect, useRef, useState, } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
export const itemMenus = new WeakMap();
/**
 * A button that opens a small dropdown. Closes on outside click or Escape.
 * The dropdown sits on top of the whole window, so a small card or a
 * scrolling row never cuts it off, and it opens upwards or inwards when there
 * isn't room below or to the side.
 */
export function Menu({ trigger, label, items, align = "end", className = "icon-btn", menuClassName = "", closeOnScroll = true, searchLabel, }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const search = useRef(null);
    const [section, setSection] = useState(null);
    const hasSubmenus = items.some((item) => typeof item === "object" && "submenu" in item && item.submenu?.length);
    const group = section === null ? undefined : items[section];
    const submenu = group && typeof group === "object" && "label" in group ? group.submenu : undefined;
    const visible = submenu ? [
        { label: "Back to " + label, icon: "arrowLeft", onSelect: () => setSection(null) },
        "divider",
        ...submenu,
    ] : items;
    const term = query.trim().toLowerCase();
    const results = term ? visible.filter((item) => typeof item === "object" && "label" in item && !!item.id &&
        [item.label, item.hint, item.description].some((text) => text?.toLowerCase().includes(term))) : visible;
    const closeMenu = () => { setOpen(false); setSection(null); setQuery(""); };
    const [place, setPlace] = useState({ visibility: "hidden" });
    const root = useRef(null);
    const menu = useRef(null);
    const stableSize = useRef(null);
    useLayoutEffect(() => {
        const element = root.current;
        if (!element)
            return;
        itemMenus.set(element, { label, items });
        return () => { itemMenus.delete(element); };
    }, [label, items]);
    useLayoutEffect(() => {
        if (!open) {
            stableSize.current = null;
            return;
        }
        const button = root.current?.getBoundingClientRect();
        const element = menu.current;
        if (!button || !element)
            return;
        if (stableSize.current) {
            element.scrollTop = 0;
            return;
        }
        const box = element.getBoundingClientRect();
        const naturalHeight = element.scrollHeight + element.offsetHeight - element.clientHeight;
        const gap = 6;
        const margin = 8;
        const below = button.bottom + gap;
        const roomBelow = window.innerHeight - margin - below;
        const roomAbove = button.top - gap - margin;
        // Below when it fits, or when there's more room there; a long menu (a big
        // library's genres) then scrolls inside the room it has.
        const goBelow = naturalHeight <= roomBelow || roomBelow >= roomAbove;
        const available = Math.max(0, goBelow ? roomBelow : roomAbove);
        const height = Math.min(naturalHeight, available);
        const top = goBelow ? below : button.top - gap - height;
        const preferred = align === "end" ? button.right - box.width : button.left;
        const left = Math.max(margin, Math.min(preferred, window.innerWidth - margin - box.width));
        const position = { top: Math.max(margin, top), left, maxHeight: available };
        if (hasSubmenus) {
            stableSize.current = { ...position, width: box.width, height };
        }
        setPlace(stableSize.current ?? position);
    }, [open, align, hasSubmenus, visible.length, section]);
    useEffect(() => {
        if (!open)
            return;
        const inside = (target) => root.current?.contains(target) ||
            menu.current?.contains(target);
        const close = (e) => {
            if (e instanceof KeyboardEvent ? e.key === "Escape" : !inside(e.target))
                closeMenu();
        };
        // The dropdown is pinned to the window, so it closes rather than drift
        // away from its button when the page scrolls or the window changes size.
        const away = (e) => {
            if (!inside(e.target))
                closeMenu();
        };
        const shut = closeMenu;
        document.addEventListener("pointerdown", close);
        document.addEventListener("keydown", close);
        if (closeOnScroll)
            document.addEventListener("scroll", away, true);
        window.addEventListener("resize", shut);
        (search.current ?? menu.current?.querySelector(".menu-item:not(:disabled)"))?.focus({ preventScroll: true });
        return () => {
            document.removeEventListener("pointerdown", close);
            document.removeEventListener("keydown", close);
            document.removeEventListener("scroll", away, true);
            window.removeEventListener("resize", shut);
        };
    }, [open, section, closeOnScroll]);
    useEffect(() => {
        if (!open)
            setPlace({ visibility: "hidden" });
    }, [open]);
    return (_jsxs("div", { className: "menu-root", ref: root, children: [_jsx("button", { type: "button", className: className, "aria-label": label, title: label, "aria-haspopup": "menu", "aria-expanded": open, onClick: () => open ? closeMenu() : setOpen(true), children: trigger }), open &&
                createPortal(_jsx(MenuList, { ref: menu, label: label, items: results, before: searchLabel && _jsx("input", { ref: search, type: "search", className: "browser-tab-search", "aria-label": searchLabel, placeholder: searchLabel, value: query, onChange: (event) => setQuery(event.target.value), onKeyDown: (event) => {
                            if (event.key !== "Enter" || event.nativeEvent.isComposing)
                                return;
                            event.preventDefault();
                            const first = results.find((item) => typeof item === "object" && "label" in item && !!item.id && !item.disabled);
                            if (first) {
                                closeMenu();
                                first.onSelect?.();
                            }
                        } }), empty: term && results.length === 0 ? "No matching open tabs." : undefined, className: menuClassName, style: place, onClose: closeMenu, onSubmenu: submenu ? undefined : setSection, back: !!submenu }), document.body)] }));
}
/** The dropdown's list itself, for a Menu or a right-click menu. */
export const MenuList = forwardRef(function MenuList({ label, items, className = "", style, onClose, onSubmenu, back, before, empty }, ref) {
    const onKeyDown = (e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp")
            return;
        e.preventDefault();
        const buttons = [
            ...e.currentTarget.querySelectorAll(".menu-item:not(:disabled)"),
        ];
        const at = buttons.indexOf(document.activeElement);
        const next = at < 0 ? (e.key === "ArrowDown" ? 0 : buttons.length - 1) :
            (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
    };
    return (_jsxs("div", { ref: ref, className: `menu menu-floating ${className}`.trim(), role: "menu", "aria-label": label, style: style, onKeyDown: onKeyDown, children: [before, empty && _jsx("p", { className: "menu-heading", children: empty }), items.map((item, i) => {
                if (item !== "divider" && "label" in item) {
                    const row = (_jsxs("button", { type: "button", role: item.checked === undefined ? "menuitem" : "menuitemcheckbox", "aria-haspopup": item.submenu ? "menu" : undefined, "aria-checked": item.excluded ? "mixed" : item.checked, className: `menu-item${item.danger ? " menu-item-danger" : ""}${item.excluded ? " menu-item-excluded" : ""}${item.description ? " has-description" : ""}`, disabled: item.disabled, onClick: () => {
                            if (item.submenu && onSubmenu) {
                                onSubmenu(i);
                                return;
                            }
                            if (item.checked === undefined && !(back && i === 0))
                                onClose();
                            item.onSelect?.();
                        }, children: [item.checked !== undefined ? (_jsx("span", { className: "menu-check", children: item.excluded ? _jsx(Icon, { name: "close", size: 16 }) : item.checked && _jsx(Icon, { name: "check", size: 16 }) })) : (item.icon && _jsx(Icon, { name: item.icon, size: item.description ? 24 : 16 })), item.description ? (_jsxs("span", { className: "menu-label", children: [item.label, _jsx("span", { className: "menu-description", children: item.description })] })) : (_jsx("span", { className: "menu-label", children: item.label })), item.submenu && _jsx(Icon, { name: "chevronRight", size: 14 }), (item.excluded ? "Hidden" : item.hint) && _jsx("span", { className: "menu-hint", children: item.excluded ? "Hidden" : item.hint })] }, item.id ?? i));
                    if (!item.closeAction)
                        return row;
                    const action = item.closeAction;
                    return _jsxs("div", { className: "menu-row-action", children: [row, _jsx("button", { type: "button", role: "menuitem", className: "menu-item menu-row-close", "aria-label": action.label, title: action.label, onClick: (event) => {
                                    const row = event.currentTarget.parentElement;
                                    const next = row?.nextElementSibling ?? row?.previousElementSibling;
                                    action.run();
                                    requestAnimationFrame(() => next?.querySelector(".menu-row-close, .menu-item")?.focus());
                                }, children: _jsx(Icon, { name: "close", size: 14 }) })] }, item.id ?? i);
                }
                return item === "divider"
                    ? _jsx("div", { className: "menu-divider", role: "separator" }, i)
                    : _jsx("div", { className: "menu-heading", children: item.heading }, i);
            })] }));
});
