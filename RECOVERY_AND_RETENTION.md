# Recovery and retention runbook

## Current status

All changes are local until reviewed and deployed by the owner. No migration,
function deployment, schedule activation or production deletion is performed by
the build or test scripts. The migration defaults retention to disabled and the
schedule template installs an inactive job. Tests use an isolated local database.

Supabase currently rejects the project's API requests with HTTP 402 for egress
and storage limits. Code cannot lift this restriction. Restore service through
Supabase Billing/Usage (the appropriate plan/spend-limit change) or Support first.
Deleting database metadata is not a workaround and does not free stored photos.
Previously incurred egress is not reversed by deleting files.

## Owner steps, in order

1. Restore Supabase service. Do not send credentials in chat. Confirm settings
   reads succeed and the intended project is configured in Vercel. The two
   existing VITE_SUPABASE_* variables remain sufficient for the browser.
2. Review this branch. Deploy the frontend login/photo recovery changes only
   after deployment is approved separately. This fixes the misleading login
   error, but cannot restore access while Supabase returns 402. No PIN is reset.
3. Review/apply `supabase/migrations/202610250001_delivery_retention.sql` with
   the SQL Editor or the project's migration process. This adds public-schema
   functions, private queue/control/run tables and a delivery-file tracking
   trigger. It does not alter historical orders, order numbers, drivers or
   settings and does not delete storage files. Inspect existing production cron
   jobs/functions for older retention jobs and disable any conflicting job
   before enabling this one. Repository inspection cannot establish their state.
4. Set the exact project's origin (no trailing slash) in SQL Editor:

   ```sql
   update public.delivery_retention_control
   set storage_origin = 'https://YOUR_PROJECT_REF.supabase.co'
   where id;
   ```

5. In a trusted local terminal, supply `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` as process environment variables. Never use a
   VITE_ name for privileged credentials. Run `npm run retention:preview`.
   This only reads Supabase and writes a private local preview. It does not
   call the Edge Function and does not activate cleanup.
6. Review `summary.json` and `preview.json` in the reported ignored
   `retention-backups/` directory. They contain exact delivery IDs, full affected
   records, exact bucket paths, object versions/timestamps, estimated bytes,
   shared-file exclusions, missing files and unrecognized-URL holds. They contain
   customer information: keep the directory private. Filesystem modes do not
   replace Windows ACLs. Store backups outside the project's OneDrive folder on
   a restricted drive if OneDrive syncing is inappropriate for customer data.
7. Run `npm run retention:preview -- --backup`. It generates a fresh preview,
   saves every affected delivery column, downloads actual file bytes, checks
   object sizes, rereads local files to verify SHA-256, and rechecks the live
   candidate inventory. Failed/changed downloads cannot produce a verified
   manifest. Unknown URLs stop backup verification. Missing-before-backup files
   are explicit exceptions, not recovered files. Resolve or approve those
   exceptions before destructive cleanup. Copy the backup off-site and run
   `node scripts/verify-retention-backup.mjs PATH_TO_BACKUP` on that copy.
   Review the fresh preview and verified manifest with the owner. Do not enable
   deletion until the owner explicitly approves them. The app's ordinary JSON
   backup and Supabase database backups do not include actual storage objects.
8. Only after approval: set a strong randomly generated `RETENTION_JOB_SECRET`
   in Edge Function secrets, deploy `delivery-retention` with this repository's
   `supabase/config.toml`, and install matching Vault entries
   `retention_job_secret` and `project_url`. Keep the secret out of Git, SQL
   history copied to chat, browser variables and client code. The function uses
   its built-in SUPABASE_SERVICE_ROLE_KEY only on the server. The custom header
   is checked even though gateway JWT verification is disabled for this function.
   With the Supabase CLI authenticated locally, deploy using
   `supabase functions deploy delivery-retention --project-ref YOUR_PROJECT_REF`.
   Set the function secret through Dashboard > Edge Functions > Secrets. Install
   the same value through Dashboard > Integrations > Vault, plus `project_url`.
   These are owner setup instructions, not commands run by this implementation.
9. Only after approved preview and verified backup, record the approval gate:

   ```sql
   update public.delivery_retention_control
   set backup_verified_at = now(), enabled = true
   where id;
   ```

   Send a protected POST to `/functions/v1/delivery-retention` with
   `x-retention-secret` and body `{"action":"run"}` for a bounded first run.
   `{"action":"preview"}` is read-only and is the default action. Compare run
   counts to the approved manifest, confirm Storage paths are gone, newer/active
   deliveries remain, and shared files still exist. Run the backup tool again
   before any additional first-cleanup batches whose candidates were not backed
   up or covered by the approved preview. Reconcile intervening edits/new
   candidates before each run; coordinate the first cleanup with Office users.
10. After first-run verification and approval of ongoing automatic retention,
    run `supabase/retention_schedule.sql`. It creates an INACTIVE hourly job.
    Activate it with the explicit `cron.alter_job` statement at that file's end.
    Cron needs pg_cron and pg_net; the job secret belongs in Supabase Vault.
    Scheduled functions must be deployed separately from Vercel. Nothing in the
    frontend deployment activates this schedule.

## Policy and safety

- Read the sole `public.settings` row on every run (production uses text ID
  `main`; numeric IDs also work). Missing or multiple settings rows stop cleanup.
  Archive after archive_after_days
  (normally 7), delete after delete_after_days (normally 30), both measured from
  completed_at. Thirty days means thirty elapsed 24-hour periods, not thirty
  additional days after archive. The hourly schedule may add up to an hour,
  plus backlog/retry time. No created_at/delivery_date fallback is used for
  destructive eligibility. Null completion dates are held for review.
