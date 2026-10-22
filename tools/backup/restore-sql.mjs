// Turns a nightly backup's data.sql into the SQL that loads it into a freshly
// migrated project (BACKUP_AND_RESTORE.md, "Restore"). Usage:
//
//   node tools/backup/restore-sql.mjs data.sql restore-load.sql
//
// What it changes, and why:
// - Loads in one transaction with session_replication_role = replica, so rows
//   go in exactly as dumped, in any order (foreign keys and our triggers, such
//   as the credit-ledger guard, are triggers and do not fire in that mode).
// - Empties the public tables first: the migrations seed some (settings,
//   starter tags) and the backup's rows replace them.
// - Skips Supabase Storage tables: IntroChat stores no files, and the postgres
//   role a hosted project gives you may not write them (the first restore test
//   failed on storage.buckets_vectors). If the app ever uses Storage, revisit.
//
// A shell one-liner did this first and silently dropped everything after the
// first Storage block, sequence positions included; restore-sql.test.mjs
// keeps that from coming back.

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const STORAGE_COPY = /^COPY "storage"\.("[^"]+")/
const PUBLIC_COPY = /^COPY ("public"\."[^"]+")/
const END_OF_COPY = '\\.'

/**
 * @param {string} dataSql the contents of data.sql from the backup
 * @returns {{ sql: string, publicTables: string[], skipped: string[], sequences: number }}
 */
export function buildRestoreSql(dataSql) {
  const kept = []
  const publicTables = []
  const skipped = []
  let skipping = false

  for (const line of dataSql.split(/\r?\n/)) {
    if (skipping) {
      if (line === END_OF_COPY) skipping = false
      continue
    }
    const storage = STORAGE_COPY.exec(line)
    if (storage) {
      skipping = true
      skipped.push(`storage.${storage[1]}`)
      continue
    }
    const table = PUBLIC_COPY.exec(line)
    if (table) publicTables.push(table[1])
    kept.push(line)
  }

  if (skipping) throw new Error('data.sql ends inside a COPY block: the backup file is cut short')
  if (publicTables.length === 0) {
    throw new Error('data.sql has no public tables: this is not an IntroChat data dump')
  }

  const sql = [
    '\\set ON_ERROR_STOP on',
    'begin;',
    'set session_replication_role = replica;',
    `truncate ${publicTables.join(', ')};`,
    ...kept,
    'commit;',
    '',
  ].join('\n')
  const sequences = kept.filter((line) => line.includes('pg_catalog.setval(')).length
  return { sql, publicTables, skipped, sequences }
}

/**
 * Rows per table in a data dump, for the backup log and for checking a restore.
 * @param {string} dataSql
 * @returns {Map<string, number>}
 */
export function countRows(dataSql) {
  const counts = new Map()
  let table = null
  for (const line of dataSql.split(/\r?\n/)) {
    if (table !== null) {
      if (line === END_OF_COPY) table = null
      else counts.set(table, counts.get(table) + 1)
      continue
    }
    const copy = /^COPY ("[^"]+"\."[^"]+")/.exec(line)
    if (copy) {
      table = copy[1].replaceAll('"', '')
      counts.set(table, 0)
    }
  }
  if (table !== null) throw new Error('data.sql ends inside a COPY block: the backup file is cut short')
  return counts
}

const USAGE = `usage:
  node tools/backup/restore-sql.mjs <data.sql> <restore-load.sql>   build the load file
  node tools/backup/restore-sql.mjs --counts <data.sql>             rows per table`

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [first, second] = process.argv.slice(2)
  if (first === '--counts' && second) {
    for (const [table, rows] of countRows(readFileSync(second, 'utf8'))) {
      if (!table.startsWith('storage.')) console.log(`${table.padEnd(40)} ${rows}`)
    }
    process.exit(0)
  }
  const [input, output] = [first, second]
  if (!input || !output) {
    console.error(USAGE)
    process.exit(2)
  }
  const result = buildRestoreSql(readFileSync(input, 'utf8'))
  writeFileSync(output, result.sql)
  console.error(
    `${output}: ${result.publicTables.length} public tables, ${result.sequences} sequence positions; ` +
      `skipped ${result.skipped.length} Storage tables (unused by IntroChat)`,
  )
}
