import { createClient } from 'npm:@supabase/supabase-js@2.110.0'
import { runRetention } from './worker.mjs'
import { authorized } from './auth.mjs'

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!await authorized(request.headers.get('x-retention-secret'), Deno.env.get('RETENTION_JOB_SECRET') || '')) {
    return new Response('Unauthorized', { status: 401 })
  }
  try {
    const body = await request.text()
    if (body.length > 1024) return new Response('Request too large', { status: 413 })
    const { action = 'preview' } = body ? JSON.parse(body) : {}
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    if (action === 'preview') {
      const { data, error } = await client.rpc('delivery_retention_preview')
      if (error) throw error
      return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (action !== 'run') return new Response('Unknown action', { status: 400 })
    const result = await runRetention(client)
    console.log(JSON.stringify(result)) // Counts only; no customer data, file URLs or credentials.
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    console.error('Retention request failed. Check run logs and service availability.')
    return Response.json({ error: 'Retention unavailable; no unqueued file deletions were attempted.' }, { status: 503 })
  }
})
