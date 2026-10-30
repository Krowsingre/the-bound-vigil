declare module "pagedjs" {
  export class Previewer {
    constructor(options?: Record<string, unknown>);
    preview(content: DocumentFragment | Element | string, stylesheets: (string | Record<string, string>)[], renderTo: Element): Promise<{ total: number }>;
    on(event: string, listener: (...args: unknown[]) => void): void;
  }
}
