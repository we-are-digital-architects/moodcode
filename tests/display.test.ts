import { expect, test } from 'claude-code/testing'
import { DRAWN, DRAWN_ROWS, DRAWN_WIDTH } from '../data/faces.ts'
import { GRID } from '../data/grid.ts'
import { EMPTY_LOG, faceFor, firstText, recordRow, replay, splitFace } from '../src/display.ts'

test('every grid face has a 9x5 drawing of quadrant blocks', () => {
  for (const { emoticon } of GRID) {
    const rows = DRAWN[emoticon]
    expect(rows?.length).toBe(DRAWN_ROWS)
    for (const row of rows ?? []) {
      expect([...row].length).toBe(DRAWN_WIDTH)
      expect(row).toMatch(/^[ ▘▝▖▗▀▄▌▐▚▞▛▜▙▟█]+$/)
    }
  }
})

test('the nine drawings are all different', () => {
  const drawings = GRID.map(c => (DRAWN[c.emoticon] ?? []).join('\n'))
  expect(new Set(drawings).size).toBe(GRID.length)
})

test('splitFace takes the leading face and the whitespace after it', () => {
  expect(splitFace('(^o^)  Glad it helped.')).toEqual({ face: '(^o^)', rest: 'Glad it helped.' })
  expect(splitFace('  d(^O^)b\n\nShipped.')).toEqual({ face: 'd(^O^)b', rest: 'Shipped.' })
  expect(splitFace('No face here.')).toBeUndefined()
  expect(splitFace('(^o^)Glued.')).toBeUndefined()
})

test('the first face shows, a repeat hides, a new face shows', () => {
  let log = recordRow(EMPTY_LOG, '(^.^)  One.', 'u1')
  log = recordRow(log, '(^.^)  Two.', 'u2')
  log = recordRow(log, '(^o^)  Three.', 'u3')
  expect(faceFor(log, '(^.^)  One.', 'u1')).toBe('(^.^)')
  expect(faceFor(log, '(^.^)  Two.', 'u2')).toBeNull()
  expect(faceFor(log, '(^o^)  Three.', 'u3')).toBe('(^o^)')
  expect(log.last).toBe('(^o^)')
})

test('a row is found by its text when its id is unknown', () => {
  const log = recordRow(recordRow(EMPTY_LOG, '(^.^)  One.', 'u1'), '(^.^)  Two.', 'u2')
  expect(faceFor(log, '(^.^)  Two.', 'other-id')).toBeNull()
  expect(faceFor(log, '(^.^)  One.', undefined)).toBe('(^.^)')
})

test('a row not recorded yet compares with the last face', () => {
  const log = recordRow(EMPTY_LOG, '(^.^)  One.', 'u1')
  expect(faceFor(log, '(^.^)  Still streami', 'u9')).toBeNull()
  expect(faceFor(log, '(^o^)  Still streami', 'u9')).toBe('(^o^)')
  expect(faceFor(EMPTY_LOG, '(^.^)  First ever', 'u9')).toBe('(^.^)')
})

test('rows without a face are not recorded and have no face', () => {
  const log = recordRow(EMPTY_LOG, 'Plain reply.', 'u1')
  expect(log).toEqual(EMPTY_LOG)
  expect(faceFor(log, 'Plain reply.', 'u1')).toBeUndefined()
})

test('the log keeps a bounded number of rows', () => {
  let log = EMPTY_LOG
  for (let i = 0; i < 600; i++) log = recordRow(log, `(^.^)  Reply ${i}.`, `u${i}`)
  expect(Object.keys(log.faces).length).toBeLessThanOrEqual(400)
  expect(faceFor(log, '(^.^)  Reply 599.', 'u599')).toBeNull()
})

test('replay rebuilds the log from a transcript in order', () => {
  const log = replay(['(^.^)  One.', 'Tool output summary.', '(^.^)  Two.', '(-_-)  Three.'])
  expect(faceFor(log, '(^.^)  One.', undefined)).toBe('(^.^)')
  expect(faceFor(log, '(^.^)  Two.', undefined)).toBeNull()
  expect(faceFor(log, '(-_-)  Three.', undefined)).toBe('(-_-)')
  expect(log.last).toBe('(-_-)')
})

test('firstText reads the first text block of a row', () => {
  expect(firstText([{ type: 'tool_use' }, { type: 'text', text: '(^.^)  Hi' }])).toBe('(^.^)  Hi')
  expect(firstText([{ type: 'tool_use' }])).toBeUndefined()
})
