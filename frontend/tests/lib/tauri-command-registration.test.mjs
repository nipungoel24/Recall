/**
 * Tauri command registration gate.
 *
 * A frontend `invoke('some_command', ...)` that is missing from the Rust
 * `tauri::generate_handler![...]` list fails at RUNTIME with "unknown command",
 * not at compile time, and not in any TypeScript or Rust test. That is how the
 * entire Meeting Intelligence feature shipped broken: `intelligence_commands.rs`
 * existed since Phase 4, the Phase 5 frontend was written against it, and
 * `lib.rs` never registered it — so every meeting reported intelligence as
 * unavailable while 172/172 Phase 5 tests passed.
 *
 * This gate closes that class of bug: every command the frontend can invoke
 * must appear in the Rust handler.
 *
 * It intentionally does not check argument shapes. Tauri v2 maps camelCase
 * argument keys onto snake_case Rust parameters, and a mismatched payload is a
 * separate, narrower failure that this gate cannot see.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

/** Every .ts/.tsx under a directory, as repo-relative posix paths. */
function sourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) sourceFiles(rel, acc)
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(rel)
  }
  return acc
}

const LIB_RS = 'src-tauri/src/lib.rs'

/**
 * Commands the frontend invokes, via a literal first argument to `invoke(...)`.
 * Dynamic command names are not analysable and are out of scope.
 */
function invokedCommands() {
  const found = new Map() // command -> [files]
  for (const file of sourceFiles('src')) {
    const src = read(file)
    // invoke('name'  |  invoke("name"
    const re = /\binvoke(?:<[^>]*>)?\(\s*(['"])([a-z0-9_]+)\1/g
    let m
    while ((m = re.exec(src)) !== null) {
      const cmd = m[2]
      if (!found.has(cmd)) found.set(cmd, [])
      found.get(cmd).push(file)
    }
  }
  return found
}

/**
 * Commands registered in the Rust handler. Entries are module-qualified
 * (e.g. `summary::commands::api_get_summary`) or bare; we compare the final
 * path segment because that is what Tauri exposes to `invoke`.
 */
function registeredCommands() {
  const src = read(LIB_RS)
  const start = src.indexOf('tauri::generate_handler![')
  assert.ok(start !== -1, 'could not find tauri::generate_handler![ in lib.rs')

  const open = src.indexOf('[', start)
  let depth = 0
  let close = -1
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++
    else if (src[i] === ']') {
      depth--
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  assert.ok(close !== -1, 'could not find the end of tauri::generate_handler![')

  const body = src.slice(open + 1, close)
  const names = new Set()
  for (const m of body.matchAll(/^\s*([A-Za-z0-9_:]+)\s*,?\s*$/gm)) {
    const path = m[1]
    if (path === 'tauri::generate_handler') continue
    names.add(path.split('::').pop())
  }
  return names
}

const invoked = invokedCommands()
const registered = registeredCommands()

describe('tauri command registration', () => {
  it('the Rust handler could be parsed', () => {
    assert.ok(registered.size > 100, `expected a populated handler, parsed ${registered.size}`)
  })

  it('the frontend invokes a non-trivial number of commands', () => {
    assert.ok(invoked.size > 50, `expected many invoked commands, found ${invoked.size}`)
  })

  it('every command the frontend invokes is registered in Rust', () => {
    const missing = []
    for (const [cmd, files] of invoked) {
      if (!registered.has(cmd)) missing.push(`${cmd}  (invoked from ${[...new Set(files)].join(', ')})`)
    }
    assert.deepEqual(
      missing,
      [],
      `these invoke() calls will fail at runtime with "unknown command":\n  ${missing.join('\n  ')}`,
    )
  })

  it('the meeting intelligence commands are registered', () => {
    // Named explicitly because this is the exact regression that shipped.
    for (const cmd of [
      'api_get_meeting_intelligence',
      'api_get_meeting_intelligence_items',
      'api_generate_meeting_intelligence',
      'api_get_transcript_segment',
      'api_get_transcript_segment_position',
    ]) {
      assert.ok(registered.has(cmd), `${cmd} is not registered in lib.rs`)
      assert.ok(invoked.has(cmd), `${cmd} is registered but never invoked — dead command`)
    }
  })

  it('intelligence commands are declared with #[tauri::command]', () => {
    const src = read('src-tauri/src/summary/intelligence_commands.rs')
    const declared = (src.match(/#\[tauri::command\]/g) || []).length
    assert.ok(declared >= 5, `expected at least 5 #[tauri::command] fns, found ${declared}`)
  })
})
