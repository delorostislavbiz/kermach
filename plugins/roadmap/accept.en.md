# Instruction "Accept the phase" (English)

Translation of `accept.md` (t1428). This is the text printed by the command `kermach roadmap accept fN` when the board is in English (`lang: en` in the passport).
The project's main session runs it when the human writes "Accept phase fN". First the command prints board facts it counted itself, below them — this instruction.

Where to edit. This file next to the plugin code is the built-in text: a program update overwrites it.
Edit the copy in the plugin data folder: `%APPDATA%\Kermach\plugins-data\roadmap\accept.en.md`.

How it works:
- text before the first `## ` heading is an explanation for a human; it does not go into the instruction;
- the heading `## Инструкция` is the same Russian line as in `accept.md`: the program finds the instruction by it;
- placeholders: `{фаза}` — phase number, `{отчёт}` — path of the phase report, `{папка}` — board folder, `{язык}` — board language.
- lines the program prints itself — "проверка фазы идёт", "[Роадмап] Проверка фазы …" — are in Russian: look for them as they are.

## Инструкция
You are the main session and you are accepting phase {фаза}. The program counted the facts above from the board files in {папка}.
Do the work yourself, do not start subagents. A turn ends with a question to the human, not with "waiting" or "I'll continue".
Write to the human in this language: {язык}.
The phase is accepted only by the human's word "yes". The human said "work on your own until done" or left — that is not "yes": keep working,
but the phase stays unaccepted (do not set `status: done`), and the next phase will run on top of the unaccepted one — with a warning.

1. Done criteria. Check each criterion from the list above yourself: a command and its output, a file and line, a page or a screenshot.
   "What was done" and "Proof" in the cards are the agents' words: they hint where to look but do not prove anything.
   A criterion that cannot be checked without a human (look at the program, the site) — mark it "human needed" and say what to look at.
   The facts have a line "No checker ran" — those cards were closed by a command or by hand, without an agent tab: nobody checked their work.
   Run the "How to check" of each of them yourself. In step 7 tell the human this in the first line: "No checker ran for cards …, the phase is not accepted".
   The facts have lines "Closed despite the checker's refusal", "Closed without a proof file", "despite the check's findings", "The phase check before the start did not take place" or "Cards without a phase" — tell the human about it in step 7 in one sentence: numbers and reasons. They do not forbid acceptance: the human decides.
   The facts have a line "Kind of check" — show it to the human at step 7 together with the card numbers "only on a fake", "only a human" and "kind of check not given". The human must see what was not checked for real. This does not forbid the acceptance: a probe on a fake is normal.
