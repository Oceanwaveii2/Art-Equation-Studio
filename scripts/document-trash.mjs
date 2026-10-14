import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const transpile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const asDataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const projectUrl = asDataUrl(transpile(await readFile('src/model/project.ts', 'utf8')))
const trashSource = transpile(await readFile('src/model/trash.ts', 'utf8')).replace("from './project'", `from '${projectUrl}'`)
const { applyDocumentTrash, applyDocumentRestore } = await import(asDataUrl(trashSource))

const richContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Process notes' }] },
    { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#dc9378' } }], text: 'Preserve this rich text.' }] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell one' }] }] }] }] },
  ],
}
const layout = { pageSize: 'A4', orientation: 'portrait', marginTop: 42, custom: { columns: 2 } }
const document = { id: 'user-document', title: 'Layout study', content: richContent, layout }
const questionnaire = { id: 'project-brief', title: 'Project questionnaire', content: { type: 'doc' }, locked: true, system: true }
const project = { id: 'test-project', documents: [questionnaire, document] }

assert.equal(applyDocumentTrash(project, questionnaire.id), null, 'system questionnaire cannot be trashed')
const trashed = applyDocumentTrash(project, document.id, 123456)
assert(trashed, 'user document can be trashed')
assert.deepEqual(trashed.project.documents, [questionnaire], 'only the selected document leaves the project')
assert.deepEqual(trashed.entry.document, document, 'Trash stores the complete rich content and layout')

document.content.content[1].content[0].text = 'Changed after deletion'
assert.equal(trashed.entry.document.content.content[1].content[0].text, 'Preserve this rich text.', 'Trash snapshot is independent of the original')
const restored = applyDocumentRestore(trashed.project, trashed.entry)
assert(restored, 'document restores')
assert.deepEqual(restored.documents[1], trashed.entry.document, 'rich content and layout survive the round trip')
assert.equal(applyDocumentRestore(restored, trashed.entry), null, 'ID conflict cannot silently consume the Trash copy')
console.log('Document Trash snapshot, rich content/layout round trip, and collision safety: PASS')
