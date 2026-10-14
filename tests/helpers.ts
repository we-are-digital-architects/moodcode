import type {
  ModelCompleteInput, ModelCompleteResult, On, PromptOrigin, PromptSubmitInput, SessionMessage, TurnCompleteInput,
} from 'claude-code'
import type { KV } from '../src/state.ts'

export const r3 = (n: number): number => Math.round(n * 1000) / 1000 + 0

export function memoryKV(initial: Readonly<Record<string, unknown>> = {}): KV & { readonly data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial))
  return {
    data,
    get: async key => data.get(key),
    set: async (key, value) => {
      data.set(key, JSON.parse(JSON.stringify(value)))
    },
    delete: async key => {
      data.delete(key)
    },
    keys: async () => [...data.keys()],
  }
}

export const SESSION = 'S1'

const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

export type Recorder = {
  readonly contexts: (readonly string[] | undefined)[]
  readonly judgeCalls: ModelCompleteInput[]
  readonly commands: string[]
}

export function judgeAnswer(text: string): ModelCompleteResult {
  return { isAnswered: true, text, usage: NO_USAGE }
}

export const ROUTINE = judgeAnswer('{"dPleasure":0,"dEnergy":0,"isRepeat":false,"reason":"routine"}')

export function installBottoms(
  on: On,
  judge: ModelCompleteResult | { readonly deny: string } = ROUTINE,
  transcript: readonly SessionMessage[] = [],
): Recorder {
  const recorder: Recorder = { contexts: [], judgeCalls: [], commands: [] }
  on('session.messages', () => ({ value: [...transcript] }))
  on('session.id', () => ({ value: SESSION }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.submit', ($, e) => {
    recorder.contexts.push(e.context)
    return { text: e.text, context: e.context }
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base prompt', scope: 'shared' as const }] }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('command.register', ($, e) => {
    recorder.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('model.complete', ($, e) => {
    recorder.judgeCalls.push(e)
    return 'deny' in judge ? { deny: judge.deny } : { value: judge }
  })
  return recorder
}

export function userPrompt(text: string, origin: PromptOrigin = { kind: 'composer' }): PromptSubmitInput {
  return { text, wait: false, origin }
}

export function finished(answer: string, turnId: string, extra: Partial<TurnCompleteInput> = {}): TurnCompleteInput {
  return { answer, durationMs: 10, isAborted: false, turnId, reason: 'answer', ...extra } as TurnCompleteInput
}

export function moodCommand(args: string) {
  return {
    command: 'mood',
    args,
    origin: { kind: 'composer' } as const,
    presentation: { isFullscreen: false, columns: 100 },
  }
}

export const COMPOSE = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
} as const
