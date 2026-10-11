import type { Register } from 'claude-code'
import { wireCommand } from './command.ts'
import { wirePrompt } from './prompt.ts'

export const register: Register = on => {
  wireCommand(on)
  wirePrompt(on)
}
