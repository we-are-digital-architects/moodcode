import type { PluginOptions } from 'claude-code'

export type FaceStyle = 'drawn' | 'line'

export type Settings = { readonly judge: boolean; readonly judgeModel: string; readonly faceStyle: FaceStyle }

export function readSettings(options: PluginOptions): Settings {
  const model = options.judgeModel
  return {
    judge: options.judge !== false,
    judgeModel: typeof model === 'string' && model !== '' ? model : 'haiku',
    faceStyle: options.faceStyle === 'line' ? 'line' : 'drawn',
  }
}
