Pilot writer pack v4.14 (TEACH-110 part av, 26 Oct 2026). Production's pack (`PILOT_PACK_ID`); v4.13 stays as shipped in `pilot-v4.13-menu` for comparison. Schema, layouts and code are v4.13's.

From two real lessons under v4.13 (genlab runs 20261026-103709 Y2 Great Fire Detailed, judged 7/10, and 20261026-104025 Y4 Hadrian's Wall Standard, judged 6.5/10):
- Romans S11 Q1 asked which place is at the other end of the wall from Wallsend. The writer did put "from Wallsend in the east to Bowness-on-Solway in the west" in slide 3's points (key-card-fig). The layout check then flagged "overflow: picture-text key card beside points", and the saved slide shows only the lead and the card. A code fault dropped the taught fact, and no rule stopped a question from resting on one place in the text.
- Year 2 teaching slides carry 18–22 words (KS1 visual-text points-0-fig fits 24 words, from code), up to 3 sentences, at large type. This was not new in v4.13: v4.11's leads were 18–21 words. v4.12's "each sentence adds a fact" allowed the third sentence.

system-KS*.template.txt = the v4.13 templates with one sentence added to the questions line (all key stages): an answer is stated in an earlier slide's text (lead, point, card or caption), and a fact only in the notes or a picture is not yet taught. KS1 also gets one sentence in the Flow line: in Years 1 and 2 a teaching slide's lead, or the text of a slide with no items, is at most two short sentences; multi-item layouts (steps, comparisons, cards) keep their own fits.

system-KS*.snapshot.txt = the assembled text, pinned by pilot-v414.test.ts, which also checks the paid Great Fire deck (fixtures/pilot-v414-y2-greatfire.json). Regenerate, never edit by hand.
