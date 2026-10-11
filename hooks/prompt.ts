import type { EngineInterface, On, PromptOrigin } from 'claude-code'
import { GRID } from '../data/grid.ts'
import { cellOf } from '../src/mood.ts'
import { type KV, loadRecord, saveRecord, serial, takePending } from '../src/state.ts'
import { onUserMessage } from '../src/step.ts'
import { moodLine, STYLE_SECTION_ID, styleSection } from '../src/style.ts'

const STYLE_TEXT = styleSection(GRID)

// The engine follows `$` only into functions of the same file and wants `$.store.<method>(…)` at each call site.
function storeOf($: EngineInterface): KV {
  return {
    get: key => $.store.get(key),
    set: (key, value) => $.store.set(key, value),
    delete: key => $.store.delete(key),
    keys: () => $.store.keys(),
  }
}

export function isHuman(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge'
}

async function nextMoodLine($: EngineInterface, text: string, human: boolean): Promise<string | undefined> {
  const id = await $.session.id()
  const now = await $.clock.now()
  return serial(async () => {
    const rec = await loadRecord(storeOf($), id, now)
    if (!rec.isOn) return undefined
    const pending = await takePending(storeOf($), id)
    const updated = onUserMessage(rec, pending, text, human, now)
    await saveRecord(storeOf($), id, updated)
    return moodLine(cellOf(updated))
  })
}

export function wirePrompt(on: On): void {
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const rec = await loadRecord(storeOf($), await $.session.id(), await $.clock.now())
    if (!rec.isOn) return composed
    return { sections: [...composed.sections, { id: STYLE_SECTION_ID, text: STYLE_TEXT, scope: 'session' as const }] }
  })

  on('prompt.submit', async ($, e, next) => {
    const line = await nextMoodLine($, e.text, isHuman(e.origin))
    return line === undefined ? next(e) : next({ ...e, context: [...(e.context ?? []), line] })
  }).catch(($, e, next) => next(e))
}
