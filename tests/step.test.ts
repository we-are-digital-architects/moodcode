import { expect, test } from 'claude-code/testing'
import { evaluateRules } from '../src/rules.ts'
import { freshRecord, type SessionRecord } from '../src/state.ts'
import { markJudgeFailed, onTurnEnd, onUserMessage } from '../src/step.ts'
import { r3 } from './helpers.ts'

const NOW = 1000

test('a first plain message stays neutral and opens turn 1', () => {
  const rec = onUserMessage(freshRecord(0), [], 'how do I read a file in python', true, NOW)
  expect(rec.turn).toBe(1)
  expect(rec.suggested).toBe('(^.^)')
  expect(rec.recentTokens).toEqual([evaluateRules('how do I read a file in python', [], 0).tokens])
  expect(rec.history).toEqual([{ turn: 1, at: NOW, before: [0, 0], after: [0, 0], emoticon: '(^.^)', causes: [] }])
})

test('thanks suggests (^o^)', () => {
  const rec = onUserMessage(freshRecord(0), [], 'thanks!', true, NOW)
  expect(r3(rec.pleasure)).toBe(0.35)
  expect(rec.suggested).toBe('(^o^)')
  expect(rec.history.at(-1)?.causes).toEqual(['rule:thanks'])
})

test('pending verdicts apply in order before drift and are logged', () => {
  const pending = [
    { turn: 1, dPleasure: 0.2, dEnergy: 0, isRepeat: false, reason: 'a' },
    { turn: 2, dPleasure: 0.2, dEnergy: 0, isRepeat: false, reason: 'b' },
  ]
  const rec = onUserMessage(freshRecord(0), pending, 'ok', true, NOW)
  expect(r3(rec.pleasure)).toBe(0.34)
  expect(rec.suggested).toBe('(^o^)')
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
  const start: SessionRecord = { ...freshRecord(0), repeatCount: 3, recentTokens: [evaluateRules('read file python', [], 0).tokens] }
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
  const ended = onTurnEnd(rec, '(^o^)  Yes, that is it.', NOW + 5)
  expect(ended.pleasure).toBe(0.34)
  expect(ended.history.at(-1)?.emoticon).toBe('(^o^)')
  expect(ended.history.at(-1)?.causes).toEqual(['shift'])
  expect(ended.history.at(-1)?.after).toEqual([0.34, 0])
})

test('onTurnEnd patches the turn it answers, not a message typed meanwhile', () => {
  let rec = onUserMessage(freshRecord(0), [], 'how do I read a file in python', true, NOW)
  rec = onUserMessage(rec, [], 'thanks a lot', true, NOW)
  const ended = onTurnEnd(rec, '(^.^)  Use open().', NOW + 5, { turn: 1, suggested: '(^.^)' })
  expect(r3(ended.pleasure)).toBe(0.35)
  expect(ended.history[0]?.causes).toEqual([])
  expect(ended.history[1]?.causes).toEqual(['rule:thanks'])
  expect(ended.history[1]?.emoticon).toBe('(^o^)')
})

test('onTurnEnd records a shift on the answered turn when a newer one exists', () => {
  let rec = onUserMessage(freshRecord(0), [], 'so it is the cache key?', true, NOW)
  rec = onUserMessage(rec, [], 'and the ttl too', true, NOW)
  const ended = onTurnEnd(rec, '(^o^)  Yes, that is it.', NOW + 5, { turn: 1, suggested: '(^.^)' })
  expect(ended.history[0]?.causes).toEqual(['shift'])
  expect(ended.history[0]?.emoticon).toBe('(^o^)')
  expect(ended.history[1]?.causes).toEqual([])
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
