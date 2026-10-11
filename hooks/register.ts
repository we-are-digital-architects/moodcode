import type { Register } from 'claude-code'
import { wirePrompt } from './prompt.ts'

export const register: Register = on => {
  wirePrompt(on)
}
