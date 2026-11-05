# Task "Compose a roadmap" (English)

Translation of `compose.md` (t1428). This is the first message of the Claude tab that the "Compose a roadmap" button opens on the empty "Roadmap" panel when the window language is English (t519).
The file is read again on every click: an edit is visible in the next task without restarting the program.

Where to edit. This file next to the plugin code is the built-in text: a program update overwrites it.
Edit the copy in the plugin's data folder: `%APPDATA%\Kermach\plugins-data\roadmap\compose.en.md`.
There is a copy — the program takes it. No copy — it takes this built-in text. A program update does not touch the copy.

How it works:
- text before the first `## ` heading is an explanation for a human, it does not go into the task;
- everything after the line of the first `## ` heading goes to the agent, the heading line itself does not. The heading `## Задание` is the same Russian line as in `compose.md`: the program finds the task by it;
- placeholders: `{проект}` — project folder, `{папка}` — board folder, `{формат}` — the file FORMAT.en.md describing the board, `{образцы}` — the folder with sample board files (samples.en), `{язык}` — the board language.

First the agent studies the project and writes the overview — the file `.kermach\обзор.md` in the project folder (t805). The passport, the cards and the card agents rely on the overview later.
At the end the builder inserts the roles from the template `project-claude.en.md` into the project's `CLAUDE.md` — it lies next to this file (step 6, t1326).
As the last thing it opens the main session tab with the command `kermach roadmap start` and passes it the summary of the review (t1423).
Before the main session a fresh checker reads the board (t1438): no more than two rounds, the builder fixes serious remarks.
Questions by project kind are the sections `### Kind: …`. Each can be edited separately. Your own kind — a new section `### Kind: <name>` next to them, in the same line order: one question per line.

## Задание
Help me compose a roadmap for this project. The project folder is {проект}.

A roadmap is a board of text files in the folder {папка}: the project passport, phases and cards. The Kermach program shows it in the "Roadmap" panel and runs the cards with agents.
How the board files are built — the description {формат}. Read it in full before proposing anything. Samples of every kind of file are in the folder {образцы}.

The work goes like this. First you study the project and write the overview — the file {проект}\.kermach\обзор.md. Then you ask me questions about what is not in the files. Then together we compose the board and the roles in CLAUDE.md.
The overview is needed afterwards too: the passport, the cards and the agents who will do the cards rely on it. A shallow overview means bad cards: they will have guesses instead of facts.

### How to work in this tab
- Write to me in this language: {язык} — questions, the overview, the text of the board and the cards. The overview file name `обзор.md` stays as it is: the program looks for it.
- Study the project yourself, do not start subagents: neither background nor regular ones. This task overrides the general rule "big things — to a subagent" from your instructions.
  Why: the notice that a background subagent finished often does not reach this tab, and it stands still for hours; and you have to read the subagents' excerpts yourself anyway, and the context gets compacted several times.
- Read big things in parts, not in full. A file up to ~500 lines — in full. A log or a file over ~500 lines (SESSION.md, PLAN.md, notes) — first its headings (lines starting with `#`), then the last ~300 lines, then search by the topics of step 1: access, agreements, prohibitions, what broke.
- Create the overview skeleton at once, before step 1: the file {проект}\.kermach\обзор.md with all the sections of step 3, empty for now. Extend it as you go through each step — the file grows while you work.
- Do not end a turn with the words "waiting", "I'll continue when…", "I'll wait for the report": nobody will wake you up after that. A turn ends either with a question to me or with a finished step.
- In steps 4–6 every message to me ends with one line: "Now: step N of 6, needed from you: …" — what exactly is needed from me. This shows that the turn ended with a question and did not stall.

What a good roadmap is — keep this in mind from the first step:
- Every card is later done by a separate agent in a new tab. It does not see this conversation: it has only the card text, the passport and the overview. What is not in the card, the agent does not know.
- A card is one go of an agent: one checkable goal, usually up to three files to edit. More — split into several cards linked with `depends`.
- "Done" for a card and for a phase is an external fact: command output, a file and a line, a screenshot of a page. Not "the agent said it did it".
- A phase is closed when its done criteria are met, not when the cards run out.

