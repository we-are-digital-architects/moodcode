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

export type TurnRef = { readonly turn: number; readonly suggested: string }

export function onTurnEnd(
  rec: SessionRecord,
  answer: string,
  now: number,
  answered: TurnRef = { turn: rec.turn, suggested: rec.suggested },
): SessionRecord {
  const outcome = applyShift({ pleasure: rec.pleasure, energy: rec.energy }, answered.suggested, answer)
  const history = rec.history.map(h => (h.turn !== answered.turn
    ? h
    : {
        ...h,
        after: h.turn === rec.turn ? pair(outcome.mood) : h.after,
        emoticon: outcome.emoticon ?? h.emoticon,
        causes: outcome.cause === 'none' ? h.causes : [...h.causes, outcome.cause],
      }))
  return { ...rec, pleasure: outcome.mood.pleasure, energy: outcome.mood.energy, history, updatedAt: now }
}

export function markJudgeFailed(rec: SessionRecord, turn: number, kind: string): SessionRecord {
  return {
    ...rec,
    history: rec.history.map(h => (h.turn === turn ? { ...h, causes: [...h.causes, `judge-failed:${kind}`] } : h)),
  }
}
