Pilot writer pack v4.6 (TEACH-110 part s). Byte-exact copies, never hand-edited:
- layouts.json = pilot/writer/schema-v4.6.json (gen-v4.6.py: no maxLength or pattern anywhere)
- base-KS*.schema.json = pilot/writer/smoke-context/base4h-KS*-v4.6.schema.json (base4h with v4.5's basePatches applied, then stripped)
- system-KS*.txt = pilot/writer/smoke-context/system-KS*-base4r.txt (byte-identical to base4q)
The writer sees no string caps; code checks them (slot-fill cap table = the v4.5 request, pilot-fit charCaps).
