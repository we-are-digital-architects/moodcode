import type { Register } from 'claude-code'
import { readSettings } from '../src/settings.ts'
import { wireCommand } from './command.ts'
import { wirePrompt } from './prompt.ts'
import { wireTurn } from './turn.ts'

export const register: Register = (on, options) => {
  wireCommand(on)
  wirePrompt(on)
  wireTurn(on, readSettings(options))
}
