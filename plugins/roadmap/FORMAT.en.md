# Format of the "Roadmap" board (t510)

English translation of `FORMAT.md` (t1428). This board is English: the passport header has `lang: en`, the format words are English (section "Board language").
A project board is plain text files in the folder `<project>\.kermach\roadmap\`.
People read and edit them by hand in an editor, the agent writes them directly, the program shows them in a panel.
Samples of every kind of file are in the folder `samples.en\` next to this description.

## Folder

All files lie directly in `.kermach\roadmap\`, without subfolders.

| File | What it is | How many |
|---|---|---|
| `passport.md` | project passport | one |
| `f<N>.md` | phase, for example `f1.md` | one file per phase |
| `t<N>.md` | card, for example `t12.md` | one file per card |
| `d<N>.md` | decision, dead end, agreement or pattern, for example `d3.md` | one file per entry |
| `counter.json` | number counter | one |

The project overview is `.kermach\обзор.md`, next to the board folder, not inside it: what the agent found out about the project before composing the roadmap, with a source for every fact. The file name `обзор.md` stays Russian: the program looks for it by that name. The program itself does not read the overview.

Name rules:
- `<N>` — digits only. `t09.md` and `t9.md` are the same number 9; two such files at once are an error in both.
- Other names in the folder (`README.md`, `t12.bak`, `card.md`, subfolders) are a "wrong name" error.
  The program neither shows nor edits a file with an error; the others are read.
- Names starting with a dot (`.t12.md.tmp`) or ending with `~` are editors' service files; the program skips them silently.
- A file larger than 256 KB is a "too large" error; the program does not read it.

## How a file is built

All `.md` files are built the same way:

```
---
key: value
key: value
---
# Title
Body
```

The header is between two `---` lines at the very start of the file.
In the header every line is `key: value`. Keys are in Latin letters, values are in the board language (here English, see "Board language").
An empty value is nothing after the colon. A list is in square brackets, comma-separated: `depends: [t09, t10]`.
You may add your own keys: the program leaves them alone and keeps them when editing.
A header line without a colon, or no closing `---`, is a "broken header" error.

After the header come the title `# …` and the body. A `# …` line inside a code block ```…``` is not a title.
The letter "ё" in Russian values is optional: «ждет ответа» reads as «ждёт ответа».
The program keeps line endings (LF or CRLF) as it found them.

Some words the program reads only in Russian — on an English board write them exactly like this, in Russian:
- `effort` values (`высокое` and the others from the card table), `advisor: да`, `draft: да`, `pick: человек`;
- in the passport `card_mcp: все` / `никаких`, `card_skills` and `card_check` — `да` / `нет`; in an entry `pattern: нет`;
- text lines `Текст ошибки:`, `Неверно (tN): …`, `Проверено человеком (…)`, the title «Правило работы: …», the pattern lines `Правило:`, `Почему:`, `Когда не так:`;
- section headings `## Переносимый вывод`, `## Ответ человека (…)`, `## Вопрос`, the line `Стек:` in the passport.

## Card — `t<N>.md`

Header:

| Key | What it is | Values |
|---|---|---|
| `id` | number, matches the file name | `t12` |
| `phase` | phase | phase number `f1`; empty — the card is in the Inbox |
| `status` | status | `queued`, `in progress`, `awaiting answer`, `checking`, `in review`, `paused`, `done` |
| `kind` | kind of work, the prompt template is chosen by it | `do`, `review`, `research`; no key — `do` |
| `agent` | who does it | `claude`, `codex` or the name of your own agent |
| `model` | model | any, for example `opus`, `gpt-5.5`; empty — the agent's default. The window's lists are in `agents.js` |
| `effort` | effort, optional | any, for example `высокое` (in Russian: that is how `agents.js` reads it); empty — default. The window knows `минимальное`, `низкое`, `среднее`, `высокое`, `очень высокое`, `максимальное` |
| `advisor` | whether to call the advisor, optional | `да` — the card's task gets the line "call the advisor", only for the `claude` executor; no key or anything else — no line. The program does not set the advisor's model: it comes from the Claude settings (`advisorModel` in `~\.claude\settings.json`); if it is not there, the agent says there is no advisor and does the card without one |
| `pick` | who chose the model and effort, optional | `человек` — a human named them, a retry does not raise them; no key — chosen by whoever created the card, by the rule below |
| `agent_why` | why this agent, model, effort and advisor, optional | one line, for example `research — sonnet низкое` |
| `checked` | result of the card checker, written by the program | one line, for example `выполнено, круг 1: 4 из 4 критериев` or `нужна доработка, круг 2 из 3: нет пробы для выкл`; the full review is `.kermach/grades/tN-круг.md` (t1330) |
| `tries` | launch attempt number, written by the program (t1440) | a number `1`, `2`, `3`…; rewritten on every launch from "Run", `kermach roadmap run`, a wave or a batch. On a done card — the attempt it was delivered on: `kermach roadmap accept fN` sums up the `size.js` tiers by it. Do not edit by hand; no key — the card was launched before t1440 or not by the program |
| `depends` | which cards it depends on | a list of numbers `[t09, t10]` or empty |
| `human` | whether a human is needed | `no human`, `human needed` |
| `draft` | draft, optional (t1325) | `да` — a card of a later phase without "How to check": the "All" and "Independent" waves skip it with the reason "draft", "Selected" launches it; the card row in the panel has the mark "draft". No key — an ordinary card. See "Card draft" below |
| `created` | when it was created | `2026-10-12 11:20` |
| `closed` | when it was closed, optional | `2026-10-12 15:40`; set by the agent on close, by the window when the status changes to "done". No key — this card gets into the prompt of a neighbouring card of the phase (part 5) only if created later (`created`), and the card row on the board has no time: the file time after `git clone` is wrong |
| `source` | who created it, optional | `found by claude in session t15`, `added by a human` |
| `served` | which entries the program gave the agent in the task; written by the program at card launch, the agent does not touch it | `[d12, d40]`; a relaunch appends new numbers, the earlier ones stay |
| `from` | which "Tasks" task the card came from; written by `kermach tasks card kN` and the "To project roadmap" button (t1163). When the card is closed, the task is marked done by itself | `k12` |
| `used` | the agent's feedback on entries that helped, optional; written by the agent on close | `помогла: d12 — found the same cause of the hang; помогла: d40 — took the ready probe command` (t1433); the word `помогла:` is Russian, the program reads it; old cards have `d12 помогла, d40 не пригодилась, d77 неверна, d81 не открывал`; a piece not matching the pattern is a board remark, the card is still read |

