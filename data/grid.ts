export type Band = 'low' | 'mid' | 'high'

export type Cell = {
  readonly emoticon: string
  readonly label: string
  readonly pleasure: Band
  readonly energy: Band
}

export const GRID: readonly Cell[] = [
  { emoticon: '(>_<)', label: 'frustrated', pleasure: 'low', energy: 'high' },
  { emoticon: '(O_O)', label: 'surprised', pleasure: 'mid', energy: 'high' },
  { emoticon: 'd(^O^)b', label: 'excited', pleasure: 'high', energy: 'high' },
  { emoticon: '(._.)', label: 'unhappy', pleasure: 'low', energy: 'mid' },
  { emoticon: '(^.^)', label: 'neutral', pleasure: 'mid', energy: 'mid' },
  { emoticon: '(^o^)', label: 'happy', pleasure: 'high', energy: 'mid' },
  { emoticon: '(-_-)', label: 'weary', pleasure: 'low', energy: 'low' },
  { emoticon: '(o_O)', label: 'unsure', pleasure: 'mid', energy: 'low' },
  { emoticon: '(^-^)', label: 'content', pleasure: 'high', energy: 'low' },
]
