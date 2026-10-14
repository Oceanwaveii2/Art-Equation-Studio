import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'

// Executes the catalog and both actual selector handlers. Native invocation is
// controlled here; this is not a rendered-face or native pixel qualification.
const catalogSource = await fs.readFile('src/typography/fontCatalog.ts', 'utf8')
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
let moduleSequence = 0
async function catalogModule(invoke) {
  const key = `__fontCatalogFixture${moduleSequence++}`
  globalThis[key] = invoke
  return import('data:text/javascript;base64,' + Buffer.from(`const invoke=globalThis.${key};\n` + compile(catalogSource).replace(/^import .*$/gm, '')).toString('base64'))
}
let nativeCalls = 0, resolveNative
const catalog = await catalogModule(command => {
  nativeCalls++
  assert.equal(command, 'list_system_fonts')
  return new Promise(resolve => { resolveNative = resolve })
})
const first = catalog.discoverFontCatalog(), second = catalog.discoverFontCatalog()
assert.equal(nativeCalls, 1, 'Concurrent editors share one discovery request')
resolveNative([' Arial ', 'arial', 'Georgia', '', '  '])
const discovered = await first
assert.equal(await second, discovered)
assert.equal(await catalog.discoverFontCatalog(), discovered)
assert.equal(nativeCalls, 1, 'Successful discovery is shared and cached')
assert.deepEqual(discovered, { families: ['Arial', 'Georgia'], source: 'system-catalog' })
assert(!discovered.families.includes('Source Serif 4'), 'Curated absent families are never merged into the system catalog')
assert(!discovered.families.includes('Iowan Old Style'))

const plain = catalog.fontFamilyOptions(discovered)
assert.equal(plain[0].value, '')
assert.equal(plain[0].status, 'default')
assert.match(plain[0].label, /paragraph style/)
assert(!plain.some(option => option.value === 'Source Serif 4'), 'No invented default or installed option')
assert.deepEqual(plain.slice(1).map(option => [option.value, option.status]), [['Arial', 'listed'], ['Georgia', 'listed']])

for (const authored of ['Source Serif 4', 'Iowan Old Style', 'Missing Custom Face']) {
  const options = catalog.fontFamilyOptions(discovered, authored)
  const active = options.find(option => option.value === authored)
  assert.equal(active.status, 'unlisted')
  assert.match(active.label, /Not listed/)
  assert.match(active.description, /saved font choice is preserved/)
  assert(!active.description.includes('installed'), 'Catalog absence never claims a proven resolved-face failure')
}
for (const authored of ['ARIAL', '"Arial"', "'Arial'"]) {
  const options = catalog.fontFamilyOptions(discovered, authored)
  assert.equal(options[1].value, authored, 'Authored case and quoting survive menu inspection')
  assert.equal(options[1].status, 'listed')
  assert.equal(options.filter(option => /arial/i.test(option.value)).length, 1, 'Canonical duplicate is removed without rewriting the authored value')
}
const stack = '"Missing Face", Arial, sans-serif'
assert.equal(catalog.fontFamilyOptions(discovered, stack)[1].status, 'stack')
assert.equal(catalog.fontFamilyOptions(discovered, stack)[1].value, stack)
for (const generic of ['serif', 'sans-serif', 'system-ui', 'ui-monospace']) {
  assert.equal(catalog.fontFamilyOptions(discovered, generic)[1].status, 'generic', 'Generic families are not mislabeled as missing physical fonts')
}

for (const invoke of [async () => [], async () => { throw new Error('browser has no native catalog') }, async () => ['bad', null]]) {
  const failed = await catalogModule(invoke)
  const unknown = await failed.discoverFontCatalog()
  assert.equal(unknown.source, 'unverified', 'Empty/failed/invalid discovery does not prove absence')
  const options = failed.fontFamilyOptions(unknown, 'Authored Custom Face')
  assert(options.slice(1).every(option => option.status === 'unverified'))
  assert(options.slice(1).every(option => option.label.endsWith('(Unverified)')))
}

function selectorHandler(source, label) {
  const ast = ts.createSourceFile('selector.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let handler
  const visit = node => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'select') {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute)
      const named = attributes.find(attribute => attribute.name.getText(ast) === 'aria-label')
      if (named?.initializer && ts.isStringLiteral(named.initializer) && named.initializer.text === label) {
        const onChange = attributes.find(attribute => attribute.name.getText(ast) === 'onChange')
        assert(onChange?.initializer && ts.isJsxExpression(onChange.initializer))
        handler = onChange.initializer.expression.getText(ast)
        assert(attributes.some(attribute => attribute.name.getText(ast) === 'title'), 'Availability explanation is reachable on the actual selector')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert(handler, 'The actual selector handler was found')
  return new Function('editor', compile(`const handler = ${handler}; return handler`))
}
for (const [path, label] of [['src/document/RichDocument.tsx', 'Font family'], ['src/board/BoardRichText.tsx', 'Canvas text font']]) {
  const source = await fs.readFile(path, 'utf8'), calls = []
  const chain = { focus() { return this }, setFontFamily(value) { calls.push(['set', value]); return this }, unsetFontFamily() { calls.push(['unset']); return this }, run() { calls.push(['run']); return true } }
  const handler = selectorHandler(source, label)({ chain: () => chain })
  assert.deepEqual(calls, [], 'Inspecting options does not edit the document')
  handler({ target: { value: 'Source Serif 4' } })
  assert.deepEqual(calls, [['set', 'Source Serif 4'], ['run']], 'Explicit user choices retain exact authored values')
  calls.length = 0
  handler({ target: { value: '' } })
  assert.deepEqual(calls, [['unset'], ['run']], 'Default removes only a user-requested family override')
  assert.match(source, /fontFamily \|\| ''/, 'Unset text is represented as inherited paragraph styling')
  assert(!source.includes('discoverSystemFontFamilies'), 'Both selectors consume availability-aware catalog metadata')
}
console.log('Font catalog truth: PASS (shared discovery, no invented installed families, preserved authored values/stacks/generics, and actual document/canvas default handlers; no native font or pixel qualification)')
