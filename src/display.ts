import type { ShownLog } from '../types'
import { parseLeadingEmoticon } from './mood.ts'
import { fingerprint } from './rules.ts'

export type { ShownLog }

export const EMPTY_LOG: ShownLog = { faces: {}, last: null }

const MAX_ROWS = 400
const OPENING_CHARS = 200

export function splitFace(text: string): { readonly face: string; readonly rest: string } | undefined {
  const face = parseLeadingEmoticon(text)
  if (face === undefined) return undefined
  return { face, rest: text.trimStart().slice(face.length).trimStart() }
}

const idKey = (id: string): string => `id:${id}`
const textKey = (text: string): string => `text:${fingerprint(text.trimStart().slice(0, OPENING_CHARS))}`

export function recordRow(log: ShownLog, text: string, id: string | undefined): ShownLog {
  const split = splitFace(text)
  if (split === undefined) return log
  const shown = split.face === log.last ? null : split.face
  const faces: Record<string, string | null> = { ...log.faces, [textKey(text)]: shown }
  if (id !== undefined) faces[idKey(id)] = shown
  const keys = Object.keys(faces)
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ROWS))) delete faces[key]
  return { faces, last: split.face }
}

// The face a row draws: a string to show, null to hide it, undefined when the row has none.
export function faceFor(log: ShownLog, text: string, id: string | undefined): string | null | undefined {
  const split = splitFace(text)
  if (split === undefined) return undefined
  for (const key of id === undefined ? [textKey(text)] : [idKey(id), textKey(text)]) {
    if (key in log.faces) return log.faces[key] ?? null
  }
  // Not recorded yet: the row is still streaming, after every recorded one.
  return split.face === log.last ? null : split.face
}

export function replay(texts: readonly string[]): ShownLog {
  return texts.reduce((log, text) => recordRow(log, text, undefined), EMPTY_LOG)
}

export function firstText(content: readonly { readonly type: string; readonly text?: unknown }[]): string | undefined {
  const block = content.find(b => b.type === 'text' && typeof b.text === 'string')
  return typeof block?.text === 'string' ? block.text : undefined
}
