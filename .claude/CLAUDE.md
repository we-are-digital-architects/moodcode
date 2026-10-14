# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`moodcode` (working name: sentiment) is a Claude Code **mod** (function hooks module, early-access API, Claude Code ≥ 2.1.299). It gives Claude a two-axis mood shown as a face: Claude writes a one-line face at the start of each reply, and the terminal draws it as a 9x5 picture beside the reply whenever it changes. Design: `docs/superpowers/specs/2026-10-11-sentiment-plugin-design.md`. Plan: `docs/superpowers/plans/2026-10-11-sentiment-plugin.md`.

## Commands

- `claude plugin test .`: runs every `tests/*.test.ts` against the engine (`claude-code/testing` kit). There is no per-file or per-test filter.
- `claude plugin validate .`: manifest, marketplace and hooks module, and what the module hooks and calls.
- `npx --yes -p typescript@5.6.3 tsc -p .`: type-check. It needs `.claude-plugin/types/claude-code/index.d.ts` (gitignored). The engine writes it when an interactive session loads the folder (`claude --plugin-dir .`). Alternatively, copy `types/claude-code.d.ts` from the `plugin-authoring` skill.
- `claude --plugin-dir .`: run the plugin live in an interactive session. Saving a file hot-reloads it.

## Architecture

- `hooks/register.ts` only wires: `wireCommand` (session.start, `/mood`), `wirePrompt` (prompt.compose adds the `moodcode:style` system section, prompt.submit attaches the hidden mood line), `wireTurn` (turn.start snapshots the user text, turn number and suggested emoticon in memory, because a message typed mid-turn advances the record before the turn completes; turn.complete records Claude's emoticon against that snapshot and schedules the judge on `$.clock.after`), `wireFace` (session.append records which face each reply row shows in `$.state` `moodcode.shown`; ui.render on `AssistantMessage` strips the face and draws `data/faces.ts` beside the engine's own row when it changed).
- `src/` is pure logic: `mood.ts` (axes, bands, grid lookup, one-step shift), `rules.ts` (word rules, repeat detection), `judge.ts` (prompt and parser), `step.ts` (per-message and per-turn record updates), `style.ts` (all text Claude or the user sees), `display.ts` (which reply rows show their face, keyed by row id and by a hash of the reply's opening, rebuilt from the transcript on resume). `state.ts` holds all store logic over a small `KV` interface: `session:<id>` records and `judge:<id>` pending verdicts, behind one in-module `serial` queue.
- `data/grid.ts`, `data/tuning.ts` and `data/faces.ts` hold every number, word list, grid cell and drawn face. They change only with a release, and users cannot customise them.
- `$.state` values are declared in `types/index.d.ts`. A render hook only reads state; writes happen in session.append, session.start and `/mood`.
- An event may be hooked once per module without a matcher, so the one `session.start` hook (in `command.ts`) also replays the transcript for the faces.
- Hooks never await the judge. A verdict is stored, then applied by the next `prompt.submit`.
- Plugin files import each other with explicit `.ts` extensions. The module has no Node and no DOM, so everything goes through `$`.
- The engine refuses `$.store` passed as a value and follows `$` only into functions declared in the same file. Each hooks file therefore has its own `storeOf($)` that wraps `$.store.get/set/delete/keys` into a `KV`; never move it into `src/` or pass `$` across an import.
