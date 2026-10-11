# API probe notes (Claude Code 2.1.296)

A throwaway probe mod (`sentiment-probe`) was loaded with hot reload in a live session. It hooked `prompt.compose` and `turn.complete`, wrote what it saw to files, and scheduled a Haiku call with `$.clock.after(1, …)` from `turn.complete`.

## Risk 1: does a judge scheduled from `turn.complete` outlive the hook?

Yes. A subagent turn ended, its `turn.complete` hook returned `next(e)` at once, and the timer callback's `$.model.complete` finished afterwards:

```json
{"isAnswered":true,"text":"OK","usage":{"input_tokens":17,"output_tokens":4,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}
```

Decision: Task 8 uses `$.clock.after(1, …)`. The `$.clock.every` fallback is not needed.

## Risk 2: what does `turn.complete.answer` hold?

For the subagent turn, `answer` was its final text (`"pong"`). A main-thread turn with several text messages was not observed before the probe was removed. `parseLeadingEmoticon` reads the start of `answer` either way, and the style section asks for the emoticon on every message, so both shapes work.

## Risk 3: does the style section leak into subagent system prompts?

No. Spawning a subagent fired no `prompt.compose` hook: the only compose file came from the main thread (`traits: ["lean","skills"]`, model `claude-opus-5-5`). The subagent did fire `turn.complete`, with `agentId` set:

```json
{"agentId":"a2968a25217b15f2a","reason":"answer","answer":"pong","stamp":"util-import-ok"}
```

Decision: no skip in `prompt.compose`. `turn.complete` already skips turns with `agentId`.

## Risk 4: `userConfig` boolean and picker shape

`claude plugin validate --strict` accepts the manifest, and the plugin-authoring reference states that a `string` field listing `options` is a picker in `/config`.

## Imports with `.ts` extensions

They load at run time (`"stamp":"util-import-ok"`). Imports keep their `.ts` extensions.

## Found while building (not probed)

- The engine refuses `$.store` passed as a value, and follows `$` only into functions declared in the same file. Each hooks file declares its own `storeOf($)` adapter that calls `$.store.get/set/delete/keys` at the call site.
- Op events (`session.id`, `command.register`, `model.complete`, …) answer `{ value }` or `{ deny }`, so test bottoms for them return `{ value: … }`.

## Live check (2026-10-11, headless)

The finished plugin ran in a real engine with `claude -p --setting-sources project --plugin-dir <repo> --model sonnet`, one session resumed turn by turn, user settings (and so other tone plugins) left out.

| Scenario | Result |
|---|---|
| 1. `hi, what does git stash do?` | Reply starts `:\|`, short and plain. Pass |
| 2. `thanks, that helps!` | Reply starts `:)`; `/mood` shows `:) happy (pleasure 0.34, energy 0.00)` with `shift`. Pass |
| 3. Same question three ways | Stayed `:\|`. Not testable headless: `claude -p` prompts have origin `sdk`, and the rules run only for `composer`/`bridge` (spec §5.2). The judge caught it (`judge:user asked again how to undo last commit`). Needs an interactive session |
| 4. `so git reset --soft HEAD~1 keeps my changes staged?` | Stayed `:\|` (the shift is optional) |
| 5. `/mood off`, a question, `/mood on`, `/mood loud` | Plain reply with no emoticon; `Mood is on.`; usage line. Pass |

The background judge ran live: verdicts appeared as `judge:<reason>` on the following turn. Under `claude -p` each turn is its own process, so about half the verdicts were lost when the process exited before the judge finished; an interactive session keeps running and does not have this gap.
