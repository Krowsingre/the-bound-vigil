import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { Picture } from "./extensions";

describe("pictures in the editor", () => {
  it("keeps a caption and a page of its own, and reads older pictures", () => {
    const editor = new Editor({ extensions: [StarterKit, Picture], content: `<figure data-picture="" data-size="full"><img src="data:image/png;base64,AA==" alt="A map"><figcaption>The road</figcaption></figure><img src="data:image/png;base64,BB==" alt="Old">` });
    const html = editor.getHTML();
    expect(html).toContain(`<figure data-picture="" class="writing-figure is-full" data-size="full"><img src="data:image/png;base64,AA==" alt="A map" class="writing-picture"><figcaption>The road</figcaption></figure>`);
    expect(html).toContain(`<figure data-picture="" class="writing-figure"><img src="data:image/png;base64,BB==" alt="Old" class="writing-picture"></figure>`);
    editor.destroy();
  });
});
