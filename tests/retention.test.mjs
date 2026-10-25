import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

let db
const origin = 'https://example.supabase.co'
const photo = (path) => origin + '/storage/v1/object/public/delivery-proofs/' + path
const id = (value) => '00000000-0000-0000-0000-' + String(value).padStart(12, '0')

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage;
    create table public.settings(id bigint primary key, archive_after_days integer, delete_after_days integer);
    insert into public.settings values(1, 7, 30);
    create table public.deliveries(id uuid primary key, order_no text, status text, completed_at timestamptz, archived_at timestamptz, proof_photo_url text, signature_url text);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), version text);
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/202610250001_delivery_retention.sql', import.meta.url), 'utf8'))
  await db.query('update public.delivery_retention_control set storage_origin = $1', [origin])
})
after(async () => db?.close())

async function isolated(fn) {
  await db.exec('begin')
  try { await fn() } finally { await db.exec('rollback') }
}
async function delivery(number, age, status = 'Delivered', path = '', signature = '') {
  await db.query(`insert into public.deliveries(id, order_no, status, completed_at, proof_photo_url, signature_url)
    values($1, '1040', $2, now() - $3::integer * interval '1 day', $4, $5)`, [id(number), status, age, path ? photo(path) : '', signature ? photo(signature) : ''])
}
async function object(path, age, bucket = 'delivery-proofs') {
  await db.query(`insert into storage.objects(bucket_id, name, metadata, created_at, updated_at)
    values($1, $2, '{"size":42,"mimetype":"image/jpeg"}', now() - $3::integer * interval '1 day', now() - $3::integer * interval '1 day')`, [bucket, path, age])
}
async function preview() { return (await db.query('select public.delivery_retention_preview() as data')).rows[0].data }
async function start() {
  await db.exec('update public.delivery_retention_control set enabled = true, backup_verified_at = now()')
  assert.equal((await db.query('select public.delivery_retention_start($1) as started', [id(999)])).rows[0].started, true)
}
async function batch() { return (await db.query('select public.delivery_retention_batch($1, 100) as data', [id(999)])).rows[0].data }

test('migration installs disabled and refuses execution without approved backup', () => isolated(async () => {
  await delivery(1, 40)
  assert.equal((await db.query('select public.delivery_retention_start($1) as started', [id(999)])).rows[0].started, false)
  await db.exec('update public.delivery_retention_control set enabled = true')
  assert.equal((await db.query('select public.delivery_retention_start($1) as started', [id(999)])).rows[0].started, false)
  assert.equal((await preview()).deliveries.length, 1)
  assert.equal((await db.query('select count(*)::integer as count from deliveries')).rows[0].count, 1)
}))

test('archives after 7 days, deletes after 30 completed days, preserves boundary, active and missing dates', () => isolated(async () => {
  await delivery(1, 31, 'Delivered', 'old/proof.jpg', 'old/signature.png')
  await delivery(2, 8, 'Failed')
  await delivery(3, 30)
  await delivery(4, 90, 'New')
  await delivery(5, 90, 'Out for Delivery')
  await delivery(6, 90)
  await db.query('update deliveries set completed_at = null where id = $1', [id(6)])
  await object('old/proof.jpg', 31)
  await object('old/signature.png', 31)
  const report = await preview()
  assert.deepEqual(report.deliveries.map((row) => row.id), [id(1)])
  assert.equal(report.missing_completed_at_count, 1)
  await start()
  const result = await batch()
  assert.equal(result.deliveries_deleted, 1)
  assert.equal(result.archived, 3)
  const survivors = (await db.query('select * from deliveries order by id')).rows
  assert.equal(survivors.length, 5)
  assert.equal(survivors.find((row) => row.id === id(4)).archived_at, null)
  assert.equal((await db.query('select count(*)::integer as count from delivery_file_cleanup')).rows[0].count, 2)
  assert.equal((await db.query('select count(*)::integer as count from storage.objects')).rows[0].count, 2)
}))

test('shared files, newer files and unrelated buckets are preserved; old orphans are exact paths', () => isolated(async () => {
  await delivery(1, 40, 'Delivered', '1040/shared.jpg')
  await delivery(2, 1, 'Delivered', '1040/shared.jpg')
  await object('1040/shared.jpg', 40)
  await object('1040/orphan.jpg', 40)
  await object('1040/recent.jpg', 1)
  await object('other.jpg', 40, 'other-bucket')
  const report = await preview()
  assert.equal(report.files.find((file) => file.path === '1040/shared.jpg').shared_with_retained_delivery, true)
  await start()
  await batch()
  const claims = (await db.query('select * from delivery_retention_claim_files($1, 50)', [id(999)])).rows
  assert.deepEqual(claims.map((row) => row.delivery_retention_claim_files), ['1040/orphan.jpg'])
  assert.equal((await db.query('select count(*)::integer as count from deliveries')).rows[0].count, 1)
}))

