const tags = ["table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td"] as const;
type TableTag = typeof tags[number];

export interface TableNode {
  tag: TableTag;
  text?: string;
  rowSpan?: number;
  colSpan?: number;
  scope?: "row" | "col" | "rowgroup" | "colgroup";
  id?: string;
  headers?: string;
  children: TableNode[];
}

export type StructuredContent =
  | { kind: "table"; label: string; table: TableNode }
  | { kind: "pre"; label: string; text: string };

export interface StructuredTarget {
  id: string;
  content: StructuredContent;
}

const legalChildren: Partial<Record<TableTag, TableTag[]>> = {
  table: ["caption", "thead", "tbody", "tfoot", "tr"],
  thead: ["tr"], tbody: ["tr"], tfoot: ["tr"], tr: ["th", "td"],
};
const safeId = /^[A-Za-z_][\w.-]{0,79}$/;
const safeText = (element: Element, limit: number) => {
  const walker = element.ownerDocument.createTreeWalker(element, 5);
  let text = "";
  let visited = 0;
  while (walker.nextNode()) {
    if (++visited > 8_000) return null;
    const node = walker.currentNode;
    if (node.parentElement?.closest("script, style, template")) continue;
    const chunk = (node as Element).localName === "br" ? "\n" : node.nodeValue ?? "";
    if (text.length + chunk.length > limit) return null;
    text += chunk;
  }
  return text;
};

/** Build a local, inert snapshot. No publisher markup or URLs enter the viewer. */
export function describeStructuredContent(element: Element): StructuredContent | null {
  if (element.namespaceURI !== "http://www.w3.org/1999/xhtml") return null;
  if (element.localName === "pre") {
    const text = safeText(element, 64_000);
    return text?.trim() ? { kind: "pre", label: "Preformatted text", text } : null;
  }
  if (element.localName !== "table" || element.querySelector("table")) return null;
  let cells = 0;
  let nodes = 0;
  let budget = 64_000;
  const read = (node: Element): TableNode => {
    if (++nodes > 2_500 || node.children.length > 2_500) throw new Error("Table too large");
    const tag = node.localName as TableTag;
    const children = legalChildren[tag];
    if (children) return { tag, children: Array.from(node.children).filter((child) => children.includes(child.localName as TableTag)).map(read) };
    if (tag !== "caption" && ++cells > 1_000) throw new Error("Table too large");
    const text = safeText(node, budget);
    if (text === null) throw new Error("Table too large");
    budget -= text.length;
    const span = (name: string, maximum: number) => {
      const raw = node.getAttribute(name);
      if (raw === null) return undefined;
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
  } catch {
    return null;
  }
}
