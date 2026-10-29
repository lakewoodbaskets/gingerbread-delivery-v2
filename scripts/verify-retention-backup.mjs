import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function verifyBackup(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  if (manifest.version !== 1 || manifest.verified !== true || !Array.isArray(manifest.files)) throw new Error('Incomplete backup manifest')
  const sha256 = (value) => createHash('sha256').update(value).digest('hex')
  const records = await readFile(join(directory, 'deliveries.json'))
  if (sha256(records) !== manifest.records_sha256 || !Array.isArray(JSON.parse(records))) throw new Error('Record checksum mismatch')
  let verifiedFiles = 0
  for (const file of manifest.files) {
    if (file.missing_before_backup) continue
    if (!/^object-\d+\.bin$/.test(file.local_file)) throw new Error('Invalid backup filename')
    const bytes = await readFile(join(directory, file.local_file))
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error('Storage file checksum mismatch')
    verifiedFiles++
  }
  return { verified_files: verifiedFiles, missing_before_backup: manifest.files.filter((file) => file.missing_before_backup).length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Provide the private backup directory to verify')
  console.log(JSON.stringify(await verifyBackup(resolve(process.argv[2])), null, 2))
}
