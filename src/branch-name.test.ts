import { assert, test } from 'orca/testing'
import { shortcutBranchName } from './branch-name'

test("matches Shortcut's branch helper", () => {
  // The rule was checked against the helper's own output for real stories (2026-11-17). These
  // made-up titles have the same features: a long title cut at 50 characters overall; `/`, `:`,
  // `.` and parentheses dropped; `_` kept; an em dash between spaces leaving `--`; and a short
  // name left whole. Expected names were worked out apart from this code.
  const helper: [number, string, string][] = [
    [
      2124,
      'Rewrite the Bernoulli note as set-based tables of numbers',
      'ada/sc-2124/rewrite-the-bernoulli-note-as-set-base'
    ],
    [
      1921,
      'engine/mill: card.variable_cards is silently dropped (typo: variable_card)',
      'ada/sc-1921/enginemill-cardvariable_cards-is-silen'
    ],
    [
      1794,
      'Difference engine — column alerting (2 tables)',
      'ada/sc-1794/difference-engine--column-alerting-2-t'
    ],
    [
      1793,
      'Difference engine — mill_v2 (7 columns)',
      'ada/sc-1793/difference-engine--mill_v2-7-columns'
    ],
    [
      1092,
      'Add retry_policy to Engine store_punched_cards routes',
      'ada/sc-1092/add-retry_policy-to-engine-store_punch'
    ]
  ]
  for (const [id, title, branch] of helper) {
    assert.equal(shortcutBranchName('ada', id, title), branch, `sc-${id}`)
  }
})

test('keeps short titles whole and cuts long ones at 50 characters overall', () => {
  assert.equal(shortcutBranchName('ada', 7, 'Fix it'), 'ada/sc-7/fix-it')
  const long = shortcutBranchName('a-much-longer-mention-name', 123456, 'Some title here')
  assert.equal(long.length, 50)
  assert.ok(long.startsWith('a-much-longer-mention-name/sc-123456/'))
})

test('collapses whitespace runs and keeps the result a valid ref', () => {
  assert.equal(shortcutBranchName('ada', 1, 'Tabs\tand  spaces'), 'ada/sc-1/tabs-and-spaces')
  // Not checked against Shortcut: this pins the plugin's own behaviour for non-ASCII titles,
  // which is to drop the letters rather than produce a ref Git could reject.
  assert.equal(shortcutBranchName('ada', 1, 'Ünïcode & émojis 🚀'), 'ada/sc-1/ncode--mojis-')
})