### Step 1. Project memory — always, before the code
Read what is already written about the project. This is the first thing to do, in any project.
- Rules and logs in the project folder: CLAUDE.md, AGENTS.md, files in .claude\, SESSION.md, SESSION-now.md, PLAN*.md, README, notes on the state and tasks.
- Claude Code memory: the folder ~\.claude\projects\<key>\memory\, MEMORY.md first. The key is the full project path where every character except Latin letters and digits is replaced with "-": D:\Work\my_shop → D--Work-my-shop. Folders with Cyrillic in the name get the same keys — check by MEMORY.md that the memory is about this project.
- Past conversations, if there is the mempalace command. `mempalace status` — the list of wings; find the project's wing in this list, it is usually the folder name in lower case. Then `mempalace search "question" --wing <wing>` — several queries by topic: how the project is built, access, agreements, what is forbidden, what broke and why.
- The previous board, if any: files d<N>.md in {папка} — decisions, dead ends, agreements and patterns. A pattern (`type: pattern`, in old files `паттерн`) is one rule collected from the records in its `from`. A pattern with `approved:` was approved by the human: it goes into the overview as a project rule, instead of the records from `from`.
Write out separately the agreements with the human and with their client: what was decided, what was forbidden, what was postponed, how work is usually done. Each with a date and where it is written.

### Step 2. Project kind
Work out from the files what kind of project this is. There can be several kinds at once: a site and marketing, a program and documentation. For every kind answer its questions below.
The kind is not in the list — make up the questions yourself after the same pattern and name the kind in the overview.
A sample of the result — in any kind of project. A sample is what the result must look like: a layout, a mockup, a design, the old site, someone else's text "do it the same way".
Look for it in the files and in the agreements (folders html, layout, design, mockups, links to Figma, an export of the old site). Found it — for every page of the sample list its sections top to bottom, to the end of the page, not by the first screen.
For every section mark whether the project has data for it: texts, photos, prices, reviews. Where there is no data — it is a question to the human in step 4, not a section that can be silently skipped.

### Kind: site
- What it is built on: the engine and its version, PHP, database, hosting and web server.
- Theme: parent and child, their versions. Page builder (Bricks, Elementor, Gutenberg blocks) and its add-ons.
- What the sections and pages are made with: theme templates, builder templates and components, blocks, ACF fields, own styles. Where their local copies or exports are.
- Plugins — as a list with versions and the date the versions are correct for. Which are paid or licensed, which are disabled, which were updated and what broke after that.
- Own code: functions.php of the child theme, mu-plugins, snippets (Code Snippets, Fluent Snippets, WPCode), own CSS and JS in the builder settings. Where the local copies are and how fresh they are.
- Access: SSH, REST API, WP-CLI or only the admin panel. What the project rules allow and forbid, through what edits go to the server.
- How an edit is checked: which pages, which cache to clear, whether there is staging.
- Found an export or unpacked copy of the site (backup, .wpress, zip) — look at its folders two levels deep. The freshest code is often there: themes, plugins, snippets. Compare the dates with other copies.
Do not go to the server and do not go online: find all this out from the files and memory, and what is not in them — write into "Not found out".

### Kind: program
- Language and its version, package manager, main libraries.
- How to build, run and check: commands from README, package.json, Makefile, CI.
- Main parts and their links: which folders, where the entry point is, what depends on what.
- Tests: are there any, how they are run, what they check.
- What is broken or unfinished now: TODO, open tasks, the log.

### Kind: texts and marketing
- For whom: the reader or buyer, the customer and their task.
- Tone and voice: style rules, prohibitions, examples of good and bad text.
- Ready materials and samples: what is already written, what is taken as a sample.
- The client's edits: what they changed and why, which remarks repeat.
- Where it is published: platforms, formats, length, deadlines.
- What worked and what did not: numbers, responses, conclusions from past work.

### Kind: research
- What question: what has to be found out and what for.
- Sources: what is already collected, where it is, what can be trusted.
- What is already found out and what remains open.

### Step 3. Overview — the file {проект}\.kermach\обзор.md
Sections of the overview:
- `# Project overview` and the date under it;
- `## Project kind` — which kinds and from which files this is seen;
- `## What I read` — the list of memory sources and main files;
- a section for every kind, for example `## Site` — answers to the questions of the kind;
- `## Agreements` — each with a date and a source;
- `## Check` — how an edit is checked: one command and its expected result (for example "13 of 13"), where it is described, whether two runs can go at once. No command — say so and describe how it is checked by hand;
- `## Sample` — where the sample is and what counts as a match; for every page — the sections top to bottom and whether there is data for each. No sample — say so;
- `## Started and broken` — open tasks, TODO, unfinished plans, known breakages, with a source. Cards will grow out of this later;
- `## Not found out` — the question and the reason: not in the files, access is needed, sources disagree.
Every fact has a source in brackets: file:line, a command (`mempalace search "…"`) or a memory file. Do not write a fact without a source.
Sources disagree — give both with dates, the newer first. Take facts from the files, not from guesses by the folder or file name.
Read inventories, lists and file headers, not only headings. Do not walk big folders in full (node_modules, builds, archives, videos, database exports): look at an inventory or a couple of files in them.
Do not write passwords, keys and tokens into the overview, even if you see them — only where they are kept. Do not write people's names either: "the human", "the client", "the ad specialist".

