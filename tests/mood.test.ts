import { expect, test } from 'claude-code/testing'
import { GRID } from '../data/grid.ts'
import {
  addDelta, applyShift, bandOf, cellByEmoticon, cellOf, clamp, drift, isNeighbor, nudgeInto, parseLeadingEmoticon,
} from '../src/mood.ts'
import { r3 } from './helpers.ts'

const at = (emoticon: string) => {
  const cell = cellByEmoticon(emoticon)
  if (cell === undefined) throw new Error(`no cell ${emoticon}`)
  return cell
}

test('grid has one cell per band pair and unique emoticons', () => {
  expect(GRID).toHaveLength(9)
  expect(new Set(GRID.map(c => c.emoticon)).size).toBe(9)
  expect(new Set(GRID.map(c => `${c.pleasure}/${c.energy}`)).size).toBe(9)
})

test('clamp keeps values inside -1..1', () => {
  expect(clamp(1.7)).toBe(1)
  expect(clamp(-3)).toBe(-1)
  expect(clamp(0.2)).toBe(0.2)
})

test('addDelta adds and clamps each axis', () => {
  const m = addDelta({ pleasure: 0.9, energy: -0.2 }, 0.5, -0.1)
  expect(m.pleasure).toBe(1)
  expect(r3(m.energy)).toBe(-0.3)
})

test('drift moves both axes 15% toward zero', () => {
  const m = drift({ pleasure: 0.4, energy: -0.2 })
  expect(r3(m.pleasure)).toBe(0.34)
  expect(r3(m.energy)).toBe(-0.17)
})

test('bands split at ±0.33 with the edges in the middle band', () => {
  expect(bandOf(-0.34)).toBe('low')
  expect(bandOf(-0.33)).toBe('mid')
  expect(bandOf(0.33)).toBe('mid')
  expect(bandOf(0.331)).toBe('high')
})

test('cellOf maps the centre and the corners', () => {
  expect(cellOf({ pleasure: 0, energy: 0 }).emoticon).toBe('(^.^)')
  expect(cellOf({ pleasure: -0.5, energy: 0.5 }).emoticon).toBe('(>_<)')
  expect(cellOf({ pleasure: 0.5, energy: 0.5 }).emoticon).toBe('d(^O^)b')
  expect(cellOf({ pleasure: -0.5, energy: -0.5 }).emoticon).toBe('(-_-)')
  expect(cellOf({ pleasure: 0.5, energy: -0.5 }).emoticon).toBe('(^-^)')
  expect(cellOf({ pleasure: 0, energy: -0.5 }).emoticon).toBe('(o_O)')
})

test('parseLeadingEmoticon prefers the longest match and needs a boundary', () => {
  expect(parseLeadingEmoticon('(>_<)  Third time.')).toBe('(>_<)')
  expect(parseLeadingEmoticon('  (._.)  Sorry.')).toBe('(._.)')
  expect(parseLeadingEmoticon('(^o^)')).toBe('(^o^)')
  expect(parseLeadingEmoticon('(o_O)  Not sure.')).toBe('(o_O)')
  expect(parseLeadingEmoticon('(^o^)Done, shipped.')).toBeUndefined()
  expect(parseLeadingEmoticon('```\n(^o^) code\n```')).toBeUndefined()
  expect(parseLeadingEmoticon('Hello (^o^)')).toBeUndefined()
})

test('isNeighbor is true only at grid distance one, diagonals included', () => {
  expect(isNeighbor(at('(^.^)'), at('(^o^)'))).toBe(true)
  expect(isNeighbor(at('(^.^)'), at('d(^O^)b'))).toBe(true)
  expect(isNeighbor(at('(^.^)'), at('(^.^)'))).toBe(false)
  expect(isNeighbor(at('(-_-)'), at('d(^O^)b'))).toBe(false)
})

test('nudgeInto moves each axis just inside the target band', () => {
  expect(nudgeInto({ pleasure: 0.1, energy: 0.2 }, at('(^o^)'))).toEqual({ pleasure: 0.34, energy: 0.2 })
  expect(nudgeInto({ pleasure: 0.6, energy: -0.6 }, at('(^.^)'))).toEqual({ pleasure: 0.33, energy: -0.33 })
  expect(nudgeInto({ pleasure: 0, energy: 0 }, at('(>_<)'))).toEqual({ pleasure: -0.34, energy: 0.34 })
})

test('applyShift follows a neighbour and ignores far or missing emoticons', () => {
  expect(applyShift({ pleasure: 0, energy: 0 }, '(^.^)', '(^.^)  Yes.').cause).toBe('none')

  const up = applyShift({ pleasure: 0, energy: 0 }, '(^.^)', '(^o^)  Yes, that is it.')
  expect(up.cause).toBe('shift')
  expect(up.emoticon).toBe('(^o^)')
  expect(up.mood).toEqual({ pleasure: 0.34, energy: 0 })

  const far = applyShift({ pleasure: -0.5, energy: -0.5 }, '(-_-)', 'd(^O^)b  Yay!')
  expect(far.cause).toBe('shift-ignored')
  expect(far.mood).toEqual({ pleasure: -0.5, energy: -0.5 })

  const missing = applyShift({ pleasure: 0, energy: 0 }, '(^.^)', 'Yes.')
  expect(missing.cause).toBe('shift-ignored')
  expect(missing.emoticon).toBeUndefined()
})

test('every face is plain ASCII that markdown draws as written', () => {
  for (const { emoticon } of GRID) {
    expect(emoticon).toMatch(/^[\x21-\x7e]+$/)
    expect(emoticon).not.toMatch(/[\\*`]/)
    expect(emoticon).not.toMatch(/^[>#+-]/)
  }
})
