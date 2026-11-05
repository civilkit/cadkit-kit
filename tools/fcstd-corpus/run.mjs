#!/usr/bin/env node
// Corpus runner: for each model in packages/fcstd/corpus/models run FreeCAD headless (driver.py),
// write <out>/<name>.FCStd, <name>.dump.json and, for models with variant(), <name>.v1.FCStd/.v1.dump.json.
//
//   node tools/fcstd-corpus/run.mjs [--only a,b] [--freecad APP_OR_BIN] [--out DIR] [--reopen] [--chunk N] [--timeout S]
//
// --reopen  re-open every saved file in a fresh FreeCAD process, dump again and require an identical dump.
// FreeCAD location: --freecad, else $FREECAD_APP, else /Applications/FreeCAD.app.
// Models are run in chunks inside one FreeCAD process (start-up is slow); a crashed chunk is retried model by model.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus = path.resolve(here, '../../packages/fcstd/corpus')
const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const flag = n => args.includes(n)

let fc = opt('--freecad', process.env.FREECAD_APP ?? '/Applications/FreeCAD.app')
if (fc.endsWith('.app')) fc = path.join(fc, 'Contents/Resources/bin/freecadcmd')
const out = path.resolve(opt('--out', path.join(corpus, 'generated')))
const chunk = Number(opt('--chunk', '12'))
const timeout = Number(opt('--timeout', '900')) * 1000
const modelsDir = path.join(corpus, 'models')
const only = opt('--only', '')?.split(',').filter(Boolean)
const all = fs.readdirSync(modelsDir).filter(f => /^\d\d_.*\.py$/.test(f)).map(f => f.slice(0, -3)).sort()
const names = only?.length ? all.filter(n => only.some(o => n === o || n.startsWith(o))) : all
if (!names.length) { console.error('no models selected'); process.exit(2) }
fs.mkdirSync(path.join(out, '_reopen'), { recursive: true })

function runDriver(mode, list) {
  const r = spawnSync(fc, [path.join(here, 'driver.py')], {
    env: { ...process.env, FCC_MODE: mode, FCC_MODELS: modelsDir, FCC_OUT: out, FCC_NAMES: list.join(',') },
    encoding: 'utf8', timeout, maxBuffer: 1 << 28,
  })
  const res = {}
  for (const line of (r.stdout || '').split('\n'))
    if (line.startsWith('FCC_RESULT ')) { const j = JSON.parse(line.slice(11)); res[j.model] = j }
  return { res, log: (r.stdout || '') + (r.stderr || ''), status: r.status }
}

function runAll(mode, list) {
  const results = {}
  for (let i = 0; i < list.length; i += chunk) {
    const part = list.slice(i, i + chunk)
    const { res, log } = runDriver(mode, part)
    Object.assign(results, res)
    const missing = part.filter(n => !res[n])
    for (const n of missing) { // process died: run it alone to find the culprit
      const one = runDriver(mode, [n])
      results[n] = one.res[n] ?? { model: n, ok: false, error: 'FreeCAD process died: ' + one.log.slice(-300) }
    }
    console.error(`${mode}: ${Math.min(i + chunk, list.length)}/${list.length}`)
  }
  return results
}

const dynEnums = new Set()
// properties FreeCAD derives again when a file is loaded (live value differs from the stored one)
const RELOAD_DERIVED = new Set(['ThreadDiameter'])
const statusFile = path.join(out, 'STATUS.json')
let status = {}
try { status = JSON.parse(fs.readFileSync(statusFile, 'utf8')) } catch {}
const results = runAll('generate', names)
for (const n of names) {
  const r = results[n]
  status[n] = { ok: r.ok, error: r.error ?? null, objects: r.objects ?? null, variant: r.variant ?? null }
}

if (flag('--reopen')) {
  runAll('reopen', names)
  for (const n of names) {
    for (const s of ['', '.v1']) {
      const a = path.join(out, n + s + '.dump.json'), b = path.join(out, '_reopen', n + s + '.dump.json')
      if (!fs.existsSync(a)) continue
      const diffs = []
      if (!fs.existsSync(b)) diffs.push('reopen produced no dump')
      else diff(JSON.parse(fs.readFileSync(a, 'utf8')), JSON.parse(fs.readFileSync(b, 'utf8')), '', diffs)
      const key = s ? 'reopenV1' : 'reopen'
      status[n][key] = diffs.length ? diffs.slice(0, 5) : 'identical'
      if (dynEnums.size) { status[n][key + 'DynamicEnums'] = [...new Set([...dynEnums].map(x => x.split('/').slice(-2, -1)[0]))]; dynEnums.clear() }
    }
  }
}

function diff(a, b, p, outd) {
  if (outd.length > 20) return
  if (p === '/stripped' || p === '/enumLists' || p === '/propertyTypes' || RELOAD_DERIVED.has(p.split('/')[4])) return
  if (typeof a !== typeof b || (a === null) !== (b === null)) return void outd.push(`${p}: ${JSON.stringify(a)?.slice(0, 60)} vs ${JSON.stringify(b)?.slice(0, 60)}`)
  if (a && typeof a === 'object' && !Array.isArray(a) && 'enum' in a && 'index' in a && 'enum' in b) {
    // enumerations whose item list is dynamic (Hole thread size/class/fit) come back as ['-'] after a reload;
    // only the stored index is comparable
    if (a.index !== b.index) outd.push(`${p}/index: ${a.index} vs ${b.index}`)
    else if (a.enum !== b.enum) dynEnums.add(p)
  } else if (a && typeof a === 'object') {
    const ks = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of ks) diff(a[k], b[k], p + '/' + k, outd)
  } else if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))) {
  } else if (a !== b) outd.push(`${p}: ${a} vs ${b}`)
}

// merge the per-process schema parts (property types and enumeration lists) into schema.json
const schemaFile = path.join(out, 'schema.json')
let schema = { enumLists: {}, propertyTypes: {} }
try { schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8')) } catch {}
for (const f of fs.readdirSync(out).filter(f => /^schema\.part\.\d+\.json$/.test(f))) {
  const part = JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'))
  Object.assign(schema.enumLists, part.enumLists)
  for (const [t, props] of Object.entries(part.propertyTypes)) schema.propertyTypes[t] = { ...schema.propertyTypes[t], ...props }
  fs.unlinkSync(path.join(out, f))
}
const sortObj = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)))
schema.enumLists = sortObj(schema.enumLists)
schema.propertyTypes = sortObj(Object.fromEntries(Object.entries(schema.propertyTypes).map(([t, p]) => [t, sortObj(p)])))
fs.writeFileSync(schemaFile, JSON.stringify(schema) + '\n')

const sorted = Object.fromEntries(Object.entries(status).sort(([x], [y]) => (x < y ? -1 : 1)))
fs.writeFileSync(statusFile, '{\n' + Object.entries(sorted).map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(',\n') + '\n}\n')
const bad = names.filter(n => !status[n].ok || (status[n].variant && !status[n].variant.ok) ||
  (flag('--reopen') && (status[n].reopen !== 'identical' || (status[n].reopenV1 && status[n].reopenV1 !== 'identical'))))
console.log(`${names.length} models, ${names.length - bad.length} ok, ${bad.length} problems`)
for (const n of bad) console.log(' ', n, JSON.stringify(status[n]).slice(0, 300))
process.exit(bad.length ? 1 : 0)
