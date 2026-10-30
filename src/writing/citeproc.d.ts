// citeproc-js, the open citation engine Zotero uses, has no types of its own.
// Only the parts Scribe calls are described here.

declare module "citeproc" {
  interface Sys {
    retrieveLocale(lang: string): string;
    retrieveItem(id: string): unknown;
  }
  class Engine {
    constructor(sys: Sys, style: string, lang?: string, forceLang?: boolean);
    opt: { xclass: "note" | "in-text" };
    updateItems(ids: string[]): void;
    makeCitationCluster(cites: { id: string; locator?: string; label?: string }[]): string;
    /** Adds a citation after `pre`; answers with every citation whose words changed, as [index, html, citationID]. */
    processCitationCluster(
      citation: { citationItems: { id: string; locator?: string; label?: string }[]; properties: { noteIndex: number }; citationID?: string },
      pre: [string, number][],
      post: [string, number][],
    ): [unknown, [number, string, string][]];
    makeBibliography(): [unknown, string[]] | false;
    setOutputFormat(format: "html" | "text" | "rtf"): void;
  }
  const CSL: { Engine: typeof Engine };
  export default CSL;
}
