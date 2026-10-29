// Explicit owner-approved first cleanup only. Never called by the frontend/CI.
import { createClient } from '@supabase/supabase-js'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { verifyBackup } from './verify-retention-backup.mjs'
import { runRetention } from '../supabase/functions/delivery-retention/worker.mjs'

if (!process.argv.includes('--execute-approved') || !process.argv[2]) throw new Error('An approved backup directory and --execute-approved are required')
const directory = resolve(process.argv[2])
await verifyBackup(directory)
const approved = JSON.parse(await readFile(directory + '/preview.json', 'utf8'))
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const canonical = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const business = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !['archived_at', 'updated_at'].includes(key)))
async function checked(request) {
  const { data, error } = await request
  if (error) throw new Error('Production request failed; cleanup must remain paused')
  return data
}
async function rows(table) {
  const result = []
  for (let offset = 0; ; offset += 1000) {
    const page = await checked(client.from(table).select('*').order('id').range(offset, offset + 999))
    result.push(...page)
    if (page.length < 1000) return result
  }
}
const preview = await checked(client.rpc('delivery_retention_preview'))
for (const field of ['deliveries', 'files', 'unrecognized_file_urls', 'blocked_delivery_count', 'missing_completed_at_count']) {
  if (canonical(preview[field]) !== canonical(approved[field])) throw new Error('STOP: approved inventory changed; nothing was enabled')
}
const ids = new Set(approved.deliveries.map((row) => row.id))
const files = new Map(approved.files.filter((file) => !file.shared_with_retained_delivery).map((file) => [file.path, file]))
const baseline = { deliveries: (await rows('deliveries')).filter((row) => !ids.has(row.id)), drivers: await rows('drivers'), settings: await rows('settings') }
await writeFile(directory + '/protected-baseline.json', JSON.stringify(baseline), { mode: 0o600, flag: 'wx' })
async function verifyProtected() {
  const current = new Map((await rows('deliveries')).map((row) => [row.id, row]))
  for (const row of baseline.deliveries) {
    if (!current.has(row.id) || canonical(business(current.get(row.id))) !== canonical(business(row))) throw new Error('STOP: protected delivery changed')
  }
  if (canonical(await rows('drivers')) !== canonical(baseline.drivers)) throw new Error('STOP: driver data changed')
  if (canonical(await rows('settings')) !== canonical(baseline.settings)) throw new Error('STOP: settings changed')
}
const receipt = { started_at: new Date().toISOString(), local_only_backup_risk_accepted: true, runs: [], protected_deliveries: baseline.deliveries.length }
try {
  await checked(client.from('delivery_retention_control').update({
    approved_delivery_ids: [...ids], approved_file_paths: [...files.keys()],
    backup_verified_at: new Date().toISOString(), enabled: true,
  }).eq('id', true).select('id').single())
  for (let batch = 0; batch < 30; batch++) {
    const live = await checked(client.rpc('delivery_retention_preview'))
    for (const row of live.deliveries) {
      const expected = approved.deliveries.find((item) => item.id === row.id)
      if (!expected || canonical(business(row)) !== canonical(business(expected))) throw new Error('STOP: delivery inventory changed during cleanup')
    }
    for (const file of live.files) {
      const expected = files.get(file.path)
      if (!expected || file.shared_with_retained_delivery || ['bytes', 'updated_at', 'object_version'].some((key) => file[key] !== expected[key])) throw new Error('STOP: file ownership or version changed during cleanup')
    }
    if (live.unrecognized_file_urls.length || live.blocked_delivery_count || live.missing_completed_at_count !== approved.missing_completed_at_count) throw new Error('STOP: new cleanup exception')
    await verifyProtected()
    const result = await runRetention(client, { maxBatches: 1 })
    if (result.status !== 'finished' || result.files_failed) throw new Error('STOP: cleanup did not finish successfully')
    receipt.runs.push(result)
    console.log(JSON.stringify(result))
    await writeFile(directory + '/cleanup-receipt.json', JSON.stringify(receipt, null, 2), { mode: 0o600 })
    if (!result.archived && !result.deliveries_deleted && !result.files_deleted) break
  }
  const remaining = await rows('deliveries')
  if (remaining.some((row) => ids.has(row.id))) throw new Error('Approved delivery records remain')
  const queue = await checked(client.from('delivery_file_cleanup').select('path,state').in('path', [...files.keys()]))
  if (queue.length !== files.size || queue.some((item) => item.state !== 'deleted')) throw new Error('Approved file cleanup is incomplete')
  const pending = [...files.keys()]
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (pending.length) {
      const path = pending.pop()
      const { error } = await client.storage.from('delivery-proofs').info(path)
      if (!error || String(error.statusCode || error.status) !== '404') throw new Error('Storage API could not confirm an approved object was removed')
    }
  }))
  await verifyProtected()
  receipt.verified_at = new Date().toISOString()
  receipt.deleted_deliveries = ids.size
  receipt.deleted_files = files.size
  receipt.protected_drivers = baseline.drivers.length
  receipt.protected_settings = baseline.settings.length
  receipt.storage_api_removal_verified = true
} finally {
  await checked(client.from('delivery_retention_control').update({ enabled: false }).eq('id', true))
  receipt.paused_after_execution = true
  await writeFile(directory + '/cleanup-receipt.json', JSON.stringify(receipt, null, 2), { mode: 0o600 })
}
console.log(JSON.stringify({ verified: true, deleted_deliveries: receipt.deleted_deliveries, deleted_files: receipt.deleted_files, protected_deliveries: receipt.protected_deliveries, protected_drivers: receipt.protected_drivers, protected_settings: receipt.protected_settings, cleanup_paused: true }))