`id` and `status` are required; the rest may be left out.

Whoever creates a card chooses its agent and, if they want, the model, effort and advisor.
The agent is `claude` unless the human named another executor.
Model and effort — the first matching line from the top:
1. The human named the model or effort — set them, for any executor, and `pick: человек`.
2. The executor is not `claude` (codex and others) — `model` and `effort` empty.
3. Otherwise do not write `model` and `effort`: the program computes the tier at launch from the card text (`size.js`, decision t1045) and writes the reason to the plugin log and to the "next launch" line of the window. A card with empty "What to do", "Files" and "How to check" counts as the opus tier: little data — a higher tier.

| Tier | Model and effort | When |
|---|---|---|
| opus | `opus`, `низкое` | production or irreversible; cause unknown or behaviour flaky; gestures, focus, event order, timing; architecture, protocol, daemon; 4 or more files in `src`; a check of 4 or more points; editing several `src` files without exact places |
| sonnet | `sonnet`, `низкое`, the advisor once before delivery | the rest: research and review without editing `src`; text, checks, probes without `src`; an edit of `src` in a known place (file:line) |
| haiku | `haiku` | only on a human's word (`pick: человек`): the title starts with a navigation verb — find, collect, move, rename, measure, count — and `src` is not touched. The program never sets haiku itself, it only hints in the log |

The advisor is set separately from the model and only for the `claude` executor. For a sonnet-tier card the program adds the line "call the advisor once before delivery" itself (t1042: without an advisor Sonnet delivered a hidden error in 4 runs out of 4, with an advisor — 0 out of 4). Write `advisor: да` for production, money, the irreversible and when a human asks for the advisor: then the line is "before the first edit and before closing", with any model. Codex and other executors have no advisor — do not set the `advisor` key; the program does not give them the advisor line either.
A retry after "awaiting answer" goes one step up the ladder `sonnet низкое → opus низкое → opus среднее`; a card with `pick: человек` is not raised.
Write the reason for the choice as one line in `agent_why` when a human or the orchestrator chose the model: what was said and why.

Retry. The card is launched again after "awaiting answer" (red check, a question, the agent stopped without "done") — the program takes one step up: `sonnet низкое` → `opus низкое` → `opus среднее` (`LADDER` in `agents.js`).
`model` and `effort` in the card file do not change: the step goes only into the tab's arguments, the line about it into the plugin log. Not raised: a card with `pick: человек`, not claude, or with a model or effort not from this ladder.
How attempts are counted:
- the attempt reached "awaiting answer" — the next launch is one step up. It does not matter who set this status: the agent, the program from the tab, or a human in the window;
- the human answered in the same tab and the agent is "in progress" again — it is the same attempt, the mark "reached an answer" is removed;
- the tab was closed mid-work ("paused"), the card went to "checking" or "in review" — the count does not change;
- the card became "done" or was returned to "queued" — the count starts over.
The program sets `pick: человек` itself when a human changes the model or effort in the window to non-empty values. Resetting the model on an agent change does not set `pick`.

Body: the title `# …` is the card name. Below — labelled lines.

The name is for a human. From the name alone a human understands what changes after the card: what will work differently or what will appear.
Plain words, up to ~80 characters. No internal names — functions, files, variables, keys, probe numbers — and no jargon: those go into "What to do".
Bad → good:
- «"не открывал" in --used — the fourth verdict for the t1329 review» → «The review counts the use of notes more precisely: the agent marks which it did not open»;
- «Probes: child process result by exit, not by close» → «Checks do not lose the program's output under load»;
- «Gate in 2–3 threads: windowless checks in parallel» → «The gate is faster: windowless checks run three at a time».
A label is at the start of a line, with a colon; the text comes after the colon and may continue on the following lines.
A field ends at the next label from the list, at an empty line or at a heading.
A code block ```…``` is part of the field as is: an empty line, `#` and a label inside the block do not end the field. The block starts on a new line after the label.

| Label | Key in the program |
|---|---|
| `What to do:` | `what` |
| `Why:` | `why` |
| `Files:` | `files` |
| `How to check:` | `check` |
| `Special notes:` | `notes` |
| `What was done:` | `done` |
| `Proof:` | `proof` |

