import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'
import { converter, formatHex } from 'culori'
import { jsx, jsxs } from 'react/jsx-runtime'

// Execute the actual component handlers with controlled hooks and keyed child
// lifetimes. This proves draft/model boundaries, not browser event ordering or pixels.
const source = await fs.readFile('src/color/ColorPanel.tsx', 'utf8')
const fixture = { current: null }
function useState(initial) {
  const instance = fixture.current, index = instance.index++
  if (!(index in instance.slots)) instance.slots[index] = typeof initial === 'function' ? initial() : initial
  return [instance.slots[index], next => { instance.slots[index] = typeof next === 'function' ? next(instance.slots[index]) : next }]
}
function useRef(initial) {
  const instance = fixture.current, index = instance.index++
  if (!(index in instance.slots)) instance.slots[index] = { current: initial }
  return instance.slots[index]
}
globalThis.__colorHexFixture = { converter, formatHex, useState, useRef, _jsx: jsx, _jsxs: jsxs }
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*$/gm, '')
const { ColorPanel } = await import('data:text/javascript;base64,' + Buffer.from('const {converter,formatHex,useState,useRef,_jsx,_jsxs}=globalThis.__colorHexFixture;\n' + compiled).toString('base64'))
function render(Component, props, instance) {
  fixture.current = instance
  instance.index = 0
  try { return Component(props) } finally { fixture.current = null }
}
function findHex(element) {
  if (!element || typeof element !== 'object') return null
  if (typeof element.type === 'function' && element.type.name === 'HexColorInput') return element
  for (const child of [element.props?.children].flat(Infinity)) {
    const found = findHex(child)
    if (found) return found
  }
  return null
}
function harness(overrides = {}) {
  const model = { contextIdentity: 'board-A/object-A', value: '#aabbcc', opacity: 0.65, title: 'Identical title', target: 'fill', ...overrides }
  const root = { slots: [], index: 0 }, calls = []
  let child, element, input, key, accepted = true
  const onChange = (value, opacity) => { calls.push({ value, opacity }); if (accepted) { model.value = value; model.opacity = opacity } }
  function update(next = {}) {
    Object.assign(model, next)
    const tree = render(ColorPanel, { ...model, swatches: [], onChange, onTargetChange() {}, onSwatchesChange() {}, onClose() {} }, root)
    element = findHex(tree)
    assert(element, 'Actual ColorPanel mounts the scoped Hex input')
    if (!child || key !== element.key) { child = { slots: [], index: 0 }; key = element.key }
    input = render(element.type, element.props, child)
    return input
  }
  update()
  return {
    model, calls, update,
    get input() { return input }, get key() { return key },
    rejectWrites() { accepted = false },
    change(value) { input.props.onChange({ target: { value } }); update() },
    blur() { input.props.onBlur(); update() },
    press(key) {
      let prevented = 0, stopped = 0, blurred = 0
      input.props.onKeyDown({ key, preventDefault() { prevented++ }, stopPropagation() { stopped++ }, currentTarget: { blur() { blurred++; input.props.onBlur() } } })
      update()
      return { prevented, stopped, blurred }
    },
  }
}
const edit = harness()
assert.equal(edit.input.props.value, '#AABBCC')
for (const partial of ['#', '#1', '#12', '#123', '#123a', '#123ab', '#123abc']) {
  edit.change(partial)
  assert.equal(edit.input.props.value, partial, 'Each keyboard intermediate remains editable')
  assert.equal(edit.calls.length, 0, 'Draft edits do not mutate the model, including a complete uncommitted value')
}
edit.blur()
assert.deepEqual(edit.calls, [{ value: '#123abc', opacity: 0.65 }])
assert.equal(edit.input.props.value, '#123ABC', 'Accepted external color becomes authoritative')
edit.change('#FEDCBA')
assert.deepEqual(edit.press('Enter'), { prevented: 1, stopped: 1, blurred: 1 })
assert.deepEqual(edit.calls.at(-1), { value: '#fedcba', opacity: 0.65 })
assert.equal(edit.calls.length, 2, 'Enter commits once through blur')
edit.blur()
assert.equal(edit.calls.length, 2, 'Unchanged blur does not duplicate the commit')
for (const invalid of ['', '#12', '#abc', '#12345g', '#1234567', 'red']) {
  edit.change(invalid); edit.blur()
  assert.equal(edit.input.props.value, '#FEDCBA')
  assert.equal(edit.calls.length, 2, 'Existing six-digit contract rejects incomplete/invalid drafts')
}
edit.change('#654321')
const beforeEscape = edit.input
beforeEscape.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {}, currentTarget: { blur() { throw new Error('Escape should retain focus') } } })
beforeEscape.props.onBlur() // Force same-turn blur before the next controlled render.
edit.update()
assert.equal(edit.calls.length, 2, 'Escape cancellation also guards an immediate stale-handler blur')
assert.equal(edit.input.props.value, '#FEDCBA')
edit.change(' #010203 '); edit.blur()
assert.deepEqual(edit.calls.at(-1), { value: '#010203', opacity: 0.65 }, 'Later typing clears the cancellation guard and trims a pasted value')
const rejected = harness()
rejected.rejectWrites(); rejected.change('#010203'); rejected.blur()
assert.equal(rejected.model.value, '#aabbcc')
assert.equal(rejected.input.props.value, '#AABBCC', 'Rejected parent write cannot invent a committed displayed color')
for (const replacement of [
  { contextIdentity: 'board-A/object-B' },
  { contextIdentity: 'board-B/object-A' },
  { target: 'stroke' },
  { value: '#123456' },
  { opacity: 0.9 },
]) {
  const scoped = harness()
  scoped.change('#654321')
  const priorKey = scoped.key
  scoped.update(replacement)
  assert.notEqual(scoped.key, priorKey, 'External target/color state replaces draft lifetime')
  assert.equal(scoped.input.props.value, scoped.model.value.toUpperCase())
  scoped.blur()
  assert.equal(scoped.calls.length, 0, 'Discarded draft never commits to a replacement scope')
  scoped.update({ contextIdentity: 'board-A/object-A', target: 'fill', value: '#aabbcc', opacity: 0.65 })
  assert.equal(scoped.input.props.value, '#AABBCC', 'Returning to a previous scope cannot revive its abandoned draft')
}

