import { Color } from "@tiptap/extension-color";
import { Link } from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";

/**
 * The single extension set used by every Tiptap editor AND by static rendering,
 * so JSON produced in the editor always renders identically read-only.
 */
export const baseExtensions = [
  StarterKit.configure({
    heading: false,
    codeBlock: false,
    blockquote: false,
    horizontalRule: false,
    // Tiptap v3 StarterKit bundles Underline/TextStyle in some builds; keep explicit ones below.
    underline: false,
    // Configured below rather than through the kit, so the editor and the static
    // renderer cannot drift apart on how a link is written out.
    link: false,
  }),
  Underline,
  TextStyle,
  Color,
  TextAlign.configure({ types: ["paragraph"] }),
  /**
   * Links.
   *
   * `openOnClick: false`: a click on the canvas selects the text and a second one
   * edits it, so following the link there would take the teacher off the slide
   * mid-sentence. The markup still carries `target="_blank"` and
   * `rel="noopener noreferrer"`, which is what `./static.ts` writes into the viewer,
   * present mode and print. `components/slide/slide.css` decides where a link is
   * clickable, and it is clickable in view and present mode only.
   *
   * `linkOnPaste` is what makes pasting a URL over selected words link them.
   */
  Link.configure({
    openOnClick: false,
    linkOnPaste: true,
    autolink: true,
    defaultProtocol: "https",
    HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
  }),
];
