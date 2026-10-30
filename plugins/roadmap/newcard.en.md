# Task "New card" (English)

Translation of `newcard.md` (t1428). This is the first message of the Claude tab opened by the "New card" button on the "Roadmap" panel when the board already exists and is in English (`lang: en` in the passport).
The file is read again on every click: an edit appears in the next task without restarting the program.

Where to edit. This file next to the plugin code is the built-in text: a program update overwrites it.
Edit the copy in the plugin data folder: `%APPDATA%\Kermach\plugins-data\roadmap\newcard.en.md`.
If the copy exists, the program uses it. If not, it uses this built-in text. A program update does not touch the copy.

How it works:
- text before the first `## ` heading is an explanation for a human; it does not go into the task;
- everything after the line of the first `## ` heading goes to the agent, the heading line itself does not; the heading is the same as in `newcard.md`;
- placeholders: `{проект}` — project folder, `{папка}` — board folder, `{формат}` — the file FORMAT.en.md describing the board, `{язык}` — board language.

The agent first asks what needs doing, then studies the project on that topic, and only after "yes" creates the card.
A card resting on guesses gets done by agents on guesses. So every fact in the card has a source.

## Задание
Help create one new card on this project's roadmap board. The project folder is {проект}.
The board is text files in the folder {папка}: passport, phases and cards. How the files work — the description {формат}. Read the "Card" section before writing the card.

Study the project yourself, do not start subagents: neither background nor regular ones. This task overrides the general "big work goes to a subagent" rule in your instructions. Why: the notice that a background subagent finished often does not reach this tab, and it sits idle for hours.
Do not end a turn with "waiting", "I'll continue when…", "I'll wait for the report": nobody will wake you up after that. A turn ends either with a question to me or with a finished step.
Write to me in this language: {язык} — both the questions and the card text.

The work goes like this.
1. Ask me in one question what needs doing. Until the answer, read and do nothing.
2. After the answer, study the project on this topic:
   - the project overview `{проект}\.kermach\обзор.md`, if it exists — in full, to the last line;
   - the passport `passport.md` and all phases `f<N>.md` — goals and done criteria: you choose the phase by them;
   - all cards `t<N>.md`, done ones included — whether the same or a similar task exists; records `d<N>.md` on the topic and all agreements (`type: agreement`), except cancelled and expired ones;
   - project files on the topic: find where it is in the code or documents and read those places. The overview, passport or a card refers to a file — open it, do not judge by the name.
3. Propose the card as text, do not create the file yet:
   - title — what changes after the card, in plain words, without names from the code (title rule — the "Card" section in {формат});
   - phase — number and why; no phase fits or not sure — "Inbox";
   - kind: `do`, `review` or `research` (find out without changing anything);
   - what to do, why, files (paths, with lines where needed), special notes (what not to touch, rollback), if any;
   - how to check — one of three: a command and the expected result; without a command — what to compare with what (file:line, canon from the passport); only a human can check, or access the agent lacks is needed — say so;
   - whether a human is needed, which cards it depends on;
   - agent, model, effort and advisor — by the choice rule from the "Card" section of the description {формат}, and the reason in one line.
   Every fact in the card has a source: file and line. What you did not find — say so in the card, do not guess.
   A similar card already exists — name its number and title and say how the tasks differ. Propose: add to it or create a new one. First — the option you recommend, and why.
   At the end ask: no similar card — "Create it?"; there is one — "Add to tNN or create a new one?". A "yes" without a choice means your recommended option.
4. After my "yes" create the card with the command `kermach roadmap new t "Title"`, for a phase — with `--phase fN`. The command prints the number and creates the file. If it says "похоже на tNN" (looks like tNN) — open tNN and tell me whether it is the same task.
   Then complete the file per the board description: in the header `status: queued`, `kind`, `agent` (`claude`, unless I named another executor), `model`, `effort`, `advisor` (only `да` — in Russian, the program reads this word; otherwise no key), `agent_why`, `pick: человек` (only if I named the model or effort; the value stays in Russian, the program reads it), `depends`, `human`, `created` — the time from the `date` command, `source: written with a human`; in the body — the fields in the order of the description, "What was done: —" and "Proof: —".
   No kermach command (the terminal is not Kermach) — the number is the next after the largest in counter.json and among the files `t<N>.md`; write it into counter.json too. A card in "Inbox" is an empty `phase:` field, not the word "inbox".
   Asked for a fix — fix it and ask again. The "add to the similar one" option was chosen — add to it what you proposed, do not create a new one; at the end — its number and path.
5. At the end in one line: card number and file path. Change nothing else on the board or in the project.
