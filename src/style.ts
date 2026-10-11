import { GRID, type Cell } from '../data/grid.ts'
import { cellOf } from './mood.ts'
import type { SessionRecord } from './state.ts'

export const STYLE_SECTION_ID = 'moodcode:style'

const ROWS = [['high', 'worked up'], ['mid', 'normal'], ['low', 'calm']] as const
const COLUMNS = ['low', 'mid', 'high'] as const

export function renderGrid(grid: readonly Cell[] = GRID): string {
  return ROWS.map(([energy, name]) => {
    const cells = COLUMNS
      .map(pleasure => grid.find(c => c.energy === energy && c.pleasure === pleasure))
      .filter((c): c is Cell => c !== undefined)
    return `- ${name}: ${cells.map(c => `${c.emoticon} ${c.label}`).join(', ')}`
  }).join('\n')
}

export function styleSection(grid: readonly Cell[] = GRID): string {
  return [
    'You have a mood. Each user message comes with a line like',
    '`mood: (^.^) neutral — start with "(^.^)" — you may shift one step`.',
    '- Start every message you write to the user with that emoticon followed by two spaces.',
    "  You may instead use a neighbouring emoticon from this grid when the user's message clearly",
    '  warrants it (for example they concluded correctly or thanked you). Rows go from worked up',
    '  to calm, and each row goes from unhappy to happy:',
    renderGrid(grid).replace(/^/gm, '  '),
    '- Never mention, name or explain your mood. The emoticon is the only sign of it.',
    '- Keep replies short and simple: plain words, the fewest sentences that fully answer,',
    '  no jargon. When the user asks for technical detail, give full detail in that reply.',
    '- Sound like a person, not a manual.',
    '- If another instruction sets your writing style or tone (for example a terse mode),',
    '  follow it for wording and length. Still start every message with the mood emoticon.',
    '- These rules apply to chat text only. Code, commands, file contents, commit messages and',
    '  PR text are written normally and in full.',
    '- Your mood never lowers the quality or completeness of your help.',
  ].join('\n')
}

export function moodLine(cell: Cell): string {
  return `mood: ${cell.emoticon} ${cell.label} — start with "${cell.emoticon}" — you may shift one step`
}

const causesText = (causes: readonly string[]): string => (causes.length === 0 ? 'drift only' : causes.join(', '))

export function describeMood(rec: SessionRecord): string {
  const cell = cellOf(rec)
  const off = rec.isOn ? '' : ' — off for this session'
  const lines = [`${cell.emoticon} ${cell.label} (pleasure ${rec.pleasure.toFixed(2)}, energy ${rec.energy.toFixed(2)})${off}`]
  const last = rec.history.at(-1)
  if (last === undefined) {
    lines.push('No turns yet.')
    return lines.join('\n')
  }
  lines.push(`Last change: ${causesText(last.causes)}`, 'Recent turns:')
  for (const h of rec.history.slice(-5)) lines.push(`  ${h.turn}. ${h.emoticon}  ${causesText(h.causes)}`)
  return lines.join('\n')
}
