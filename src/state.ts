import { TUNING } from '../data/tuning.ts'
import type { JudgeVerdict } from './judge.ts'

export type HistoryEntry = {
  readonly turn: number
  readonly at: number
  readonly before: readonly [number, number]
  readonly after: readonly [number, number]
  readonly emoticon: string
  readonly causes: readonly string[]
}

export type SessionRecord = {
  readonly v: 1
  readonly pleasure: number
  readonly energy: number
  readonly isOn: boolean
  readonly turn: number
  readonly suggested: string
  readonly repeatCount: number
  readonly recentTokens: readonly (readonly string[])[]
  readonly history: readonly HistoryEntry[]
  readonly updatedAt: number
}

export type PendingJudge = JudgeVerdict & { readonly turn: number }

export type KV = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

const SESSION_PREFIX = 'session:'

export const sessionKey = (id: string): string => `${SESSION_PREFIX}${id}`
export const judgeKey = (id: string): string => `judge:${id}`

export function freshRecord(now: number): SessionRecord {
  return {
    v: 1,
    pleasure: 0,
    energy: 0,
    isOn: true,
    turn: 0,
    suggested: '(^.^)',
    repeatCount: 0,
    recentTokens: [],
    history: [],
    updatedAt: now,
  }
}

export function isRecord(x: unknown): x is SessionRecord {
  if (typeof x !== 'object' || x === null) return false
  const r = x as Record<string, unknown>
  return r.v === 1
    && typeof r.pleasure === 'number'
    && typeof r.energy === 'number'
    && typeof r.isOn === 'boolean'
    && typeof r.turn === 'number'
    && typeof r.suggested === 'string'
    && typeof r.repeatCount === 'number'
    && Array.isArray(r.recentTokens)
    && Array.isArray(r.history)
    && typeof r.updatedAt === 'number'
}

function isPending(x: unknown): x is PendingJudge {
  if (typeof x !== 'object' || x === null) return false
  const p = x as Record<string, unknown>
  return typeof p.turn === 'number'
    && typeof p.dPleasure === 'number'
    && typeof p.dEnergy === 'number'
    && typeof p.isRepeat === 'boolean'
    && typeof p.reason === 'string'
}

let tail: Promise<unknown> = Promise.resolve()

export function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task)
  tail = run.catch(() => undefined)
  return run
}

export async function loadRecord(kv: KV, id: string, now: number): Promise<SessionRecord> {
  const raw = await kv.get(sessionKey(id))
  return isRecord(raw) ? raw : freshRecord(now)
}

export async function saveRecord(kv: KV, id: string, rec: SessionRecord): Promise<void> {
  await kv.set(sessionKey(id), rec)
}

export async function takePending(kv: KV, id: string): Promise<PendingJudge[]> {
  const raw = await kv.get(judgeKey(id))
  if (raw === undefined) return []
  await kv.delete(judgeKey(id))
  return Array.isArray(raw) ? raw.filter(isPending).sort((a, b) => a.turn - b.turn) : []
}

export async function addPending(kv: KV, id: string, pending: PendingJudge): Promise<void> {
  const raw = await kv.get(judgeKey(id))
  const list = Array.isArray(raw) ? raw : []
  await kv.set(judgeKey(id), [...list, pending])
}

export async function prune(kv: KV, now: number): Promise<number> {
  const keys = (await kv.keys()).filter(key => key.startsWith(SESSION_PREFIX))
  const dated = await Promise.all(keys.map(async key => {
    const rec = await kv.get(key)
    return { key, at: isRecord(rec) ? rec.updatedAt : 0 }
  }))
  dated.sort((a, b) => b.at - a.at)
  const doomed = dated.filter((d, i) => now - d.at > TUNING.prune.maxAgeMs || i >= TUNING.prune.maxSessions)
  for (const d of doomed) {
    await kv.delete(d.key)
    await kv.delete(judgeKey(d.key.slice(SESSION_PREFIX.length)))
  }
  return doomed.length
}