"How to check" — a command and the expected result, if something beyond the project check from the passport is needed.
"How to check" measures the card's goal, not only the absence of errors (t1434). If the goal is matching a sample (markup, mockup, design, old site), the check compares the whole page with it from top to bottom: every section of the sample is on the page or removed by a human's answer.
"Opens without an error", "no fatal", "one H1" is not enough for such a card: the checker returns it with the result "criteria do not fit". Bad → good: «the home page opens without fatal, one H1» → «the home page opens without fatal; sections from top to bottom match html/index.html: 12 of 12, a screenshot of the whole page next to a screenshot of the sample».
"What was done" and "Proof" are filled in on close; proof is command output, a commit, or a file and line.
An empty field is a dash `—` or nothing.
Write your own text after an empty line: then it does not become part of a field, and the program will not touch it.

```
---
id: t12
phase: f1
status: queued
agent: codex
depends: [t09]
human: no human
---
# Cart: delivery recalculation
What to do: when the city in the cart changes, delivery is recalculated without a page reload.
Why: now the delivery price lags one step behind, buyers leave (complaint 09.10).
Files: `theme/js/cart.js`, `inc/shipping.php`.
How to check: `remote-check.sh` is green; by hand — change the city, the price changes at once.
Special notes: do not touch `theme/js/city.js`.
What was done: —
Proof: —
```

### Human answer (t1354)
The answer to the agent's question is a section at the end of the card. The program writes it, not a person by hand:
- the main session or a human in the terminal — `kermach roadmap answer tN "text"` (or `-`: text from standard input);
- the "Roadmap" panel — the plugin command `answer`.

The section heading is Russian, `## Ответ человека (…)`: the program finds the answer by it.

```
## Ответ человека (26.10 22:40)
option 1: the checker trusts only answers written by the program.
```

