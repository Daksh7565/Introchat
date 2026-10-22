// Run: node --test tools/backup/restore-sql.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildRestoreSql, countRows } from './restore-sql.mjs'

// The shape of `supabase db dump --data-only --use-copy`, cut down.
const DUMP = [
  'SET session_replication_role = replica;',
  'COPY "auth"."users" ("id", "phone") FROM stdin;',
  'u1\t919000000011',
  '\\.',
  'COPY "public"."app_settings" ("key", "value") FROM stdin;',
  'FREE_SESSION_MINUTES\t60',
  '\\.',
  'COPY "public"."messages" ("id", "body") FROM stdin;',
  '1\thello',
  '\\.',
  'COPY "storage"."buckets" ("id") FROM stdin;',
  '\\.',
  'COPY "storage"."objects" ("id") FROM stdin;',
  'o1',
  '\\.',
  'SELECT pg_catalog.setval(\'"public"."messages_id_seq"\', 1, true);',
  'RESET ALL;',
].join('\n')

test('skips only the Storage blocks; everything after them survives', () => {
  const { sql, skipped, sequences } = buildRestoreSql(DUMP)
  assert.deepEqual(skipped, ['storage."buckets"', 'storage."objects"'])
  assert.ok(!sql.includes('"storage"'))
  // The sequence position after the last Storage block: a restore without it
  // fails on the first new message with a duplicate key.
  assert.equal(sequences, 1)
  assert.ok(sql.includes('RESET ALL;'))
  assert.ok(sql.includes('u1\t919000000011'))
})

test('empties exactly the public tables it reloads, inside one transaction', () => {
  const { sql, publicTables } = buildRestoreSql(DUMP)
  assert.deepEqual(publicTables, ['"public"."app_settings"', '"public"."messages"'])
  const lines = sql.split('\n')
  assert.deepEqual(lines.slice(0, 4), [
    '\\set ON_ERROR_STOP on',
    'begin;',
    'set session_replication_role = replica;',
    'truncate "public"."app_settings", "public"."messages";',
  ])
  assert.equal(lines.at(-2), 'commit;')
})

test('reads a dump saved with Windows line endings', () => {
  assert.equal(buildRestoreSql(DUMP.replaceAll('\n', '\r\n')).sequences, 1)
})

test('counts the rows of every table, empty ones included', () => {
  assert.deepEqual(
    [...countRows(DUMP)],
    [
      ['auth.users', 1],
      ['public.app_settings', 1],
      ['public.messages', 1],
      ['storage.buckets', 0],
      ['storage.objects', 1],
    ],
  )
})

test('refuses a dump that is cut short or is not ours', () => {
  assert.throws(() => countRows('COPY "public"."messages" ("id") FROM stdin;\n1'), /cut short/)
  assert.throws(() => buildRestoreSql('COPY "storage"."objects" ("id") FROM stdin;\no1'), /cut short/)
  assert.throws(() => buildRestoreSql('SET x = 1;'), /not an IntroChat data dump/)
})
