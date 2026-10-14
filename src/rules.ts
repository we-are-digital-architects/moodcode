import { STOPWORDS, TUNING, WORD_RULES } from '../data/tuning.ts'

export type RuleResult = {
  readonly dPleasure: number
  readonly dEnergy: number
  readonly causes: readonly string[]
  readonly isRepeat: boolean
  readonly tokens: readonly string[]
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function hasPhrase(text: string, phrase: string): boolean {
  const pattern = new RegExp(`(^|[^a-z0-9'])${escapeRegExp(phrase)}($|[^a-z0-9'])`)
  return pattern.test(normalize(text))
}

export function tokenize(text: string): string[] {
  const words = normalize(text).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
  const kept = words.filter(w => w.length >= TUNING.repeat.minTokenLength && !STOPWORDS.has(w))
  return [...new Set(kept)].sort()
}

// FNV-1a: the store keeps a fingerprint of each word, never the word itself.
export function fingerprint(token: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const inB = new Set(b)
  const shared = a.filter(t => inB.has(t)).length
  return shared / (a.length + b.length - shared)
}

export function isRepeat(tokens: readonly string[], recent: readonly (readonly string[])[]): boolean {
  if (tokens.length < TUNING.repeat.minTokens) return false
  return recent.some(previous => jaccard(tokens, previous) >= TUNING.repeat.threshold)
}

function capAxis(x: number): number {
  return Math.min(TUNING.ruleCapPerAxis, Math.max(-TUNING.ruleCapPerAxis, x))
}

export function evaluateRules(
  text: string,
  recent: readonly (readonly string[])[],
  repeatCount: number,
): RuleResult {
  let dPleasure = 0
  let dEnergy = 0
  const causes: string[] = []
  for (const rule of WORD_RULES) {
    if (!rule.phrases.some(phrase => hasPhrase(text, phrase))) continue
    dPleasure += rule.dPleasure
    dEnergy += rule.dEnergy
    causes.push(`rule:${rule.id}`)
  }
  const words = tokenize(text)
  // A long paste is not a rephrased question, and keeping its vocabulary would bloat the store.
  const tokens = words.length > TUNING.repeat.maxTokens ? [] : [...new Set(words.map(fingerprint))].sort()
  const repeated = isRepeat(tokens, recent)
  if (repeated) {
    const count = repeatCount + 1
    dPleasure += TUNING.repeat.dPleasure * count
    dEnergy += TUNING.repeat.dEnergy * count
    causes.push(`repeat:${count}`)
  }
  return { dPleasure: capAxis(dPleasure) + 0, dEnergy: capAxis(dEnergy) + 0, causes, isRepeat: repeated, tokens }
}
