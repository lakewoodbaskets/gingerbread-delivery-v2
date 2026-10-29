export async function runRetention(client, { runId = crypto.randomUUID(), maxBatches = 5, deadlineMs = 45000 } = {}) {
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args)
    if (error) throw new Error(error.message || 'Retention database request failed')
    return data
  }
  if (!await rpc('delivery_retention_start', { run_id: runId })) return { status: 'disabled-or-busy' }
  const deadline = Date.now() + deadlineMs
  const counts = { archived: 0, deliveries_deleted: 0, files_deleted: 0, files_failed: 0 }
  let failure = null
  try {
    for (let batch = 0; batch < maxBatches && Date.now() < deadline; batch++) {
      const result = await rpc('delivery_retention_batch', { run_id: runId, batch_size: 100 })
      counts.archived += result.archived
      counts.deliveries_deleted += result.deliveries_deleted
      const paths = await rpc('delivery_retention_claim_files', { run_id: runId, batch_size: 50 })
      for (const path of paths) {
        if (Date.now() >= deadline) break // Unprocessed claims become eligible after their lease expires.
        let fileError = null
        try {
          const { error } = await client.storage.from('delivery-proofs').remove([path])
          if (error && String(error.statusCode || error.status) !== '404') fileError = 'Storage deletion failed'
        } catch {
          fileError = 'Storage deletion request failed'
        }
        await rpc('delivery_retention_file_result', { run_id: runId, file_path: path, failure: fileError })
        counts[fileError ? 'files_failed' : 'files_deleted']++
      }
      if (!result.archived && !result.deliveries_deleted && !paths.length) break
    }
    return { status: 'finished', run_id: runId, ...counts }
  } catch (error) {
    failure = 'Retention run failed; inspect database run status and pending queue.'
    throw error
  } finally {
    await rpc('delivery_retention_finish', { run_id: runId, failure })
  }
}
