// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
export {}

declare module 'orca' {
  interface PluginRequests {
    /** Whether a token is stored and whom it belongs to. Never returns the token. */
    'auth.status': { output: AuthStatus }
    /** Checks `token` against Shortcut, then stores it in the plugin's encrypted secrets. */
    'auth.connect': { input: { token: string }; output: AuthStatus }
    /** Forgets the stored token. */
    'auth.disconnect': { output: AuthStatus }
  }
  interface PluginPanelEvents {
    /** Posted to every open panel after connecting or disconnecting. */
    'auth.changed': AuthStatus
  }
}

export type AuthStatus =
  | { connected: false; secretsAvailable: boolean }
  | {
      connected: true
      secretsAvailable: true
      member: { name: string; mentionName: string; workspaceName: string }
    }
