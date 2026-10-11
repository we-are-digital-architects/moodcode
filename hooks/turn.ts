import type { EngineInterface, ModelCompleteResult, On } from 'claude-code'
import { TUNING } from '../data/tuning.ts'
import { buildJudgePrompt, JUDGE_SYSTEM, parseJudgeReply } from '../src/judge.ts'
import { cellOf } from '../src/mood.ts'
import type { Settings } from '../src/settings.ts'
import { addPending, type KV, loadRecord, saveRecord, serial, type SessionRecord } from '../src/state.ts'
import { markJudgeFailed, onTurnEnd, type TurnRef } from '../src/step.ts'

// The engine follows `$` only into functions of the same file and wants `$.store.<method>(…)` at each call site.
function storeOf($: EngineInterface): KV {
  return {
    get: key => $.store.get(key),
    set: (key, value) => $.store.set(key, value),
    delete: key => $.store.delete(key),
    keys: () => $.store.keys(),
  }
}

export async function runJudge(
  $: EngineInterface,
  id: string,
  rec: SessionRecord,
  userText: string,
  answer: string,
  model: string,
  turn: number,
): Promise<void> {
  const reasons = rec.history
    .flatMap(h => h.causes)
    .filter(c => c.startsWith('judge:'))
    .map(c => c.slice('judge:'.length))
    .slice(-TUNING.judge.historyReasons)
  let result: ModelCompleteResult | undefined
  try {
    result = await $.model.complete({
      model,
      system: JUDGE_SYSTEM,
      prompt: buildJudgePrompt({ mood: rec, label: cellOf(rec).label, reasons, userText, answer }),
      maxTokens: TUNING.judge.maxTokens,
      timeoutMs: TUNING.judge.timeoutMs,
      effort: 'low',
    })
  } catch {
    result = undefined // refused by the engine, e.g. a model the account cannot use
  }
  const verdict = result?.isAnswered === true ? parseJudgeReply(result.text) : undefined
  await serial(async () => {
    if (verdict !== undefined) {
      await addPending(storeOf($), id, { turn, ...verdict })
      return
    }
    const kind = result === undefined ? 'rejected' : result.isAnswered ? 'unparsable' : result.reason
    const current = await loadRecord(storeOf($), id, await $.clock.now())
    await saveRecord(storeOf($), id, markJudgeFailed(current, turn, kind))
  })
}

export function wireTurn(on: On, settings: Settings): void {
  // What each turn answers: a message typed while Claude is still answering advances the record
  // before this turn completes, so the turn keeps its own snapshot from turn.start.
  const turns = new Map<string, TurnRef & { readonly text: string }>()

  on('turn.start', async ($, e, next) => {
    const id = await $.session.id()
    const now = await $.clock.now()
    const rec = await serial(() => loadRecord(storeOf($), id, now))
    turns.set(e.turnId, { text: e.text, turn: rec.turn, suggested: rec.suggested })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const started = turns.get(e.turnId)
    turns.delete(e.turnId)
    if (e.agentId !== undefined || e.reason !== 'answer') return next(e)
    const id = await $.session.id()
    const now = await $.clock.now()
    const ended = await serial(async () => {
      const rec = await loadRecord(storeOf($), id, now)
      if (!rec.isOn) return undefined
      const answered: TurnRef = started ?? { turn: rec.turn, suggested: rec.suggested }
      const updated = onTurnEnd(rec, e.answer, now, answered)
      await saveRecord(storeOf($), id, updated)
      return { rec: updated, turn: answered.turn }
    })
    if (ended !== undefined && settings.judge) {
      const userText = started?.text ?? ''
      $.clock.after(1, () => {
        void runJudge($, id, ended.rec, userText, e.answer, settings.judgeModel, ended.turn).catch(() => undefined)
      })
    }
    return next(e)
  })
}
