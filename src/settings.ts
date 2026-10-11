import type { PluginOptions } from 'claude-code'

export type Settings = { readonly judge: boolean; readonly judgeModel: string }

export function readSettings(options: PluginOptions): Settings {
  const model = options.judgeModel
  return {
    judge: options.judge !== false,
    judgeModel: typeof model === 'string' && model !== '' ? model : 'haiku',
  }
}
