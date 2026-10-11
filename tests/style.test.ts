import { expect, test } from 'claude-code/testing'
import { cellOf } from '../src/mood.ts'
import { freshRecord } from '../src/state.ts'
import { onTurnEnd, onUserMessage } from '../src/step.ts'
import { describeMood, moodLine, renderGrid, STYLE_SECTION_ID, styleSection } from '../src/style.ts'

test('the section id is the plugin-scoped one', () => {
  expect(STYLE_SECTION_ID).toBe('moodcode:style')
})

test('renderGrid lists rows worked up to calm, unhappy to happy', () => {
  expect(renderGrid()).toBe([
    '- worked up: (>_<) frustrated, (O_O) surprised, d(^O^)b excited',
    '- normal: (._.) unhappy, (^.^) neutral, (^o^) happy',
    '- calm: (-_-) weary, (o_O) unsure, (^-^) content',
  ].join('\n'))
})

test('the style section carries the rules and the grid', () => {
  const text = styleSection()
  expect(text).toContain('Start every message you write to the user with that emoticon')
  expect(text).toContain('Never mention, name or explain your mood')
  expect(text).toContain('Code, commands, file contents, commit messages and')
  expect(text).toContain('  - normal: (._.) unhappy, (^.^) neutral, (^o^) happy')
})

test('moodLine names the emoticon, label and the one-step allowance', () => {
  expect(moodLine(cellOf({ pleasure: 0, energy: 0 }))).toBe('mood: (^.^) neutral — start with "(^.^)" — you may shift one step')
})

test('describeMood on a fresh record', () => {
  expect(describeMood(freshRecord(0))).toBe([
    '(^.^) neutral (pleasure 0.00, energy 0.00)',
    'No turns yet.',
  ].join('\n'))
})

test('describeMood shows the last change and recent turns', () => {
  let rec = onUserMessage(freshRecord(0), [], 'thanks!', true, 1)
  rec = onTurnEnd(rec, '(^o^)  Glad it helped.', 2)
  rec = { ...rec, isOn: false }
  expect(describeMood(rec)).toBe([
    '(^o^) happy (pleasure 0.35, energy 0.00) — off for this session',
    'Last change: rule:thanks',
    'Recent turns:',
    '  1. (^o^)  rule:thanks',
  ].join('\n'))
})

test('the style section yields wording to other style instructions but keeps the emoticon', () => {
  const text = styleSection()
  expect(text).toContain('If another instruction sets your writing style or tone (for example a terse mode),')
  expect(text).toContain('follow it for wording and length. Still start every message with the mood emoticon.')
})
