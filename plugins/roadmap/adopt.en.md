# The task "Use an existing plan" (in English)

Translation of `adopt.md` (t1602). This is the first message of the tab in which a ready plan of the project is moved onto the board rather than composed anew, when the window language is English (the panel buttons are t1603).
The file is read anew on every click: an edit shows up in the next task without restarting the program.

Where to edit. This file next to the plugin code is the built-in text: a program update overwrites it.
Edit the copy in the plugin data folder: `%APPDATA%\Kermach\plugins-data\roadmap\adopt.en.md`.
If the copy exists, the program takes it. If not, it takes this built-in text. A program update does not touch the copy.

How it works:
- the text before the first `## ` heading is an explanation for a human and does not go into the task;
- the agent gets the section `## Задание`, without the heading line itself;
- `{выбор}` is step 0: the section `## Файл выбран` if the human chose a file, otherwise the section `## Файла нет`. The headings of these sections are not translated: the program looks for them by these words;
- `{состав:…}` is a piece of the task `compose.en.md`: `как` — the tab rules, `1`, `2`, `3`, `6` — whole steps, `5.2-поля` — the list of card fields from item 5.2, `5.3`, `5.4` — items of step 5. The common steps are edited in `compose.en.md` and come here by themselves;
- the substitutions are the same as in `compose.en.md`, plus `{файл}` — the chosen plan file.

## Задание
The task "Use an existing plan": move the ready plan of this project onto the board without composing it anew. The project folder is {проект}.

A roadmap is a board of text files in the folder {папка}: the project passport, phases and cards. The program Kermach shows it in the "Roadmap" panel and launches the cards to agents.
How the board files are arranged is in the description {формат}. Read it in full before proposing anything. Samples of all file kinds are in the folder {образцы}.

The plan is already decided: you do not improve it and do not compose a new one. The work goes like this. Step 0 — you find the plan. Steps 1–3 — you study the project and write the overview, the file {проект}\.kermach\обзор.md. Step 4 — you compare the plan with the project. Step 5 — you move the plan onto the board. Step 6 — the roles in CLAUDE.md.
The overview is needed later too: the passport, the cards and the agents who will do the cards rely on it. A shallow overview means bad cards: they will have guesses instead of facts.

{состав:как}

{выбор}

{состав:1}

{состав:2}

{состав:3}

### Step 4. Comparing the plan with the project
Add two sections to the overview. `## Plan source` — where the plan comes from (a file or a tab), its date and why this one. `## Done by the plan` — what of the plan is already done and what confirms it.
Then write in this tab, in five to seven lines, what is the main thing in the overview, and show three lists. There are no other lists or questions.
1. What in the plan is already done: the plan item and what confirms it (file:line). If you could not confirm it from the files, ask whether it is done.
2. What in the plan disagrees with the project files: both versions with sources, "in the plan: …", "in the files: …". I decide, you do not choose.
3. What the board lacks and is neither in the plan nor in the overview: the check command and its result, what not to touch, how many agents can work at once without hitting the subscription limit (a junior subscription — 1–2, a regular one — 3, a big one — up to 8; do not invent tariff names), the open questions of the plan itself.
An open question of the plan is only what the plan itself calls undecided. Work details the plan is silent about (a file format, names, how a command is built) are not questions: the card agent will decide them.
Questions are only about these three lists. What is decided in the plan is not discussed again: which phases, in what order, what they are called, what is more important. If a list is empty, write "none".
A question about a decision comes with options: first the one you recommend and why in one phrase. A question about a fact has no recommended answer, the options are "I know: …" and "I don't know". Explain every term in the same phrase.
Add the answers to the overview with a date and the source "human's answer". A fact answered "I don't know" stays in "Not found out". An open question of the plan that I did not decide becomes a research card in step 5.

### Step 5. Moving the plan onto the board
We compose the board in parts: first the passport and all phases, then the cards, one phase at a time. Each part goes into files right after my "yes".
Why so: the work is long, and along the way the tab compresses its context, so the details of the conversation get lost. What already lies in files does not get lost.
Rely on the plan and the overview, not on general knowledge of such projects. Names, headers, sections and the counter of file numbers — strictly by {формат}.

