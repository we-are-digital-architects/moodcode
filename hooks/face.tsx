import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'
import { DRAWN, DRAWN_WIDTH } from '../data/faces.ts'
import { EMPTY_LOG, faceFor, firstText, recordRow, splitFace } from '../src/display.ts'
import type { Settings } from '../src/settings.ts'

const shown = atom({ plugin: 'moodcode', key: 'shown' } as const, EMPTY_LOG)

// Below this width the drawn face would squeeze the reply, so the one-line face stands in.
const MIN_COLUMNS = 60

export function wireFace(on: On, settings: Settings): void {
  on('session.append', { door: 'response' }, async ($, e, next) => {
    const stored = await next(e)
    const text = e.agentId === undefined && e.message.type === 'assistant' ? firstText(e.message.content) : undefined
    if (text !== undefined) {
      await update($, shown, log => recordRow(log ?? EMPTY_LOG, text, e.uuid)).catch(() => undefined)
    }
    return stored
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const split = e.props.isSummary === true ? undefined : splitFace(e.props.text)
    if (split === undefined) return next(e)
    const face = faceFor((await read($, shown)) ?? EMPTY_LOG, e.props.text, e.requestId)
    const bare = { ...e, props: { ...e.props, text: split.rest } }
    if (face === null || face === undefined) return next(bare)
    const rows = DRAWN[face]
    const isRoomy = e.viewport === undefined || e.viewport.columns >= MIN_COLUMNS
    if (e.surface !== 'terminal' || settings.faceStyle !== 'drawn' || rows === undefined || !isRoomy) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const body = await next(bare)
    return (
      <Box flexDirection="row">
        <Box flexShrink={0} width={DRAWN_WIDTH} marginRight={2}>
          <Text>{rows.join('\n')}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          {body}
        </Box>
      </Box>
    )
  })
}
