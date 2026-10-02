# Headlines, 1 Oct 2026

Omer, welcome back. The short version of the last three days:

- **dayback.app is live.** Homepage on dayback.app, app on teach.dayback.app, API healthy. www doesn't resolve yet; I'll fix that in Cloudflare.
- **Production photos have been broken since 29 Sep.** The switch to luna made the photo picker refuse every call. The fix is a one-file PR waiting for you.
- **We now beat Chalkie on looks.** Blind judges preferred our decks on 8 of 9 Chalkie lessons, ahead on clarity, polish and how much of the lesson is on the slides.
- **Pictures are close but not there.** Level with Chalkie apart from one Year 1 lesson. I've parked pictures for now.
- **Against Opus writing the lesson by hand, we're about level.** We always win on coverage and explanation and lose on pitch. Most runs land inside the judges' noise, so it isn't a clean win yet.
- **What moved the needle:** slides that hold a whole idea, chunked text, full worked examples, hand-drawn diagram templates, fact checks on photo captions, and a short model-written exit quiz.
- **What didn't:** Oak's lesson packs, extra checks by prompt, and the cheap model as the writer.
- **Speed and cost are still off target:** about 71 s until the lesson is editable (target 40 s) and 5 to 10 cents a lesson (target 2).
- **Decisions made:** smaller teaching text; exit ticket on the worksheet with a closing slide pointing to it, plus a remembered teacher opt-in to show it on the slides; Pexels plus Wikimedia Commons for photos with credits only in an info dot and exports; one list marker and no em dashes; no "know your class" profile in the MVP.
- **Oak National Academy's API is set up** under their open licence. Useful for fixing facts, not for quality on its own.
- **Budget is spent:** $8.81 of $9 today. The next real test costs about $1.50.

## Needs Omer

1. Add `VITE_TURNSTILE_SITE_KEY` on Vercel, then review and approve the signed-out lessons PR (#352).
2. Review and merge the photo fix (#378). Production needs it.
3. The eval docs PR (#377) fails the secrets check on a throwaway test password in a lab script. Your call: ignore that fingerprint or squash the branch.
4. All open PRs fail the dependency audit on a `brace-expansion` advisory. It needs a repo-wide bump.
5. Have your agent read the full handoff and decide how to split the candidate branch into tickets, starting with the exit-ticket work (TEACH-22, which overlaps TEACH-230).
6. Approve about $1.50 for two averaged test runs of the candidate before we build on it.

## Links

- [Full handoff](https://github.com/OmerBresinski/ai-teacher/blob/gregwallacegb/teach-263-check-the-lesson-quality-judging-rubric-and-recent-results/docs/eval/HANDOFF-2026-10-01.md)
- [Round J results against Chalkie and Opus](https://claude.ai/artifact/3xg7BoX8MeiivnERvmKejF) (private to me until I share it)
- [Candidate branch](https://github.com/OmerBresinski/ai-teacher/tree/spike/s-candidate)
