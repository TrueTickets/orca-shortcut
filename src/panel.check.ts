// `orca plugin check` renders the panel once per scenario, each with the worker on a fresh
// host. Seed what the worker reads so check shows more than the first state.
import { defineCheck } from 'orca/testing'

export default defineCheck({
  disconnected: { results: { 'secrets.protection': { status: 'os-keyring' } } },
  connected: {
    results: { 'secrets.protection': { status: 'os-keyring' } },
    secrets: { shortcutToken: 'tok' },
    storage: {
      member: { name: 'Ada Lovelace', mentionName: 'ada', workspaceName: 'Analytical Engines' }
    }
  },
  noKeyStore: { results: { 'secrets.protection': { status: 'unavailable' } } }
})
