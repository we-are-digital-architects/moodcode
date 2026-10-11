import { expect, mock, test } from 'claude-code/testing'
import { freshRecord, sessionKey } from '../src/state.ts'
import { COMPOSE, installBottoms, SESSION, userPrompt } from './helpers.ts'

const NEUTRAL_LINE = 'mood: (^.^) neutral — start with "(^.^)" — you may shift one step'

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

test('thanks makes the next line (^o^)', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const rec = installBottoms(on)
  await $.prompt.submit(userPrompt('thanks a lot'))
  expect(rec.contexts[0]).toEqual([expect.stringContaining('mood: (^o^) happy')])
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
  expect(out.sections.map(s => s.id)).toEqual(['intro', 'moodcode:style'])
  expect(out.sections[1]?.scope).toBe('session')
  expect(out.sections[1]?.text).toContain('(>_<) frustrated')
})

test('compose leaves the prompt alone when off', async ($, on) => {
  mock.store(on, { [sessionKey(SESSION)]: { ...freshRecord(0), isOn: false } })
  mock.clock(on)
  installBottoms(on)
  const out = await $.prompt.compose(COMPOSE)
  expect(out.sections.map(s => s.id)).toEqual(['intro'])
})
