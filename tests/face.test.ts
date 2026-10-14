import type { EngineInterface, On, RenderElement, RenderSurface, RenderViewport } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { installBottoms, moodCommand } from './helpers.ts'

const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const
const WIDE: RenderViewport = { columns: 120, rows: 40 }
const HEAD = /▄█████▄/

// Beneath the plugin the engine draws the reply's text; this bottom draws it in one keyed Box.
function drawText(on: On): void {
  on('ui.render', { component: 'AssistantMessage' }, ($: EngineInterface, e) => h('Box', { key: 'body' }, h('Text', null, e.props.text)) as RenderElement)
}

async function reply($: Engine, uuid: string, text: string, agentId?: string): Promise<void> {
  await $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
    door: 'response',
    origin: { kind: 'model', model: 'claude-opus-5-5' },
    uuid,
    ...(agentId === undefined ? {} : { agentId }),
  })
}

async function draw($: Engine, uuid: string, text: string, surface: RenderSurface = 'terminal', viewport: RenderViewport = WIDE) {
  const ui = await $.ui.mount({
    plugin: 'moodcode', surface, component: 'AssistantMessage', props: { text, isFirstOfReply: true }, requestId: uuid, viewport,
  })
  return { hasFace: (await ui.find({ text: HEAD })) !== undefined, body: (await ui.find({ key: 'body' }))?.text }
}

test('the first reply draws its face beside the text', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  installBottoms(on)
  drawText(on)
  await $.session.start(START)
  await reply($, 'u1', '(^.^)  Hello.')
  expect(await draw($, 'u1', '(^.^)  Hello.')).toEqual({ hasFace: true, body: 'Hello.' })
})

test('a reply with the same face as the one before draws none', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  installBottoms(on)
  drawText(on)
  await $.session.start(START)
  await reply($, 'u1', '(^.^)  Hello.')
  await reply($, 'u2', '(^.^)  Same again.')
  expect(await draw($, 'u2', '(^.^)  Same again.')).toEqual({ hasFace: false, body: 'Same again.' })
  expect((await draw($, 'u1', '(^.^)  Hello.')).hasFace).toBe(true)
})

test('a changed face is drawn again', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  installBottoms(on)
  drawText(on)
  await $.session.start(START)
  await reply($, 'u1', '(^.^)  Hello.')
  await reply($, 'u2', '(^o^)  Glad it helped.')
  expect(await draw($, 'u2', '(^o^)  Glad it helped.')).toEqual({ hasFace: true, body: 'Glad it helped.' })
})

test('a reply still streaming is compared with the last face', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  installBottoms(on)
  drawText(on)
  await $.session.start(START)
  await reply($, 'u1', '(^.^)  Hello.')
  expect((await draw($, 'u2', '(^.^)  Stre')).hasFace).toBe(false)
  expect((await draw($, 'u3', '(-_-)  Stre')).hasFace).toBe(true)
})

test('line style keeps the one-line face only when it changes', { options: { faceStyle: 'line' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on)
  installBottoms(on)
  drawText(on)
  await $.session.start(START)
  await reply($, 'u1', '(^.^)  Hello.')
  await reply($, 'u2', '(^.^)  Same again.')
  expect(await draw($, 'u1', '(^.^)  Hello.')).toEqual({ hasFace: false, body: '(^.^)  Hello.' })
  expect(await draw($, 'u2', '(^.^)  Same again.')).toEqual({ hasFace: false, body: 'Same again.' })
})

test('other surfaces and narrow terminals get the one-line face', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  installBottoms(on)
  drawText(on)
  await $.session.start(START)
  await reply($, 'u1', '(^.^)  Hello.')
  await reply($, 'u2', '(^.^)  Same again.')
  for (const surface of ['desktop', 'vscode'] as const) {
    expect(await draw($, 'u1', '(^.^)  Hello.', surface)).toEqual({ hasFace: false, body: '(^.^)  Hello.' })
    expect(await draw($, 'u2', '(^.^)  Same again.', surface)).toEqual({ hasFace: false, body: 'Same again.' })
  }
  expect(await draw($, 'u1', '(^.^)  Hello.', 'terminal', { columns: 50, rows: 40 })).toEqual({ hasFace: false, body: '(^.^)  Hello.' })
})

test('a reply without a face is left alone', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  installBottoms(on)
  drawText(on)
  await $.session.start(START)
  expect(await draw($, 'u1', 'Plain reply.')).toEqual({ hasFace: false, body: 'Plain reply.' })
})

test('subagent replies do not count as the last face', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  installBottoms(on)
  drawText(on)
  await $.session.start(START)
  await reply($, 's1', '(^.^)  From a subagent.', 'a1')
  await reply($, 'u1', '(^.^)  Hello.')
  expect((await draw($, 'u1', '(^.^)  Hello.')).hasFace).toBe(true)
})

test('/mood off and on start the faces over', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  installBottoms(on)
  drawText(on)
  await $.session.start(START)
  await reply($, 'u1', '(^.^)  Hello.')
  await $.command.run(moodCommand('off'))
  await $.command.run(moodCommand('on'))
  await reply($, 'u2', '(^.^)  Back again.')
  expect((await draw($, 'u2', '(^.^)  Back again.')).hasFace).toBe(true)
})

test('a resumed session rebuilds which faces showed from the transcript', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  installBottoms(on, undefined, [
    { role: 'user', text: 'hi', toolUses: [] },
    { role: 'assistant', text: '(^.^)  One.', toolUses: [] },
    { role: 'user', text: 'and?', toolUses: [] },
    { role: 'assistant', text: '(^.^)  Two.', toolUses: [] },
  ])
  drawText(on)
  await $.session.start(START)
  expect((await draw($, 'old1', '(^.^)  One.')).hasFace).toBe(true)
  expect((await draw($, 'old2', '(^.^)  Two.')).hasFace).toBe(false)
})
