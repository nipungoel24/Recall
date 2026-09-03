# Recall — Migration Upgrade Safety Guide

**Status:** LIVE release procedure
**Audience:** release engineers, support, anyone shipping DB-affecting changes.

---

## 1. The problem

Recall applies SQLite schema changes through `sqlx` migrations
(`frontend/src-tauri/migrations/*.sql`). sqlx stores the SHA-384 of every
applied migration file in the user's database (`_sqlx_migrations.checksum`).

On every startup sqlx re-validates applied migrations and **hard-fails** with

```
migration <version> was previously applied but has been modified
```

whenever an already-shipped migration file's bytes change. The Tauri setup
code turns this into a startup panic (`Failed to initialize database`), which
means a user upgrading from an older build would see the app crash on launch
instead of opening.

This happened once already: this repository's fork history diverged from the
upstream migration bytes, so developer databases created by older builds no
longer matched the current files. The drift was resolved for one machine by
the verified procedure in §4 below.

sqlx 0.8.6 offers **no tolerant mode** for this (verified against the vendored
source: `ignore_missing` only skips missing-version validation; the checksum
comparison in `Migrator::run_direct` always fails on mismatch).

## 2. The rule (prevention)

**Never modify a migration file that has shipped.** Schema changes go into a
NEW migration file with a strictly increasing version number. This includes
comment edits and whitespace-only edits — sqlx compares bytes, not SQL
semantics.

Enforcement:

- `frontend/src-tauri/migrations/checksums.json` records the SHA-384 of every
  shipped migration.
- `node tests/contract/audit.mjs` fails if any manifest-listed file's checksum
  changes (73 checks, 0 violations as of this writing).
- Run the audit in CI on every change touching `migrations/`.

Adding a new migration is safe: the audit reports new files without manifest
entries as INFO only — **run the manifest update and audit once before the
release**:

```powershell
# regenerate the manifest from the current files (from frontend/)
node ..\tools\gen-migration-manifest.cjs src-tauri/migrations src-tauri/migrations/checksums.json
node tests/contract/audit.mjs
```

## 3. What an upgrading user experiences

- DB created by a build whose migration bytes match the current files:
  startup runs only pending migrations and opens normally.
- DB created by an older/diverged build: startup panic with the message above.

The repair below is for case 2. It must never be performed automatically by
the application without structural verification.

## 4. Verified repair procedure (what was done on this machine)

Do NOT blind-update checksums. The DB must be verified to already contain the
effects of the migrations being re-baselined, otherwise later queries fail
silently or loudly.

1. **Back up first** (mandatory):
   copy `%APPDATA%\com.meetily.ai\meeting_minutes.sqlite` to
   `meeting_minutes.sqlite.bak-<date>`. (The Tauri identifier — and therefore
   this path — is intentionally preserved across the Meetily → Recall
   rebrand.)
2. **List applied migrations and compare checksums** against the current
   files (SHA-384 of each `.sql` file vs `_sqlx_migrations.checksum` blob).
3. **Verify structural equivalence** for every mismatched migration:
   - open the DB and confirm each table/column the migration file declares
     already exists (`sqlite_master` + `PRAGMA table_info`), with compatible
     types; the DB may be a superset (later migrations may add more).
   - If ANY declared object is missing, stop: this is a real divergence, not
     checksum drift. Resolve with a NEW migration instead.
4. **Re-baseline only the verified rows**:
   `UPDATE _sqlx_migrations SET checksum = X'<sha384-hex>' WHERE version = <v>;`
   for each verified migration, inside a transaction.
5. **Launch the app.** sqlx now treats those migrations as applied-and-
   matching and applies only the pending new migrations.
6. Keep the backup until the upgraded build has been used successfully.

A one-off utility implementing steps 2–4 for this repository's 13 current
migrations is available in the release tooling; it still requires a human to
confirm the structural verification from step 3's report.

## 5. What was NOT done (deliberately)

- No automated in-app checksum rewriting: sqlx's strictness exists to catch
  real schema divergence, and silently re-baselining without verification
  risks corrupting a user's data model.
- No migration history rewrite/rebasing of the files themselves.
- No changes to user DBs beyond the one verified re-baseline described above.

## 6. Release checklist

- [ ] `node tests/contract/audit.mjs` → 0 violations (checksum drift guard)
- [ ] New migrations have manifest entries before release
- [ ] Any support ticket with "previously applied but has been modified"
      follows §4 exactly (backup → verify → re-baseline → retest)