The section ends at the next heading or field label. The text may not start a line with `#`, ```` ``` ```` or a field label: the command refuses.
Together with the section the program writes a fingerprint of the text (sha1 of the project, card number and text) to `answers.json` in the Kermach data folder (`%APPDATA%\Kermach\plugins-data\roadmap\`), not in the project folder.
The card checker (`card_check`) sees only answers with a fingerprint. A section typed into the card by hand, and lines like «Ответ оркестратора …», are not an answer for the checker: they do not remove a criterion. The card agent still sees them in the prompt.
Editing the section text after writing, moving it to another card or renaming the project folder — the fingerprint will not match, the answer has to be written again.
From the card agent's tab (`KERMACH_CARD` in the environment) the `answer` command refuses with code 5: the agent does not write a human's answer to itself.
This protects against an agent's mistake, not against deception. The agent runs under the same Windows user as the program: it could remove `KERMACH_CARD` from the environment or write `answers.json` itself. There is deliberately no lock through the main process: it would not block writing a file in the data folder anyway.

### Card draft (t1325)
The roadmap is written fully in advance: the first phase as full cards, the rest as drafts. A draft is a card with `draft: да` in the header and `status: queued`.
It has a title, "What to do", "Why", "Files"; "How to check" is empty or a dash. The details and "How to check" are added at the review after the previous phase: from what was learned in the work.
Once added, the `draft` key is removed from the header and the card becomes ordinary. A wave takes it only after that: the agent does not get a card without "How to check".
Why a field and not a status. A draft is "queued, but not written out". A new status would have to be taught to everyone who reads the status: the card count of a phase, the phase report, `kermach roadmap`, translations, editing in the window. The field is seen only by the wave and by the card row in the panel.

### Phase review card (t1325)
The last card of every phase is `kind: review`, `depends` — all other cards of the phase. A fresh agent checks how the work of the neighbouring cards fits together.
Its "How to check" is every done criterion of the phase point by point: yes or no and what proves it (a command, a file and line, a page). In a draft phase the review is a draft too.
The criteria are written out in words, not as a reference "for every criterion of the phase": the roadmap check looks for the words of every criterion in "How to check".

### Roadmap check (t1437)
The program checks the board without AI: `kermach roadmap check [fN]` (without fN — unfinished phases; errors — code 4).
The same check runs by itself in two places: when the builder has written the cards and called `kermach roadmap start --summary` (the result goes to its output, into the main session's task and as a line under the phase) and before a phase wave is launched.
What counts as an error:
- a phase without a `kind: review` card or without done criteria;
- a phase card without "How to check" or without "Files" (empty or a dash). A draft (`draft: да`) and a "done" card are not counted;
- a review card whose "How to check" lacks the phase criteria: a criterion is found when the text has at least half of its words;
- `depends` on a card that is not on the board;
- a dependency loop: t1 waits for t2 and t2 waits for t1 (or longer; a card waiting for itself is a loop too).
If errors are found, the phase wave does not start: under the phase the line "Wave not started: the roadmap check found errors" with the list.
Only a human may launch with them, with the button "run anyway" in the same line. `kermach roadmap wave fN` then answers with code 4 and lists the errors.
The "Selected" wave checks only the selected cards: it needs neither the review nor the phase criteria. Continuing an interrupted wave is not checked: it was already launched.
Once the cards are fixed, the line disappears by itself on the next board read.

### Fresh roadmap checker (t1438)
The program catches errors of form. Errors of content — a card that does not move a phase criterion, a check measuring the wrong goal — are caught by a fresh agent: the builder sees its own mistakes poorly.
When: the builder called `kermach roadmap start --summary`, the program check found no errors, and the builder's tab is alive. `start` from a human's terminal, without the builder's tab, opens the main session at once, as before.
Who: a separate `claude -p`, model opus, effort "high", read-only (Read, Glob, Grep). The task is the template `review-roadmap.md` next to this file (in English — `review-roadmap.en.md`), your own copy is in the plugin data folder, as with `compose.md`.
What it checks:
- every card has a done criterion of its phase — the "Why" field names it; every criterion has a card;
- the criterion is visible in practice: command output, a page, a file; "all cards closed" is not a criterion;
- "How to check" measures the card's goal, not "opens without an error";
- if there is a sample, the first phase ends with a pilot comparing a whole page, every phase with pages has a criterion of comparison with the sample;
- sample sections without data: the human's answer is recorded in the overview before the cards of those pages are created;
- the order of phases and dependencies, an access card for cards with a server.

No more than two rounds:
- while a round runs, `start` answers with code 4 and the text «проверка роадмапа идёт» (the roadmap check is running) — the main session tab is not opened;
- the program prints the round result into the builder's tab as one line «[Роадмап] Проверка роадмапа, круг N из 2: …» (roadmap check, round N of 2) with the path to the review. If the line did not get through (a human is typing a long text, the tab did not accept it), the next `start` returns it as the answer and does not start the next round;
- serious remarks — the builder fixes the board and calls `start` again: the second round;
- clean, the second round is over, or the check did not happen (limit, no claude, longer than 20 minutes) — the next `start` opens the main session. What is left and why the check did not happen is in its task: it will tell the human.
Serious — a card without a phase criterion, a criterion without a card, the criterion "all cards closed", a check of the wrong goal, no pilot or sample comparison, a section without the human's answer, a missing needed dependency. The rest is minor, for the human in the summary.
The review of every round is `.kermach\grades\roadmap-N.md` in the project folder (the next free number, not for git). The program remembers the round: reopening the window does not restart the check, a new builder tab starts from round 1.
The checker takes one of the two card-checker slots: with two card checks running, it waits its turn.

A wave does not launch two cards with a shared file together. A shared file is one path in the "Files" of both cards, the same file name, or a folder containing a file of the other card.
The second card waits with the mark "waits for file: tNN" while the first is working, awaiting an answer, checking or in review; it launches when the first has become "done" and its check is over.
A card launched not by a wave holds the file too.

### Fresh phase checker (t1439)
Later phases are written as drafts and completed after the previous phase, and at its acceptance the human makes edits. The roadmap check at the start does not see that. So before a phase is launched, the same fresh agent checks it — only this phase.
When: the first wave of the phase (`kermach roadmap wave fN` or the "All" or "Independent" wave button), if the program check found no errors, the previous phase is over — `status: done` or all its cards "done" — and no card of this phase has been launched yet (all "queued" or "paused").
It does not check the first phase: the roadmap checker checked it. "Selected" and "run anyway" are a human's decision, there is no check.
Who: the same `claude -p` as for the roadmap. The task is the section «## Проверка фазы» in `review-roadmap.md` (the heading is Russian in the translation too: the program finds the section by it); if your own copy lacks this section, the built-in one is taken.
What it checks:
- there are no drafts (`draft: да`) in the phase: the wave would skip them silently;
- every card has "How to check", and it measures the card's goal;
- the human's edits from the previous phase's acceptance reached the cards: the main session writes them in "Now" as the line «Правки приёмки для fN: …»;
- the phase criteria cover the cards and vice versa, the last card is a review;
- the cards do not rely on what the previous phase did not do.

The order is the same as for the roadmap, only the tab is the main session's and the command is `wave`:
- while a round runs, `wave` answers with code 4 and the text «проверка фазы идёт» (the phase check is running) — no wave;
- the round result is the line «[Роадмап] Проверка фазы fN, круг K из 2: …» in the main session tab. If a line with remarks or about a failure did not get through, the next `wave` returns it as the answer;
- serious remarks — the main session fixes the cards and calls `wave` again: the second round;
- clean, the second round is over, or the check did not happen — the next `wave` launches the wave. What is left after the second round the main session shows the human before launching.
The review of every round is `.kermach\grades\phase-fN-K.md`. The program remembers the round: reopening the window does not restart the check.

## Phase — `f<N>.md`

Phases go in number order: `f1`, `f2`, …

| Key | What it is | Values |
|---|---|---|
| `id` | number, matches the file name | `f1` |
| `status` | status | `planned`, `running`, `done` |
| `health` | health | `green`, `yellow`, `red` or empty |
| `health_why` | one line, why this health | text |
| `health_by` | who set it | `human`, `codex` |
| `health_at` | when | `2026-10-11 14:02` |

`id` and `status` are required.
Body: `# …` — the phase name. The label `Goal:` — the goal of the phase.
The label `Done criteria:` — a list below it, one criterion per line: `- [ ] …` not ticked, `- [x] …` ticked.
A `- [ ]` line inside a code block ```…``` is an example, not a criterion: the window does not show it and a click does not change it.
A phase is done when all criteria are ticked, not when the cards have run out.
If there is a sample (markup, mockup, design, old site), the first phase and every later phase that changes pages have the criterion "the phase's pages match the sample over the whole page: every section is there or removed by the human's answer" (t1434). The comparison is not postponed to the last phase and not limited to the first screen.

```
---
id: f1
status: running
health: green
health_why: the check is green, closed cards without returns
health_by: human
health_at: 2026-10-11 14:02
---
# Cart
Goal: the buyer puts together an order and sees a fair price with delivery before paying.
Done criteria:
- [x] The city is chosen and saved in the cart
- [ ] Delivery is recalculated when the city changes
```

## Passport — `passport.md`

