import { expect, test } from 'claude-code/testing'
import {
  addPending, freshRecord, judgeKey, loadRecord, prune, saveRecord, serial, sessionKey, takePending,
} from '../src/state.ts'
import { memoryKV } from './helpers.ts'

const DAY = 24 * 60 * 60 * 1000

test('a missing record loads as fresh neutral', async () => {
  const rec = await loadRecord(memoryKV(), 'S1', 500)
  expect(rec).toEqual(freshRecord(500))
  expect(rec.suggested).toBe('(^.^)')
  expect(rec.isOn).toBe(true)
})

test('corrupt or old-version records load as fresh neutral', async () => {
  const kv = memoryKV({ [sessionKey('A')]: { v: 0, pleasure: 1 }, [sessionKey('B')]: 'garbage' })
  expect(await loadRecord(kv, 'A', 7)).toEqual(freshRecord(7))
  expect(await loadRecord(kv, 'B', 7)).toEqual(freshRecord(7))
})

test('a saved record loads back', async () => {
  const kv = memoryKV()
  const rec = { ...freshRecord(1), pleasure: 0.4, turn: 3 }
  await saveRecord(kv, 'S1', rec)
  expect(await loadRecord(kv, 'S1', 99)).toEqual(rec)
})

test('pending verdicts come back in turn order, once, without junk', async () => {
  const kv = memoryKV()
  await addPending(kv, 'S1', { turn: 2, dPleasure: 0.1, dEnergy: 0, isRepeat: false, reason: 'b' })
  await addPending(kv, 'S1', { turn: 1, dPleasure: 0.2, dEnergy: 0, isRepeat: false, reason: 'a' })
  kv.data.set(judgeKey('S1'), [...(kv.data.get(judgeKey('S1')) as unknown[]), { turn: 'x' }, 42])
  const pending = await takePending(kv, 'S1')
  expect(pending.map(p => p.reason)).toEqual(['a', 'b'])
  expect(await takePending(kv, 'S1')).toEqual([])
})

test('prune drops sessions older than 7 days and beyond the newest 200', async () => {
  const now = 1000 * DAY
  const seed: Record<string, unknown> = {
    [sessionKey('old')]: { ...freshRecord(now - 8 * DAY) },
    [judgeKey('old')]: [],
    [sessionKey('broken')]: 'garbage',
  }
  for (let i = 0; i < 201; i++) seed[sessionKey(`s${i}`)] = freshRecord(now - i)
  const kv = memoryKV(seed)
  const dropped = await prune(kv, now)
  expect(dropped).toBe(3)
  expect(kv.data.has(sessionKey('old'))).toBe(false)
  expect(kv.data.has(judgeKey('old'))).toBe(false)
  expect(kv.data.has(sessionKey('broken'))).toBe(false)
  expect(kv.data.has(sessionKey('s0'))).toBe(true)
  expect(kv.data.has(sessionKey('s200'))).toBe(false)
})

test('serial runs tasks one at a time in call order', async () => {
  const order: string[] = []
  let release: () => void = () => undefined
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const a = serial(async () => {
    await gate
    order.push('a')
  })
  const b = serial(async () => {
    order.push('b')
  })
  release()
  await Promise.all([a, b])
  expect(order).toEqual(['a', 'b'])
})

test('serial keeps going after a task throws', async () => {
  const failed = await serial(async () => {
    throw new Error('boom')
  }).then(() => 'ok', () => 'failed')
  expect(failed).toBe('failed')
  expect(await serial(async () => 'next')).toBe('next')
})
