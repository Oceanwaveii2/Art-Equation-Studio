import fs from 'node:fs';import ts from 'typescript'
const file='src/App.tsx';let source=fs.readFileSync(file,'utf8'),sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
let shell;const walk=n=>{if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(sf)==='Prototype25Shell')shell=n;ts.forEachChild(n,walk)};walk(sf)
const slots=shell.attributes.properties.find(n=>n.name?.getText(sf)==='slots').initializer.expression
const prop=name=>slots.properties.find(n=>n.name?.getText(sf)===name)
const nav=prop('boardNavigation'),strip=prop('boardStrip')
const edits=[];let canvas
const scan=n=>{if(ts.isJsxExpression(n)&&n.expression&&n.getText(sf).includes('mode !== \'document\' && activeBoard && <CanvasPane'))canvas=n;else ts.forEachChild(n,scan)};scan(prop('workspace'))
if(!canvas)throw new Error('Missing canonical CanvasPane seam')
const original=canvas.getText(sf);const prefix=original.indexOf('<CanvasPane'),suffix=original.lastIndexOf('/>')
const pane=original.slice(prefix,suffix+2).replace('<CanvasPane ','<CanvasPane navigation={'+nav.initializer.getText(sf)+'} ')
const conditional=original.slice(0,prefix)
const stripContent=strip.initializer.getText(sf)
edits.push([canvas.getStart(sf),canvas.end,conditional+'<section className="prototype-canvas-workspace" aria-label="Canvas workspace">'+pane+stripContent+'</section>}'])
for(const n of [nav,strip])edits.push([n.initializer.getStart(sf),n.initializer.end,'null'])
for(const [start,end,replacement]of edits.sort((a,b)=>b[0]-a[0]))source=source.slice(0,start)+replacement+source.slice(end)
fs.writeFileSync(file,source);console.log('Board navigation passed to CanvasPane; board strip scoped to canvas column; writing pane extends to workspace bottom.')

