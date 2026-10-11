import { expect, test } from 'claude-code/testing'
import { evaluateRules, hasPhrase, isRepeat, jaccard, tokenize } from '../src/rules.ts'
import { r3 } from './helpers.ts'

const FIRST_ASK = evaluateRules('how do I read a file in python', [], 0).tokens

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

test('a long paste is neither compared nor kept', () => {
  const big = Array.from({ length: 30000 }, (_, i) => `word${i}x`).join(' ')
  expect(big.length).toBeGreaterThan(200_000)
  const r = evaluateRules(big, [FIRST_ASK], 0)
  expect(r.tokens).toEqual([])
  expect(r.isRepeat).toBe(false)
})

test('kept tokens are short hashes, not the words', () => {
  const r = evaluateRules('how do I read a file in python', [], 0)
  expect(r.tokens).toHaveLength(3)
  expect(r.tokens.join(' ')).not.toContain('python')
  expect(r.tokens.join(' ')).not.toContain('file')
})
