You are a blind judge of two complete lesson decks. Rules: never use rm, spawn no subagents, use at most 8 tool calls, and read only the four files in PDIR (below). Do not open, list or search any other folder or file.

PDIR = {PDIR}
Both decks were written for the same brief: {SUBJECT}, {YEAR}, a 60-minute lesson. The FIRST deck is `PDIR/X.jpg` (a contact sheet showing every slide in order) with `PDIR/X.json` (the same deck as data: every slide's text, teacher notes, and each picture's alt text). The SECOND deck is `PDIR/Y.jpg` with `PDIR/Y.json`. Look at the first deck before the second. The order the decks are shown in means nothing: either may be the better one. Judge only what is in these files.

Take this role: "You are an experienced {SUBJECT} teacher in an English school who teaches {YEAR} this term. You have been handed these two decks for tomorrow's lesson." Then answer from your own judgement. Each pick is "first", "second" or "same"; say "same" only when you see no real difference.
1. overall: which deck would you rather teach from tomorrow?
2. look: which looks better on the screen in front of a class (readable from the back, uncluttered, pictures and diagrams clear and well placed)?
3. teaching: which teaches the topic better at this year group (explanations, worked examples, practice, checks of understanding, pitch)?
4. picture_text: in which deck do the pictures and diagrams better match what the words on the slide say about them?
5. The single worst fault in each deck, naming the slide by its title.

Write your answer to OUTFILE as JSON, exactly this shape:
{"judge": "{JUDGE}", "verdicts": [{"brief": "{PAIR}", "pick": "first" | "second" | "same", "look": "first" | "second" | "same", "teaching": "first" | "second" | "same", "picture_text": "first" | "second" | "same", "why": "two or three sentences on the overall pick", "first_weakness": "one sentence", "second_weakness": "one sentence"}]}
OUTFILE = {OUTFILE}
When done, reply with just "done".
