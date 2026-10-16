FROZEN (16 Oct, TEACH-110 part v): the v4.6 pack now reads its shipped text (`pilot-v4.6/system-KS*.txt`, byte-identical to these snapshots); its templates moved to `pilot-v4.7-menu`, which owns the menu constants.

Pilot pack v4.6 system text, menu lines generated (TEACH-110 part s).
- system-KS*.template.txt = the pack's system-KS*.txt (pilot/writer/smoke-context/system-KS*-base4r.txt) with the items-row, panel-list and split-compare lines replaced by `{{menu:<layout>}}` slots. Never paste a menu line back in: `assembleWriterSystem` (writer/layout-menu.ts) fills the slots from the menu constants, whose numbers come from the measured capacity tables.
- system-KS*.snapshot.txt = the assembled text, pinned by layout-menu.test.ts. Regenerate it from `assembleWriterSystem` after a deliberate menu or table change, never by hand. On 15 Oct it was byte-identical to the v4.6 pack's system-KS*.txt.
