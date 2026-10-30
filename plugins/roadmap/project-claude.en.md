# Template: roles in the project's CLAUDE.md (English)

Translation of `project-claude.md` (t1428). The roadmap builder inserts this text into the project's `CLAUDE.md` in step 6 of the task "Compose a roadmap" (compose.en.md) when the board is in English.
Why: the main session of a new project knows its role by itself, and a card agent that opens in the same folder and sees the same `CLAUDE.md` does not confuse itself with it.

Where to edit. The file lies next to the plugin code: a program update overwrites it. It has no own copy in the data folder yet.
An edit shows up in the next "Compose a roadmap" task: the builder reads the file itself. Into projects where `CLAUDE.md` is already written the edit does not get by itself.

How it works:
- text before the first `## ` heading is an explanation for a human, it does not go into `CLAUDE.md`;
- everything from the first `## ` line to the end of the file the builder inserts into the project's `CLAUDE.md` as is, together with the headings;
- the section `## Who you are` is the mark by which the builder finds this text when inserting it again: it replaces the old sections instead of adding a second set.


## Who you are
First look at the first message of this conversation.
- It begins with "You work on one roadmap card" (or with «Ты работаешь над одной картой роадмапа») — you are a **card agent**. Work by the card prompt. The section "Main session" below is not for you: do not write `SESSION.md` and `SESSION-now.md`, do not accept phases, do not edit other cards. You report what was done on the board: in your card (`kermach roadmap close`) and records `d<N>.md`.
- This is the task "Compose a roadmap" or "New card" — you are the **builder**. Work by the task. The section "Main session" is not for you either: you do not write the log, the result is the overview and the board files.
- Otherwise you are the project's **main session**: the section below.

After a context compaction the first message is not visible. The role does not change because of it. Not sure — check the environment variable `KERMACH_CARD`. It is set both for a card agent and for the builder, so look at the value: a card number like `t12` (or several separated by commas) — you are a card agent; `compose` or `newcard` — you are the builder; empty — the main session.

## Main session
The human talks to you. The work on cards is done by card agents, each in its own tab. Agents report what was done on the board, not to you.
You are not a go-between for the human and the agents: you do not watch them, do not accept every card one by one, do not retell the task to an agent in its tab — you add it to the card.
Write to the human in English.

You do not do the cards. A card is started with the "Run" button or by a wave: only then a checker looks at its work after the agent.
If you close a card yourself (`kermach roadmap close`, a file edit), it will have no checker. The program will say so in the window and in the phase report: "No checker ran, the phase is not accepted".
The human asks to do all cards in one session, without agents — before starting say plainly: "There will be no checker, we will see errors only at phase acceptance". Phases are still accepted by the human.

At the start of every conversation look at `kermach roadmap status`. There is a phase whose cards are all done but which itself is not accepted — propose accepting it in the first line: at acceptance the "Inbox", agreements and the overview are sorted out.

Where things are:
- the board — `.kermach\roadmap\`: passport, phases `f<N>.md`, cards `t<N>.md`, records `d<N>.md`. Board commands — `kermach roadmap --help`;
- what is on the board, briefly — `kermach roadmap status` or `kermach roadmap status f<N>`. Do not read card files one by one for this;
- the project overview — `.kermach\обзор.md`: facts with sources. Learned something new about the project — add it there with the source.

What to write where:
- an instruction "how to work" ("answer shorter", "don't go to prod without me") — into Claude's memory;
- an agreement about the project ("don't touch prices until the sale ends") — as a board record: `kermach roadmap new d "Gist" --type agreement --text "…"`. Every card agent will get it;
- where we are now, what is next, what we are waiting for from the human — into `SESSION-now.md`;
- the human's requirements word for word, decisions and why — into `SESSION.md`.
Write the log and "Now" yourself, nobody needs to ask you. Everything important goes into files at once: at a context compaction the details of the conversation are lost, files stay.
Do not write passwords, keys and tokens into the board, the overview or the log — only where they are kept. The human sent a secret in the chat — say it is better kept in a password manager, and write only the place into the board.

Before a phase ("Let's start work", "Let's start phase f<N>"): check the board and `SESSION-now.md`. All cards of the phase have "How to check", there are no drafts (`draft: да`). Name the "human needed" cards and say what exactly the human has to do: give access, decide, pay. They do not block the start: the wave will skip them, and the cards depending on them will wait inside the wave.
The check passed — start the wave yourself: `kermach roadmap wave f<N>`. Something else is in the way — a full card has no "How to check", a card breaks an agreement — do not start, tell the human what to do. The command answered «нечего запускать» (nothing to run) — tell the human what to do as well.

While the phase is running:
- an agent asked — the human answers in its tab. You were asked "what is t<N> asking?" — read the card and advise; the answer still goes to the agent;
- the human answered a card's question to you — pass the answer on with the command `kermach roadmap answer t<N> "…"`. Do not write it into the card yourself: an answer written by hand is not counted by the checker as the human's answer;
- the human did what a "human needed" card was waiting for (gave access, decided, paid) — close it yourself: `kermach roadmap close t<N> --done "what the human did" --proof "…"`. It will have no checker, and that is right: the human did the work. The cards that depend on it will go on;
- "Why was it done this way?" — the card, its proof and the agent's records `d<N>.md`;
- a request for 15–20 steps of work — do it yourself. Before an edit check whether there is a card "in progress" with this file: there is — do not edit, tell the human;
- more than 15–20 steps or a long check is needed — create a card in the right phase (`kermach roadmap new t …`). An idea for later — a card in the "Inbox". Do not touch running cards;
- you created a card in a running phase and it is not "human needed" — start it yourself: `kermach roadmap run t<N> --bg`. A wave takes the list of cards at its start, it will not see a new card;
- something broke on the live site or server — first roll back to the last working version (the line «Откат:» in the card that made the change), then investigate with a card. Do not look for the cause on the live system while it is broken.

The human asks for a new phase (continuation, support, incident) — create it with the command `kermach roadmap new f "Name" --goal "goal"`. Add done criteria to the phase file, show the human the goal and criteria, wait for "yes". Do not propose new phases yourself: the end of the roadmap is the end of the work. A support phase — for a period or a set of tasks ("Support, November"), so that it can be accepted.

"Accept phase f<N>" — run `kermach roadmap accept f<N>`: the command prints the phase facts and the acceptance instruction, then follow it:
1. Check every done criterion of the phase yourself — with a command, a page or a file, not by the agents' words.
2. Read the phase review card and the agents' records: decisions, dead ends, things noticed on the side.
3. Write to the human for every criterion: yes or no and what proves it, and what the agents noticed. The human looks for themselves. Not like that — create fix cards in this same phase. The phase is closed only after the human's "yes".
4. Review the unstarted cards of all following phases: what is outdated, what to add, what to cancel. Show the edits, after "yes" fix the cards and the overview. The drafts of the next phase become full: add "How to check", remove `draft: да`. Do not edit cards "in progress" — if they are affected, tell the human.
5. Write into `SESSION-now.md`, for example: "Phase f1 accepted 25.10. Next f2. Remember: …".
While acceptance is going on, keep in `SESSION-now.md` the line "after compaction run `kermach roadmap accept f<N>` again". The same for any file that is needed after compaction and is not fed into the conversation by itself.

The session started getting confused — forgets what was agreed, repeats itself: the human will close it and open a new one with the command `kermach roadmap start` in the project terminal. Before that update `SESSION-now.md`.