2. Review and records. Read the "What was done" of the review card and the phase records from the list above: decisions, dead ends, notes.
   The phase report is {отчёт}; need details — open the cards and records by number.
   The "Card tiers" summary — how many cards of each tier (`size.js` chose the model by the card's words) were done on the 1st, 2nd, 3rd and later attempt.
   Fewer than half of the simple ones (sonnet) on the first attempt — tell the human: the model choice rules (`size.js`) are wrong, name the cards
   of this tier from the 2nd attempt on — the rules are fixed by them. Do not count cards with "no attempt number" and "model chosen by a human".
   New notes. Sort all notes from the "New notes" list now, including those from other phases and without a phase. Many notes are no reason to skip or postpone them.
   This sorting and the sorting of remarks below are the only board edits before the human's "yes": the human decided so, the sorting does not wait for their answer.
   For each note open its file `d<number>.md` and check against the code whether the error exists now. Then one of two, there is no "keep" option:
   - the error exists — into a card: `kermach roadmap note take d1 [d2 ...] [--title "title"] [--phase fN]`. The card lands in "Inbox" unless a phase is given;
   - the error is gone, it is a repeat or not worth fixing — drop it: `kermach roadmap note drop d1 --why "reason"`.
   Collect small check issues (an outdated probe, an inexact word in a check) into one shared card: `kermach roadmap note take d1 d2 d3 --title "Small check issues"`.
   The human decides if a note touches the live site, money, secrets or data loss, if it cannot be checked against the code, or if the meaning of the work changes. Put such a note into a card too and remember it for step 7.
   At the end run `kermach roadmap note`: it must say "новых 0" (0 new; the program's line is in Russian).
   Board remarks. Sort every line of the list "Board remarks" now, including those of other phases. These are service lines of the program, the human does not see them.
   If you can fix one, fix it in the file named in the line. An old list in `used:` without a rating: do not invent a rating for the agent, append " — без оценки" (no rating, in Russian) to the line (`used: d1, d2 — без оценки`). This removes the remark and assigns no rating.
   If you cannot fix it or the meaning of the work changes, tell the human at step 7 in plain words: what happened and what to decide. Do not retell the file field or texts like "used: …" to the human.
   A line "No checker ran" of another phase cannot be fixed by an edit: at step 7 say in one sentence which cards nobody checked. A line saying the checker does not start: find the cause and fix it; if that fails, tell the human that cards have stopped being checked.
   At the end run `kermach roadmap accept {фаза}` again: only lines you will tell the human about should remain in the list.
3. Review of unstarted cards. Go through the cards from the list "Unstarted cards of other phases": open each one in full.
   Compare with what the phase delivered: file names, decisions, findings of the review and records. For each decide: keep, fix, cancel.
   A draft of the nearest next phase has become clear — add its "How to check" and remove `draft: да`: only then will the wave start it.
   A card is missing — propose a new one. Do not edit cards "in progress": if one is affected — tell the human.
4. "Inbox". Go through each card from the "Inbox" list and the cards made from notes in step 2: into the next phase (`phase:` phase number), cancel or keep.
   A card has no "cancelled" status: after the human's "yes" a cancelled card goes to the Windows Recycle Bin — propose exactly that.
   An important finding of an agent must not drown among trifles: what breaks work, loses data, touches the live site — first in the list.
5. Agreements. Each one from the list above goes into every prompt of every card. Outdated — propose cancelling:
   a line `cancelled: YYYY-MM-DD` in the record's header. Two about the same thing — propose merging into one, cancel the extra one.
6. The project overview `.kermach/обзор.md`. Agents must read its sections on access, constraints, checks and "Not found out", and they trust them.
   Check these sections against what the phase delivered: the check command changed, access appeared or disappeared, the unknown became known.
   Wrong — propose a fix, with date and source (card, record, command). New for future agents — propose adding it.
7. Write to the human and end the turn with a question. Until their "yes" do not change the board files and the overview, except sorting the notes and remarks in step 2.
   Criteria — as a table: criterion | yes / no / human needed | how checked (command and output, file:line, page).
   Then briefly: what the agents and the review noticed, the tier summary. Then a list of edits: card, record or overview section — what to change — why. Board remarks fixed in step 2 are not part of this list: they are already done, and the list is for what the person still decides.
   "Inbox" — a short list: card — where — why.
   Board remarks — only those not fixed: what happened and what to decide, in plain words. Write nothing about the fixed ones, not even one phrase or a count.
   Message to the person: name a card by its number (t12), not by its file name (`t12.md`). Do not name or quote the `used:` field or the suffix « — без оценки» in the message.
   Notes — one line: how many were taken into cards and how many dropped. Separately name only those the human must decide: note — card — what to decide. Do not list the rest.
   "Not checked by a human" from the facts — as a short list: number — what to look at. The human marks them with the button in the window or tells you, then `kermach roadmap human <number> --done` or `kermach roadmap human <number> --skip "reason"`.
   Question: "Do we accept phase {фаза}, shall I make the edits? Have a look yourself: …" — and what exactly to open.
8. The human said "not like that". Create fix cards in this same phase:
   `kermach roadmap new t "Title" --phase {фаза} --files … --text "what to do" --why "why" --check "how to check"`.
   Write the check into `--check`, not into `--text`: otherwise the "How to check" field stays empty.
   When they are done — again `kermach roadmap accept {фаза}`.
9. The human said "yes". There is no command for this — edit the files yourself:
   - in the phase file {фаза} mark `[x]` only for criteria with "yes"; set `status: done`;
   - criteria "no" and "human needed" stayed without `[x]` — add to the phase file {фаза} one line "Not checked by a human: <criterion> — what to look at; <another criterion> — what to look at". Each separate thing goes after ";": the human marks them one by one. Do not write this line into "Now";
   - fix the cards, "Inbox" and agreements per the agreed list; remove the line `draft: да` from completed drafts;
   - fix and extend `.kermach/обзор.md` per the agreed list: a corrected fact gets a date and source;
   - write "Now" (`SESSION-now.md` in the project folder): "Phase {фаза} accepted <date>. Next <phase>. Remember: …".
     If the human corrected something for the next phase during acceptance — add a line "Acceptance edits for <phase>: <what the human decided> — cards <numbers>".
     By it the phase checker will verify before the run that the edits reached the cards.
     There was a context compaction in the middle of acceptance — add a line "after compaction run kermach roadmap accept {фаза}".
10. The next phase. The facts above name the next phase — end the turn with the question "Shall I start <phase>?".
   Above it there is a line "Not accepted" — name in the question those of them that are still not accepted (phase {фаза} is accepted after "yes"):
   "<phase> will run on top of the unaccepted …".
   On "yes" — what the main session's rules say to do "before a phase": check the phase cards and start it as described there.
   The first wave of a phase first starts a fresh phase checker (t1439): `kermach roadmap wave <phase>` answers with code 4
   and the text "проверка фазы идёт" (phase check running; the program's line is in Russian). This is not an error. Tell the human in one line that a fresh agent is checking the phase, and end the turn.
   The program will print the result into this tab as a line "[Роадмап] Проверка фазы <phase>, круг N из 2: …" with the path to the analysis (`.kermach/grades/phase-<phase>-K.md`):
   - no serious ones — again `kermach roadmap wave <phase>`: the wave will start. Show the minor ones from the analysis to the human;
   - serious ones in round 1 — open the analysis, fix the phase cards (complete the draft and remove `draft: да`, "How to check", acceptance edits, criteria),
     then `wave` again: round 2 begins. An edit changes meaning the human did not talk about — ask them first;
   - remarks remain after round 2 — show them to the human before the run. If they say run — `wave` again: the wave will go on top of the remarks;
   - the check did not happen — tell the human that nobody checked the phase; the next `wave` starts the wave without a check.
   There is no next phase — say the roadmap has ended, do not propose new phases: they are created at the human's word.
11. The human did not answer step 7 and told you to keep working. Do not accept the phase, do not edit the board per the agreed list.
   Write into "Now": "Phase {фаза} awaits acceptance: <what was not checked>". Start the next phase only with this line in "Now"
   and with a warning to the human in the very first message: "<phase> runs on top of unaccepted {фаза}".
