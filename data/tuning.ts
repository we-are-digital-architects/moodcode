export type WordRule = {
  readonly id: string
  readonly phrases: readonly string[]
  readonly dPleasure: number
  readonly dEnergy: number
}

export const TUNING = {
  bandEdge: 0.33,
  nudgeEdge: 0.34,
  drift: 0.85,
  ruleCapPerAxis: 0.75,
  repeat: { threshold: 0.6, window: 5, minTokens: 3, maxTokens: 200, minTokenLength: 3, dPleasure: -0.25, dEnergy: 0.25 },
  judge: { deltaCap: 0.5, maxTokens: 150, timeoutMs: 30_000, inputChars: 2000, reasonWords: 12, historyReasons: 5 },
  historyLimit: 50,
  prune: { maxAgeMs: 7 * 24 * 60 * 60 * 1000, maxSessions: 200 },
} as const

export const WORD_RULES: readonly WordRule[] = [
  {
    id: 'thanks',
    phrases: ['thanks', 'thank you', 'thx', 'cheers', 'appreciate it', 'much appreciated'],
    dPleasure: 0.35,
    dEnergy: 0,
  },
  {
    id: 'praise',
    phrases: ['great', 'perfect', 'exactly', 'nice', 'awesome', 'well done', 'brilliant', 'love it'],
    dPleasure: 0.25,
    dEnergy: 0.15,
  },
  {
    id: 'complaint',
    phrases: ['still broken', 'wrong', "doesn't work", 'does not work', 'not working', 'still failing', 'useless'],
    dPleasure: -0.2,
    dEnergy: 0.2,
  },
]

export const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with', 'this', 'that', 'these', 'those',
  'what', 'whats', 'how', 'why', 'when', 'where', 'which', 'who', 'can', 'could', 'would', 'should',
  'does', 'did', 'have', 'has', 'had', 'was', 'were', 'will', 'about', 'from', 'into', 'just', 'like',
  'please', 'there', 'then', 'than', 'them', 'they', 'its', 'get', 'way', 'any', 'some', 'again',
  'tell', 'explain', 'want', 'need', 'know', 'help', 'also', 'still', 'really', 'one', 'use', 'using',
  'show', 'give', 'make', 'all', 'out', 'our', 'his', 'her', 'she', 'him', 'too', 'very', 'thing',
])