### Step 4. Questions to me
When the overview is written, write in this tab in five to seven lines what is the main thing in it.
Then collect the questions — only about the gaps from "Not found out" and about what the passport and the phases cannot be composed without. Do not ask what is already in the overview.
Be sure to find out, if it is not in the overview: what result of the project the human needs in the coming weeks; what is most important; what not to touch; with what command or action to check an edit.
There is a sample — two decision questions are required, before the cards:
- "Is done a match with the sample over the whole page?" The recommended answer is yes: otherwise the checks will measure "the page opens without an error", and nobody will see the missing sections until the end of the work.
- Sample sections without data — for each one or as one list "page: section": "take the text and pictures from the sample", "remove the section", "I will send the data". The recommended one is the text from the sample: the page stays complete, the human will replace the text later.
Do not skip such a section silently and do not put it off into the list "the owner will decide": the answer changes the cards. Write the answer into the overview, section "Sample", and into the cards of these pages.
Also ask how many agents can work at once without hitting the subscription limit: a junior subscription — 1–2, a regular one — 3, a big one — up to 8. Do not invent plan names. The answer will be needed in 5.4.

Questions are of two kinds, and they are asked differently.
- Decisions — what to choose: what is more important, what to do first, what not to touch. With each — answer options, first the one you recommend, and why in one phrase.
- Facts — how things really are: whether there is a copy of the site for trials, which PHP version, what access to the server, which subscription. Only the human knows the answer, yours would be a guess. That is why a fact has no recommended answer. There are always two options: "I know: …" and "I don't know".
Write so that a person who does this for the first time understands. Explain every term in the same phrase: not "is there staging?", but "is there staging — a copy of the site where edits can be tried without touching the real one?". You ask to find or do something — step by step: where to open, what to click, what to send.

First collect all the questions, then ask in one message: "Questions: N", under it two groups — "Decisions" and "Facts", in each the topics of the questions, one line each, and at the end "Shall we discuss each in turn, or do you accept the recommended answers?".
- "Recommended" — print all the questions in one list: number, question, for a decision — the recommended answer and why in one phrase, for a fact — "I know: … / I don't know" without a recommended one. Wait for confirmation.
  The human may correct single numbers ("all yes except 3: …") — accept the correction, show again only the corrected items and wait for "yes". Asked to discuss single numbers — go through them one by one.
  A fact the human did not answer themselves but accepted with the list or "yes" is "I don't know".
- "Discuss" — ask one question at a time and wait for the answer.
A new question grew out of an answer — ask it separately, in the same order.

Add the answers to the overview with a date. Source: "the human's answer" — if the human answered themselves or corrected; "the human's answer: recommended accepted" — if they agreed with the list.
A fact with the answer "I don't know" stays in "Not found out". In 5.2 a research card or an item of a "human needed" card grows out of it.
The board cannot be composed without an assumption — write it into the overview with the source "guess, accepted without checking (list DD.MM)". Such an item goes into the summary of 5.4 "what rests on a guess".

### Step 5. The board
We compose the board in parts: first the passport and all phases, then the cards — one phase at a time. Each part goes into files right after my "yes".
Why so: the work is long, and on the way the tab compacts its context — the details of the conversation are lost. What already lies in files is not lost.
Rely on the overview, not on general knowledge about such projects. Names, headers, sections and the file number counter — strictly by {формат}.
Board format words — statuses, card kinds, field and section names — write in English, as in {формат} and the samples {образцы}. Start the passport with a header with the line `lang: en` (between `---` lines): by it the program writes the board words in English. If you do not write it, the program will add it itself when it sees the passport.