The constant part about the project, one for all cards. The header holds the board language (`lang: en`, section "Board language") and, if you want, the card agent start settings (t1322):

```
---
lang: en
card_mcp: никаких
card_skills: нет
---
```

| Key | Value | What it does |
|---|---|---|
| `card_mcp` | `все` · `никаких` · names separated by commas: `playwright, context7` | MCP servers of the card agent. `никаких` — the claude flag `--strict-mcp-config`. A list — only these servers: the program writes their file itself from the Claude settings (`.claude.json` and the project's `.mcp.json`) and passes it to `--mcp-config`; the file is deleted when the agent's tab has exited. Servers from Claude plugins and claude.ai connectors cannot be found from the list — a card with them will not start: use `все` for them. |
| `card_skills` | `да` · `нет` | `нет` — skills and "/" commands are off: the claude flag `--disable-slash-commands`. |
| `card_check` | `да` · `нет` | Card checker (t1330). `да` — a card closed by the agent from "Run" is checked by a separate `claude -p` (sonnet, low, read-only): it sees "What to do", "How to check" and the changes since the start of the card, it does not see the agent's conversation. The result is the line `checked:` in the card. "Needs more work" — the remarks go to the agent's tab, the card is "in progress" again, no more than 3 rounds, after the third — "awaiting answer". "Criteria do not fit" — "awaiting answer". Cards of kind `review` and `research` without a command in "How to check" are not checked. |

The values of these three keys are Russian, as in the table: that is how the program reads them.
No key — `все` and `да`, as before t1322 (for `card_check` — `да`: the check is on). A wrong value has no effect, the window and the "Roadmap" log warn about it.
Subagents are always forbidden to the card agent, there is no setting for them: claude starts with `--disallowedTools=Agent`.
The flags exist only in claude; for codex and other agents the setting has no effect, the log writes a line about it.
The body is nine sections, each with a `## ` heading. The sections hold links to the project's files, not a retelling.
An empty section is a heading without text; the program shows it as "empty".

| Section heading | Key in the program |
|---|---|
| `## Transport and server` | `transport` |
| `## Project tools` | `tools` |
| `## Check command and expected result` | `check` |
| `## Cache after an edit` | `cache` |
| `## Connection loss` | `disconnect` |
| `## Samples and canon` | `samples` |
| `## Do not touch` | `keep` |
| `## Required besides a green check` | `required` |
| `## Log` | `journal` |

A number before the name is allowed: `## 3. Check command and expected result`. So is a colon at the end: `## Log:`. Letter case does not matter. The program reads the Russian headings (`## Транспорт и сервер`) too.
Lines inside a code block ```…``` are section text: `## …` and `# …` there are not headings. An unclosed ``` does not count as a block.
A lone ``` pairs with the nearest ``` below, as in Markdown, and the sections between them become block text. The window warns about such a section, and "Save" does not write it until the block in the file is closed.
A section with its own heading is kept as is.

## Decision, dead end, agreement or pattern — `d<N>.md`

| Key | What it is | Values |
|---|---|---|
| `id` | number, matches the file name | `d3` |
| `type` | kind of entry | `decision`, `dead end`, `agreement` — an agreement with a human or a working rule for all cards (what to edit files with, how to launch), approved by a human; `pattern` — one rule, a generalisation of 3+ entries about one cause; `note` — a side finding that does not get in the way now (t1046): not given to agents, does not go into patterns, a human creates a card from it |
| `card` | the card where it was found | `t12` or empty |
| `files` | which files it concerns | a list `[src/cart/delivery.ts]` |
| `date` | when | `2026-10-12` |
| `agent` | who wrote it | `codex`, `human` |
| `how` | how reliable | `verified` — confirmed by a run, `guess` — not; or empty |
| `until` | shelf life: the last day the entry is valid | `2026-12-31` or empty — no limit |
| `repeats` | cards where the same cause was found again | a list `[t40, t55]` or empty |
| `cancelled` | cancellation date: the entry is no longer valid but stays in the history | `2026-10-15` or empty |
| `differs` | entries this one is not alike: a human pressed "not alike" next to the mark "similar to dN", the window no longer marks this pair | a list `[d32]` or empty |
| `wrong` | cards whose agent marked the entry "wrong" | a list `[t901]` or empty; for each, a line `Неверно (t901): why` in the text (the word `Неверно` is Russian), without it the mark has no effect (a board remark) |
| `stack` | whose code is to blame: theme, plugin, library | a list `[woocommerce, woodmart@8.1]` or empty: the name in lower case (a-z, digits, `.` `-` `_` `/`, `@scope/` at the start), a version after `@` optional |
| `from` | for a pattern: which entries it is built from | a list `[d77, d97, d136]` |
| `approved` | for a pattern: the day a human approved it | `2026-10-16` or empty — waits for approval |
| `pattern` | a human said "not a pattern": the entry is no longer offered to make a pattern | `нет` (in Russian) or empty |
| `for` | for an agreement: whom it is for (t1433) | `agent` — a working rule for the card agent; `program` — for the program and the orchestrator (which model to launch, how to keep the board): not given to the card agent; empty — to the agent |

`id` and `type` are required. An empty value is the same as no key: entries without the new keys read as before.
A wrong value is a file error, as for a card: `how` not from the list, `until` or `cancelled` not a real date `YYYY-MM-DD`, in `repeats` and `wrong` not `t<number>`, in `differs` and `from` not `d<number>`, `approved` not a date, `pattern` not `нет`, `for` neither `agent` nor `program`.
The program does not give the card agent an entry with `cancelled`, an entry `type: note`, an agreement with `for: program`, or an entry whose `until` is before today; `until` set to today is still valid.
A note is a finding for a human: it waits in the Inbox of the "Roadmap" window, a human creates a card from it; it does not go into the card prompt or into `kermach roadmap notes`.
An entry with `wrong` (and the line «Неверно (tN): …») is not given to agents either until a human looks at it: the list is `kermach roadmap notes --wrong`. If the entry is right, the human clears `wrong`, the «Неверно…» line stays as history; if wrong, they set `cancelled` (t836).
When a human looked and decided the entry is right, the line «Неверно (tN): …» becomes «Проверено человеком (YYYY-MM-DD): верна, отзыв tN снят» (the program writes it so, in Russian), tN leaves `wrong`, and the entry is given again. A merge moves the duplicate's `wrong` into the old entry together with its «Неверно» lines.
When closing a card, the agent writes `used:` into its header — only the entries that helped, and how (t1433): `помогла: d12 — found the same cause of the hang; помогла: d40 — took the ready probe command`. Parts are separated by `;`; everything after the dash is an explanation, numbers in it do not count as feedback. "How" is at least two words of three letters or more, apart from numbers and the words «помогла», «пригодилась»: `kermach roadmap close` refuses without it with code 1 and writes what is needed. The agent does not list entries that did not help; none helped — no `used`.
Old cards with `d12 помогла, d40 не пригодилась, d77 неверна, d81 не открывал` read as before, without a remark: the strict check is only on close. An entry turned out wrong — that is the mark `wrong` in the entry header, not feedback.
Card prompt, part 5 "Notes for the task" (before t1433 entries went in two parts: 5 "Fresh" — decisions and dead ends by date, and 6). In order: agreements for the agent — to every card, in full text, without selection by files and date; approved patterns; up to 5 decisions and dead ends by the card's words and files; cards of this phase and of the Inbox closed after the card, by the same files — as lines. There is no selection of decisions by date any more: a fresh entry about another part of the program does not help the agent (ЗАМЕЧАНИЯ-роадмапа.md, section З).
Decisions and dead ends — up to 6 of all valid ones by the card's words and files: first a match with the error text in the card, then words in the entry title, then words of its text, then shared files; a guess is below a verified one, an entry with `repeats` is higher. If there are more entries, the last line is «Показано 5 записей из M»: the agent searches the board folder for the rest itself. So the error text and exact words in the card and in the entry title help to find it later.
The same selection by error text, not by card, is the command `kermach roadmap notes "error text"`: the agent calls it when an error shows up during work. So the entry holds the verbatim error text or the symptom as seen before the analysis, not only the cause.
Body: `# …` — the topic. Below — the gist in free text: cause → what was done (for a dead end — what was tried and why it did not work).
A decision and a dead end have a line `Текст ошибки:` (the label is Russian: the program looks for the symptom by it): verbatim, as the symptom is seen before the analysis (a message, a log line, what is on screen). There was no error — `Текст ошибки: —`. A new entry without text gets this line with `—`: the agent replaces the dash.
The error showed up again with the same cause — no new entry: the agent appends its card to `repeats` of the old one, and the symptom of the repeat as one more line `Текст ошибки: … (t<number>)` right under `# …`. Under the title, not at the end: in the selection the agent sees the first 400 characters of the text. The notes command reads the whole text, the place of the line does not matter to it; `repeats` lifts the entry above equal matches (t933).
If the cause is in someone else's code — `stack` in the header, at the end of the body the section `## Переносимый вывод` (the heading is Russian: the program finds the section by it): what will be needed in another project with the same stack, without addresses, server paths, client names and keys. The section runs to the next `#`/`##` or the end of the file; it is not part of the entry text for selection and similarity. A `stack` with a capital letter, a space or Cyrillic is a file error. A merge ("merge") appends the duplicate's section to the old entry's section, and the `stack` names the old one lacks — to its `stack`.
The shared base for all projects (t844) is the folder `known\` in the plugin data folder (`%APPDATA%\Kermach\plugins-data\roadmap\known\`). The prompt assembly itself copies there a decision or dead end with `how: verified`, `stack` and the section «Переносимый вывод» — as a file `s<N>.md`: title, `type`, `stack`, the first line `Текст ошибки:` and the section. The lines "<title> (dN):" after a merge are not copied. The entry text, `files`, `card` and the project name do not go into the base; where the entry came from is in `known\state.json`.
Not copied: a guess, a cancelled and an expired entry, one marked "wrong", «Правило работы: …», an entry without `stack` or the section. A section with a site address, IP, e-mail, a path with a user name, a path or name of the project folder, something like a key — neither: the entry stays in the project with a mark of the reason, nothing is cut out. `s<N>.md` may be edited by hand: the program no longer overwrites it; deleted — it does not bring it back. A file with git conflict markers is not given to the agent.
Part 6 after your own entries — up to 3 base entries from other projects: `stack` overlaps the line `Стек: name, name` in the "Project tools" section of the passport (the word `Стек:` is Russian, the program looks for it so) or the `stack` of your own entries (versions do not matter), or the entry's `Текст ошибки:` is in the card text. The base summary is `known\known.md`, one line per entry.
A pattern goes into the base the same way — `s<N>.md` with `type: pattern`, but only approved by a human (`approved:` and a fingerprint in approved.json), it needs no `how`. If it is edited after approval, the copy is removed from the base until a new approval. In another project a pattern is given only by `stack`, not by error text, and first among the base entries. The section «Переносимый вывод» is not given to your own agent — neither in part 5 of the prompt nor in `kermach roadmap notes` (t992): the entry text carries the same cause and fix in this project's words, more precisely than the generalisation, and the section would eat part of the 400 characters the entry gets in the selection. The section is for other projects; the agent sees it when it opens `d<N>.md`.

```
---
id: d3
type: decision
card: t12
files: [src/cart/delivery.ts]
date: 2026-10-12
agent: codex
how: verified
---
# Delivery zone
Текст ошибки: Delivery zone is undefined
The zone is taken from the city in the cart, not from the profile: the profile may be empty.
```

An agreement with a human that was later cancelled:
```
---
id: d7
type: agreement
card:
files: []
date: 2026-10-01
agent: human
until: 2026-12-31
cancelled: 2026-10-15
---
# Do not touch prices until the end of the sale
Human 01.10: do not change prices in the catalogue while the sale is on. 15.10 the sale ended — cancelled.
```

A working rule is an agreement too. The agent creates it as a `decision` titled «Правило работы: …» (these words are Russian: by them the window offers the button "make it an agreement") and offers it to the human; the human changes the type:

```
---
id: d8
type: agreement
card: t9
files: []
date: 2026-10-08
agent: human
---
# Правило работы: edit files with `\` via Edit, not via heredoc and not `node -e`
A heredoc in Git Bash and a `node -e` string spoil the backslash: the path `D:\app` arrives as `D:app`, `\n` in a JS string becomes a line break.
```

A dead end in someone else's code:
```
---
id: d9
type: dead end
card: t14
files: [src/cart/hooks.php]
date: 2026-10-16
agent: claude
how: verified
stack: [woocommerce, woodmart@8.1]
---
# The cart hook does not fire in the theme
Текст ошибки: woocommerce_before_cart не вызван
Cause: woodmart replaces the cart template with its own and does not call the hook. Tried the hook in functions.php — the theme does not call it.

## Переносимый вывод
In woodmart 8.x the cart template is its own: the WooCommerce before-cart hook is not called in it — check the theme template before hanging code on this hook.
```

Pattern (t845). The program spots a candidate: an entry that 2+ other entries are similar to (the mark "similar to dN" or `repeats`), or 3+ entries with the same `Текст ошибки:`. The agent writes the pattern text from the card "Make a pattern": one entry `type: pattern`, `from` — the entry numbers, the title — the rule in one line, the body — `Правило:`, `Почему:`, `Когда не так:` (labels in Russian), no more than 400 characters in all. The agent does not set `approved`: a human approves with a button, the program remembers the sha1 of the approved text in its data folder. The project path is not part of the approval (t1018): renaming the folder does not remove it, and the same pattern text in another project is approved there at once. Editing the text after approval — the pattern waits for the human again. A `from` with the number of an entry that does not exist is a board remark.
The fingerprint is computed from the title, the text, «Переносимый вывод» and `from`, without the header: the button itself writes `approved:` into the header. So editing `files`, `stack`, `card`, `how` does not remove the approval — the rule does not change from them.
In the window, tab "Decisions, dead ends, agreements", filter "patterns" (t1005): a candidate has "looks like a pattern: d77 and 5 more" and the buttons "make a pattern" (the card «Make a pattern from d77, …» in the Inbox) and "not a pattern" (`pattern: нет` in the header of d77); a pattern has "waits for approval" and the button "approve". A pattern neither gets nor gives the mark "similar to dN": "merge" would delete the pattern or append text to it. "Merge" (t1014): a pattern merges only with a pattern, `from` of the old one — both lists together. If an entry with `from` was merged with another, in the patterns' `from` its number is replaced with the old one's number. `from` changed — the approval is removed, the pattern waits for the human again.

```
---
id: d240
type: pattern
card: t250
files: []
date: 2026-10-16
agent: claude
how: verified
from: [d77, d97, d136]
approved:
---
# A hidden Electron window returns the last drawn frame
Правило: in a hidden window a screenshot, a click and a mouse move see an old frame — call webContents.invalidate() before them and wait for a frame.
Почему: a hidden window does not redraw by itself.
Когда не так: the window is on screen.
```

## Board language — `lang:` in the passport (t1429)

Statuses, kinds, field labels and passport sections may be written in one of four languages: `ru`, `uk`, `en`, `de`.
The board language is the line `lang:` in the header of `passport.md`. For this board:

```
---
lang: en
---
```

No line, no passport, or an unknown value — the board is Russian. That is how all boards created before t1429 work.
"Compose a roadmap" sets `lang:` by the Kermach window language when the agent creates the passport; Russian needs no line.

How the program reads:
- header values (`status`, `kind`, `human`, for a phase `status` and `health`, for an entry `type` and `how`) — in any of the four languages. If the agent wrote `status: готово` on an English board, the card is "done" all the same;
- card and phase field labels (`What to do:`) and passport section headings — in Russian and in the board language. A label of another language is ordinary text: the line «Зачем: …» in an English card does not become the field "Why";
- case, "ё" and the kind of apostrophe (`'`, `’`, `ʼ`) do not matter.

How the program writes: new header values and new labels — in the board language. Labels already in the file it does not change.

To change the language — "Board language" in the passport window. The program rewrites the format words in all board files.
Before writing — a backup: all board files are copied to `.kermach\roadmap-backup-YYYYMMDD-HHMMSS\`, next to the board folder.
If even one file would read differently in the new language, the language does not change at all and no file is touched: for example, a text line starts with a word that is a field label in the new language. A file with a parse error and a file edited during the change are not touched, the window names them.

Words by language:

| ru | uk | en | de |
|---|---|---|---|
| `в очереди` | `в черзі` | `queued` | `in Warteschlange` |
| `в работе` | `в роботі` | `in progress` | `in Arbeit` |
| `ждёт ответа` | `чекає відповіді` | `awaiting answer` | `wartet auf Antwort` |
| `на проверке` | `на перевірці` | `checking` | `in Prüfung` |
| `на ревью` | `на рев'ю` | `in review` | `im Review` |
| `пауза` | `пауза` | `paused` | `pausiert` |
| `готово` (card) | `готово` | `done` | `fertig` |
| `запланирована` | `запланована` | `planned` | `geplant` |
| `идёт` | `триває` | `running` | `läuft` |
| `готова` (phase) | `готова` | `done` | `fertig` |
| `зелёный` | `зелений` | `green` | `grün` |
| `жёлтый` | `жовтий` | `yellow` | `gelb` |
| `красный` | `червоний` | `red` | `rot` |
| `без человека` | `без людини` | `no human` | `ohne Mensch` |
| `нужен человек` | `потрібна людина` | `human needed` | `Mensch nötig` |
| `сделать` | `зробити` | `do` | `umsetzen` |
| `ревью` | `рев'ю` | `review` | `Review` |
| `разведка` | `розвідка` | `research` | `Recherche` |
| `решение` | `рішення` | `decision` | `Entscheidung` |
| `тупик` | `глухий кут` | `dead end` | `Sackgasse` |
| `договорённость` | `домовленість` | `agreement` | `Vereinbarung` |
| `паттерн` | `патерн` | `pattern` | `Muster` |
| `заметка` | `нотатка` | `note` | `Notiz` |
| `проверено` | `перевірено` | `verified` | `geprüft` |
| `догадка` | `здогадка` | `guess` | `Vermutung` |
| `агент` | `агент` | `agent` | `Agent` |
| `программа` | `програма` | `program` | `Programm` |
| `Что сделать` | `Що зробити` | `What to do` | `Was tun` |
| `Зачем` | `Навіщо` | `Why` | `Wozu` |
| `Файлы` | `Файли` | `Files` | `Dateien` |
| `Как проверить` | `Як перевірити` | `How to check` | `Wie prüfen` |
| `Особые указания` | `Особливі вказівки` | `Special notes` | `Besondere Hinweise` |
| `Что сделано` | `Що зроблено` | `What was done` | `Was erledigt wurde` |
| `Доказательство` | `Доказ` | `Proof` | `Nachweis` |
| `Цель` | `Мета` | `Goal` | `Ziel` |
| `Признаки готовности` | `Ознаки готовності` | `Done criteria` | `Fertig-Kriterien` |
| `Транспорт и сервер` | `Транспорт і сервер` | `Transport and server` | `Transport und Server` |
| `Инструменты проекта` | `Інструменти проєкту` | `Project tools` | `Projektwerkzeuge` |
| `Команда проверки и ожидаемый итог` | `Команда перевірки й очікуваний підсумок` | `Check command and expected result` | `Prüfbefehl und erwartetes Ergebnis` |
| `Кэш после правки` | `Кеш після правки` | `Cache after an edit` | `Cache nach einer Änderung` |
| `Обрыв соединения` | `Обрив з'єднання` | `Connection loss` | `Verbindungsabbruch` |
| `Где образцы и канон` | `Де зразки й канон` | `Samples and canon` | `Muster und Kanon` |
| `Что не трогать` | `Що не чіпати` | `Do not touch` | `Nicht anfassen` |
| `Что ещё обязано быть, кроме зелёной проверки` | `Що ще має бути, крім зеленої перевірки` | `Required besides a green check` | `Pflicht außer grüner Prüfung` |
| `Журнал` | `Журнал` | `Log` | `Protokoll` |

Also read: `queue`, `todo`, `to do` — "queued"; `in work`, `working` — "in progress"; `waiting`, `wartet` — "awaiting answer"; `reviewing` — "in review"; `pause` — "paused".
Inside the program the values stay Russian words: the window shows them in the interface language, `kermach` commands and probes compare Russian words.
Task templates name a board word with the placeholder `{доска:<Russian word>}`, for example `{доска:готово}` — on an English board it is `done`.

## Counter — `counter.json`

```
{ "t": 18, "d": 3 }
```

`t` is the last card number issued, `d` the last entry number.
The number is shared across the project and is given as soon as the card appears, including in the Inbox. It does not change when the card is moved into a phase.

A new card or entry — with a command in the Kermach terminal: `kermach roadmap new t "Title"` or `kermach roadmap new d "Gist" --card t12`. The program issues the number: two agents together will not take the same number.
Card fields are flags: `--text` — "What to do", `--why` — "Why", `--files` — "Files", `--check` — "How to check" (t1439). Write the check in `--check`, not in `--text`: otherwise "How to check" stays empty and the roadmap check will not let the wave launch. A card in a phase without `--check` is a remark in the command output.

A new card by hand:
1. Find the largest number — in `counter.json` and among the `t<N>.md` files.
2. The new number is one larger. Write it to `counter.json`.
3. Create the file `t<number>.md`, with `id` of the same number in the header.

The number of a deleted card is not issued again. No counter — the program computes it from the files.
