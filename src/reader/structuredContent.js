const tags = ["table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td"];
const legalChildren = {
    table: ["caption", "thead", "tbody", "tfoot", "tr"],
    thead: ["tr"], tbody: ["tr"], tfoot: ["tr"], tr: ["th", "td"],
};
const safeId = /^[A-Za-z_][\w.-]{0,79}$/;
const safeText = (element, limit) => {
    const walker = element.ownerDocument.createTreeWalker(element, 5);
    let text = "";
    let visited = 0;
    while (walker.nextNode()) {
        if (++visited > 8_000)
            return null;
        const node = walker.currentNode;
        if (node.parentElement?.closest("script, style, template"))
            continue;
        const chunk = node.localName === "br" ? "\n" : node.nodeValue ?? "";
        if (text.length + chunk.length > limit)
            return null;
        text += chunk;
    }
    return text;
};
function describeFigure(figure) {
    const images = figure.querySelectorAll("img");
    if (images.length !== 1)
        return null;
    const image = images[0];
    if (!image.complete || !image.naturalWidth || !image.naturalHeight)
        return null;
    const source = image.currentSrc;
    if (!source.startsWith("blob:") && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(source))
        return null;
    const canvas = figure.ownerDocument.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context)
        return null;
    try {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const snapshot = canvas.toDataURL("image/png");
        if (snapshot.length > 6_000_000)
            return null;
        const captionNode = figure.querySelector(":scope > figcaption");
        const caption = captionNode ? safeText(captionNode, 2_000) ?? "" : "";
        return { kind: "figure", label: caption.trim().slice(0, 120) || "Figure",
            caption, alt: image.alt.slice(0, 2_000), image: snapshot };
    }
    catch {
        return null;
    }
}
/** Build a local, inert snapshot. No publisher markup or URLs enter the viewer. */
export function describeStructuredContent(element) {
    if (element.namespaceURI !== "http://www.w3.org/1999/xhtml")
        return null;
    if (element.localName === "figure")
        return describeFigure(element);
    if (element.localName === "pre") {
        const text = safeText(element, 64_000);
        return text?.trim() ? { kind: "pre", label: "Preformatted text", text } : null;
    }
    if (element.localName !== "table" || element.querySelector("table"))
        return null;
    let cells = 0;
    let nodes = 0;
    let budget = 64_000;
    const read = (node) => {
        if (++nodes > 2_500 || node.children.length > 2_500)
            throw new Error("Table too large");
        const tag = node.localName;
        const children = legalChildren[tag];
        if (children)
            return { tag, children: Array.from(node.children).filter((child) => children.includes(child.localName)).map(read) };
        if (tag !== "caption" && ++cells > 1_000)
            throw new Error("Table too large");
        const text = safeText(node, budget);
        if (text === null)
            throw new Error("Table too large");
        budget -= text.length;
        const span = (name, maximum) => {
            const raw = node.getAttribute(name);
            if (raw === null)
                return undefined;
            if (!/^\d+$/.test(raw) || Number(raw) > maximum || (name === "colspan" && Number(raw) < 1)) {
                throw new Error("Unsupported table span");
            }
            return Number(raw);
        };
        const scope = node.getAttribute("scope");
        const id = node.id;
        const headers = node.getAttribute("headers")?.trim().split(/\s+/).filter((value) => safeId.test(value));
        return { tag, text, children: [],
            rowSpan: span("rowspan", 100), colSpan: span("colspan", 50),
            scope: scope === "row" || scope === "col" || scope === "rowgroup" || scope === "colgroup" ? scope : undefined,
            id: safeId.test(id) ? id : undefined,
            headers: headers?.length ? headers.join(" ") : undefined,
        };
    };
    try {
        const table = read(element);
        const caption = table.children.find((node) => node.tag === "caption")?.text?.trim();
        return cells ? { kind: "table", label: caption?.slice(0, 120) || "Table", table } : null;
    }
    catch {
        return null;
    }
}