test('manual delete and replacement enqueue old photo/signature paths atomically', () => isolated(async () => {
  await delivery(1, 1, 'Delivered', 'a/photo.jpg', 'a/signature.png')
  await db.query('update deliveries set proof_photo_url = $1 where id = $2', [photo('a/replacement.jpg'), id(1)])
  await db.query('delete from deliveries where id = $1', [id(1)])
  const paths = (await db.query('select path from delivery_file_cleanup order by path')).rows.map((row) => row.path)
  assert.deepEqual(paths, ['a/photo.jpg', 'a/replacement.jpg', 'a/signature.png'])
  await db.exec('savepoint invalid_reference')
  await assert.rejects(() => delivery(2, 1, 'Delivered', 'a/photo.jpg'), /retired/)
  await db.exec('rollback to invalid_reference')
}))

test('storage failures retry durably and concurrent workers cannot acquire the lease', () => isolated(async () => {
  await object('orphan.jpg', 40)
  await start()
  assert.equal((await db.query('select public.delivery_retention_start($1) as started', [id(998)])).rows[0].started, false)
  await batch()
  await db.query('select * from delivery_retention_claim_files($1, 50)', [id(999)])
  await db.query('select delivery_retention_file_result($1, $2, $3)', [id(999), 'orphan.jpg', 'Storage deletion failed'])
  const queue = (await db.query('select * from delivery_file_cleanup')).rows[0]
  assert.equal(queue.state, 'pending')
  assert.equal(queue.attempts, 1)
  assert.equal((await db.query('select * from delivery_retention_claim_files($1, 50)', [id(999)])).rows.length, 0)
  await db.exec("update delivery_file_cleanup set next_attempt_at = now() - interval '1 minute'")
  await db.query('select * from delivery_retention_claim_files($1, 50)', [id(999)])
  await db.query('select delivery_retention_file_result($1, $2, null)', [id(999), 'orphan.jpg'])
  assert.equal((await db.query('select state from delivery_file_cleanup')).rows[0].state, 'deleted')
}))

test('transactional restores can reattach existing pending files but never in-flight deletion paths', () => isolated(async () => {
  await object('restore/proof.jpg', 1)
  await delivery(1, 1, 'Delivered', 'restore/proof.jpg')
  await db.query('delete from deliveries where id = $1', [id(1)])
  await delivery(1, 1, 'Delivered', 'restore/proof.jpg')
  assert.equal((await db.query('select count(*)::integer as count from delivery_file_cleanup')).rows[0].count, 0)
  await db.query('delete from deliveries where id = $1', [id(1)])
  await start()
  await db.query('select * from delivery_retention_claim_files($1, 50)', [id(999)])
  await db.exec('savepoint in_flight')
  await assert.rejects(() => delivery(1, 1, 'Delivered', 'restore/proof.jpg'), /retired/)
  await db.exec('rollback to in_flight')
}))

test('foreign URLs are blocked and URL-encoded paths decode exactly', () => isolated(async () => {
  await delivery(1, 40)
  await db.query('update deliveries set proof_photo_url = $1 where id = $2', ['https://foreign.example/photo.jpg', id(1)])
  assert.equal((await preview()).blocked_delivery_count, 1)
  assert.equal((await preview()).deliveries.length, 0)
  assert.equal((await db.query('select delivery_proof_path($1) as path', [photo('a/My%20Photo.jpg')])).rows[0].path, 'a/My Photo.jpg')
  await start()
  assert.equal((await batch()).deliveries_deleted, 0)
}))

test('anonymous callers cannot preview or execute cleanup', () => isolated(async () => {
  await db.exec('set local role anon; savepoint forbidden')
  await assert.rejects(() => db.query('select delivery_retention_preview()'), /permission denied/)
  await db.exec('rollback to forbidden')
  await assert.rejects(() => db.query('select delivery_retention_start($1)', [id(999)]), /permission denied/)
}))

test('invalid settings stop retention before changing any deliveries', () => isolated(async () => {
  await delivery(1, 40)
  await start()
  await db.exec('update settings set delete_after_days = 1')
  await db.exec('savepoint invalid_settings')
  await assert.rejects(() => batch(), /Invalid retention settings/)
  await db.exec('rollback to invalid_settings')
  assert.equal((await db.query('select count(*)::integer as count from deliveries')).rows[0].count, 1)
}))

test('historical signature support remains safe when the column is absent', () => isolated(async () => {
  await db.exec('alter table deliveries drop column signature_url')
  await db.query("insert into deliveries(id, status, completed_at) values ($1, 'Failed', now() - interval '40 days')", [id(1)])
  assert.equal((await preview()).deliveries.length, 1)
  await start()
  assert.equal((await batch()).deliveries_deleted, 1)
}))
