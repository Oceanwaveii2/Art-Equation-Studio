import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
registerHooks({resolve(s,c,next){try{return next(s,c)}catch(e){if(s.startsWith('.'))return next(s+'.ts',c);throw e}}})
const {projectModelArtwork}=await import('../src/board/modelArtwork.ts')
const base={id:'type',kind:'text',title:'Type',x:10,y:20,width:320,height:100,color:'transparent',textColor:'#ffffff',body:'<p style="margin:0"><span style="font-family:Arial;font-size:32px;color:#ffffff">Original prose</span></p>'}
for(const textMode of ['point','area']){
 const paint=projectModelArtwork({...base,textMode})
 assert.ok(paint,'ordinary zero-margin Type prose must stay on the engine path')
 assert.equal(paint.background,undefined,'Type must not emit an opaque backing rectangle')
 assert.equal(paint.header,undefined,'Type must not emit Note-card title chrome')
 assert.equal(paint.inset,0,'Type frame origin must match authored text origin')
 assert.equal(paint.top,0)
 assert.equal(paint.wrap,textMode==='area')
 assert.equal(paint.text,'Original prose')
}
const note=projectModelArtwork({...base,kind:'note',body:'A separate note'})
assert.ok(note.background,'ordinary Notes retain their own backing surface')
assert.ok(note.header)
assert.equal(projectModelArtwork({...base,textMode:'area',body:'<p style="margin:12px">unsupported box model</p>'}),undefined,'unsupported layout must remain a visible refusal')
console.log('Type frame contract: transparent point/area frames, exact origin, wrapping, Note separation and explicit unsupported layout PASS')