Do not change or delete the plan file.
Add only what is not in the plan. In what you show me, every line has a mark: "from the plan" or "added by me". In the board files mark only what you added: "(added by me)" at the end of a phase goal or criterion; for a card, the line "Added by me: <which fields>" in "Special notes" and `source: from the plan` in the header. For a card the plan does not have: `source: added by me` and "Added by me: the whole card".
Expand abbreviations and numbers from the plan (for example, "question 79") with words from the file where they are described: a card agent does not see that file and will not understand the number. Keep a number only like this: "words saying what the question is (question 79)" or "question 79: words saying what the question is". The same goes for a number from the overview and for "open question of the plan No. 3", in the title and the text of a card, in a card and in a record. Otherwise remove the number: in the sentence "the answer to question 60" it explains nothing, however many words stand next to it. If you did not find what it means, ask me.

5.1. Passport and phases.
   Show as text in this tab a table "in the plan → on the board", the passport and all phases, without cards.
   Each stage of the plan is one phase: the name word for word as in the plan, and the same order. Do not merge stages, do not reorder them and do not add new ones without my "yes". The rule "from two to five phases" does not apply here: there are as many phases as in the plan.
   Take the phase goal and done criteria from what the plan promises at this stage. What is missing, add and mark. From two to five criteria, each checked by an external fact: a command, a page, a file. Do not set health for phases.
   The passport is nine sections by {формат}. The section "Check command and expected result" — from the section "Check" of the overview: the command, the result and what to do if a run is already going. No command — say so, the first card of the first phase creates it. The first line of the section "Project tools" is `Стек: name, name` (the word `Стек:` exactly so, in Russian), in lowercase Latin letters. In the passport refer to the overview and the project files, do not retell them.
   Wait for my "yes". After "yes" create in {папка}: passport.md, f<N>.md for each phase, counter.json. Phases get `status: planned`, the first one — `running`. Create every agreement in force from the overview as a record d<N>.md with `type: agreement`.

5.2. Cards — one phase at a time, in the order of phases. Show the cards of a phase, wait for "yes" or edits, after "yes" create them as files t<N>.md and take the next phase.
   If the plan has tasks, each task becomes a card, a full one, in the same order and in the same words. Add only the missing fields. Splitting or merging tasks only after my "yes".
   If the plan has no tasks, only stages, every phase gets drafts (section "Card draft" in {формат}): `draft: да` in the header (the word `да` in Russian: the program reads it), the title, "What to do", "Why", "Files"; "How to check" — a dash. Drafts in the first phase too: you write full cards only at my word, one phase at a time. Do not offer them or start them yourself. In the summary of 5.4 say that a wave does not launch drafts and that the first phase needs my word. On such a board step 6 does not promise a start of the first phase: the main session writes full cards at my word and only then starts the phase.
   What in the plan concerns people, access and decisions becomes cards `human: human needed`, in the phase that needs them (with a plan without tasks, drafts too). What exactly is needed from the human goes to "Special notes", step by step. Such a card has `source: from the plan`, even if you added the steps for the human: the line "Added by me: …" marks what you added. Phases depend on them: the cards of that phase that need this before the start have such cards in `depends`.
   Each such item is a card of its own, in a separate section of the plan too. Merging items only after my "yes". Before 5.3 go through these sections of the plan line by line and name any item that has no card. If you create a card for it, add it to the `depends` of that phase's review.
   Open questions of the plan that I did not decide in step 4 become cards `kind: research`. What is already done by the plan goes only to the overview, it gets no cards.
   An order from the plan ("5 and 6 in parallel, 7 after them") becomes `depends` links between cards of the phases: phase numbers go in a row, and a phase has no separate dependency field. The first card of the first phase depends on nothing except "human needed" cards.
   Card fields:
{состав:5.2-поля}
   The last card of every phase is a review (section "Phase review card" in {формат}): `kind: review`, `depends` — all the other cards of the phase, "How to check" — every done criterion of the phase: yes or no and what proves it. "Files" of a full review is what it reads, with the words "read only"; the board check counts a dash as an error. In a draft phase the review is a draft too, "How to check" — a dash.
   Every card, full or draft, also has an agent, a model, an effort and an advisor — by the selection rule from the section "Card" of the description, and the reason in one line (the keys `agent`, `model`, `effort`, `advisor`, `agent_why`). All cards are `status: queued`.
   Before showing the cards of a phase, check them yourself: no card without a link to a done criterion, no criterion without a card, the last card is a review, no agreement from the overview that a card breaks, no number from the plan without words next to it.

