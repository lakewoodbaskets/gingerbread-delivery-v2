// Read-only production tool. Requires server credentials in the local process.
// Does not activate retention, modify rows, or delete any object.
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const backup = process.argv.includes('--backup')
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY locally; never use VITE_ for the service key.')
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: preview, error } = await client.rpc('delivery_retention_preview')
if (error) {
  console.error('Preview unavailable. Restore Supabase access and install the retention migration first.')
  process.exit(1)
}
const directory = resolve('retention-backups', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID())
await mkdir(directory, { recursive: true, mode: 0o700 })
const save = (name, content) => writeFile(join(directory, name), content, { mode: 0o600 })
await save('preview.json', JSON.stringify(preview, null, 2))
const files = preview.files.filter((file) => !file.shared_with_retained_delivery)
const summary = {
  deliveries: preview.deliveries.length,
  files: files.length,
  shared_files_preserved: preview.files.length - files.length,
  estimated_recoverable_bytes: files.reduce((total, file) => total + Number(file.bytes || 0), 0),
  unknown_file_sizes: files.filter((file) => file.exists_in_storage && file.bytes == null).length,
  missing_files: files.filter((file) => !file.exists_in_storage).length,
  unresolved_urls: preview.unrecognized_file_urls.length,
  completed_without_date: preview.missing_completed_at_count,
  blocked_deliveries: preview.blocked_delivery_count,
}
await save('summary.json', JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
console.log('Private preview directory:', directory)

if (backup) {
  if (preview.unrecognized_file_urls.length) throw new Error('Unrecognized URLs require review before a verified backup can be completed.')
  // Snapshot includes all columns, including historical signatures and sequence identities.
  const records = Buffer.from(JSON.stringify(preview.deliveries, null, 2))
  await save('deliveries.json', records)
  const sha256 = (value) => createHash('sha256').update(value).digest('hex')
  const manifest = { version: 1, preview_at: preview.preview_at, records_sha256: sha256(records), files: [], verified: false }
  for (const [index, file] of files.entries()) {
    if (!file.exists_in_storage) {
      manifest.files.push({ path: file.path, missing_before_backup: true })
      continue
    }
    const { data, error: downloadError } = await client.storage.from('delivery-proofs').download(file.path)
    if (downloadError) throw new Error('Storage backup download failed; backup is incomplete.')
    const bytes = Buffer.from(await data.arrayBuffer())
    if (file.bytes != null && bytes.length !== Number(file.bytes)) throw new Error('Object size changed during backup; generate a fresh preview.')
    const localName = 'object-' + index + '.bin'
    await save(localName, bytes)
    const expectedHash = sha256(bytes)
    if (sha256(await readFile(join(directory, localName))) !== expectedHash) throw new Error('Backup checksum verification failed.')
    manifest.files.push({ path: file.path, local_file: localName, bytes: bytes.length, sha256: expectedHash })
  }
  if (sha256(await readFile(join(directory, 'deliveries.json'))) !== manifest.records_sha256) throw new Error('Record backup verification failed.')
  // Detect row edits, new candidates or object changes while downloading. Fail closed.
  const { data: fresh, error: refreshError } = await client.rpc('delivery_retention_preview')
  const inventory = (value) => JSON.stringify({ deliveries: value.deliveries, files: value.files })
  if (refreshError || inventory(fresh) !== inventory(preview)) throw new Error('Candidates changed during backup; review a fresh preview and rerun.')
  manifest.verified = true
  manifest.verified_at = new Date().toISOString()
  await save('manifest.json', JSON.stringify(manifest, null, 2))
  console.log('Backup files and record checksums verified. Retention is still disabled. Review missing-file exceptions before approval.')
}
