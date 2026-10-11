/**
 * Phase F2 security regression gate: filesystem confinement + least privilege.
 *
 * Phase E reported broad `fs:read-all` / `fs:write-all` capabilities, four
 * unguarded path commands, unconfined `remove_dir_all`, template-id sanitization
 * that ran on writes but not reads, and a recovery path that could delete a
 * live recording's checkpoints.
 *
 * The behavioural proofs live in Rust, against the real production functions:
 *   src-tauri/src/path_guard.rs                    (path confinement + deletion)
 *   src-tauri/src/summary/templates/tests_f2_security.rs (template id reads)
 * These assertions pin the configuration and the frontend contract that those
 * tests depend on, so neither can be silently undone.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')
const conf = JSON.parse(read('src-tauri/tauri.conf.json'))

/** Every permission string in every capability, including inline objects. */
function allPermissions(capabilities) {
  const out = []
  for (const cap of capabilities) {
    for (const p of cap.permissions ?? []) {
      out.push(typeof p === 'string' ? p : p.identifier)
    }
  }
  return out
}

const permissions = allPermissions(conf.app.security.capabilities)

/** Strip comments so prose about a rule is not read as implementing it. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('phase F2: least-privilege Tauri capabilities', () => {
  it('the renderer is granted no filesystem plugin permission at all', () => {
    const fsPerms = permissions.filter((p) => typeof p === 'string' && p.startsWith('fs:'))
    assert.deepEqual(
      fsPerms,
      [],
      `the renderer performs no filesystem access itself; every read/write goes `
        + `through a validating Rust command. Found: ${fsPerms.join(', ')}`,
    )
  })

  it('the blanket read-all / write-all grants are gone', () => {
    for (const forbidden of ['fs:read-all', 'fs:write-all', 'fs:default']) {
      assert.ok(
        !permissions.includes(forbidden),
        `${forbidden} grants unrestricted access and must not be present`,
      )
    }
  })

  it('no filesystem scope is declared without the fs plugin', () => {
    const scopes = conf.app.security.capabilities.flatMap((c) =>
      (c.permissions ?? []).filter((p) => typeof p === 'object' && p.identifier === 'fs:scope'),
    )
    assert.deepEqual(scopes, [], 'an fs:scope without any fs permission is dead configuration')
  })

  it('core:path is retained because the frontend resolves appDataDir()', () => {
    // appDataDir() is the only filesystem-adjacent call in the frontend, and it
    // is a read-only path resolution, not a read/write.
    assert.ok(permissions.includes('core:path:default'), 'core:path must remain available')
    const srcFiles = []
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name))
        else if (/\.(ts|tsx)$/.test(e.name)) srcFiles.push(join(d, e.name))
      }
    }
    walk('src')
    const users = srcFiles.filter((f) => read(f).includes("from '@tauri-apps/api/path'"))
    assert.ok(users.length > 0, 'sanity: appDataDir() should still be in use')

    // And nothing should import the fs plugin, which is why its permissions
    // were removed.
    const fsImporters = srcFiles.filter((f) => read(f).includes('@tauri-apps/plugin-fs'))
    assert.deepEqual(
      fsImporters,
      [],
      'the fs plugin is no longer permitted, so nothing may import it',
    )
  })

  it('the retained permissions are the expected non-filesystem set', () => {
    for (const p of permissions) {
      assert.ok(
        /^(core|store|notification):/.test(p),
        `unexpected permission outside the reviewed set: ${p}`,
      )
    }
  })
})

describe('phase F2: path confinement at the trust boundary', () => {
  const libRs = read('src-tauri/src/lib.rs')
  const saver = read('src-tauri/src/audio/incremental_saver.rs')

  it('read_audio_file is confined, not a raw arbitrary read', () => {
    const c = code(libRs)
    assert.doesNotMatch(
      c,
      /fn read_audio_file\(file_path: String\)[\s\S]{0,200}?std::fs::read\(&file_path\)/,
      'reading an unvalidated renderer path is an arbitrary-file-read primitive',
    )
    assert.match(
      c,
      /read_audio_file[\s\S]{0,300}?confine_recording_path/,
      'read_audio_file must resolve through the path guard',
    )
  })

  it('save_transcript is confined and writes atomically', () => {
    const c = code(libRs)
    assert.match(
      c,
      /save_transcript[\s\S]{0,400}?confine_recording_path/,
      'save_transcript must resolve through the path guard',
    )
    assert.doesNotMatch(
      c,
      /std::fs::write\(&file_path, content\)/,
      'a direct write to an unvalidated path is an arbitrary-write primitive',
    )
    assert.match(c, /std::fs::rename\(&temp, &resolved\)/, 'the write must be atomic')
  })

  it('the checkpoint commands are confined', () => {
    for (const fn of [
      'cleanup_checkpoints',
      'recover_audio_from_checkpoints',
      'has_audio_checkpoints',
    ]) {
      assert.match(
        saver,
        new RegExp(`${fn}[\\s\\S]{0,900}?confine_recording`),
        `${fn} must resolve through the path guard`,
      )
    }
  })

  it('deletion uses the deletion guard, which refuses roots and ancestors', () => {
    const guard = read('src-tauri/src/path_guard.rs')
    assert.match(guard, /pub fn resolve_for_deletion/, 'a distinct deletion guard is required')
    assert.match(
      guard,
      /Refusing to delete the recordings root itself/,
      'deleting the root must be refused',
    )
    assert.match(
      guard,
      /Refusing to delete an ancestor of the recordings root/,
      'deleting an ancestor of the root would take the database with it',
    )
  })

  it('the guard canonicalises rather than string-matching', () => {
    const guard = read('src-tauri/src/path_guard.rs')
    assert.match(guard, /canonicalize/, 'symlink escapes require canonicalisation')
    assert.match(guard, /canonicalize_lenient/, 'non-existent targets must still be validated')
    assert.match(
      guard,
      /starts_with/,
      'containment must compare whole path components, not string prefixes',
    )
  })
})

describe('phase F2: recording recovery cannot destroy a live recording', () => {
  const saver = read('src-tauri/src/audio/incremental_saver.rs')
  const recoveryHook = read('src/hooks/useTranscriptRecovery.ts')

  it('recovery and checkpoint cleanup refuse to run while recording', () => {
    for (const fn of ['cleanup_checkpoints', 'recover_audio_from_checkpoints']) {
      const m = saver.match(new RegExp(`pub async fn ${fn}[\\s\\S]{0,700}`))
      assert.ok(m, `could not locate ${fn}`)
      assert.match(
        m[0],
        /is_recording\(\)\.await/,
        `${fn} must fail closed while a recording is live`,
      )
    }
  })

  it('the frontend no longer falls back to the active recording folder', () => {
    // get_meeting_folder_path returns the CURRENT session's folder. Recovery
    // using it merged into, then deleted, an in-progress capture's checkpoints.
    assert.doesNotMatch(
      code(recoveryHook),
      /get_meeting_folder_path/,
      'recovery must not source a folder from the live session',
    )
  })
})

describe('phase F2: template identifiers are validated on reads', () => {
  const loader = read('src-tauri/src/summary/templates/loader.rs')
  const store = read('src-tauri/src/summary/templates/store.rs')

  it('every read path sanitizes before building a path', () => {
    for (const fn of ['load_bundled_template', 'load_custom_template']) {
      const m = loader.match(new RegExp(`fn ${fn}[\\s\\S]{0,400}`))
      assert.ok(m, `could not locate ${fn}`)
      assert.match(
        m[0],
        /sanitize_template_id\(template_id\)/,
        `${fn} must validate the id before touching the filesystem`,
      )
    }
  })

  it('template_file_path cannot build a traversal path', () => {
    const m = store.match(/pub fn template_file_path[\s\S]{0,600}?\n\}/)
    assert.ok(m, 'could not locate template_file_path')
    assert.match(
      m[0],
      /sanitize_template_id\(id\)/,
      'the path builder must validate, so it is safe for any caller',
    )
  })

  it('the F2 template security tests exist and are compiled', () => {
    const modRs = read('src-tauri/src/summary/templates/mod.rs')
    assert.match(modRs, /mod tests_f2_security;/, 'the security test module must be compiled')
    const t = read('src-tauri/src/summary/templates/tests_f2_security.rs')
    for (const s of [
      'a_traversal_identifier_cannot_read_a_file_out_of_the_templates_dir',
      'an_absolute_identifier_cannot_read_an_arbitrary_file',
      'a_legacy_persisted_invalid_id_fails_safely',
      'template_file_path_refuses_to_build_a_traversal_path',
    ]) {
      assert.ok(t.includes(s), `missing template security scenario: ${s}`)
    }
  })
})

describe('phase F2: path guard security tests exist', () => {
  it('the confinement scenarios are present', () => {
    const g = read('src-tauri/src/path_guard.rs')
    for (const s of [
      'rejects_parent_traversal',
      'rejects_an_absolute_path_outside_the_root',
      'rejects_a_sibling_directory_with_a_shared_prefix',
      'rejects_symlink_escape_from_the_root',
      'validates_a_path_that_does_not_exist_yet',
      'deletion_refuses_the_root_itself',
      'deletion_refuses_an_ancestor_of_the_root',
      'deletion_allows_a_child_directory',
      'traversal_heuristic_flags_hostile_shapes',
    ]) {
      assert.ok(g.includes(s), `missing path confinement scenario: ${s}`)
    }
  })
})