// The values moodcode keeps in `$.state` for the session.

/** Which face each reply row draws, so a face shows only when it differs from the reply before. */
export type ShownLog = {
  /** Row key (`id:<row uuid>` or `text:<hash of its opening>`) to the face it draws, or null when it draws none. */
  readonly faces: Readonly<Record<string, string | null>>
  /** The face of the newest reply row that opened with one; null at the start and after /mood on or off. */
  readonly last: string | null
}

declare module 'claude-code' {
  interface PluginState {
    moodcode: { shown: ShownLog }
  }
}
