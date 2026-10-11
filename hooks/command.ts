import type { EngineInterface, On } from 'claude-code'
import { type KV, loadRecord, prune, saveRecord, serial } from '../src/state.ts'
import { describeMood } from '../src/style.ts'

export const USAGE = 'Usage: /mood, /mood on, /mood off'

// The engine follows `$` only into functions of the same file and wants `$.store.<method>(…)` at each call site.
function storeOf($: EngineInterface): KV {
  return {
    get: key => $.store.get(key),
    set: (key, value) => $.store.set(key, value),
    delete: key => $.store.delete(key),
    keys: () => $.store.keys(),
  }
}

export function wireCommand(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mood',
      description: 'Show the mood, or turn it on or off for this session',
      argumentHint: '[on|off]',
    })
    const now = await $.clock.now()
    void serial(() => prune(storeOf($), now)).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'mood' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') return { text: USAGE }
    const id = await $.session.id()
    const now = await $.clock.now()
    return serial(async () => {
      const rec = await loadRecord(storeOf($), id, now)
      if (arg === '') return { text: describeMood(rec) }
      await saveRecord(storeOf($), id, { ...rec, isOn: arg === 'on', updatedAt: now })
      return { text: arg === 'on' ? 'Mood is on.' : 'Mood is off for this session.' }
    })
  })
}
