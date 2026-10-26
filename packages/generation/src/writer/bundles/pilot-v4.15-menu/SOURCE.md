Pilot writer pack v4.15 (TEACH-251 part aj, 26 Oct 2026). Production's pack (`PILOT_PACK_ID`); v4.14 stays as shipped in `pilot-v4.14-menu` for comparison. Schema, layouts and code are v4.14's.

From the writer output of genlab run 20261026-150307-record-y4-romans-detailed-verify7 (Y4 "Why the Romans built Hadrian's Wall", Detailed, v4.14), three picture asks that could never be placed:
- A row of a frontier's forts, milecastles and gates took items-row, whose items have no picture field, so the slide asked for no pictures although each is a real, much-photographed structure.
- A stages slide asked three generic "Reconstruction of a traveller ... at a gate" pictures. v4.12's rule called any reconstruction "even one set at a real place" generic, but ruling 296 keeps real places and monuments real-only, so none could be placed.
- A library map's intent said "in AD 122"; the filler set dateRange AD 122 to AD 122 and the model refused it twice ("is not after").

system-KS*.template.txt = the v4.14 templates with three lines changed (all key stages):
- Items line: parts that are each a real building, structure or site take panel-list with a named picture per item (items-row has none), its shows naming one real surviving example and the part.
- Picture subject line: a reconstruction stays generic only in a real town or event; a monument, building or site that survives, or any part of it, is never reconstructed and is pictured as its remains today, by site name and part. (A painted 1666 street scene stays generic.)
- Figures line: a map model's intent gives a span of years, never one year as both ends.

system-KS*.snapshot.txt = the assembled text, pinned by pilot-v415.test.ts. Regenerate, never edit by hand.
