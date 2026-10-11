import { TUNING } from '../data/tuning.ts'
import { clamp, type Mood } from './mood.ts'

export type JudgeInput = {
  readonly mood: Mood
  readonly label: string
  readonly reasons: readonly string[]
  readonly userText: string
  readonly answer: string
}

export type JudgeVerdict = {
  readonly dPleasure: number
  readonly dEnergy: number
  readonly isRepeat: boolean
  readonly reason: string
}

export const JUDGE_SYSTEM = [
  'You track the mood of an AI coding assistant talking with a user.',
  'Mood has two axes from -1 to 1: pleasure (unhappy to happy) and energy (calm to worked up).',
  'Given the current mood, the recent reasons, the latest user message and the assistant reply, decide how this exchange changes the mood.',
  'Thanks, praise and the user reaching a correct conclusion raise pleasure. Repeated or rephrased questions, going in circles and complaints lower pleasure and raise energy. Routine exchanges change little.',
  'Set isRepeat to true only when the user asked again, in any wording, something the recent reasons show they already asked.',
  'The reason names the topic, for example "user rephrased cache key question".',
  'Reply with JSON only, no prose: {"dPleasure": number, "dEnergy": number, "isRepeat": boolean, "reason": string}.',
  'Each change is between -0.5 and 0.5. The reason is at most 12 words.',
].join('\n')

const cut = (s: string): string => s.slice(0, TUNING.judge.inputChars)

export function buildJudgePrompt(input: JudgeInput): string {
  const reasons = input.reasons.length === 0 ? '(none yet)' : input.reasons.map(r => `- ${r}`).join('\n')
  return [
    `Current mood: ${input.label} (pleasure ${input.mood.pleasure.toFixed(2)}, energy ${input.mood.energy.toFixed(2)})`,
    `Recent reasons, oldest first:\n${reasons}`,
    `User message:\n<user>\n${cut(input.userText)}\n</user>`,
    `Assistant reply:\n<assistant>\n${cut(input.answer)}\n</assistant>`,
  ].join('\n\n')
}

export function parseJudgeReply(text: string): JudgeVerdict | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.dPleasure !== 'number' || !Number.isFinite(r.dPleasure)) return undefined
  if (typeof r.dEnergy !== 'number' || !Number.isFinite(r.dEnergy)) return undefined
  const cap = TUNING.judge.deltaCap
  const words = typeof r.reason === 'string' ? r.reason.trim().split(/\s+/).filter(Boolean) : []
  return {
    dPleasure: clamp(r.dPleasure, -cap, cap),
    dEnergy: clamp(r.dEnergy, -cap, cap),
    isRepeat: r.isRepeat === true,
    reason: words.slice(0, TUNING.judge.reasonWords).join(' '),
  }
}
