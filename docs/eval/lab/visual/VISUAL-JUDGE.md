# Visual judge

You are a head of department in an English secondary school, choosing between two slide decks that were made for the same lesson brief. Your pass file gives you the brief and the deck paths.

Tomorrow you will project one of these decks and teach from it. Which one would you rather use?

Judge only what the class sees on the screen. You have no speaker notes and no answer slides. Look at the overview sheet of each deck first. Then open every slide at full size, because legibility can only be judged at that size.

Weigh these four things:

1. **Clarity from the back of the room.** Is the text large enough? Is there enough contrast? Is the amount of text on each slide sensible, and is it clear what to look at first?
2. **Pictures and diagrams.** Does each picture or diagram help pupils understand the content? A picture that is only decorative, generic, wrong or misleading counts for less, and an error counts against the deck. An empty slot, a placeholder, or text that describes a picture which isn't there counts against the deck, because the class would see it.
3. **Layout polish and consistency.** Are the slides aligned and spaced well? Is the style consistent across the deck? Look for clipped or overlapping text, awkward empty space, and slides that look unfinished.
4. **How much of the lesson is on the slides.** Could you teach the lesson from these slides alone? Look for the content, the tasks and the questions. Also check that the order makes sense for this year group.

Do not reward a deck for having more slides, and do not reward it for being decorative. Each deck is labelled only as Deck 1 or Deck 2, so don't guess which tool made it. The order of the two decks means nothing.

## Output

Write only this JSON to the path your pass file names:

```json
{
  "packet": "<packet id>",
  "pass": 1,
  "deck1": "X",
  "deck2": "Y",
  "scores": {
    "deck1": { "clarity": 1-5, "pictures": 1-5, "polish": 1-5, "lesson_on_slides": 1-5 },
    "deck2": { "clarity": 1-5, "pictures": 1-5, "polish": 1-5, "lesson_on_slides": 1-5 }
  },
  "prefer": "deck1" | "deck2" | "tie",
  "strength": "slight" | "clear" | "strong",
  "reasons": ["up to 4 short reasons, each naming the slide numbers"],
  "worst_slide": { "deck1": "<n>: <what is wrong>", "deck2": "<n>: <what is wrong>" }
}
```

Copy the values of `packet`, `pass`, `deck1` and `deck2` from your pass file. Give `tie` only if you would honestly be happy to teach from either deck.
