import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'
const source=ts.transpileModule(await fs.readFile('src/canvas-engine/assetPathUrl.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {appendAssetPathUrl}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
const windows='http://asset.localhost/'+encodeURIComponent(String.raw`\\?\C:\workspace\tiles`)
assert.equal(decodeURIComponent(new URL(appendAssetPathUrl(windows,'10/0_0.png')).pathname).slice(1),String.raw`\\?\C:\workspace\tiles\10\0_0.png`)
assert.equal(appendAssetPathUrl('http://127.0.0.1:5000/tiles/?token=fixture','9/0_0.png'),'http://127.0.0.1:5000/tiles/9/0_0.png?token=fixture')
for(const bad of ['../outside.png','a/../b.png','/absolute.png','a//b.png','%2e%2e/outside','a\\b',''])assert.throws(()=>appendAssetPathUrl(windows,bad))
assert.throws(()=>appendAssetPathUrl('javascript:alert(1)','1/0_0.png'))
console.log('Asset paths PASS: extended Windows paths, URL query preservation and invalid-path refusal')
