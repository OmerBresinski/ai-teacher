// The server lays out slides with their icons at once: it holds the icon library statically and
// hands it to the layouts' loader (`@tj/slides` loads it lazily in the browser; TEACH-310 part c).
import * as ICONS from "@tj/slides/icons";

ICONS.provideIcons(ICONS);