- Only Delivered/Failed rows qualify. Existing normal/Archived History views
  continue using archived_at. Malformed, missing or inconsistent settings stop
  the run. Unknown URL formats hold affected rows and pause all file deletion
  and orphan discovery until ownership/reference checks are reliable.
- Database row deletion and queue insertion share a transaction. Manual deletes
  and replaced/cleared proof URLs also create queue entries, even while the
  worker is disabled. Exact public/signed URLs from the configured origin are
  percent-decoded to exact paths. No order-number-folder deletion is used.
- Shared paths referenced by ANY retained delivery, including active orders,
  cannot be claimed for deletion. In-flight and deleted paths cannot be newly
  attached. Pending paths may be reattached only if the file still exists; this
  preserves transactional Backup Restore behavior. Never reuse retired paths.
- Storage removal happens through the Storage API, never SQL deletion of
  storage.objects. API and database transactions cannot be atomic together;
  durable queue entries survive API failures, timeouts and worker crashes.
  Queue rows are retained as tombstones. Failed attempts back off up to 24 hours;
  abandoned claims retry after 15 minutes. Storage objects already missing are
  treated as removed. Do not purge queue tombstones while paths could be reused.
- Orphan scanning checks only image/signature files in delivery-proofs, older
  than delete_after_days by BOTH creation and last-update timestamps and with
  no live proof/signature reference. This catches unsaved uploads and legacy
  manual deletion/replacement leftovers. Unknown extensions/MIME types are
  preserved. Other buckets, drivers and settings are never cleanup targets.
- A database lease prevents overlapping workers. Each invocation has bounded
  batches and a time budget; remaining work is picked up by the next run. Bulk
  initial backlogs may take multiple invocations. A prolonged restriction leaves
  work queued; no credential bypass is assumed and storage is not silently
  considered cleaned when a request fails.

## Bandwidth and photo behavior

New photos are decoded locally, resized to a maximum 1600-pixel edge, and encoded
as JPEG at 0.78 quality before upload. UUID filenames under database row IDs
prevent overwrites and order-number collisions. Long-lived cache headers and
lazy thumbnail decoding reduce repeated transfers; no cache-busting URLs are
added. Small thumbnails use the compressed source without requiring paid image
transforms. Historical images remain full-size until retention removes them;
this change does not rewrite existing storage. Realtime reconnects now back off
instead of reloading all data every 1.2 seconds during outages. Confirm actual
improvement in Storage/Database/Realtime usage and cache-hit metrics after release.

## Verification and monitoring

Run `npm test` and `npm run build`. The test database runs the actual migration
and covers cutoffs, active rows, shared files, duplicate order-number identities,
manual deletes/replacements, restores, URL decoding, retries and denied anon
access. Worker tests use mocked Storage failures. Backup verification tests
detect corrupted file bytes. Edge Function type checking:
`deno check supabase/functions/delivery-retention/index.ts`.

After activation, inspect `delivery_retention_runs` for archived/deleted counts,
finished_at and error; inspect `delivery_file_cleanup` for repeated attempts and
overdue next_attempt_at. Inspect Cron run details AND pg_net HTTP responses: a
successful cron SQL invocation alone does not prove the function succeeded.
Check for a successful finished run within the last two hours; investigate
missing runs or a growing retry backlog in Supabase's existing dashboard/logs.
Function logs contain counts, not customer names or secrets. Verify active and
newer delivery IDs remain and reconcile recovered bytes against the manifest.
Test Storage outage/retry and missing-file cases in staging before first release.

The existing toolchain currently reports four high-severity development-tool
dependency advisories in `npm audit` (Vite/PostCSS and transitive packages).
This change does not bundle those development servers into the production app
or silently upgrade the unrelated toolchain. Review patched toolchain versions
separately before exposing a development server to an untrusted network.

Emergency pause:

```sql
update public.delivery_retention_control set enabled = false where id;
```

Also deactivate the cron job. Already issued Storage requests cannot be recalled;
the worker finishes its current bounded claimed batch. Backups are the recovery
source for permanently deleted rows/files. Restoring files may require clearing
the corresponding deleted queue tombstone in an owner-reviewed recovery before
reattaching a URL; do not use ordinary app restore to undo a cleanup blindly.

## Approved first-cleanup execution

The owner explicitly accepted the risk of retaining only the verified local
backup for the October 29, 2026 first cleanup. Do not infer that waiver for
future recoveries. The first cleanup removed exactly 441 approved deliveries
and 447 approved files. The 210 retained deliveries, 4 drivers, settings and
104 retained storage objects were independently checked; retained business
fields and storage metadata were unchanged (normal archived_at updates are
expected under the 7-day policy).

`202610290001_approved_cleanup_scope.sql` adds optional exact-ID/path allowlists.
They reject deletion or queue claims outside a specifically approved first-run
inventory. Ordinary scheduled retention uses NULL allowlists only after first
cleanup verification. Both allowlists must be set/cleared together.

For an explicitly approved initial cleanup only, use
`node scripts/execute-approved-retention.mjs PRIVATE_BACKUP_DIRECTORY --execute-approved`
with server credentials in the local process. It revalidates backup checksums
and the live inventory, records a protected-data baseline, executes bounded
batches through the existing worker, verifies every removed file using the
Storage info API, and pauses cleanup on exit. It creates private receipts beside
the backup; never commit these files. Independently compare retained storage
metadata against a before-run snapshot before enabling ordinary scheduling.

To verify actual cron invocation without waiting an hour, temporarily use
`* * * * *`, observe a successful cron run, pg_net HTTP 200 and a matching
finished retention run, then immediately set the intended `17 * * * *` schedule.
Do not treat creating a cron job or a successful HTTP enqueue as execution proof.
