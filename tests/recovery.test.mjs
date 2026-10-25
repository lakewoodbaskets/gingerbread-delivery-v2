import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkOfficeLogin, validateOfficeLogin } from '../src/officeAuth.js'
import { compressProofPhoto, fitImage } from '../src/proofPhoto.js'
import { runRetention } from '../supabase/functions/delivery-retention/worker.mjs'
import { authorized } from '../supabase/functions/delivery-retention/auth.mjs'

test('cleanup endpoint requires its private job secret and fails closed if unset', async () => {
  assert.equal(await authorized(null, 'private-test-secret'), false)
  assert.equal(await authorized('', ''), false)
  assert.equal(await authorized('public-anon-key', 'private-test-secret'), false)
  assert.equal(await authorized('private-test-secret', 'private-test-secret'), true)
})

test('Office login never accepts a default or reports invalid PIN during an outage', () => {
  for (const status of ['loading', 'error']) {
    const result = validateOfficeLogin('example', { officePin: 'example' }, status)
    assert.equal(result.ok, false)
    assert.match(result.message, /unavailable/)
  }
  assert.equal(validateOfficeLogin('example', { officePin: 'example' }, 'ready').ok, true)
  assert.equal(validateOfficeLogin('other', { officePin: 'example' }, 'ready').message, 'Invalid office PIN.')
  assert.match(validateOfficeLogin('', { officePin: '' }, 'ready').message, /unavailable/)
})

test('photo dimensions preserve aspect ratio and never upscale', () => {
  assert.deepEqual(fitImage(4000, 3000), { width: 1600, height: 1200 })
  assert.deepEqual(fitImage(3000, 4000), { width: 1200, height: 1600 })
  assert.deepEqual(fitImage(640, 480), { width: 640, height: 480 })
})

test('photo processing resizes and JPEG-encodes before upload and releases temporary URLs', async () => {
  const originalImage = globalThis.Image
  const originalDocument = globalThis.document
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  let revoked = false
  const canvas = {
    getContext: () => ({ fillRect() {}, drawImage() {} }),
    toBlob: (callback, type, quality) => {
      assert.equal(type, 'image/jpeg')
      assert.equal(quality, 0.78)
      callback(new Blob(['compressed'], { type }))
    },
  }
  try {
    globalThis.Image = class { naturalWidth = 4000; naturalHeight = 3000; async decode() {} }
    globalThis.document = { createElement: () => canvas }
    URL.createObjectURL = () => 'blob:test'
    URL.revokeObjectURL = () => { revoked = true }
    const result = await compressProofPhoto(new File(['original image'], 'proof.png', { type: 'image/png' }))
    assert.equal(result.type, 'image/jpeg')
    assert.equal(canvas.width, 1600)
    assert.equal(canvas.height, 1200)
    assert.equal(revoked, true)
    await assert.rejects(() => compressProofPhoto(new File(['text'], 'file.txt', { type: 'text/plain' })), /choose an image/)
  } finally {
    globalThis.Image = originalImage
    globalThis.document = originalDocument
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
})

test('Office login rechecks the backend and distinguishes outage from incorrect PIN', async () => {
  const unavailable = await checkOfficeLogin('example', async () => { throw new Error('HTTP 402') })
  assert.match(unavailable.message, /unavailable/)
  assert.equal((await checkOfficeLogin('example', async () => ({ officePin: 'changed' }))).message, 'Invalid office PIN.')
})

test('worker removes exact paths, persists individual failures, and finishes the run', async () => {
  const calls = []
  let batches = 0
  const client = {
    rpc: async (name, args) => {
      calls.push([name, args])
      if (name.endsWith('_start')) return { data: true }
      if (name.endsWith('_batch')) return { data: { archived: batches++ === 0 ? 1 : 0, deliveries_deleted: 0 } }
      if (name.endsWith('_claim_files')) return { data: batches === 1 ? ['1040/one.jpg', '1040/two.png'] : [] }
      return { data: null }
    },
    storage: { from: (bucket) => {
      assert.equal(bucket, 'delivery-proofs')
      return { remove: async (paths) => {
        assert.equal(paths.length, 1)
        calls.push(['remove', paths])
        return { error: paths[0].endsWith('.png') ? { status: 500 } : null }
      } }
    } },
  }
  const result = await runRetention(client)
  assert.equal(result.files_deleted, 1)
  assert.equal(result.files_failed, 1)
  assert.equal(calls.filter(([name]) => name === 'delivery_retention_file_result').length, 2)
  assert.equal(calls.at(-1)[0], 'delivery_retention_finish')
})

test('disabled worker makes no storage requests', async () => {
  const result = await runRetention({ rpc: async () => ({ data: false }) })
  assert.equal(result.status, 'disabled-or-busy')
})

test('database failure releases worker lease and propagates the error', async () => {
  const calls = []
  await assert.rejects(() => runRetention({ rpc: async (name) => {
    calls.push(name)
    if (name.endsWith('_start')) return { data: true }
    if (name.endsWith('_batch')) return { error: { message: 'Test failure' } }
    return { data: null }
  } }), /Test failure/)
  assert.equal(calls.at(-1), 'delivery_retention_finish')
})
