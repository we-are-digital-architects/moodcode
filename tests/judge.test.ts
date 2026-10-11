import { expect, test } from 'claude-code/testing'
import { buildJudgePrompt, JUDGE_SYSTEM, parseJudgeReply } from '../src/judge.ts'

const INPUT = {
  mood: { pleasure: 0.123, energy: -0.456 },
  label: 'neutral',
  reasons: ['user asked about cache key', 'user thanked for cache fix'],
  userText: 'so it is the cache key?',
  answer: '(^o^)  Yes, that is it.',
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
  expect(prompt).toContain('(^o^)  Yes, that is it.')
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
