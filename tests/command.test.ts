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
  expect(out.text).toBe('(^.^) neutral (pleasure 0.00, energy 0.00)\nNo turns yet.')
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
  expect(rec.contexts[1]).toEqual([expect.stringContaining('mood: (^.^)')])
})

test('/mood with anything else shows usage', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  installBottoms(on)
  await $.session.start(START)
  expect((await $.command.run(moodCommand('loud'))).text).toBe('Usage: /mood, /mood on, /mood off')
})