5.1. Passport and phases.
   Propose the passport and all phases as text in this tab, without cards.
   The passport is nine sections by {формат}. The section "Check command and expected result" — from the section "Check" of the overview: the command, the result, and what to do if a run is already going (do not start a second one, wait or ask). No check command — the first card of the first phase creates it.
   The first line of the section "Project tools" is `Стек: name, name` (the word `Стек:` exactly so, in Russian: the program looks for it): themes, plugins, frameworks and libraries that have their own errors, in Latin letters in lower case, like the `stack` field of records (`Стек: woocommerce, woodmart`). By it the card agent gets checked solutions from other projects with the same stack. In the passport refer to the overview and the project files, do not retell them.
   Phases — from two to five, in order. A phase has a goal in one phrase — what will change for the human or their client, not "write the code". Done criteria — from two to five, each checked by an external fact: a command, a page, a file. Do not set the health of phases: the human and the check set it during the work.
   There is a sample — the first phase ends with a pilot: one page in full and its comparison with the sample over the whole page, top to bottom, not by the first screen. The first phase and every next phase that changes pages have the criterion "the phase's pages match the sample: every section is there or removed per the human's answer". Do not put off the comparison with the sample to the last phase: there is nobody left to see it in time there.
   Wait for my "yes". I may correct — then show the corrected version and wait again.
   After "yes" create in {папка}: passport.md, f<N>.md for each phase, counter.json. Phases get `status: planned`, the first one — `running`. Create every agreement in force from the overview as a record d<N>.md with `type: agreement` (keys — by {формат}): the agent of every card gets it.

5.2. Cards — one phase at a time, in phase order.
   Show the cards of one phase, wait for "yes" or edits, after "yes" create them as files t<N>.md and take the next phase. So up to the last one.
   The first phase — full cards. Each is a task for an agent who has not seen this conversation:
   - title — what will change, in plain words, without names from the code (section "Card" of the description);
   - "What to do" — specifically, with a place in the project; if the overview has a file and a line — name them;
   - "Why" — which done criterion of the phase the card moves forward;
   - "Files" — which files may be changed; what must not be touched — into "Special notes";
   - "How to check" — item by item, each item an external fact and the expected result. The check measures the card's goal, not only the absence of errors: the goal "like the sample" — a comparison with the sample over the whole page (sections top to bottom: how many in the sample, how many on the page, a screenshot of the whole page). "Opens without an error", "no fatal", "one H1" is not enough for such a card: the checker will return it;
   - `depends` — numbers of cards without which this one cannot start. The first card of a phase depends on nothing. Card order — from the one that opens the rest to the one closer to the phase goal. A card can also depend on a card of a past phase;
   - `kind` — `research` if something has to be found out first (the cause, access, the state), `review` for checking someone else's work, otherwise `do`;
   - `human: human needed` if the card cannot be done without the human: access, a decision, payment, prod. What exactly is needed from the human — into "Special notes", step by step, as for someone doing it for the first time: where to open, what to click, what to send. Explain every term in the same phrase;
   - the card works with a server, a site or a service — it has `depends` on the card that gives access to it. Without such a link — only if the access is already written in the overview;
   The next phases are drafts (section "Card draft" in {формат}): `draft: да` in the header (the word `да` in Russian: the program reads it), the title, "What to do", "Why", "Files"; "How to check" — a dash. We will complete them at the review after the previous phase, by what we learn in the work. A wave does not run drafts.
   The last card of every phase is a review (section "Phase review card" in {формат}): `kind: review`, `depends` — all the other cards of the phase, "How to check" — every done criterion of the phase: yes or no and what proves it. In a draft phase the review is a draft too.
   Every card, full or draft, also has an agent, a model, an effort and an advisor — by the selection rule from the section "Card" of the description, and the reason in one line. In the card file these are the keys `agent`, `model`, `effort`, `advisor`, `agent_why`; if I named the model or the effort — also `pick: человек` (exactly so, in Russian: the program reads this word).
   All cards — `status: queued`, in the field `source` — `composed with the human`.
   Before showing the cards of a phase, check them yourself: a full card has "What to do", "Files", "How to check" filled in, a draft — "What to do", "Why", "Files"; there is no card without a link to a done criterion; there is no done criterion without a card; the last card is a review; there is no agreement from the overview that a card breaks; a card with the goal "like the sample" has "How to check" comparing the whole page with the sample; sections without data are decided by the answer from step 4; a card that works with a server, a site or a service has `depends` on the access card or the access is written in the overview. Found a discrepancy — fix it before showing.

5.3. "Inbox".
   Started and broken things from the overview that do not lead to the goal of any phase — cards in the "Inbox" (empty field `phase`), not in phases.
   Pattern candidates — 3 or more records of the previous board about one cause, counted by the program: {паттерны}
   For every candidate propose a card in the "Inbox" "Collect a pattern from dN, dN, …" of kind `do`, the numbers — from the candidate's line. Do not write the pattern yourself and do not set `approved:`: the agent of this card will write the pattern, the human will approve it.
   A candidate's line has "overlaps" — ask me whether to collect one common pattern or two. The answer "one" — one card with the numbers of both lines, "two" — a card for each line.
   Show, wait for "yes", create as files.

