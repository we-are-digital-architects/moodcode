# Sentiment Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `sentiment`, a Claude Code mod that gives Claude an evolving two-axis mood, shown as a leading emoticon on short, simple replies, judged by instant rules plus a background Haiku call.

**Architecture:** One TypeScript hooks module (`hooks/register.ts`) wires five engine events to small pure modules in `src/`. Per-session state lives in the plugin's `$.store`. After each turn, the judge runs on a `$.clock.after` timer, so no reply waits for it. Its verdict is stored and applied on the next user message.

**Tech Stack:** Claude Code mods API (function hooks, early access, Claude Code ≥ 2.1.296), TypeScript 5.6 (type-check only, `noEmit`), the `claude-code/testing` kit run by `claude plugin test`, and `claude plugin validate`. No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-sentiment-plugin-design.md`

## Global Constraints

- Claude Code **2.1.296 or newer**. The mods API is early access. The module runs with no Node and no DOM, and reaches everything through `$`.
- No runtime dependencies. No `package.json`. TypeScript is only used through `npx` for type-checking.
- Plugin name `sentiment`. Command `/mood`. System prompt section id `sentiment:style` (scope `session`). Store keys `session:<sessionId>` and `judge:<sessionId>`.
- Grid: exactly the 9 cells of spec §5.1. Bands: low x < −0.33, mid −0.33 ≤ x ≤ 0.33, high x > 0.33. Drift factor 0.85 per message. Nudge edge 0.34.
- Rules (spec §5.3):
  - thanks +0.35 / 0
  - praise +0.25 / +0.15
  - complaint −0.20 / +0.20
  - repeat −0.25 × count / +0.25 × count
  - total per message capped at ±0.75 per axis
- Repeat: Jaccard ≥ 0.6 against the last 5 token sets. Tokens are ≥ 3 characters with stopwords dropped. Messages under 3 tokens never repeat.
- Judge (spec §6): default model `haiku`, `maxTokens` 150, `timeoutMs` 30000, inputs cut to 2,000 characters, deltas clamped to ±0.5, reason ≤ 12 words, reasons from the last 5 judge results.
- History capped at 50 entries. Pruning: 7 days, then at most 200 sessions.
- Never store raw message text in `$.store`. Only token sets and judge reasons.
- No hook awaits the judge. `turn.complete` returns `next(e)` without waiting for any model call.
- Users cannot customise the grid or the rules. Their only settings are `judge` (boolean, default `true`) and `judgeModel` (`haiku` | `sonnet`, default `haiku`).
- Imports between plugin files use explicit `.ts` extensions (`'../src/mood.ts'`).
- Style rules apply to chat text only. Code, commands, file contents, commit messages and PR text are unaffected.

## Review Focus

1. **A reply that opens with emoticon-like text that is not a mood marker** (`:Done`, a code fence, `Hello :)`) must not count as a shift. Pinned in Task 2 (`parseLeadingEmoticon` boundary test).
2. **A huge paste (≈200 KB) as the user message** must not break or slow rules, and the judge prompt carries at most 2,000 characters of it. Pinned in Task 3 (big tokenize test) and Task 4 (cut test).
3. **Non-English, emoji-only or one-word messages** (`👍`, `hvala lijepa`, `ok`) must not crash and never count as repeats. Pinned in Task 3.
4. **Corrupt or older-version store data** (`{ v: 0 }`, a string, junk in the pending list) must give a fresh neutral record and drop the junk. Pinned in Task 5 and Task 6.
5. **Two judge verdicts arriving before the next message** must both be applied, in turn order, exactly once. Pinned in Task 5 (`takePending` order) and Task 8 (engine test).

---

## File structure

```
.claude-plugin/plugin.json        manifest + userConfig (Task 1)
.claude-plugin/marketplace.json   one-entry marketplace (Task 1)
hooks/hooks.json                  { "modules": ["./register.ts"] } (Task 1)
hooks/register.ts                 reads options, calls wire* functions (Tasks 1, 6, 7, 8)
hooks/prompt.ts                   prompt.compose + prompt.submit (Task 6)
hooks/command.ts                  session.start + /mood (Task 7)
hooks/turn.ts                     turn.start + turn.complete + runJudge (Task 8)
data/grid.ts                      Band, Cell, GRID (Task 2)
data/tuning.ts                    TUNING, WORD_RULES, STOPWORDS (Task 2)
src/mood.ts                       mood math, emoticon parse, one-step shift (Task 2)
src/rules.ts                      phrase rules, tokenizer, repeat detection (Task 3)
src/judge.ts                      judge system prompt, prompt builder, reply parser (Task 4)
src/state.ts                      SessionRecord, KV access, serial queue, pruning (Task 5)
src/step.ts                       pure per-message and per-turn updates (Task 5)
src/style.ts                      style section, mood line, /mood text (Task 6)
src/settings.ts                   userConfig → Settings (Task 6)
tests/helpers.ts                  r3, memoryKV, engine bottoms (Tasks 2, 5, 6)
tests/*.test.ts                   one per unit (each task)
tsconfig.json, .gitignore         toolchain (Task 1)
README.md, CLAUDE.md              docs (Task 9)
```

Note on spec deviations, all small and internal:
- `src/step.ts` and `src/settings.ts` are extra files, added to keep `hooks/` thin and the logic pure.
- `turn.start` is hooked as well, to keep the user's text in module memory (never in the store) for the judge.
- `turn` in the record counts every prompt that got a reply, not only human-typed ones.

---

### Task 1: Scaffold, toolchain, and API probes

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json`, `hooks/register.ts`, `tsconfig.json`, `.gitignore`, `tests/smoke.test.ts`
- Throwaway (not committed): a probe mod in the session's dev-mods folder

**Interfaces:**
- Consumes: nothing
- Produces: a plugin that loads, validates, type-checks and runs tests. Also answers to spec §14 risks 1–4, recorded in `docs/superpowers/plans/2026-10-11-api-probe-notes.md`.

- [ ] **Step 1: Write the manifest**

`.claude-plugin/plugin.json`:
```json
{
  "name": "sentiment",
  "version": "0.1.0",
  "description": "Gives Claude an evolving mood: every reply starts with an emoticon and stays short, simple and human.",
  "author": { "name": "Nikola HORVAT" },
  "userConfig": {
    "judge": {
      "type": "boolean",
      "title": "Background mood judge",
      "description": "After each reply a small model reviews the exchange and adjusts the mood. Off: fast rules only.",
      "default": true
    },
    "judgeModel": {
      "type": "string",
      "title": "Judge model",
      "description": "Model the background judge uses.",
      "default": "haiku",
      "options": ["haiku", "sonnet"]
    }
  }
}
```

`.claude-plugin/marketplace.json`:
```json
{
  "name": "sentiment",
  "owner": { "name": "Nikola HORVAT" },
  "plugins": [{ "name": "sentiment", "source": "./" }]
}
```

`hooks/hooks.json`:
```json
{ "modules": ["./register.ts"] }
```

`hooks/register.ts`:
```ts
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

- [ ] **Step 2: Write the toolchain files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "types": [],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment"
  },
  "include": [".claude-plugin/types", "hooks", "src", "data", "tests"]
}
```

`.gitignore`:
```
.claude-plugin/types/
.DS_Store
```

- [ ] **Step 3: Lay the API types for the editor and `tsc`**

The engine writes the types beside a mod whenever an interactive session loads it from a watched folder. To get them without that, copy this build's declaration file:

```bash
mkdir -p .claude-plugin/types/claude-code
cp /private/tmp/claude-502/bundled-skills/2.1.296/1eda5e8e2d144bd41b645ad3ccacbbf8/plugin-authoring/types/claude-code.d.ts .claude-plugin/types/claude-code/index.d.ts
head -1 .claude-plugin/types/claude-code/index.d.ts
```
Expected: `// Written by Claude Code 2.1.296.`

If that path no longer exists (a new session or build), load the `plugin-authoring` skill once. Its SKILL.md names the fresh `types/claude-code.d.ts` path. Copy from there.

- [ ] **Step 4: Write a smoke test**

`tests/smoke.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'

test('the plugin loads and session.start passes through', async ($, on) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  const out = await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(out.cwd).toBe('/tmp')
})
```

- [ ] **Step 5: Run validate, tests and type-check**

```bash
claude plugin validate .
claude plugin test .
npx --yes -p typescript@5.6.3 tsc -p .
```
Expected:
- validate reports the manifest, the marketplace and the hooks module with no errors.
- test: 1 passing.
- tsc: no output, exit 0.

If validate rejects the `userConfig` shape (spec §14 risk 4), adjust the field keys to what its message names and re-run. Keep the two fields, their types, defaults and the `haiku`/`sonnet` picker.

- [ ] **Step 6: Probe the open API questions (spec §14 risks 1–3) with a throwaway mod**

Create a probe mod in the session's mods folder: the `WHERE TO WRITE IT` path from the plugin-authoring skill. In this session that is `/Users/nhorvat/.claude/dev-mods/610300c3-eecf-41d0-8c0c-c0f1377750cc/sentiment-probe/`. It has three files.

`.claude-plugin/plugin.json`:
```json
{ "name": "sentiment-probe", "version": "0.0.1", "description": "Throwaway probe for the sentiment plugin" }
```

`hooks/hooks.json`:
```json
{ "modules": ["./register.ts"] }
```

`hooks/register.ts` (`OUT` is this session's scratchpad. Use any absolute folder you can read):
```ts
import type { Register } from 'claude-code'
import { stamp } from './util.ts'

const OUT = '/private/tmp/claude-502/-Users-nhorvat-Code-RandD-claudeWithSentiment/610300c3-eecf-41d0-8c0c-c0f1377750cc/scratchpad/probe'

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    await $.fs.write(`${OUT}/compose-${await $.clock.now()}.json`,
      JSON.stringify({ model: e.model, traits: e.traits, ids: out.sections.map(s => s.id) }))
    return out
  })

  on('turn.complete', async ($, e, next) => {
    await $.fs.write(`${OUT}/answer-${e.turnId}.json`,
      JSON.stringify({ agentId: e.agentId ?? null, reason: e.reason, answer: e.answer, stamp: stamp() }))
    $.clock.after(1, () => {
      void (async () => {
        const r = await $.model.complete({ model: 'haiku', prompt: 'Reply with the word OK.', maxTokens: 10, timeoutMs: 30000 })
        await $.fs.write(`${OUT}/judge-${e.turnId}.json`, JSON.stringify(r))
      })()
    })
    return next(e)
  })
}
```

`hooks/util.ts` (checks that a `.ts`-extension import loads at run time):
```ts
export const stamp = (): string => 'util-import-ok'
```

Writing the first file raises "Enable hot reloading for this session?". The human partner answers it. Choose **Enable for this session**. The probe loads when the turn ends.

Then trigger the probes:
- **Risk 1 + import:** end one plain turn. On the next turn, `ls` and `cat` the files in `$OUT`. `judge-<turnId>.json` with `"isAnswered":true` means a model call scheduled from `turn.complete` outlives the hook. `"stamp":"util-import-ok"` means `.ts` imports load.
- **Risk 2:** run a turn that writes two separate text messages with a tool call between them (e.g. say something, run `ls`, say something else). Read `answer-<turnId>.json`: does `answer` hold only the last message?
- **Risk 3:** run a turn that spawns a subagent (Agent tool, any trivial task). Compare the `compose-*.json` files. Does a request for the subagent show up, and what tells it apart (`traits`, `model`, section ids)?

If hot reloading is unavailable, ask the human partner to run `claude --plugin-dir <probe folder>` in another terminal and do the same three turns there. Then read the `$OUT` files.

- [ ] **Step 7: Record the probe answers and decide fallbacks**

Write `docs/superpowers/plans/2026-10-11-api-probe-notes.md` with one short section per risk: what was observed, with file excerpts, and the decision:
- **Risk 1:** if the judge file never appears, Task 8 must use the fallback from spec §14. `wireTurn` pushes jobs onto an in-module queue, and a `$.clock.every(500, drain)` started in `session.start` runs them. Note that here.
- **Risk 2:** `parseLeadingEmoticon` reads the start of `answer` either way. Note which message it is.
- **Risk 3:** if the subagent's compose request is distinguishable, note the exact test (e.g. `e.traits.includes('teammate')`) for Task 6 to skip it. If it isn't, note "accepted: subagents may see the style section" for the README in Task 9.
- **Imports:** if `util-import-ok` is missing, note it. All tasks then drop the `.ts` extension from imports (and `allowImportingTsExtensions` from `tsconfig.json`).

Then delete the probe mod folder:
```bash
rm -rf /Users/nhorvat/.claude/dev-mods/610300c3-eecf-41d0-8c0c-c0f1377750cc/sentiment-probe
```

- [ ] **Step 8: Commit**

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json hooks/hooks.json hooks/register.ts tsconfig.json .gitignore tests/smoke.test.ts docs/superpowers/plans/2026-10-11-api-probe-notes.md
git commit -m "chore: scaffold sentiment mod and record API probe results"
```

---

### Task 2: Mood grid and mood math

**Files:**
- Create: `data/grid.ts`, `data/tuning.ts`, `src/mood.ts`, `tests/helpers.ts`, `tests/mood.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `data/grid.ts`: `type Band = 'low' | 'mid' | 'high'`, `type Cell = { emoticon: string; label: string; pleasure: Band; energy: Band }`, `const GRID: readonly Cell[]`
  - `data/tuning.ts`: `const TUNING`, `type WordRule`, `const WORD_RULES: readonly WordRule[]`, `const STOPWORDS: ReadonlySet<string>`
  - `src/mood.ts`:
    - `type Mood = { pleasure: number; energy: number }`
    - `NEUTRAL`
    - `clamp(x, lo?, hi?)`
    - `addDelta(m, dPleasure, dEnergy): Mood`
    - `drift(m): Mood`
    - `bandOf(x): Band`
    - `cellOf(m): Cell`
    - `cellByEmoticon(s): Cell | undefined`
    - `parseLeadingEmoticon(text): string | undefined`
    - `isNeighbor(a, b): boolean`
    - `nudgeInto(m, cell): Mood`
    - `type ShiftOutcome = { mood: Mood; emoticon: string | undefined; cause: 'none' | 'shift' | 'shift-ignored' }`
    - `applyShift(m, suggested, answer): ShiftOutcome`
  - `tests/helpers.ts`: `r3(n: number): number`

- [ ] **Step 1: Write the data files**

`data/grid.ts`:
```ts
export type Band = 'low' | 'mid' | 'high'

export type Cell = {
  readonly emoticon: string
  readonly label: string
  readonly pleasure: Band
  readonly energy: Band
}

export const GRID: readonly Cell[] = [
  { emoticon: '>:(', label: 'frustrated', pleasure: 'low', energy: 'high' },
  { emoticon: ':O', label: 'surprised', pleasure: 'mid', energy: 'high' },
  { emoticon: ':D', label: 'excited', pleasure: 'high', energy: 'high' },
  { emoticon: ':(', label: 'unhappy', pleasure: 'low', energy: 'mid' },
  { emoticon: ':|', label: 'neutral', pleasure: 'mid', energy: 'mid' },
  { emoticon: ':)', label: 'happy', pleasure: 'high', energy: 'mid' },
  { emoticon: '-_-', label: 'weary', pleasure: 'low', energy: 'low' },
  { emoticon: ':\\', label: 'unsure', pleasure: 'mid', energy: 'low' },
  { emoticon: '^_^', label: 'content', pleasure: 'high', energy: 'low' },
]
```

`data/tuning.ts`:
```ts
export type WordRule = {
  readonly id: string
  readonly phrases: readonly string[]
  readonly dPleasure: number
  readonly dEnergy: number
}

export const TUNING = {
  bandEdge: 0.33,
  nudgeEdge: 0.34,
  drift: 0.85,
  ruleCapPerAxis: 0.75,
  repeat: { threshold: 0.6, window: 5, minTokens: 3, minTokenLength: 3, dPleasure: -0.25, dEnergy: 0.25 },
  judge: { deltaCap: 0.5, maxTokens: 150, timeoutMs: 30_000, inputChars: 2000, reasonWords: 12, historyReasons: 5 },
  historyLimit: 50,
  prune: { maxAgeMs: 7 * 24 * 60 * 60 * 1000, maxSessions: 200 },
} as const

export const WORD_RULES: readonly WordRule[] = [
  {
    id: 'thanks',
    phrases: ['thanks', 'thank you', 'thx', 'cheers', 'appreciate it', 'much appreciated'],
    dPleasure: 0.35,
    dEnergy: 0,
  },
  {
    id: 'praise',
    phrases: ['great', 'perfect', 'exactly', 'nice', 'awesome', 'well done', 'brilliant', 'love it'],
    dPleasure: 0.25,
    dEnergy: 0.15,
  },
  {
    id: 'complaint',
    phrases: ['still broken', 'wrong', "doesn't work", 'does not work', 'not working', 'still failing', 'useless'],
    dPleasure: -0.2,
    dEnergy: 0.2,
  },
]

export const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with', 'this', 'that', 'these', 'those',
  'what', 'whats', 'how', 'why', 'when', 'where', 'which', 'who', 'can', 'could', 'would', 'should',
  'does', 'did', 'have', 'has', 'had', 'was', 'were', 'will', 'about', 'from', 'into', 'just', 'like',
  'please', 'there', 'then', 'than', 'them', 'they', 'its', 'get', 'way', 'any', 'some', 'again',
  'tell', 'explain', 'want', 'need', 'know', 'help', 'also', 'still', 'really', 'one', 'use', 'using',
  'show', 'give', 'make', 'all', 'out', 'our', 'his', 'her', 'she', 'him', 'too', 'very', 'thing',
])
```

`tests/helpers.ts`:
```ts
export const r3 = (n: number): number => Math.round(n * 1000) / 1000 + 0
```

- [ ] **Step 2: Write the failing tests**

`tests/mood.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { GRID } from '../data/grid.ts'
import {
  addDelta, applyShift, bandOf, cellByEmoticon, cellOf, clamp, drift, isNeighbor, nudgeInto, parseLeadingEmoticon,
} from '../src/mood.ts'
import { r3 } from './helpers.ts'

const at = (emoticon: string) => {
  const cell = cellByEmoticon(emoticon)
  if (cell === undefined) throw new Error(`no cell ${emoticon}`)
  return cell
}

test('grid has one cell per band pair and unique emoticons', () => {
  expect(GRID).toHaveLength(9)
  expect(new Set(GRID.map(c => c.emoticon)).size).toBe(9)
  expect(new Set(GRID.map(c => `${c.pleasure}/${c.energy}`)).size).toBe(9)
})

test('clamp keeps values inside -1..1', () => {
  expect(clamp(1.7)).toBe(1)
  expect(clamp(-3)).toBe(-1)
  expect(clamp(0.2)).toBe(0.2)
})

test('addDelta adds and clamps each axis', () => {
  const m = addDelta({ pleasure: 0.9, energy: -0.2 }, 0.5, -0.1)
  expect(m.pleasure).toBe(1)
  expect(r3(m.energy)).toBe(-0.3)
})

test('drift moves both axes 15% toward zero', () => {
  const m = drift({ pleasure: 0.4, energy: -0.2 })
  expect(r3(m.pleasure)).toBe(0.34)
  expect(r3(m.energy)).toBe(-0.17)
})

test('bands split at ±0.33 with the edges in the middle band', () => {
  expect(bandOf(-0.34)).toBe('low')
  expect(bandOf(-0.33)).toBe('mid')
  expect(bandOf(0.33)).toBe('mid')
  expect(bandOf(0.331)).toBe('high')
})

test('cellOf maps the centre and the corners', () => {
  expect(cellOf({ pleasure: 0, energy: 0 }).emoticon).toBe(':|')
  expect(cellOf({ pleasure: -0.5, energy: 0.5 }).emoticon).toBe('>:(')
  expect(cellOf({ pleasure: 0.5, energy: 0.5 }).emoticon).toBe(':D')
  expect(cellOf({ pleasure: -0.5, energy: -0.5 }).emoticon).toBe('-_-')
  expect(cellOf({ pleasure: 0.5, energy: -0.5 }).emoticon).toBe('^_^')
  expect(cellOf({ pleasure: 0, energy: -0.5 }).emoticon).toBe(':\\')
})

test('parseLeadingEmoticon prefers the longest match and needs a boundary', () => {
  expect(parseLeadingEmoticon('>:(  Third time.')).toBe('>:(')
  expect(parseLeadingEmoticon('  :(  Sorry.')).toBe(':(')
  expect(parseLeadingEmoticon(':)')).toBe(':)')
  expect(parseLeadingEmoticon(':\\  Not sure.')).toBe(':\\')
  expect(parseLeadingEmoticon(':Done, shipped.')).toBeUndefined()
  expect(parseLeadingEmoticon('```\n:) code\n```')).toBeUndefined()
  expect(parseLeadingEmoticon('Hello :)')).toBeUndefined()
})

test('isNeighbor is true only at grid distance one, diagonals included', () => {
  expect(isNeighbor(at(':|'), at(':)'))).toBe(true)
  expect(isNeighbor(at(':|'), at(':D'))).toBe(true)
  expect(isNeighbor(at(':|'), at(':|'))).toBe(false)
  expect(isNeighbor(at('-_-'), at(':D'))).toBe(false)
})

test('nudgeInto moves each axis just inside the target band', () => {
  expect(nudgeInto({ pleasure: 0.1, energy: 0.2 }, at(':)'))).toEqual({ pleasure: 0.34, energy: 0.2 })
  expect(nudgeInto({ pleasure: 0.6, energy: -0.6 }, at(':|'))).toEqual({ pleasure: 0.33, energy: -0.33 })
  expect(nudgeInto({ pleasure: 0, energy: 0 }, at('>:('))).toEqual({ pleasure: -0.34, energy: 0.34 })
})

test('applyShift follows a neighbour and ignores far or missing emoticons', () => {
  expect(applyShift({ pleasure: 0, energy: 0 }, ':|', ':|  Yes.').cause).toBe('none')

  const up = applyShift({ pleasure: 0, energy: 0 }, ':|', ':)  Yes, that is it.')
  expect(up.cause).toBe('shift')
  expect(up.emoticon).toBe(':)')
  expect(up.mood).toEqual({ pleasure: 0.34, energy: 0 })

  const far = applyShift({ pleasure: -0.5, energy: -0.5 }, '-_-', ':D  Yay!')
  expect(far.cause).toBe('shift-ignored')
  expect(far.mood).toEqual({ pleasure: -0.5, energy: -0.5 })

  const missing = applyShift({ pleasure: 0, energy: 0 }, ':|', 'Yes.')
  expect(missing.cause).toBe('shift-ignored')
  expect(missing.emoticon).toBeUndefined()
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL. `tests/mood.test.ts` cannot resolve `../src/mood.ts`.

- [ ] **Step 4: Implement `src/mood.ts`**

```ts
import { GRID, type Band, type Cell } from '../data/grid.ts'
import { TUNING } from '../data/tuning.ts'

export type Mood = { readonly pleasure: number; readonly energy: number }

export type ShiftOutcome = {
  readonly mood: Mood
  readonly emoticon: string | undefined
  readonly cause: 'none' | 'shift' | 'shift-ignored'
}

export const NEUTRAL: Mood = { pleasure: 0, energy: 0 }

const BAND_INDEX: Record<Band, number> = { low: 0, mid: 1, high: 2 }
const BY_LENGTH = [...GRID].sort((a, b) => b.emoticon.length - a.emoticon.length)

export function clamp(x: number, lo = -1, hi = 1): number {
  return Math.min(hi, Math.max(lo, x))
}

export function addDelta(m: Mood, dPleasure: number, dEnergy: number): Mood {
  return { pleasure: clamp(m.pleasure + dPleasure), energy: clamp(m.energy + dEnergy) }
}

export function drift(m: Mood): Mood {
  return { pleasure: m.pleasure * TUNING.drift, energy: m.energy * TUNING.drift }
}

export function bandOf(x: number): Band {
  if (x < -TUNING.bandEdge) return 'low'
  if (x > TUNING.bandEdge) return 'high'
  return 'mid'
}

export function cellOf(m: Mood): Cell {
  const pleasure = bandOf(m.pleasure)
  const energy = bandOf(m.energy)
  const cell = GRID.find(c => c.pleasure === pleasure && c.energy === energy)
  if (cell === undefined) throw new Error(`grid has no cell for ${pleasure}/${energy}`)
  return cell
}

export function cellByEmoticon(emoticon: string): Cell | undefined {
  return GRID.find(c => c.emoticon === emoticon)
}

export function parseLeadingEmoticon(text: string): string | undefined {
  const head = text.trimStart()
  for (const cell of BY_LENGTH) {
    if (!head.startsWith(cell.emoticon)) continue
    const after = head.charAt(cell.emoticon.length)
    if (after === '' || /\s/.test(after)) return cell.emoticon
  }
  return undefined
}

export function isNeighbor(a: Cell, b: Cell): boolean {
  const dPleasure = Math.abs(BAND_INDEX[a.pleasure] - BAND_INDEX[b.pleasure])
  const dEnergy = Math.abs(BAND_INDEX[a.energy] - BAND_INDEX[b.energy])
  return Math.max(dPleasure, dEnergy) === 1
}

function nudgeAxis(x: number, band: Band): number {
  if (band === 'low') return Math.min(x, -TUNING.nudgeEdge)
  if (band === 'high') return Math.max(x, TUNING.nudgeEdge)
  return clamp(x, -TUNING.bandEdge, TUNING.bandEdge)
}

export function nudgeInto(m: Mood, target: Cell): Mood {
  return { pleasure: nudgeAxis(m.pleasure, target.pleasure), energy: nudgeAxis(m.energy, target.energy) }
}

export function applyShift(m: Mood, suggested: string, answer: string): ShiftOutcome {
  const used = parseLeadingEmoticon(answer)
  if (used === suggested) return { mood: m, emoticon: used, cause: 'none' }
  const from = cellByEmoticon(suggested)
  const to = used === undefined ? undefined : cellByEmoticon(used)
  if (from === undefined || to === undefined || !isNeighbor(from, to)) {
    return { mood: m, emoticon: used, cause: 'shift-ignored' }
  }
  return { mood: nudgeInto(m, to), emoticon: used, cause: 'shift' }
}
```

- [ ] **Step 5: Run tests and type-check**

```bash
claude plugin test .
npx --yes -p typescript@5.6.3 tsc -p .
```
Expected: all tests pass, tsc exits 0.

- [ ] **Step 6: Commit**

```bash
git add data/grid.ts data/tuning.ts src/mood.ts tests/helpers.ts tests/mood.test.ts
git commit -m "feat: add two-axis mood grid and mood math"
```

---

### Task 3: Fast rules and repeat detection

**Files:**
- Create: `src/rules.ts`, `tests/rules.test.ts`

**Interfaces:**
- Consumes: `TUNING`, `WORD_RULES`, `STOPWORDS` from `data/tuning.ts`
- Produces (`src/rules.ts`):
  - `hasPhrase(text, phrase): boolean`
  - `tokenize(text): string[]` (unique, sorted)
  - `jaccard(a, b): number`
  - `isRepeat(tokens, recent): boolean`
  - `type RuleResult = { dPleasure: number; dEnergy: number; causes: readonly string[]; isRepeat: boolean; tokens: readonly string[] }`
  - `evaluateRules(text, recent: readonly (readonly string[])[], repeatCount: number): RuleResult`
  - Causes are spelled `rule:<id>` and `repeat:<count>`.

- [ ] **Step 1: Write the failing tests**

`tests/rules.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { evaluateRules, hasPhrase, isRepeat, jaccard, tokenize } from '../src/rules.ts'
import { r3 } from './helpers.ts'

const FIRST_ASK = tokenize('how do I read a file in python')

test('thanks raises pleasure only', () => {
  const r = evaluateRules('Thanks, that fixed it!', [], 0)
  expect(r3(r.dPleasure)).toBe(0.35)
  expect(r.dEnergy).toBe(0)
  expect(r.causes).toEqual(['rule:thanks'])
})

test('a category counts once even with several of its words', () => {
  const r = evaluateRules('Perfect, exactly what I needed', [], 0)
  expect(r.causes).toEqual(['rule:praise'])
  expect(r3(r.dPleasure)).toBe(0.25)
  expect(r3(r.dEnergy)).toBe(0.15)
})

test('complaints match with a curly apostrophe', () => {
  const r = evaluateRules('It still doesn’t work', [], 0)
  expect(r.causes).toEqual(['rule:complaint'])
  expect(r3(r.dPleasure)).toBe(-0.2)
  expect(r3(r.dEnergy)).toBe(0.2)
})

test('words inside other words do not match', () => {
  expect(hasPhrase('thanksgiving plans', 'thanks')).toBe(false)
  expect(hasPhrase('a nicer layout', 'nice')).toBe(false)
  expect(hasPhrase('nice!', 'nice')).toBe(true)
})

test('tokenize drops stopwords, short words and punctuation', () => {
  expect(tokenize('How do I read a file in Python?')).toEqual(['file', 'python', 'read'])
})

test('jaccard of identical sets is 1 and of disjoint sets is 0', () => {
  expect(jaccard(['a1x', 'b2y'], ['a1x', 'b2y'])).toBe(1)
  expect(jaccard(['a1x'], ['b2y'])).toBe(0)
  expect(jaccard([], [])).toBe(0)
})

test('a rephrased question counts as a repeat', () => {
  const r = evaluateRules("what's the way to read a file in python", [FIRST_ASK], 0)
  expect(r.isRepeat).toBe(true)
  expect(r.causes).toEqual(['repeat:1'])
  expect(r3(r.dPleasure)).toBe(-0.25)
  expect(r3(r.dEnergy)).toBe(0.25)
})

test('a second repeat escalates', () => {
  const r = evaluateRules('python read file', [FIRST_ASK], 1)
  expect(r.causes).toEqual(['repeat:2'])
  expect(r3(r.dPleasure)).toBe(-0.5)
  expect(r3(r.dEnergy)).toBe(0.5)
})

test('the rule total is capped at ±0.75 per axis', () => {
  const r = evaluateRules('python read file still broken', [FIRST_ASK], 3)
  expect(r.causes).toEqual(['rule:complaint', 'repeat:4'])
  expect(r3(r.dPleasure)).toBe(-0.75)
  expect(r3(r.dEnergy)).toBe(0.75)
})

test('a different question is not a repeat', () => {
  expect(evaluateRules('how can I parse json in python', [FIRST_ASK], 0).isRepeat).toBe(false)
})

test('short, emoji-only and non-English messages never repeat', () => {
  expect(evaluateRules('👍', [FIRST_ASK], 0)).toEqual({ dPleasure: 0, dEnergy: 0, causes: [], isRepeat: false, tokens: [] })
  expect(evaluateRules('ok', [FIRST_ASK], 0).isRepeat).toBe(false)
  expect(isRepeat(tokenize('hvala lijepa'), [['hvala', 'lijepa']])).toBe(false)
})

test('a 200 KB paste is handled', () => {
  const big = 'lorem ipsum dolor '.repeat(12000)
  const r = evaluateRules(big, [FIRST_ASK], 0)
  expect(r.tokens).toEqual(['dolor', 'ipsum', 'lorem'])
  expect(r.isRepeat).toBe(false)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL. `tests/rules.test.ts` cannot resolve `../src/rules.ts`.

- [ ] **Step 3: Implement `src/rules.ts`**

```ts
import { STOPWORDS, TUNING, WORD_RULES } from '../data/tuning.ts'

export type RuleResult = {
  readonly dPleasure: number
  readonly dEnergy: number
  readonly causes: readonly string[]
  readonly isRepeat: boolean
  readonly tokens: readonly string[]
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function hasPhrase(text: string, phrase: string): boolean {
  const pattern = new RegExp(`(^|[^a-z0-9'])${escapeRegExp(phrase)}($|[^a-z0-9'])`)
  return pattern.test(normalize(text))
}

export function tokenize(text: string): string[] {
  const words = normalize(text).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
  const kept = words.filter(w => w.length >= TUNING.repeat.minTokenLength && !STOPWORDS.has(w))
  return [...new Set(kept)].sort()
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const inB = new Set(b)
  const shared = a.filter(t => inB.has(t)).length
  return shared / (a.length + b.length - shared)
}

export function isRepeat(tokens: readonly string[], recent: readonly (readonly string[])[]): boolean {
  if (tokens.length < TUNING.repeat.minTokens) return false
  return recent.some(previous => jaccard(tokens, previous) >= TUNING.repeat.threshold)
}

function capAxis(x: number): number {
  return Math.min(TUNING.ruleCapPerAxis, Math.max(-TUNING.ruleCapPerAxis, x))
}

export function evaluateRules(
  text: string,
  recent: readonly (readonly string[])[],
  repeatCount: number,
): RuleResult {
  let dPleasure = 0
  let dEnergy = 0
  const causes: string[] = []
  for (const rule of WORD_RULES) {
    if (!rule.phrases.some(phrase => hasPhrase(text, phrase))) continue
    dPleasure += rule.dPleasure
    dEnergy += rule.dEnergy
    causes.push(`rule:${rule.id}`)
  }
  const tokens = tokenize(text)
  const repeated = isRepeat(tokens, recent)
  if (repeated) {
    const count = repeatCount + 1
    dPleasure += TUNING.repeat.dPleasure * count
    dEnergy += TUNING.repeat.dEnergy * count
    causes.push(`repeat:${count}`)
  }
  return { dPleasure: capAxis(dPleasure) + 0, dEnergy: capAxis(dEnergy) + 0, causes, isRepeat: repeated, tokens }
}
```

- [ ] **Step 4: Run tests and type-check**

```bash
claude plugin test .
npx --yes -p typescript@5.6.3 tsc -p .
```
Expected: all tests pass, tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/rules.ts tests/rules.test.ts
git commit -m "feat: add instant mood rules with rephrased-repeat detection"
```

---

### Task 4: Judge prompt and reply parser

**Files:**
- Create: `src/judge.ts`, `tests/judge.test.ts`

**Interfaces:**
- Consumes: `TUNING` from `data/tuning.ts`. `clamp` and `type Mood` from `src/mood.ts`.
- Produces (`src/judge.ts`):
  - `type JudgeInput = { mood: Mood; label: string; reasons: readonly string[]; userText: string; answer: string }`
  - `type JudgeVerdict = { dPleasure: number; dEnergy: number; isRepeat: boolean; reason: string }`
  - `const JUDGE_SYSTEM: string`
  - `buildJudgePrompt(input: JudgeInput): string`
  - `parseJudgeReply(text: string): JudgeVerdict | undefined`

- [ ] **Step 1: Write the failing tests**

`tests/judge.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { buildJudgePrompt, JUDGE_SYSTEM, parseJudgeReply } from '../src/judge.ts'

const INPUT = {
  mood: { pleasure: 0.123, energy: -0.456 },
  label: 'neutral',
  reasons: ['user asked about cache key', 'user thanked for cache fix'],
  userText: 'so it is the cache key?',
  answer: ':)  Yes, that is it.',
}

test('the system prompt asks for JSON with the four fields', () => {
  for (const field of ['dPleasure', 'dEnergy', 'isRepeat', 'reason']) {
    expect(JUDGE_SYSTEM).toContain(field)
  }
})

test('buildJudgePrompt carries mood, reasons, message and reply', () => {
  const prompt = buildJudgePrompt(INPUT)
  expect(prompt).toContain('neutral (pleasure 0.12, energy -0.46)')
  expect(prompt).toContain('- user asked about cache key')
  expect(prompt).toContain('so it is the cache key?')
  expect(prompt).toContain(':)  Yes, that is it.')
})

test('buildJudgePrompt says when there are no reasons yet', () => {
  expect(buildJudgePrompt({ ...INPUT, reasons: [] })).toContain('(none yet)')
})

test('buildJudgePrompt cuts message and reply to 2000 characters', () => {
  const prompt = buildJudgePrompt({ ...INPUT, userText: 'x'.repeat(200_000), answer: 'y'.repeat(5000) })
  expect(prompt).toContain('x'.repeat(2000))
  expect(prompt).not.toContain('x'.repeat(2001))
  expect(prompt).not.toContain('y'.repeat(2001))
})

test('parseJudgeReply reads a clean reply', () => {
  expect(parseJudgeReply('{"dPleasure":0.2,"dEnergy":-0.1,"isRepeat":false,"reason":"user thanked"}'))
    .toEqual({ dPleasure: 0.2, dEnergy: -0.1, isRepeat: false, reason: 'user thanked' })
})

test('parseJudgeReply tolerates prose around the JSON', () => {
  const verdict = parseJudgeReply('Sure:\n{"dPleasure":0.1,"dEnergy":0,"isRepeat":true,"reason":"asked again"}\nDone.')
  expect(verdict?.isRepeat).toBe(true)
})

test('parseJudgeReply clamps deltas, cuts the reason, defaults isRepeat', () => {
  const verdict = parseJudgeReply(
    '{"dPleasure":2,"dEnergy":-9,"isRepeat":"yes","reason":"one two three four five six seven eight nine ten eleven twelve thirteen"}',
  )
  expect(verdict).toEqual({
    dPleasure: 0.5,
    dEnergy: -0.5,
    isRepeat: false,
    reason: 'one two three four five six seven eight nine ten eleven twelve',
  })
})

test('parseJudgeReply rejects replies without usable numbers', () => {
  expect(parseJudgeReply('no json here')).toBeUndefined()
  expect(parseJudgeReply('{bad json}')).toBeUndefined()
  expect(parseJudgeReply('{"dPleasure":"high","dEnergy":0}')).toBeUndefined()
  expect(parseJudgeReply('[1,2]')).toBeUndefined()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL. `tests/judge.test.ts` cannot resolve `../src/judge.ts`.

- [ ] **Step 3: Implement `src/judge.ts`**

```ts
import { TUNING } from '../data/tuning.ts'
import { clamp, type Mood } from './mood.ts'

export type JudgeInput = {
  readonly mood: Mood
  readonly label: string
  readonly reasons: readonly string[]
  readonly userText: string
  readonly answer: string
}

export type JudgeVerdict = {
  readonly dPleasure: number
  readonly dEnergy: number
  readonly isRepeat: boolean
  readonly reason: string
}

export const JUDGE_SYSTEM = [
  'You track the mood of an AI coding assistant talking with a user.',
  'Mood has two axes from -1 to 1: pleasure (unhappy to happy) and energy (calm to worked up).',
  'Given the current mood, the recent reasons, the latest user message and the assistant reply, decide how this exchange changes the mood.',
  'Thanks, praise and the user reaching a correct conclusion raise pleasure. Repeated or rephrased questions, going in circles and complaints lower pleasure and raise energy. Routine exchanges change little.',
  'Set isRepeat to true only when the user asked again, in any wording, something the recent reasons show they already asked.',
  'The reason names the topic, for example "user rephrased cache key question".',
  'Reply with JSON only, no prose: {"dPleasure": number, "dEnergy": number, "isRepeat": boolean, "reason": string}.',
  'Each change is between -0.5 and 0.5. The reason is at most 12 words.',
].join('\n')

const cut = (s: string): string => s.slice(0, TUNING.judge.inputChars)

export function buildJudgePrompt(input: JudgeInput): string {
  const reasons = input.reasons.length === 0 ? '(none yet)' : input.reasons.map(r => `- ${r}`).join('\n')
  return [
    `Current mood: ${input.label} (pleasure ${input.mood.pleasure.toFixed(2)}, energy ${input.mood.energy.toFixed(2)})`,
    `Recent reasons, oldest first:\n${reasons}`,
    `User message:\n<user>\n${cut(input.userText)}\n</user>`,
    `Assistant reply:\n<assistant>\n${cut(input.answer)}\n</assistant>`,
  ].join('\n\n')
}

export function parseJudgeReply(text: string): JudgeVerdict | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.dPleasure !== 'number' || !Number.isFinite(r.dPleasure)) return undefined
  if (typeof r.dEnergy !== 'number' || !Number.isFinite(r.dEnergy)) return undefined
  const cap = TUNING.judge.deltaCap
  const words = typeof r.reason === 'string' ? r.reason.trim().split(/\s+/).filter(Boolean) : []
  return {
    dPleasure: clamp(r.dPleasure, -cap, cap),
    dEnergy: clamp(r.dEnergy, -cap, cap),
    isRepeat: r.isRepeat === true,
    reason: words.slice(0, TUNING.judge.reasonWords).join(' '),
  }
}
```

- [ ] **Step 4: Run tests and type-check**

```bash
claude plugin test .
npx --yes -p typescript@5.6.3 tsc -p .
```
Expected: all tests pass, tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/judge.ts tests/judge.test.ts
git commit -m "feat: add background judge prompt and verdict parser"
```

---

### Task 5: Session state and per-turn steps

**Files:**
- Create: `src/state.ts`, `src/step.ts`, `tests/state.test.ts`, `tests/step.test.ts`
- Modify: `tests/helpers.ts` (append `memoryKV`)

**Interfaces:**
- Consumes: `TUNING` from `data/tuning.ts`. `addDelta`, `applyShift`, `cellOf`, `drift`, `type Mood` from `src/mood.ts`. `evaluateRules` from `src/rules.ts`. `type JudgeVerdict` from `src/judge.ts`.
- Produces:
  - `src/state.ts`:
    - `type HistoryEntry`, `type SessionRecord` (spec §7.1), `type PendingJudge = JudgeVerdict & { turn: number }`
    - `type KV = { get(key): Promise<unknown>; set(key, value): Promise<void>; delete(key): Promise<void>; keys(): Promise<string[]> }`
    - `sessionKey(id)`, `judgeKey(id)`
    - `freshRecord(now)`, `isRecord(x)`
    - `serial<T>(task: () => Promise<T>): Promise<T>`
    - `loadRecord(kv, id, now)`, `saveRecord(kv, id, rec)`
    - `takePending(kv, id): Promise<PendingJudge[]>`, `addPending(kv, id, p)`
    - `prune(kv, now): Promise<number>`
  - `src/step.ts`:
    - `onUserMessage(rec, pending, text, isHuman, now): SessionRecord`
    - `onTurnEnd(rec, answer, now): SessionRecord`
    - `markJudgeFailed(rec, turn, kind): SessionRecord`
  - `tests/helpers.ts`: `memoryKV(initial?)`, which returns a `KV` with a `data: Map<string, unknown>`

- [ ] **Step 1: Append `memoryKV` to `tests/helpers.ts`**

The whole file afterwards:
```ts
import type { KV } from '../src/state.ts'

export const r3 = (n: number): number => Math.round(n * 1000) / 1000 + 0

export function memoryKV(initial: Readonly<Record<string, unknown>> = {}): KV & { readonly data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial))
  return {
    data,
    get: async key => data.get(key),
    set: async (key, value) => {
      data.set(key, JSON.parse(JSON.stringify(value)))
    },
    delete: async key => {
      data.delete(key)
    },
    keys: async () => [...data.keys()],
  }
}
```

- [ ] **Step 2: Write the failing state tests**

`tests/state.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import {
  addPending, freshRecord, judgeKey, loadRecord, prune, saveRecord, serial, sessionKey, takePending,
} from '../src/state.ts'
import { memoryKV } from './helpers.ts'

const DAY = 24 * 60 * 60 * 1000

test('a missing record loads as fresh neutral', async () => {
  const rec = await loadRecord(memoryKV(), 'S1', 500)
  expect(rec).toEqual(freshRecord(500))
  expect(rec.suggested).toBe(':|')
  expect(rec.isOn).toBe(true)
})

test('corrupt or old-version records load as fresh neutral', async () => {
  const kv = memoryKV({ [sessionKey('A')]: { v: 0, pleasure: 1 }, [sessionKey('B')]: 'garbage' })
  expect(await loadRecord(kv, 'A', 7)).toEqual(freshRecord(7))
  expect(await loadRecord(kv, 'B', 7)).toEqual(freshRecord(7))
})

test('a saved record loads back', async () => {
  const kv = memoryKV()
  const rec = { ...freshRecord(1), pleasure: 0.4, turn: 3 }
  await saveRecord(kv, 'S1', rec)
  expect(await loadRecord(kv, 'S1', 99)).toEqual(rec)
})

test('pending verdicts come back in turn order, once, without junk', async () => {
  const kv = memoryKV()
  await addPending(kv, 'S1', { turn: 2, dPleasure: 0.1, dEnergy: 0, isRepeat: false, reason: 'b' })
  await addPending(kv, 'S1', { turn: 1, dPleasure: 0.2, dEnergy: 0, isRepeat: false, reason: 'a' })
  kv.data.set(judgeKey('S1'), [...(kv.data.get(judgeKey('S1')) as unknown[]), { turn: 'x' }, 42])
  const pending = await takePending(kv, 'S1')
  expect(pending.map(p => p.reason)).toEqual(['a', 'b'])
  expect(await takePending(kv, 'S1')).toEqual([])
})

test('prune drops sessions older than 7 days and beyond the newest 200', async () => {
  const now = 1000 * DAY
  const seed: Record<string, unknown> = {
    [sessionKey('old')]: { ...freshRecord(now - 8 * DAY) },
    [judgeKey('old')]: [],
    [sessionKey('broken')]: 'garbage',
  }
  for (let i = 0; i < 201; i++) seed[sessionKey(`s${i}`)] = freshRecord(now - i)
  const kv = memoryKV(seed)
  const dropped = await prune(kv, now)
  expect(dropped).toBe(3)
  expect(kv.data.has(sessionKey('old'))).toBe(false)
  expect(kv.data.has(judgeKey('old'))).toBe(false)
  expect(kv.data.has(sessionKey('broken'))).toBe(false)
  expect(kv.data.has(sessionKey('s0'))).toBe(true)
  expect(kv.data.has(sessionKey('s200'))).toBe(false)
})

test('serial runs tasks one at a time in call order', async () => {
  const order: string[] = []
  let release: () => void = () => undefined
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const a = serial(async () => {
    await gate
    order.push('a')
  })
  const b = serial(async () => {
    order.push('b')
  })
  release()
  await Promise.all([a, b])
  expect(order).toEqual(['a', 'b'])
})

test('serial keeps going after a task throws', async () => {
  const failed = await serial(async () => {
    throw new Error('boom')
  }).then(() => 'ok', () => 'failed')
  expect(failed).toBe('failed')
  expect(await serial(async () => 'next')).toBe('next')
})
```

- [ ] **Step 3: Write the failing step tests**

`tests/step.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { tokenize } from '../src/rules.ts'
import { freshRecord, type SessionRecord } from '../src/state.ts'
import { markJudgeFailed, onTurnEnd, onUserMessage } from '../src/step.ts'
import { r3 } from './helpers.ts'

const NOW = 1000

test('a first plain message stays neutral and opens turn 1', () => {
  const rec = onUserMessage(freshRecord(0), [], 'how do I read a file in python', true, NOW)
  expect(rec.turn).toBe(1)
  expect(rec.suggested).toBe(':|')
  expect(rec.recentTokens).toEqual([tokenize('how do I read a file in python')])
  expect(rec.history).toEqual([{ turn: 1, at: NOW, before: [0, 0], after: [0, 0], emoticon: ':|', causes: [] }])
})

test('thanks suggests :)', () => {
  const rec = onUserMessage(freshRecord(0), [], 'thanks!', true, NOW)
  expect(r3(rec.pleasure)).toBe(0.35)
  expect(rec.suggested).toBe(':)')
  expect(rec.history.at(-1)?.causes).toEqual(['rule:thanks'])
})

test('pending verdicts apply in order before drift and are logged', () => {
  const pending = [
    { turn: 1, dPleasure: 0.2, dEnergy: 0, isRepeat: false, reason: 'a' },
    { turn: 2, dPleasure: 0.2, dEnergy: 0, isRepeat: false, reason: 'b' },
  ]
  const rec = onUserMessage(freshRecord(0), pending, 'ok', true, NOW)
  expect(r3(rec.pleasure)).toBe(0.34)
  expect(rec.suggested).toBe(':)')
  expect(rec.history.at(-1)?.causes).toEqual(['judge:a', 'judge:b'])
})

test('prompts the user did not type skip the rules but still drift', () => {
  const start: SessionRecord = { ...freshRecord(0), pleasure: 0.4 }
  const rec = onUserMessage(start, [], 'thanks', false, NOW)
  expect(r3(rec.pleasure)).toBe(0.34)
  expect(rec.recentTokens).toEqual([])
  expect(rec.turn).toBe(1)
  expect(rec.history.at(-1)?.causes).toEqual([])
})

test('a judge-detected repeat makes the next repeat escalate', () => {
  const first = onUserMessage(freshRecord(0), [], 'how do I read a file in python', true, NOW)
  const pending = [{ turn: 1, dPleasure: -0.1, dEnergy: 0.1, isRepeat: true, reason: 'asked again' }]
  const second = onUserMessage(first, pending, "what's the way to read a file in python", true, NOW)
  expect(second.history.at(-1)?.causes).toEqual(['judge:asked again', 'repeat:2'])
  expect(second.repeatCount).toBe(2)
})

test('a non-repeat message resets the repeat count', () => {
  const start: SessionRecord = { ...freshRecord(0), repeatCount: 3, recentTokens: [tokenize('read file python')] }
  expect(onUserMessage(start, [], 'how can I parse json here', true, NOW).repeatCount).toBe(0)
})

test('recent tokens keep the last 5 and history keeps the last 50', () => {
  let rec = freshRecord(0)
  for (let i = 0; i < 60; i++) rec = onUserMessage(rec, [], `topic${i} alpha${i} beta${i}`, true, NOW + i)
  expect(rec.recentTokens).toHaveLength(5)
  expect(rec.history).toHaveLength(50)
  expect(rec.history[0]?.turn).toBe(11)
})

test('onTurnEnd records a neighbour shift on the turn entry', () => {
  const rec = onUserMessage(freshRecord(0), [], 'so it is the cache key?', true, NOW)
  const ended = onTurnEnd(rec, ':)  Yes, that is it.', NOW + 5)
  expect(ended.pleasure).toBe(0.34)
  expect(ended.history.at(-1)?.emoticon).toBe(':)')
  expect(ended.history.at(-1)?.causes).toEqual(['shift'])
  expect(ended.history.at(-1)?.after).toEqual([0.34, 0])
})

test('onTurnEnd ignores a missing emoticon and logs it', () => {
  const rec = onUserMessage(freshRecord(0), [], 'hello there friend', true, NOW)
  const ended = onTurnEnd(rec, 'Hello!', NOW + 5)
  expect(ended.pleasure).toBe(0)
  expect(ended.history.at(-1)?.causes).toEqual(['shift-ignored'])
})

test('markJudgeFailed tags only the matching turn', () => {
  let rec = onUserMessage(freshRecord(0), [], 'first message here', true, NOW)
  rec = onUserMessage(rec, [], 'second message here', true, NOW)
  const marked = markJudgeFailed(rec, 1, 'timeout')
  expect(marked.history[0]?.causes).toEqual(['judge-failed:timeout'])
  expect(marked.history[1]?.causes).toEqual([])
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL. `../src/state.ts` and `../src/step.ts` cannot be resolved.

- [ ] **Step 5: Implement `src/state.ts`**

```ts
import { TUNING } from '../data/tuning.ts'
import type { JudgeVerdict } from './judge.ts'

export type HistoryEntry = {
  readonly turn: number
  readonly at: number
  readonly before: readonly [number, number]
  readonly after: readonly [number, number]
  readonly emoticon: string
  readonly causes: readonly string[]
}

export type SessionRecord = {
  readonly v: 1
  readonly pleasure: number
  readonly energy: number
  readonly isOn: boolean
  readonly turn: number
  readonly suggested: string
  readonly repeatCount: number
  readonly recentTokens: readonly (readonly string[])[]
  readonly history: readonly HistoryEntry[]
  readonly updatedAt: number
}

export type PendingJudge = JudgeVerdict & { readonly turn: number }

export type KV = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

const SESSION_PREFIX = 'session:'

export const sessionKey = (id: string): string => `${SESSION_PREFIX}${id}`
export const judgeKey = (id: string): string => `judge:${id}`

export function freshRecord(now: number): SessionRecord {
  return {
    v: 1,
    pleasure: 0,
    energy: 0,
    isOn: true,
    turn: 0,
    suggested: ':|',
    repeatCount: 0,
    recentTokens: [],
    history: [],
    updatedAt: now,
  }
}

export function isRecord(x: unknown): x is SessionRecord {
  if (typeof x !== 'object' || x === null) return false
  const r = x as Record<string, unknown>
  return r.v === 1
    && typeof r.pleasure === 'number'
    && typeof r.energy === 'number'
    && typeof r.isOn === 'boolean'
    && typeof r.turn === 'number'
    && typeof r.suggested === 'string'
    && typeof r.repeatCount === 'number'
    && Array.isArray(r.recentTokens)
    && Array.isArray(r.history)
    && typeof r.updatedAt === 'number'
}

function isPending(x: unknown): x is PendingJudge {
  if (typeof x !== 'object' || x === null) return false
  const p = x as Record<string, unknown>
  return typeof p.turn === 'number'
    && typeof p.dPleasure === 'number'
    && typeof p.dEnergy === 'number'
    && typeof p.isRepeat === 'boolean'
    && typeof p.reason === 'string'
}

let tail: Promise<unknown> = Promise.resolve()

export function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task)
  tail = run.catch(() => undefined)
  return run
}

export async function loadRecord(kv: KV, id: string, now: number): Promise<SessionRecord> {
  const raw = await kv.get(sessionKey(id))
  return isRecord(raw) ? raw : freshRecord(now)
}

export async function saveRecord(kv: KV, id: string, rec: SessionRecord): Promise<void> {
  await kv.set(sessionKey(id), rec)
}

export async function takePending(kv: KV, id: string): Promise<PendingJudge[]> {
  const raw = await kv.get(judgeKey(id))
  if (raw === undefined) return []
  await kv.delete(judgeKey(id))
  return Array.isArray(raw) ? raw.filter(isPending).sort((a, b) => a.turn - b.turn) : []
}

export async function addPending(kv: KV, id: string, pending: PendingJudge): Promise<void> {
  const raw = await kv.get(judgeKey(id))
  const list = Array.isArray(raw) ? raw : []
  await kv.set(judgeKey(id), [...list, pending])
}

export async function prune(kv: KV, now: number): Promise<number> {
  const keys = (await kv.keys()).filter(key => key.startsWith(SESSION_PREFIX))
  const dated = await Promise.all(keys.map(async key => {
    const rec = await kv.get(key)
    return { key, at: isRecord(rec) ? rec.updatedAt : 0 }
  }))
  dated.sort((a, b) => b.at - a.at)
  const doomed = dated.filter((d, i) => now - d.at > TUNING.prune.maxAgeMs || i >= TUNING.prune.maxSessions)
  for (const d of doomed) {
    await kv.delete(d.key)
    await kv.delete(judgeKey(d.key.slice(SESSION_PREFIX.length)))
  }
  return doomed.length
}
```

- [ ] **Step 6: Implement `src/step.ts`**

```ts
import { TUNING } from '../data/tuning.ts'
import { addDelta, applyShift, cellOf, drift, type Mood } from './mood.ts'
import { evaluateRules } from './rules.ts'
import type { HistoryEntry, PendingJudge, SessionRecord } from './state.ts'

const pair = (m: Mood): readonly [number, number] => [m.pleasure, m.energy]

export function onUserMessage(
  rec: SessionRecord,
  pending: readonly PendingJudge[],
  text: string,
  isHuman: boolean,
  now: number,
): SessionRecord {
  const before: Mood = { pleasure: rec.pleasure, energy: rec.energy }
  const causes: string[] = []
  let mood = before
  let repeatCount = rec.repeatCount
  for (const p of pending) {
    mood = addDelta(mood, p.dPleasure, p.dEnergy)
    causes.push(`judge:${p.reason}`)
    const countedByRules = rec.history.some(h => h.turn === p.turn && h.causes.some(c => c.startsWith('repeat:')))
    if (p.isRepeat && !countedByRules) repeatCount += 1
  }
  mood = drift(mood)
  let recentTokens = rec.recentTokens
  if (isHuman) {
    const rules = evaluateRules(text, rec.recentTokens, repeatCount)
    mood = addDelta(mood, rules.dPleasure, rules.dEnergy)
    causes.push(...rules.causes)
    repeatCount = rules.isRepeat ? repeatCount + 1 : 0
    if (rules.tokens.length > 0) recentTokens = [...rec.recentTokens, rules.tokens].slice(-TUNING.repeat.window)
  }
  const turn = rec.turn + 1
  const suggested = cellOf(mood).emoticon
  const entry: HistoryEntry = { turn, at: now, before: pair(before), after: pair(mood), emoticon: suggested, causes }
  return {
    ...rec,
    pleasure: mood.pleasure,
    energy: mood.energy,
    turn,
    suggested,
    repeatCount,
    recentTokens,
    history: [...rec.history, entry].slice(-TUNING.historyLimit),
    updatedAt: now,
  }
}

export function onTurnEnd(rec: SessionRecord, answer: string, now: number): SessionRecord {
  const outcome = applyShift({ pleasure: rec.pleasure, energy: rec.energy }, rec.suggested, answer)
  const last = rec.history.at(-1)
  const history = last === undefined || last.turn !== rec.turn
    ? rec.history
    : [
        ...rec.history.slice(0, -1),
        {
          ...last,
          after: pair(outcome.mood),
          emoticon: outcome.emoticon ?? last.emoticon,
          causes: outcome.cause === 'none' ? last.causes : [...last.causes, outcome.cause],
        },
      ]
  return { ...rec, pleasure: outcome.mood.pleasure, energy: outcome.mood.energy, history, updatedAt: now }
}

export function markJudgeFailed(rec: SessionRecord, turn: number, kind: string): SessionRecord {
  return {
    ...rec,
    history: rec.history.map(h => (h.turn === turn ? { ...h, causes: [...h.causes, `judge-failed:${kind}`] } : h)),
  }
}
```

- [ ] **Step 7: Run tests and type-check**

```bash
claude plugin test .
npx --yes -p typescript@5.6.3 tsc -p .
```
Expected: all tests pass, tsc exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/state.ts src/step.ts tests/helpers.ts tests/state.test.ts tests/step.test.ts
git commit -m "feat: keep per-session mood state with history and judge queue"
```

---

### Task 6: Style text and prompt hooks

**Files:**
- Create: `src/style.ts`, `src/settings.ts`, `hooks/prompt.ts`, `tests/style.test.ts`, `tests/prompt.test.ts`
- Modify: `hooks/register.ts` (whole file), `tests/helpers.ts` (append engine bottoms)

**Interfaces:**
- Consumes: `GRID`, `type Cell` from `data/grid.ts`. `cellOf` from `src/mood.ts`. `loadRecord`, `saveRecord`, `serial`, `takePending`, `type SessionRecord` from `src/state.ts`. `onUserMessage` from `src/step.ts`.
- Produces:
  - `src/style.ts`:
    - `STYLE_SECTION_ID = 'sentiment:style'`
    - `renderGrid(grid?): string`, `styleSection(grid?): string`
    - `moodLine(cell): string`, `describeMood(rec): string`
  - `src/settings.ts`: `type Settings = { judge: boolean; judgeModel: string }`, `readSettings(options: PluginOptions): Settings`
  - `hooks/prompt.ts`: `isHuman(origin: PromptOrigin): boolean`, `wirePrompt(on: On): void`
  - `tests/helpers.ts`:
    - `SESSION`
    - `type Recorder = { contexts; judgeCalls; commands }`
    - `judgeAnswer(text)`, `installBottoms(on, judge?)`
    - `userPrompt(text, origin?)`, `finished(answer, turnId, extra?)`, `moodCommand(args)`, `COMPOSE`

- [ ] **Step 1: Write the failing style tests**

`tests/style.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { cellOf } from '../src/mood.ts'
import { freshRecord } from '../src/state.ts'
import { onTurnEnd, onUserMessage } from '../src/step.ts'
import { describeMood, moodLine, renderGrid, STYLE_SECTION_ID, styleSection } from '../src/style.ts'

test('the section id is the plugin-scoped one', () => {
  expect(STYLE_SECTION_ID).toBe('sentiment:style')
})

test('renderGrid lists rows worked up to calm, unhappy to happy', () => {
  expect(renderGrid()).toBe([
    '- worked up: >:( frustrated, :O surprised, :D excited',
    '- normal: :( unhappy, :| neutral, :) happy',
    '- calm: -_- weary, :\\ unsure, ^_^ content',
  ].join('\n'))
})

test('the style section carries the rules and the grid', () => {
  const text = styleSection()
  expect(text).toContain('Start every message you write to the user with that emoticon')
  expect(text).toContain('Never mention, name or explain your mood')
  expect(text).toContain('Code, commands, file contents, commit messages and')
  expect(text).toContain('  - normal: :( unhappy, :| neutral, :) happy')
})

test('moodLine names the emoticon, label and the one-step allowance', () => {
  expect(moodLine(cellOf({ pleasure: 0, energy: 0 }))).toBe('mood: :| neutral — start with ":|" — you may shift one step')
})

test('describeMood on a fresh record', () => {
  expect(describeMood(freshRecord(0))).toBe([
    ':| neutral (pleasure 0.00, energy 0.00)',
    'No turns yet.',
  ].join('\n'))
})

test('describeMood shows the last change and recent turns', () => {
  let rec = onUserMessage(freshRecord(0), [], 'thanks!', true, 1)
  rec = onTurnEnd(rec, ':)  Glad it helped.', 2)
  rec = { ...rec, isOn: false }
  expect(describeMood(rec)).toBe([
    ':) happy (pleasure 0.35, energy 0.00) — off for this session',
    'Last change: rule:thanks',
    'Recent turns:',
    '  1. :)  rule:thanks',
  ].join('\n'))
})
```

- [ ] **Step 2: Extend `tests/helpers.ts` with engine helpers**

The whole file afterwards (`r3` and `memoryKV` are unchanged from Task 5):
```ts
import type {
  ModelCompleteInput, ModelCompleteResult, On, PromptOrigin, PromptSubmitInput, TurnCompleteInput,
} from 'claude-code'
import type { KV } from '../src/state.ts'

export const r3 = (n: number): number => Math.round(n * 1000) / 1000 + 0

export function memoryKV(initial: Readonly<Record<string, unknown>> = {}): KV & { readonly data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial))
  return {
    data,
    get: async key => data.get(key),
    set: async (key, value) => {
      data.set(key, JSON.parse(JSON.stringify(value)))
    },
    delete: async key => {
      data.delete(key)
    },
    keys: async () => [...data.keys()],
  }
}

export const SESSION = 'S1'

const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

export type Recorder = {
  readonly contexts: (readonly string[] | undefined)[]
  readonly judgeCalls: ModelCompleteInput[]
  readonly commands: string[]
}

export function judgeAnswer(text: string): ModelCompleteResult {
  return { isAnswered: true, text, usage: NO_USAGE }
}

export const ROUTINE = judgeAnswer('{"dPleasure":0,"dEnergy":0,"isRepeat":false,"reason":"routine"}')

export function installBottoms(on: On, judge: ModelCompleteResult = ROUTINE): Recorder {
  const recorder: Recorder = { contexts: [], judgeCalls: [], commands: [] }
  on('session.id', () => SESSION)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.submit', ($, e) => {
    recorder.contexts.push(e.context)
    return { text: e.text, context: e.context }
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base prompt', scope: 'shared' as const }] }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('command.register', ($, e) => {
    recorder.commands.push(e.name)
    return { command: e.name }
  })
  on('model.complete', ($, e) => {
    recorder.judgeCalls.push(e)
    return judge
  })
  return recorder
}

export function userPrompt(text: string, origin: PromptOrigin = { kind: 'composer' }): PromptSubmitInput {
  return { text, wait: false, origin }
}

export function finished(answer: string, turnId: string, extra: Partial<TurnCompleteInput> = {}): TurnCompleteInput {
  return { answer, durationMs: 10, isAborted: false, turnId, reason: 'answer', ...extra } as TurnCompleteInput
}

export function moodCommand(args: string) {
  return {
    command: 'mood',
    args,
    origin: { kind: 'composer' } as const,
    presentation: { isFullscreen: false, columns: 100 },
  }
}

export const COMPOSE = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
} as const
```

- [ ] **Step 3: Write the failing prompt-hook tests**

`tests/prompt.test.ts`:
```ts
import { expect, mock, test } from 'claude-code/testing'
import { freshRecord, sessionKey } from '../src/state.ts'
import { COMPOSE, installBottoms, SESSION, userPrompt } from './helpers.ts'

const NEUTRAL_LINE = 'mood: :| neutral — start with ":|" — you may shift one step'

test('a first message gets the neutral mood line', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1000 })
  const rec = installBottoms(on)
  await $.prompt.submit(userPrompt('how do I read a file in python'))
  expect(rec.contexts).toEqual([[NEUTRAL_LINE]])
})

test('context from other plugins is kept', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const rec = installBottoms(on)
  await $.prompt.submit({ ...userPrompt('hello there friend'), context: ['other'] })
  expect(rec.contexts[0]).toEqual(['other', NEUTRAL_LINE])
})

test('thanks makes the next line :)', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const rec = installBottoms(on)
  await $.prompt.submit(userPrompt('thanks a lot'))
  expect(rec.contexts[0]).toEqual([expect.stringContaining('mood: :) happy')])
})

test('prompts the user did not type get the line but no rules', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const rec = installBottoms(on)
  await $.prompt.submit(userPrompt('thanks', { kind: 'task-notification' }))
  expect(rec.contexts[0]).toEqual([NEUTRAL_LINE])
})

test('when mood is off nothing is attached', async ($, on) => {
  mock.store(on, { [sessionKey(SESSION)]: { ...freshRecord(0), isOn: false } })
  mock.clock(on)
  const rec = installBottoms(on)
  await $.prompt.submit(userPrompt('thanks a lot'))
  expect(rec.contexts[0]).toBeUndefined()
})

test('a corrupt stored record starts over at neutral', async ($, on) => {
  mock.store(on, { [sessionKey(SESSION)]: 'garbage' })
  mock.clock(on)
  const rec = installBottoms(on)
  await $.prompt.submit(userPrompt('hello there friend'))
  expect(rec.contexts[0]).toEqual([NEUTRAL_LINE])
})

test('compose appends the style section last when on', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  installBottoms(on)
  const out = await $.prompt.compose(COMPOSE)
  expect(out.sections.map(s => s.id)).toEqual(['intro', 'sentiment:style'])
  expect(out.sections[1]?.scope).toBe('session')
  expect(out.sections[1]?.text).toContain('>:( frustrated')
})

test('compose leaves the prompt alone when off', async ($, on) => {
  mock.store(on, { [sessionKey(SESSION)]: { ...freshRecord(0), isOn: false } })
  mock.clock(on)
  installBottoms(on)
  const out = await $.prompt.compose(COMPOSE)
  expect(out.sections.map(s => s.id)).toEqual(['intro'])
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL. `../src/style.ts` cannot be resolved, and the prompt tests get no context because `register` is empty.

- [ ] **Step 5: Implement `src/style.ts`**

```ts
import { GRID, type Cell } from '../data/grid.ts'
import { cellOf } from './mood.ts'
import type { SessionRecord } from './state.ts'

export const STYLE_SECTION_ID = 'sentiment:style'

const ROWS = [['high', 'worked up'], ['mid', 'normal'], ['low', 'calm']] as const
const COLUMNS = ['low', 'mid', 'high'] as const

export function renderGrid(grid: readonly Cell[] = GRID): string {
  return ROWS.map(([energy, name]) => {
    const cells = COLUMNS
      .map(pleasure => grid.find(c => c.energy === energy && c.pleasure === pleasure))
      .filter((c): c is Cell => c !== undefined)
    return `- ${name}: ${cells.map(c => `${c.emoticon} ${c.label}`).join(', ')}`
  }).join('\n')
}

export function styleSection(grid: readonly Cell[] = GRID): string {
  return [
    'You have a mood. Each user message comes with a line like',
    '`mood: :| neutral — start with ":|" — you may shift one step`.',
    '- Start every message you write to the user with that emoticon followed by two spaces.',
    "  You may instead use a neighbouring emoticon from this grid when the user's message clearly",
    '  warrants it (for example they concluded correctly or thanked you). Rows go from worked up',
    '  to calm, and each row goes from unhappy to happy:',
    renderGrid(grid).replace(/^/gm, '  '),
    '- Never mention, name or explain your mood. The emoticon is the only sign of it.',
    '- Keep replies short and simple: plain words, the fewest sentences that fully answer,',
    '  no jargon. When the user asks for technical detail, give full detail in that reply.',
    '- Sound like a person, not a manual.',
    '- These rules apply to chat text only. Code, commands, file contents, commit messages and',
    '  PR text are written normally and in full.',
    '- Your mood never lowers the quality or completeness of your help.',
  ].join('\n')
}

export function moodLine(cell: Cell): string {
  return `mood: ${cell.emoticon} ${cell.label} — start with "${cell.emoticon}" — you may shift one step`
}

const causesText = (causes: readonly string[]): string => (causes.length === 0 ? 'drift only' : causes.join(', '))

export function describeMood(rec: SessionRecord): string {
  const cell = cellOf(rec)
  const off = rec.isOn ? '' : ' — off for this session'
  const lines = [`${cell.emoticon} ${cell.label} (pleasure ${rec.pleasure.toFixed(2)}, energy ${rec.energy.toFixed(2)})${off}`]
  const last = rec.history.at(-1)
  if (last === undefined) {
    lines.push('No turns yet.')
    return lines.join('\n')
  }
  lines.push(`Last change: ${causesText(last.causes)}`, 'Recent turns:')
  for (const h of rec.history.slice(-5)) lines.push(`  ${h.turn}. ${h.emoticon}  ${causesText(h.causes)}`)
  return lines.join('\n')
}
```

- [ ] **Step 6: Implement `src/settings.ts`**

```ts
import type { PluginOptions } from 'claude-code'

export type Settings = { readonly judge: boolean; readonly judgeModel: string }

export function readSettings(options: PluginOptions): Settings {
  const model = options.judgeModel
  return {
    judge: options.judge !== false,
    judgeModel: typeof model === 'string' && model !== '' ? model : 'haiku',
  }
}
```

- [ ] **Step 7: Implement `hooks/prompt.ts`**

If the Task 1 probe notes give a test that tells subagent compose requests apart, add `if (<that test>) return composed` as the first line after `const composed = await next(e)`.

```ts
import type { EngineInterface, On, PromptOrigin } from 'claude-code'
import { GRID } from '../data/grid.ts'
import { cellOf } from '../src/mood.ts'
import { loadRecord, saveRecord, serial, takePending } from '../src/state.ts'
import { onUserMessage } from '../src/step.ts'
import { moodLine, STYLE_SECTION_ID, styleSection } from '../src/style.ts'

const STYLE_TEXT = styleSection(GRID)

export function isHuman(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge'
}

async function nextMoodLine($: EngineInterface, text: string, human: boolean): Promise<string | undefined> {
  const id = await $.session.id()
  const now = await $.clock.now()
  return serial(async () => {
    const rec = await loadRecord($.store, id, now)
    if (!rec.isOn) return undefined
    const pending = await takePending($.store, id)
    const updated = onUserMessage(rec, pending, text, human, now)
    await saveRecord($.store, id, updated)
    return moodLine(cellOf(updated))
  })
}

export function wirePrompt(on: On): void {
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const rec = await loadRecord($.store, await $.session.id(), await $.clock.now())
    if (!rec.isOn) return composed
    return { sections: [...composed.sections, { id: STYLE_SECTION_ID, text: STYLE_TEXT, scope: 'session' as const }] }
  })

  on('prompt.submit', async ($, e, next) => {
    const line = await nextMoodLine($, e.text, isHuman(e.origin))
    return line === undefined ? next(e) : next({ ...e, context: [...(e.context ?? []), line] })
  }).catch(($, e, next) => next(e))
}
```

- [ ] **Step 8: Wire it in `hooks/register.ts`**

```ts
import type { Register } from 'claude-code'
import { wirePrompt } from './prompt.ts'

export const register: Register = on => {
  wirePrompt(on)
}
```

- [ ] **Step 9: Run tests, type-check and validate**

```bash
claude plugin test .
npx --yes -p typescript@5.6.3 tsc -p .
claude plugin validate .
```
Expected:
- All tests pass and tsc exits 0.
- validate lists hooks on `prompt.compose` and `prompt.submit`, the latter as a `gating hook with .catch`.

- [ ] **Step 10: Commit**

```bash
git add src/style.ts src/settings.ts hooks/prompt.ts hooks/register.ts tests/helpers.ts tests/style.test.ts tests/prompt.test.ts
git commit -m "feat: start every reply with the mood emoticon in a short, simple style"
```

---

### Task 7: `/mood` command and session start

**Files:**
- Create: `hooks/command.ts`, `tests/command.test.ts`
- Modify: `hooks/register.ts` (whole file)
- Delete: `tests/smoke.test.ts`. Once `session.start` calls `$.command.register` and `$.clock.now`, its bare test has no bottoms for them, and `tests/command.test.ts` covers session start instead.

**Interfaces:**
- Consumes: `loadRecord`, `prune`, `saveRecord`, `serial` from `src/state.ts`. `describeMood` from `src/style.ts`. `wirePrompt` from `hooks/prompt.ts`.
- Produces: `hooks/command.ts`, which exports `USAGE: string` and `wireCommand(on: On): void`

- [ ] **Step 1: Write the failing tests**

`tests/command.test.ts`:
```ts
import { expect, mock, test } from 'claude-code/testing'
import { installBottoms, moodCommand, userPrompt } from './helpers.ts'

const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const

test('session start registers /mood', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  const rec = installBottoms(on)
  await $.session.start(START)
  await clock.settle()
  expect(rec.commands).toEqual(['mood'])
})

test('/mood on a fresh session shows neutral and no turns', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  installBottoms(on)
  await $.session.start(START)
  const out = await $.command.run(moodCommand(''))
  expect(out.text).toBe(':| neutral (pleasure 0.00, energy 0.00)\nNo turns yet.')
})

test('/mood off stops the mood line and /mood on brings it back', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const rec = installBottoms(on)
  await $.session.start(START)
  expect((await $.command.run(moodCommand('off'))).text).toBe('Mood is off for this session.')
  await $.prompt.submit(userPrompt('thanks a lot'))
  expect(rec.contexts[0]).toBeUndefined()
  expect((await $.command.run(moodCommand(' ON '))).text).toBe('Mood is on.')
  await $.prompt.submit(userPrompt('hello there friend'))
  expect(rec.contexts[1]).toEqual([expect.stringContaining('mood: :|')])
})

test('/mood with anything else shows usage', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  installBottoms(on)
  await $.session.start(START)
  expect((await $.command.run(moodCommand('loud'))).text).toBe('Usage: /mood, /mood on, /mood off')
})
```

- [ ] **Step 2: Remove the smoke test and run the tests to verify they fail**

```bash
git rm tests/smoke.test.ts
claude plugin test .
```
Expected: FAIL. No command is registered, and `command.run` falls to the bottom hook, which throws.

- [ ] **Step 3: Implement `hooks/command.ts`**

```ts
import type { On } from 'claude-code'
import { loadRecord, prune, saveRecord, serial } from '../src/state.ts'
import { describeMood } from '../src/style.ts'

export const USAGE = 'Usage: /mood, /mood on, /mood off'

export function wireCommand(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mood',
      description: 'Show the mood, or turn it on or off for this session',
      argumentHint: '[on|off]',
    })
    const now = await $.clock.now()
    void serial(() => prune($.store, now)).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'mood' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') return { text: USAGE }
    const id = await $.session.id()
    const now = await $.clock.now()
    return serial(async () => {
      const rec = await loadRecord($.store, id, now)
      if (arg === '') return { text: describeMood(rec) }
      await saveRecord($.store, id, { ...rec, isOn: arg === 'on', updatedAt: now })
      return { text: arg === 'on' ? 'Mood is on.' : 'Mood is off for this session.' }
    })
  })
}
```

- [ ] **Step 4: Wire it in `hooks/register.ts`**

```ts
import type { Register } from 'claude-code'
import { wireCommand } from './command.ts'
import { wirePrompt } from './prompt.ts'

export const register: Register = on => {
  wireCommand(on)
  wirePrompt(on)
}
```

- [ ] **Step 5: Run tests, type-check and validate**

```bash
claude plugin test .
npx --yes -p typescript@5.6.3 tsc -p .
claude plugin validate .
```
Expected:
- All tests pass and tsc exits 0.
- validate lists `command.run` for `mood` as `answers its own command:` and `session.start`.

- [ ] **Step 6: Commit**

```bash
git add hooks/command.ts hooks/register.ts tests/command.test.ts
git commit -m "feat: add /mood command to show or toggle the mood per session"
# tests/smoke.test.ts removal was staged by git rm in Step 2
```

---

### Task 8: Turn end, one-step shift and background judge

**Files:**
- Create: `hooks/turn.ts`, `tests/turn.test.ts`
- Modify: `hooks/register.ts` (whole file)

**Interfaces:**
- Consumes:
  - `TUNING`
  - `buildJudgePrompt`, `JUDGE_SYSTEM`, `parseJudgeReply` from `src/judge.ts`
  - `cellOf` from `src/mood.ts`
  - `type Settings`, `readSettings` from `src/settings.ts`
  - `addPending`, `loadRecord`, `saveRecord`, `serial`, `type SessionRecord` from `src/state.ts`
  - `markJudgeFailed`, `onTurnEnd` from `src/step.ts`
- Produces: `hooks/turn.ts`, which exports `wireTurn(on: On, settings: Settings): void` and `runJudge($, id, rec, userText, answer, model): Promise<void>`

If the Task 1 probe notes say the risk-1 fallback is needed, apply the alternative given in Step 3 instead of `$.clock.after`.

- [ ] **Step 1: Write the failing tests**

`tests/turn.test.ts`:
```ts
import { expect, mock, test } from 'claude-code/testing'
import { finished, installBottoms, judgeAnswer, moodCommand, userPrompt } from './helpers.ts'

const ASK = 'how do I read a file in python'
const THANKED = judgeAnswer('{"dPleasure":0.5,"dEnergy":0,"isRepeat":false,"reason":"user thanked for fix"}')

test('the judge runs after the turn, without the turn waiting, and lands on the next message', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1000 })
  const rec = installBottoms(on, THANKED)
  await $.prompt.submit(userPrompt(ASK))
  await $.turn.start({ text: ASK, turnId: 't1' })
  await $.turn.complete(finished(':|  Use open().', 't1'))
  expect(rec.judgeCalls).toHaveLength(0)
  await clock.advance(5)
  expect(rec.judgeCalls).toHaveLength(1)
  expect(rec.judgeCalls[0]?.model).toBe('haiku')
  expect(rec.judgeCalls[0]?.maxTokens).toBe(150)
  expect(rec.judgeCalls[0]?.timeoutMs).toBe(30000)
  expect(rec.judgeCalls[0]?.prompt).toContain(ASK)
  expect(rec.judgeCalls[0]?.prompt).toContain(':|  Use open().')
  await $.prompt.submit(userPrompt('ok and writing json'))
  expect(rec.contexts[1]).toEqual([expect.stringContaining('mood: :) happy')])
})

test('the judge uses the configured model', { options: { judge: true, judgeModel: 'sonnet' } }, async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  const rec = installBottoms(on)
  await $.prompt.submit(userPrompt(ASK))
  await $.turn.start({ text: ASK, turnId: 't1' })
  await $.turn.complete(finished(':|  Use open().', 't1'))
  await clock.advance(5)
  expect(rec.judgeCalls[0]?.model).toBe('sonnet')
})

test('no judge call when the judge setting is off', { options: { judge: false } }, async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  const rec = installBottoms(on)
  await $.prompt.submit(userPrompt(ASK))
  await $.turn.start({ text: ASK, turnId: 't1' })
  await $.turn.complete(finished(':|  Use open().', 't1'))
  await clock.advance(5)
  expect(rec.judgeCalls).toHaveLength(0)
})

test('a neighbour emoticon in the answer is recorded as a shift', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  installBottoms(on)
  await $.prompt.submit(userPrompt('so it is the cache key?'))
  await $.turn.start({ text: 'so it is the cache key?', turnId: 't1' })
  await $.turn.complete(finished(':)  Yes, that is it.', 't1'))
  await clock.advance(5)
  const out = await $.command.run(moodCommand(''))
  expect(out.text).toContain(':) happy (pleasure 0.34, energy 0.00)')
  expect(out.text).toContain('Last change: shift')
})

test('subagent and interrupted turns change nothing and are not judged', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  const rec = installBottoms(on)
  await $.prompt.submit(userPrompt(ASK))
  await $.turn.complete(finished(':D  Done!', 'sub1', { agentId: 'a1' }))
  await $.turn.start({ text: ASK, turnId: 't1' })
  await $.turn.complete(finished(':D  Partial', 't1', { reason: 'aborted', isAborted: true }))
  await clock.advance(5)
  expect(rec.judgeCalls).toHaveLength(0)
  const out = await $.command.run(moodCommand(''))
  expect(out.text).not.toContain('shift')
  expect(out.text).toContain(':| neutral')
})

test('a failed judge call is logged on its turn', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  installBottoms(on, { isAnswered: false, reason: 'api-error', status: 500, error: 'server_error', usage })
  await $.prompt.submit(userPrompt(ASK))
  await $.turn.start({ text: ASK, turnId: 't1' })
  await $.turn.complete(finished(':|  Use open().', 't1'))
  await clock.advance(5)
  expect((await $.command.run(moodCommand(''))).text).toContain('judge-failed:api-error')
})

test('an unparsable judge reply is logged on its turn', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  installBottoms(on, judgeAnswer('I feel fine.'))
  await $.prompt.submit(userPrompt(ASK))
  await $.turn.start({ text: ASK, turnId: 't1' })
  await $.turn.complete(finished(':|  Use open().', 't1'))
  await clock.advance(5)
  expect((await $.command.run(moodCommand(''))).text).toContain('judge-failed:unparsable')
})

test('two verdicts that land before the next message are both applied once', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  const rec = installBottoms(on, judgeAnswer('{"dPleasure":0.1,"dEnergy":0,"isRepeat":false,"reason":"fine"}'))
  await $.prompt.submit(userPrompt('first question about lists'))
  await $.turn.start({ text: 'first question about lists', turnId: 't1' })
  await $.turn.complete(finished(':|  Lists are ordered.', 't1'))
  await $.prompt.submit(userPrompt('second question about maps'))
  await $.turn.start({ text: 'second question about maps', turnId: 't2' })
  await $.turn.complete(finished(':|  Maps hold pairs.', 't2'))
  await clock.advance(5)
  expect(rec.judgeCalls).toHaveLength(2)
  await $.prompt.submit(userPrompt('third question about sets'))
  const out = await $.command.run(moodCommand(''))
  expect(out.text).toContain('Last change: judge:fine, judge:fine')
  await $.prompt.submit(userPrompt('fourth question about trees'))
  expect((await $.command.run(moodCommand(''))).text).toContain('Last change: drift only')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL. No judge calls are made and no shift is recorded.

- [ ] **Step 3: Implement `hooks/turn.ts`**

```ts
import type { EngineInterface, On } from 'claude-code'
import { TUNING } from '../data/tuning.ts'
import { buildJudgePrompt, JUDGE_SYSTEM, parseJudgeReply } from '../src/judge.ts'
import { cellOf } from '../src/mood.ts'
import type { Settings } from '../src/settings.ts'
import { addPending, loadRecord, saveRecord, serial, type SessionRecord } from '../src/state.ts'
import { markJudgeFailed, onTurnEnd } from '../src/step.ts'

export async function runJudge(
  $: EngineInterface,
  id: string,
  rec: SessionRecord,
  userText: string,
  answer: string,
  model: string,
): Promise<void> {
  const reasons = rec.history
    .flatMap(h => h.causes)
    .filter(c => c.startsWith('judge:'))
    .map(c => c.slice('judge:'.length))
    .slice(-TUNING.judge.historyReasons)
  const result = await $.model.complete({
    model,
    system: JUDGE_SYSTEM,
    prompt: buildJudgePrompt({ mood: rec, label: cellOf(rec).label, reasons, userText, answer }),
    maxTokens: TUNING.judge.maxTokens,
    timeoutMs: TUNING.judge.timeoutMs,
    effort: 'low',
  })
  const verdict = result.isAnswered ? parseJudgeReply(result.text) : undefined
  await serial(async () => {
    if (verdict !== undefined) {
      await addPending($.store, id, { turn: rec.turn, ...verdict })
      return
    }
    const kind = result.isAnswered ? 'unparsable' : result.reason
    const current = await loadRecord($.store, id, await $.clock.now())
    await saveRecord($.store, id, markJudgeFailed(current, rec.turn, kind))
  })
}

export function wireTurn(on: On, settings: Settings): void {
  const userTextByTurn = new Map<string, string>()

  on('turn.start', ($, e, next) => {
    userTextByTurn.set(e.turnId, e.text)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const userText = userTextByTurn.get(e.turnId) ?? ''
    userTextByTurn.delete(e.turnId)
    if (e.agentId !== undefined || e.reason !== 'answer') return next(e)
    const id = await $.session.id()
    const now = await $.clock.now()
    const ended = await serial(async () => {
      const rec = await loadRecord($.store, id, now)
      if (!rec.isOn) return undefined
      const updated = onTurnEnd(rec, e.answer, now)
      await saveRecord($.store, id, updated)
      return updated
    })
    if (ended !== undefined && settings.judge) {
      $.clock.after(1, () => {
        void runJudge($, id, ended, userText, e.answer, settings.judgeModel).catch(() => undefined)
      })
    }
    return next(e)
  })
}
```

**Risk-1 fallback.** Use this only if the probe notes say the timer approach failed. Replace the `$.clock.after(...)` block with `jobs.push(() => runJudge(...))`, where `jobs` is a `const jobs: (() => Promise<void>)[] = []` declared at the top of `wireTurn`. Then add the drain to `wireTurn`:
```ts
  on('session.start', async ($, e, next) => {
    $.clock.every(500, () => {
      const job = jobs.shift()
      if (job !== undefined) void job().catch(() => undefined)
    })
    return next(e)
  })
```
With the fallback, change `clock.advance(5)` in the tests to `clock.advance(600)`.

- [ ] **Step 4: Wire it in `hooks/register.ts`**

```ts
import type { Register } from 'claude-code'
import { readSettings } from '../src/settings.ts'
import { wireCommand } from './command.ts'
import { wirePrompt } from './prompt.ts'
import { wireTurn } from './turn.ts'

export const register: Register = (on, options) => {
  wireCommand(on)
  wirePrompt(on)
  wireTurn(on, readSettings(options))
}
```

- [ ] **Step 5: Run tests, type-check and validate**

```bash
claude plugin test .
npx --yes -p typescript@5.6.3 tsc -p .
claude plugin validate .
```
Expected:
- All tests pass and tsc exits 0.
- validate lists hooks on `session.start`, `command.run`, `prompt.compose`, `prompt.submit`, `turn.start` and `turn.complete`, plus calls to `$.model.complete` and `$.clock.after`.

- [ ] **Step 6: Commit**

```bash
git add hooks/turn.ts hooks/register.ts tests/turn.test.ts
git commit -m "feat: judge each exchange in the background and let Claude shift its mood one step"
```

---

### Task 9: README, CLAUDE.md and live verification

**Files:**
- Create: `README.md`, `CLAUDE.md`
- Modify: none (fix-ups found during live verification go to the file that owns the bug, with a test first)

**Interfaces:**
- Consumes: the finished plugin
- Produces: publish-ready docs. The live check results are recorded in the commit message body.

- [ ] **Step 1: Write `README.md`**

~~~markdown
# sentiment

Gives Claude Code a mood that changes as you talk. Every reply starts with an emoticon showing how Claude feels about the conversation, and replies stay short, simple and human.

```
              unhappy        neutral        happy
worked up     >:( frustrated  :O surprised   :D excited
normal        :(  unhappy     :|  neutral    :)  happy
calm          -_- weary       :\  unsure     ^_^ content
```

Claude starts at `:|`. Thanks and praise lift the mood. Asking the same question again, even in other words, wears it down. When you work something out correctly, Claude may brighten in the same reply. Mood drifts back toward neutral over a few calm turns, and a new session or `/clear` starts fresh.

Only the chat text changes. Code, commands, file edits, commit messages and PR text are written normally.

## Install

Requires Claude Code **2.1.296 or newer**. The plugin uses the mods API, which is in early access and may change between releases.

At the prompt of a terminal session:

```
/plugin install sentiment --marketplace <owner>/<repo>
```

Answer `y` to add the marketplace, then choose a scope.

## Use

| Command | What it does |
|---|---|
| `/mood` | Current mood, why it last changed, and the last five turns |
| `/mood off` | Plain Claude replies for this session |
| `/mood on` | Mood back on |

Settings in `/config`:
- **Background mood judge** (on by default): after each reply, a small model reviews the exchange and adjusts the mood. Off means instant rules only.
- **Judge model**: `haiku` (default) or `sonnet`.

## How it works

Each message you send goes through instant word rules (thanks, praise, complaints) and a repeat check, which compares word overlap with your last five messages. That takes milliseconds, so the mood is ready before Claude answers. After the reply, the judge model looks at the exchange in the background and its verdict applies to your next message. No reply ever waits for it.

## Privacy

The judge sends your latest message and Claude's reply (each cut to 2,000 characters) to the configured model, on your own Claude account. The plugin stores only mood numbers, word lists and the judge's short reasons in the plugin store. It never stores your messages. Sessions older than seven days are deleted.

## Conflicts

Other plugins that change Claude's tone (for example caveman) will clash with this one. Turn them off while using sentiment.
~~~

Before committing, check the probe notes from Task 1. If subagents can see the style section, add this line under **Conflicts**: `Subagents may also start their messages with an emoticon.` Fill in `<owner>/<repo>` only once the GitHub repository exists. Until then, leave the line exactly as written and mention it in the final report.

- [ ] **Step 2: Write `CLAUDE.md`**

~~~markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`sentiment` is a Claude Code **mod** (function hooks module, early-access API, Claude Code ≥ 2.1.296). It gives Claude a two-axis mood shown as a leading emoticon. Design: `docs/superpowers/specs/2026-10-11-sentiment-plugin-design.md`. Plan: `docs/superpowers/plans/2026-10-11-sentiment-plugin.md`.

## Commands

- `claude plugin test .`: runs every `tests/*.test.ts` against the engine (`claude-code/testing` kit). There is no per-file filter. To focus, use `describe` names or temporarily move other files.
- `claude plugin validate .`: manifest, marketplace and hooks module, and what the module hooks and calls.
- `npx --yes -p typescript@5.6.3 tsc -p .`: type-check. It needs `.claude-plugin/types/claude-code/index.d.ts` (gitignored). The engine writes it when an interactive session loads the folder (`claude --plugin-dir .`). Alternatively, copy `types/claude-code.d.ts` from the `plugin-authoring` skill.
- `claude --plugin-dir .`: run the plugin live in an interactive session. Saving a file hot-reloads it.

## Architecture

- `hooks/register.ts` only wires: `wireCommand` (session.start, `/mood`), `wirePrompt` (prompt.compose adds the `sentiment:style` system section, prompt.submit attaches the hidden mood line), `wireTurn` (turn.start keeps the user text in memory, turn.complete records Claude's emoticon and schedules the judge on `$.clock.after`).
- `src/` is pure logic: `mood.ts` (axes, bands, grid lookup, one-step shift), `rules.ts` (word rules, repeat detection), `judge.ts` (prompt and parser), `step.ts` (per-message and per-turn record updates), `style.ts` (all text Claude or the user sees). `state.ts` is the only store access: `session:<id>` records and `judge:<id>` pending verdicts, behind one in-module `serial` queue.
- `data/grid.ts` and `data/tuning.ts` hold every number, word list and grid cell. They change only with a release, and users cannot customise them.
- Hooks never await the judge. A verdict is stored, then applied by the next `prompt.submit`.
- Plugin files import each other with explicit `.ts` extensions. The module has no Node and no DOM, so everything goes through `$`.
~~~

- [ ] **Step 3: Run the full check**

```bash
claude plugin test .
npx --yes -p typescript@5.6.3 tsc -p .
claude plugin validate --strict .
```
Expected: all tests pass, tsc exits 0, and validate --strict reports no errors and no warnings. Fix any warning it names, for example missing manifest metadata such as `repository` or `license` that `--strict` asks for. Add only the fields it names.

- [ ] **Step 4: Live verification in a real session**

Ask the human partner to start a separate terminal in this folder:
```bash
claude --plugin-dir .
```
Their other tone plugins (caveman) should be off for the test. Have them run these five scenarios and report the leading emoticon of each reply plus the `/mood` output:
1. `hi, what does git stash do?` → reply starts with `:|`
2. `thanks, that helps!` → `:)`
3. Ask one question three times in different words (e.g. "how do I undo my last commit", "what's the way to revert the last commit", "undo last commit how") → it moves toward `>:(` by the third
4. Work something out correctly ("so `git reset --soft HEAD~1` keeps my changes staged?") → Claude may shift up one step, and `/mood` shows `shift`
5. `/mood off`, then any question → plain reply with no emoticon. Then `/mood on`.

After the second message, `/mood` should also show `judge:` reasons. That confirms the background judge runs live.

Each scenario that fails is a bug. Write a failing test in the owning task's test file, fix it, and re-run Step 3.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: add README and CLAUDE.md for the sentiment mod" -m "Live check: <scenario results as reported>"
```

---

### Task 10: Shape the branch history for release

Follows the user's commit discipline. The branch becomes the changelog.

**Files:** none changed. History only.

**Interfaces:**
- Consumes: the finished branch `feat/sentiment-plugin`
- Produces: the same tree as one `chore` commit plus `feat` commits a release note would list

- [ ] **Step 1: Tag the current head**

```bash
git tag pre-squash/sentiment-plugin
git log --oneline main..HEAD
```

- [ ] **Step 2: Rebuild the history from `main`**

The changelog blocks:
1. `chore: scaffold the sentiment mod, design docs and tooling`: `docs/`, manifest, marketplace, `hooks/hooks.json`, `tsconfig.json`, `.gitignore`, `CLAUDE.md`
2. `feat: Claude gets a mood that starts every reply with an emoticon and keeps replies short and simple`:
   - `data/`
   - `src/mood.ts`, `src/rules.ts`, `src/judge.ts`, `src/state.ts`, `src/step.ts`, `src/style.ts`, `src/settings.ts`
   - `hooks/prompt.ts`, `tests/helpers.ts`, their tests, `README.md`

   `src/judge.ts` goes here because `src/state.ts` imports its `JudgeVerdict` type.
3. `feat: /mood shows the mood and why it changed, and turns it on or off per session`: `hooks/command.ts`, its test
4. `feat: a background judge reads each exchange and adjusts the mood without slowing replies`: `hooks/turn.ts`, its test

`hooks/register.ts` grows across blocks 2–4. Each commit gets the version that imports only files already committed:
- Block 2: the Task 6 version (`wirePrompt` only).
- Block 3: the Task 7 version (`wireCommand` + `wirePrompt`).
- Block 4: the final version from the tag.

```bash
git reset --soft main
git restore --staged .
# block 1
git add docs .claude-plugin/plugin.json .claude-plugin/marketplace.json hooks/hooks.json tsconfig.json .gitignore CLAUDE.md
git commit -m "chore: scaffold the sentiment mod, design docs and tooling"
# block 2: first overwrite hooks/register.ts with the Task 6 version (Task 6, Step 8)
git add data src hooks/prompt.ts hooks/register.ts tests/helpers.ts tests/mood.test.ts tests/rules.test.ts tests/judge.test.ts tests/state.test.ts tests/step.test.ts tests/style.test.ts tests/prompt.test.ts README.md
git commit -m "feat: Claude gets a mood that starts every reply with an emoticon and keeps replies short and simple"
# block 3: first overwrite hooks/register.ts with the Task 7 version (Task 7, Step 4)
git add hooks/command.ts hooks/register.ts tests/command.test.ts
git commit -m "feat: /mood shows the mood and why it changed, and turns it on or off per session"
# block 4: restore the final hooks/register.ts from the tag
git checkout pre-squash/sentiment-plugin -- hooks/register.ts
git add hooks/turn.ts hooks/register.ts tests/turn.test.ts
git commit -m "feat: a background judge reads each exchange and adjusts the mood without slowing replies"
git status --short
```
Expected: `git status --short` prints nothing (every file is in a commit).

- [ ] **Step 3: Verify the tree is unchanged and tests pass**

```bash
git diff pre-squash/sentiment-plugin --stat
claude plugin test .
npx --yes -p typescript@5.6.3 tsc -p .
git log --oneline main..HEAD
```
Expected:
- The diff against the tag is empty.
- Tests pass and tsc exits 0.
- Four commits: 1 chore + 3 feat.

- [ ] **Step 4: Hand the push to the human partner**

Do not push. Report the four commit subjects and the tag name. The human partner runs the push (`git push -u origin feat/sentiment-plugin`, or `--force-with-lease` if it was pushed before) once a remote exists.
