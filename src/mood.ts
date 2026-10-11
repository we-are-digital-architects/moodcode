import { GRID, type Band, type Cell } from '../data/grid.ts'
import { TUNING } from '../data/tuning.ts'

export type Mood = { readonly pleasure: number; readonly energy: number }

export type ShiftOutcome = {
  readonly mood: Mood
  readonly emoticon: string | undefined
  readonly cause: 'none' | 'shift' | 'shift-ignored'
}

export const NEUTRAL: Mood = { pleasure: 0, energy: 0 }

const BAND_INDEX: Record<Band, number> = { low: 0, mid: 1, high: 2 }
const BY_LENGTH = [...GRID].sort((a, b) => b.emoticon.length - a.emoticon.length)

export function clamp(x: number, lo = -1, hi = 1): number {
  return Math.min(hi, Math.max(lo, x))
}

export function addDelta(m: Mood, dPleasure: number, dEnergy: number): Mood {
  return { pleasure: clamp(m.pleasure + dPleasure), energy: clamp(m.energy + dEnergy) }
}

export function drift(m: Mood): Mood {
  return { pleasure: m.pleasure * TUNING.drift, energy: m.energy * TUNING.drift }
}

export function bandOf(x: number): Band {
  if (x < -TUNING.bandEdge) return 'low'
  if (x > TUNING.bandEdge) return 'high'
  return 'mid'
}

export function cellOf(m: Mood): Cell {
  const pleasure = bandOf(m.pleasure)
  const energy = bandOf(m.energy)
  const cell = GRID.find(c => c.pleasure === pleasure && c.energy === energy)
  if (cell === undefined) throw new Error(`grid has no cell for ${pleasure}/${energy}`)
  return cell
}

export function cellByEmoticon(emoticon: string): Cell | undefined {
  return GRID.find(c => c.emoticon === emoticon)
}

export function parseLeadingEmoticon(text: string): string | undefined {
  const head = text.trimStart()
  for (const cell of BY_LENGTH) {
    if (!head.startsWith(cell.emoticon)) continue
    const after = head.charAt(cell.emoticon.length)
    if (after === '' || /\s/.test(after)) return cell.emoticon
  }
  return undefined
}

export function isNeighbor(a: Cell, b: Cell): boolean {
  const dPleasure = Math.abs(BAND_INDEX[a.pleasure] - BAND_INDEX[b.pleasure])
  const dEnergy = Math.abs(BAND_INDEX[a.energy] - BAND_INDEX[b.energy])
  return Math.max(dPleasure, dEnergy) === 1
}

function nudgeAxis(x: number, band: Band): number {
  if (band === 'low') return Math.min(x, -TUNING.nudgeEdge)
  if (band === 'high') return Math.max(x, TUNING.nudgeEdge)
  return clamp(x, -TUNING.bandEdge, TUNING.bandEdge)
}

export function nudgeInto(m: Mood, target: Cell): Mood {
  return { pleasure: nudgeAxis(m.pleasure, target.pleasure), energy: nudgeAxis(m.energy, target.energy) }
}

export function applyShift(m: Mood, suggested: string, answer: string): ShiftOutcome {
  const used = parseLeadingEmoticon(answer)
  if (used === suggested) return { mood: m, emoticon: used, cause: 'none' }
  const from = cellByEmoticon(suggested)
  const to = used === undefined ? undefined : cellByEmoticon(used)
  if (from === undefined || to === undefined || !isNeighbor(from, to)) {
    return { mood: m, emoticon: used, cause: 'shift-ignored' }
  }
  return { mood: nudgeInto(m, to), emoticon: used, cause: 'shift' }
}
