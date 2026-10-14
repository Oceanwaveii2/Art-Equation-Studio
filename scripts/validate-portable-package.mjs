import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
const root=path.resolve(process.argv[2]),manifest=JSON.parse(await fs.readFile(path.join(root,'workspace.json'),'utf8'))
assert.equal(manifest.schemaVersion,1)
assert.ok(typeof manifest.workspaceId==='string'&&manifest.workspaceId.length>0)
assert.ok(typeof manifest.name==='string'&&manifest.name.length>0)
assert.ok(Number.isSafeInteger(manifest.createdAtUnixMs)&&manifest.createdAtUnixMs>0,'Native startup requires createdAtUnixMs in workspace.json')
const info=JSON.parse(await fs.readFile(path.join(root,'BUILD-INFO.json'),'utf8'))
const hash=createHash('sha256').update(await fs.readFile(path.join(root,'Art-Equation-alpha.exe'))).digest('hex')
assert.equal(hash,info.exeSha256.toLowerCase())
console.log(JSON.stringify({status:'PACKAGE_MANIFEST_AND_EXE_HASH_PASS',root,hash,scope:'Static package check. Native startup must still be verified separately.'}))