{состав:5.3}
   A plan without tasks: the "Inbox" cards are drafts too, `draft: да`, "How to check" — a dash.
   Expand numbers from the plan and the overview here too, in the card title and text: not "question 99", but what that question is, from the file where it is described. Before showing, check this in every "Inbox" card.
   A plan item about people, access and decisions has `source: from the plan`, sits in the phase that needs it, and that phase's cards wait for it in `depends`. It goes to the "Inbox" only if no phase needs it, also with `source: from the plan`. Name such an item to me on a separate line: "No phase needs it: tN — why".

{состав:5.4}
   Before the summary search (Grep) the board folder for the words "question", "вопрос", "питання" and the signs "No." and "№" with a number next to them. Every such place must say in words what the question is about. Not allowed: "the human answers question 95", "Why: open question 1 of the plan", "the human's answer (question 94)". Rewrite it from the file where the question is described, or remove the number.
   Before the summary run the command `kermach roadmap check` in the project folder. It checks the board without AI. If it finds errors, fix them and run it again. If the command did not run, say so in the summary.
   Begin the message with this summary with a separate line, word for word: "The board is now the main thing. The plan file stayed as it was and is no longer kept up."

{состав:6}

## Файл выбран
### Step 0. The plan is the chosen file
I chose the plan file: {файл}
There is no need to search for the plan: start with this file and read it. Read a big file in parts, as said above.
See what it says about other plans and about itself: "replaces", "stays a record of what was done", "outdated", "replaced by …", in any language.
- If the file itself is replaced by another one, warn me: what replaces it and on which line that is. Ask whether to take the chosen file and end the message with the line "Now: step 0 of 6, needed from you: …". Without an answer do not go further.
- If it is not replaced, ask nothing and go to step 1. What it says about other plans, you will write into the overview in step 4.

## Файла нет
### Step 0. Find the plan
The plan lies in a file or in a conversation of another tab. Search in this order and do not skip: a file name often deceives, an old PLAN.md may lie next to a new plan under another name.
1. Logs and indexes of the project: SESSION-now.md, ИНДЕКС.md, ІНДЕКС.md, CLAUDE.md. They often name the plan in force directly.
2. File names: roadmap*, роадмап*, plan*, план*, фаз*, этап*, етап*, phase*, ignoring case, across the whole project folder, not only the root. Do not walk big folders (node_modules, .git, builds, archives, database dumps).
3. Headings inside .md and .txt files: "Фаза N", "Этап N", "Етап N", "Phase N". Do not walk the same big folders.
4. Tabs of this project: `kermach sessions` shows tabs of all projects, take only those where the project is this folder. Read a conversation log in parts, first by searching for the words "phase", "stage", "plan", not in full.

For what you found, read the beginning and what it says about other plans: "replaces", "stays a record of what was done", "outdated". This shows which plan is in force.
Show what you found as a list: a file or a tab, the date, how many stages it has. Then your choice and the reason, for example: "Is this the one? It replaces PLAN.md, its beginning says so". End the turn with this question.
- If there are several plans or they disagree, show them all, I choose. Do not merge them yourself.
- If you found nothing, ask me to name a file, name a tab or paste the plan text into the chat. If I paste the text, write it into the overview and treat "text from the chat" as the source, do not create other files for it.
End the message with the line "Now: step 0 of 6, needed from you: …". Until I confirm the plan, do not go to step 1.