// Verify the real callsite provides stable board/object identity, including
// same-name/same-color selections; a title/color-only identity is insufficient.
const appSource = await fs.readFile('src/App.tsx', 'utf8')
const ast = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const contexts = []
function visit(node) {
  if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === 'ColorPanel') {
    const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(ast) === 'contextIdentity')
    assert(attribute && attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression, 'Every ColorPanel callsite supplies explicit identity')
    contexts.push(new Function('board', 'selectedIds', 'return (' + attribute.initializer.expression.getText(ast) + ');'))
  }
  ts.forEachChild(node, visit)
}
visit(ast)
assert.equal(contexts.length, 2)
const [objectIdentity, canvasIdentity] = contexts
assert.notEqual(objectIdentity({ id: 'board-A' }, ['object-A']), objectIdentity({ id: 'board-A' }, ['object-B']))
assert.notEqual(objectIdentity({ id: 'board-A' }, ['object-A']), objectIdentity({ id: 'board-B' }, ['object-A']))
assert.equal(objectIdentity({ id: 'board-A' }, ['A', 'B']), objectIdentity({ id: 'board-A' }, ['B', 'A']), 'Selection order alone does not discard a draft')
assert.notEqual(objectIdentity({ id: 'board-A' }, ['A:B', 'C']), objectIdentity({ id: 'board-A' }, ['A', 'B:C']), 'Object identity is encoded without delimiter collisions')
assert.notEqual(canvasIdentity({ id: 'board-A' }, []), canvasIdentity({ id: 'board-B' }, []))
delete globalThis.__colorHexFixture
console.log('Color Hex draft: PASS (actual handlers, controlled hook/key lifetimes and real callsite identities; no browser/DOM/native qualification)')