5.4. General review.
   Check the whole board by the files: every done criterion of every phase has a card; dependencies between phases are given; cards with a server, a site or a service have a link to the access card; the last card of every phase is a review; no card breaks agreements; there is a sample — the comparison with it is in the pilot and in the criteria of every phase with pages, not only in the last one. Found a discrepancy — show it and fix after "yes".
   The summary in one line: how many phases, how many full cards in the first phase, how many drafts, how many in the "Inbox", and what on the board rests on a guess rather than a fact from the overview. Here also — every item of the overview with the source "guess, accepted without checking".
   Then ask me to set the agent limit by the answer from step 4, step by step: open the "Roadmap" panel; find the line "Sessions at once: … busy of" — it appears when the board has phases; choose a number in the list on the right. You cannot set it yourself: there is no command for this. The limit is one for the whole program, for all projects at once. The answer about the subscription is "I don't know" — say that the program's default is 3, and propose starting with 2.

### Step 6. Project rules — CLAUDE.md
The main session (with me) and the card agents will work in this folder, and all of them read the project's CLAUDE.md. Write the roles into it.
The roles text is the file `project-claude.en.md` in the same folder as {формат}: everything from the first `## ` line to the end, as is, without retelling.
- No CLAUDE.md — show the whole text of the new file.
- There is one, without the section `## Who you are` and without `## Кто ты` — append the text at the end, do not touch the rest.
- There is one with `## Who you are` or with `## Кто ты` (the Russian insertion from `project-claude.md`) — this is a past insertion: replace it (from this heading to the first `## ` not from the template or to the end), do not append a second one.
- In CLAUDE.md or AGENTS.md own rules about roles disagree with the template — show them and ask what to keep.
Show the diff (`+` and `-`), write after my "yes", with the file's line endings. The summary in one line: created, appended or replaced, how many lines.

When CLAUDE.md is written, a fresh agent checks the board, and then the main session opens — from then on it leads the work, not me by hand:
1. Run `kermach roadmap start --summary "summary"`. Instead of "summary" — the summary of the general review of step 5.4: how many phases and cards, what rests on a guess, the overview items "guess, accepted without checking", what is needed from me. No longer than 4000 characters, in one line, without double quotes inside.
2. First the command checks the board by the program. Found errors — it will answer with their list: fix the cards and run the command again.
3. Then a fresh checker reads the board — a separate claude who has not seen this conversation and only reads files. The command answers «проверка роадмапа идёт» (roadmap check is running) with code 4 — this is not an error.
   Write to me in one line that a fresh agent is checking the board, and end the turn with the line "Now: step 6 of 6, needed from you: nothing — the roadmap check is running; if there is no summary line for more than 25 minutes — write "next"".
   I wrote "next" — run the same command again: the program will start an interrupted check anew and show a finished one.
   Here you may end the turn and wait — this is an exception to the rule about "waiting": the program itself will print the result into this tab as the line «[Роадмап] Проверка роадмапа, круг N из 2: …» (roadmap check, round N of 2). Do not wait in a loop and with `sleep`: the line will come as a separate message.
4. A line with serious remarks came — read the review file, the path is in the line, and fix the remarks in the board files. The edit does not change what was agreed (a card's goal, the set of phases) — fix it yourself, without my "yes". A new card, a new phase or another goal is needed — show me and wait for "yes".
   Fixed — run `kermach roadmap start --summary "summary"` again: the second round will start. No more than two rounds. What remains after the second — write into the summary for me, as a separate line "Left after the check: …".
   Write the minor remarks from the review into the summary too — I will decide.
5. The command opened the main session tab — write to me "All done:" and in one line what was created: the overview, the passport, how many phases and cards, CLAUDE.md, what the check said.
   The main session will read the board, tell me what is needed, and start the first phase itself.
6. As the last message write: "My work is finished. From now on the work goes on in the "Main session" tab". Do not close this tab: I will close it.
The command answered that the main session tab is already open — say so, with its number. It answered with another error — write it word for word and what I should do: open a terminal in the project folder and run `kermach roadmap start`.

Create only what was in what was shown and agreed: something new — show it first. Do not write people's names into the board files, even if you know them from settings or other files: other people also keep the board.
Until my "yes" on the passport and phases create nothing in the folder {папка}. The only file you write earlier is the overview {проект}\.kermach\обзор.md. Do not change other project files: this work is only about the overview, the board and the roles in CLAUDE.md (step 6, after my "yes" on the diff).
Every created part will appear in the "Roadmap" panel at once.
