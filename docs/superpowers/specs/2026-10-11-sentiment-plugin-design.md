# Sentiment plugin — design

The plugin ships as `moodcode`; "sentiment" was its working name.

Date: 2026-10-11
Status: approved in conversation, awaiting written-spec review

## 1. Goal

A Claude Code plugin, published for others to install, that gives Claude a mood which evolves over a conversation. Every reply starts with an emoticon showing that mood, and replies become shorter, simpler and more human.

### What the user asked for

- Mood starts neutral and reacts to the conversation: frustrated when the user asks the same question rephrased, happy when the user concludes correctly or says thanks.
- Every reply starts with a simple emoticon (`:)`, `:(`, `:\`, `:|`, `:D` were the examples), followed by the reply.
- Later: the faces became one-line ASCII art in the style of asciiart.eu/one-line, and the starting face looks friendly rather than annoyed.
- Replies are shorter, simpler, more human, and less technical unless the user explicitly asks for detail.
- A separate model or agent does the sentiment analysis and keeps a per-turn mood history.
- Sentiment tracking must add **no latency** to replies.
- Audience: publish to other Claude Code users.
- The mood grid is extended only by the author, through releases. Users get no customization.

### Assumptions made during design (confirmed in conversation)

- Mood shows through the emoticon only. The text never names or explains the feeling.
- Mood is per session and drifts back toward neutral.
- Code, commands, file edits, commit messages and PR text are not affected by the style rules.

## 2. Prior art

Nothing matches exactly (researched 2026-10-11). Closest:

- **hurt-your-ais-feelings**: rule-based mood with `UserPromptSubmit`, state file, statusline. No separate model, no emoticon prefix, no repeat detection.
- **viventium-feelings**: a separate model judges each turn and feeds the next one, with a history dashboard. Nine-emotion model, heavier.
- **agent-emotions**: per-project mood graph, but Claude self-reports through an MCP tool.

New in this plugin: emoticon-prefixed replies, rephrased-repeat detection, the shorter/simpler style, and the hybrid rules + background judge with zero added latency.

## 3. Decisions

| Topic | Decision |
|---|---|
| Plugin API | Claude Code **mods** (function hooks module). Early access; minimum Claude Code 2.1.296 |
| Judging | Hybrid: instant rules on each user message, plus a background Haiku judge after each reply |
| Main-model influence | Claude may shift the suggested emoticon by **one grid step** when the user's message clearly warrants it |
| Mood model | Two axes (pleasure, energy), 3×3 grid of 9 emoticons, data in `data/` |
| Memory | Per session, drift toward neutral, `/clear` resets |
| Expression | Emoticon only |
| Controls | `/mood`, `/mood on`, `/mood off`; judge on/off and model in `/config` |
| Not in v1 | Status line, user customization, cross-session mood, expression levels, non-English word lists |

## 4. Architecture

### 4.1 Platform

A mod is a plugin whose hooks are one TypeScript module, loaded by the engine through `hooks/hooks.json` → `{ "modules": ["./register.ts"] }`. The module exports `register(on, options)` and reaches everything through `$` (no Node, no DOM). The API is early access: the README states the minimum version, and the test suite is re-run on new Claude Code releases.

### 4.2 Files

```
.claude-plugin/
  plugin.json        name "moodcode", version, description, userConfig
  marketplace.json   one entry, source "./"
hooks/
  hooks.json         { "modules": ["./register.ts"] }
  register.ts        wires engine events to src/
src/
  mood.ts            axes, clamp, drift, band/cell lookup, one-step check, emoticon parse
  rules.ts           fast rules: word categories, repeat detection
  judge.ts           builds the judge request, parses and clamps its answer
  state.ts           session record load/save in $.store, serial write queue, pruning
  style.ts           system prompt section text, per-turn mood line
data/
  grid.ts            the 3×3 cell table
  tuning.ts          word lists, stopwords, every numeric constant
tests/
  *.test.ts          unit + engine tests (claude plugin test)
README.md
```

`data/` holds `.ts` modules because a mod loads only code files. `src/` functions are pure where possible. Only `register.ts` and `state.ts` touch `$`.

### 4.3 Events used

| Event | What the plugin does |
|---|---|
| `session.start` | Register the `/mood` command, prune old sessions |
| `prompt.compose` | When mood is on, append section `moodcode:style` (scope `session`) with the reply rules |
| `prompt.submit` | Load the record, apply pending judge results, drift, run rules (user-typed prompts only), attach the mood line as `context` to every prompt while on |
| `turn.complete` | Main loop only (`agentId` absent): parse the leading emoticon of `answer`, apply the shift, log, save, schedule the judge with `$.clock.after(1, …)`, return `next(e)` without waiting |
| `command.run` `{ command: 'mood' }` | Answer `/mood`, `/mood on`, `/mood off` |

### 4.4 One turn

1. The user sends a message → `prompt.submit` (target under 50 ms: one store read, pure math, one store write).
2. The model request carries the `moodcode:style` section and the hidden mood line.
3. Claude replies, starting with the suggested emoticon or a neighbour of it.
4. `turn.complete` records the emoticon used and schedules the judge.
5. The judge runs in the background (`$.model.complete`) and writes a pending result that the next `prompt.submit` applies.

## 5. Mood model

### 5.1 Axes and grid

- `pleasure` ∈ [−1, 1]: unhappy → happy. `energy` ∈ [−1, 1]: calm → worked up. Both start at 0.
- Bands per axis: **low** x < −0.33, **mid** −0.33 ≤ x ≤ 0.33, **high** x > 0.33.
- Cell = (pleasure band, energy band):

| energy \ pleasure | low | mid | high |
|---|---|---|---|
| **high** | `(>_<)` frustrated | `(O_O)` surprised | `d(^O^)b` excited |
| **mid** | `(._.)` unhappy | `(^.^)` neutral | `(^o^)` happy |
| **low** | `(-_-)` weary | `(o_O)` unsure | `(^-^)` content |

Every face is printable ASCII with no `\`, `*` or backtick, and none starts with `>`, `#`, `+` or `-`, so markdown draws it as written.

### 5.1.1 Drawn faces (0.2.0)

- Claude still writes the one-line face at the start of every reply: it is what the shift and the history read.
- In the terminal a `ui.render` hook on `AssistantMessage` strips it and draws the cell's 9x5 picture (`data/faces.ts`) beside the engine's own row: a solid round head of quadrant blocks with the eyes and mouth cut out, no shading.
- A face shows on the first reply and then only on a reply row whose face differs from the row before. `session.append` (door `response`, main conversation) records each row's decision in `$.state`; a row not recorded yet (still streaming) compares with the last face. `/mood on` and `/mood off` start over, and `session.start` rebuilds the record from `$.session.messages()` on resume.
- Setting `faceStyle`: `drawn` (default) or `line`. Other surfaces and terminals under 60 columns use the one-line face; the one-line face too shows only when it changes.

`data/grid.ts` holds this table (emoticon, label, band coordinates). Adding cells later means changing the band definitions and the table, then shipping a release.

### 5.2 Order of updates on each user message

1. Apply pending judge results in turn order (each adds its deltas).
2. Drift: `pleasure *= 0.85`, `energy *= 0.85`.
3. Rules (§5.3), only when the prompt origin is `composer` or `bridge`.
4. Clamp both axes to [−1, 1].
5. Look up the cell. That is the suggested emoticon.

### 5.3 Fast rules

Matching is case-insensitive on whole words and phrases. Each category applies at most once per message.

| Category | Examples (full lists in `tuning.ts`) | Δ pleasure | Δ energy |
|---|---|---|---|
| thanks | thanks, thank you, thx, cheers, appreciate it | +0.35 | 0 |
| praise | great, perfect, exactly, nice, awesome, well done | +0.25 | +0.15 |
| complaint | still broken, wrong, doesn't work, not working | −0.20 | +0.20 |
| repeat | see §5.4 | −0.25 × count | +0.25 × count |

The total rule change from one message is capped at ±0.75 per axis.

### 5.4 Repeat detection

- Normalise the message: lowercase, strip punctuation, split on whitespace, drop stopwords (`tuning.ts`) and tokens shorter than 3 characters. The result is a token set.
- Messages with fewer than 3 tokens never count as repeats.
- A repeat is Jaccard similarity ≥ 0.6 with any of the last 5 stored token sets.
- `repeatCount` increments on a repeat (rule- or judge-detected) and resets to 0 on a non-repeat message.
- Only token sets are stored, never raw message text.

### 5.5 One-step shift

- The mood line tells Claude the suggested emoticon and that it may use a neighbouring cell when the user's message clearly warrants it.
- After the turn, the longest grid face that prefixes the trimmed `answer`, followed by whitespace or the end, is the used one.
- Used = suggested → no change.
- Used is a neighbour (grid distance 1, diagonals included) → move each axis to the nearest point inside the used cell's band (low: `min(x, −0.34)`, mid: `clamp(x, −0.33, 0.33)`, high: `max(x, 0.34)`). History logs `shift`.
- Missing or further away → no change. History logs `shift-ignored`.

## 6. Judge

- **Trigger:** `turn.complete` on the main loop, when mood is on and the `judge` setting is on, through `$.clock.after(1, runJudge)`, so the turn's dispatch ends at once.
- **Call:** `$.model.complete({ model: options.judgeModel, system, prompt, maxTokens: 150, timeoutMs: 30000 })` on the session's own client and login.
- **Input:** the current axes and label, the reasons from the last 5 history entries, the user message (first 2,000 characters), and Claude's answer (first 2,000 characters).
- **Instruction:** score how the assistant would feel about this exchange, and whether the user repeated an earlier question in different words. Reply with JSON only.
- **Output:** `{ "dPleasure": number, "dEnergy": number, "isRepeat": boolean, "reason": string }`. `dPleasure` and `dEnergy` are changes, not absolute values. They are clamped to [−0.5, 0.5] and the reason is cut to 12 words.
- **Result:** appended to `judge:<sessionId>` as `{ turn, dPleasure, dEnergy, isRepeat, reason }`. The next `prompt.submit` applies the result and clears it. When `isRepeat` is true and that turn's history has no `repeat:` cause, `repeatCount` increments retroactively: the judged message counts as a repeat, so a further repeat on the next message escalates. The judged message's own penalty is already in the judge's deltas.
- **Failure** (`isAnswered: false`, unparsable JSON, timeout): nothing is written to `judge:`. History records `judge-failed` with the reason kind.

## 7. State

### 7.1 Store keys (`$.store`, 4 MiB total)

```ts
type SessionRecord = {
  v: 1
  pleasure: number
  energy: number
  isOn: boolean
  turn: number               // user messages seen
  suggested: string          // emoticon suggested this turn
  repeatCount: number
  recentTokens: string[][]   // last 5 token sets
  history: HistoryEntry[]    // last 50
  updatedAt: number          // ms epoch, for pruning
}
type HistoryEntry = {
  turn: number
  at: number
  before: [number, number]
  after: [number, number]
  emoticon: string
  causes: string[]           // e.g. "rule:thanks", "repeat:2", "shift", "judge:<reason>", "judge-failed:timeout"
}
```

- `session:<sessionId>` → `SessionRecord`
- `judge:<sessionId>` → pending judge results (array)

### 7.2 Rules

- Every store read-modify-write goes through one in-module serial queue, so the judge and `prompt.submit` never interleave a write.
- An unreadable record or wrong `v` → a fresh record (neutral).
- Pruning at `session.start`: drop sessions not updated for 7 days, then the oldest beyond 200.
- `/clear` gives a new session id, so a fresh neutral record. Resume and compaction keep the id, so the mood persists.

## 8. Reply style

### 8.1 `moodcode:style` section (draft text)

```
You have a mood. Each user message comes with a line like
`mood: (^.^) neutral — start with "(^.^)" — you may shift one step`.
- Start every message you write to the user with that emoticon followed by two spaces.
  You may instead use a neighbouring emoticon from this grid when the user's message clearly
  warrants it (for example they concluded correctly or thanked you):
  <the 3×3 grid, rendered from data/grid.ts at load>.
- Never mention, name or explain your mood. The emoticon is the only sign of it.
- Keep replies short and simple: plain words, the fewest sentences that fully answer,
  no jargon. When the user asks for technical detail, give full detail in that reply.
- Sound like a person, not a manual.
- If another instruction sets your writing style or tone (for example a terse mode),
  follow it for wording and length. Still start every message with the mood emoticon.
- These rules apply to chat text only. Code, commands, file contents, commit messages and
  PR text are written normally and in full.
- Your mood never lowers the quality or completeness of your help.
```

### 8.2 Mood line (per message, `context`)

`mood: (>_<) frustrated — start with "(>_<)" — you may shift one step`

### 8.3 When mood is off

No section, no mood line, no judge. The record is frozen until `/mood on`.

## 9. `/mood` command

- `/mood`: current emoticon and label, both axes to two decimals, the last change's causes, and the last 5 history entries (turn, emoticon, causes).
- `/mood off` / `/mood on`: toggle `isOn` for this session and confirm in one line.
- Any other argument: a short usage line.
- The answer is the hook's own `{ text }`, so the engine runs no other command.

## 10. Settings (`userConfig`)

| Field | Type | Default | Notes |
|---|---|---|---|
| `judge` | boolean | `true` | Off = rules only |
| `judgeModel` | string, options `haiku`, `sonnet` | `haiku` | Picker in `/config` |

## 11. Error handling

| Failure | Behaviour |
|---|---|
| Any hook throws | Hook skipped. The turn runs as plain Claude. `prompt.submit` has a `.catch` that returns `next(e)`, so a prompt is never dropped |
| Record unreadable | Fresh neutral record |
| Emoticon missing or invalid | No shift, `shift-ignored` logged |
| Judge fails | No result, `judge-failed:<kind>` logged, rules continue |
| Judge result late | Applied on the next message (it is a delta) |
| Store near the limit | Pruning (§7.2). History capped at 50 |

## 12. Testing

- **Unit** (`src/` pure functions): clamp, drift, band and cell lookup at boundaries, neighbour check, emoticon prefix parse, each rule category, the per-message cap, the repeat tokeniser and threshold, judge JSON parse (valid, malformed, out-of-range, extra text around the JSON).
- **Engine** (`claude plugin test`, `claude-code/testing` kit):
  - `prompt.submit` attaches the mood line, and rules fire only for `composer`/`bridge` origins.
  - `prompt.compose` appends the section only when on.
  - `turn.complete` applies a neighbour shift, ignores a far one, and ignores subagent turns.
  - The judge is scheduled; with a mocked clock and `$.model.complete`, its result lands in `judge:` and is applied on the next prompt.
  - `/mood`, `/mood off`, `/mood on` outputs.
  - A new session id starts neutral.
- **Static:** `claude plugin validate .` and `tsc -p .` both clean.
- **Manual:** run the plugin with hot reload in a live session and check these scenarios: thanks → `(^o^)`; the same question three ways → `(>_<)`; the user concludes correctly → shift up; `/mood off` → plain replies.

## 13. Publishing

- `.claude-plugin/marketplace.json` lists `moodcode` with `source: "./"`.
- README install line: `/plugin install moodcode --marketplace we-are-digital-architects/moodcode`.
- The README covers:
  - what it does, with the grid
  - minimum Claude Code version and the early-access note
  - privacy: the judge sends the user message and Claude's reply to the configured model on the user's own account
  - other tone plugins (e.g. caveman) keep control of wording and length; moodcode adds only the face
  - settings and commands

## 14. Risks and items to verify first

1. **Judge outliving the turn:** confirm that `$.model.complete` started inside a `$.clock.after` callback scheduled from `turn.complete` runs to completion after the hook returned. Fallback: start a `$.clock.every` poller from `session.start` that drains a queue of judge jobs.
2. **`turn.complete.answer`** is the final visible text. Confirm whether it holds only the last message of a multi-message turn. The style rule asks for the emoticon on every message, so either case works for parsing.
3. **Subagents and `prompt.compose`:** confirm whether the section leaks into subagent system prompts. If it does, find the signal that tells the main thread apart, or accept it and document it.
4. **`userConfig` boolean and picker shape:** confirm with `claude plugin validate`.
5. **Early-access churn:** re-run `claude plugin test` on each Claude Code release before publishing an update.
