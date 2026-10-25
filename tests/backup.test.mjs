import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { verifyBackup } from '../scripts/verify-retention-backup.mjs'

test('backup verification validates actual file bytes and detects tampering', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gingerbread-backup-test-'))
  try {
    const records = Buffer.from('[{"id":"test-delivery"}]')
    const image = Buffer.from('test PNG bytes')
    const hash = (value) => createHash('sha256').update(value).digest('hex')
    await writeFile(join(directory, 'deliveries.json'), records)
    await writeFile(join(directory, 'object-0.bin'), image)
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({
      version: 1, verified: true, records_sha256: hash(records),
      files: [{ local_file: 'object-0.bin', bytes: image.length, sha256: hash(image) }],
    }))
    assert.deepEqual(await verifyBackup(directory), { verified_files: 1, missing_before_backup: 0 })
    await writeFile(join(directory, 'object-0.bin'), 'changed')
    await assert.rejects(() => verifyBackup(directory), /checksum mismatch/)
  } finally { await rm(directory, { recursive: true }) }
})
