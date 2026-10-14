import type { Register } from 'claude-code'
import { readSettings } from '../src/settings.ts'
import { wireCommand } from './command.ts'
import { wireFace } from './face.tsx'
import { wirePrompt } from './prompt.ts'
import { wireTurn } from './turn.ts'

export const register: Register = (on, options) => {
  const settings = readSettings(options)
  wireCommand(on)
  wirePrompt(on)
  wireTurn(on, settings)
  wireFace(on, settings)
}
