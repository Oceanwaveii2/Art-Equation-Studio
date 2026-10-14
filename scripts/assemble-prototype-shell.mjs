import fs from 'node:fs'
import ts from 'typescript'
const file='src/App.tsx';let source=fs.readFileSync(file,'utf8')
if(source.includes('<Prototype25Shell'))throw new Error('Shell already assembled')
const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const app=sf.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='App')
const ret=app.body.statements.filter(ts.isReturnStatement).at(-1)
let root=ret.expression;while(ts.isParenthesizedExpression(root))root=root.expression
const children=n=>n.children.filter(c=>!ts.isJsxText(c))
const text=n=>n.getText(sf)
const hasClass=(n,cls)=>ts.isJsxElement(n)&&n.openingElement.attributes.getText(sf).includes(cls)
const mainChildren=children(root),body=mainChildren.find(n=>hasClass(n,'app-body'))
const bodyChildren=children(body),nav=bodyChildren.find(n=>hasClass(n,'navigator"'))
const center=bodyChildren.find(n=>hasClass(n,'project-center'))
const centerChildren=children(center),workspace=centerChildren.find(n=>hasClass(n,'workbench'))
const header=mainChildren.find(n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(sf)==='header')
const settings=mainChildren.find(n=>text(n).startsWith('{showSettings '))
const status=mainChildren.find(n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(sf)==='footer')
const focus=mainChildren.find(n=>text(n).startsWith('{shellFocusWriting '))
const inspector=bodyChildren.find(n=>text(n).includes('<ProjectInspector'))
const boardNavigation=centerChildren.find(n=>text(n).includes('<nav className="board-navigation"'))
const strip=centerChildren.find(n=>text(n).includes('<ProjectBoardStrip'))
const attrs=root.openingElement.attributes.properties.map(n=>{
 if(!ts.isJsxAttribute(n)||!n.initializer)throw new Error('Unexpected root attribute')
 const value=ts.isJsxExpression(n.initializer)?n.initializer.expression.getText(sf):n.initializer.getText(sf)
 return n.name.getText(sf)+': '+value
}).join(',\n')
const overlays=mainChildren.filter(n=>![body,header,status,focus].includes(n)).map(text).join('\n')
let headerText=text(header).replace(/aria-expanded=\{inspectorIsDrawer \? showInspectorDrawer : showInspectorPanel\}/,'aria-expanded={showInspectorDrawer}').replace(/onClick=\{\(\) => \{ if \(inspectorIsDrawer\) setShowInspectorDrawer\(\(visible\) => !visible\); else setShowInspectorPanel\(\(visible\) => !visible\) \}\}/,'onClick={() => setShowInspectorDrawer((visible) => !visible)}').replace('>Inspector</button>','>Project details</button>')
headerText=headerText.replace('<div className="mode-switch"', '<button className="quiet-button" type="button" aria-label="Toggle project navigation" aria-pressed={showNavigatorPanel} onClick={() => setShowNavigatorPanel(value => !value)}>Projects</button>\n<div className="mode-switch"')
let navText=text(nav)
const navEdge=text(bodyChildren[0]).match(/\? ([\s\S]*?)\n\s*:/)?.[1]
if(!navEdge)throw new Error('Navigator edge seam missing')
navText=navText.replace('</aside>',navEdge.replace('className="panel-edge navigator-edge"','className="p25-navigation-resize"')+'\n</aside>')
const fragment=value=>'<>\n'+value+'\n</>'
const assembled='<Prototype25Shell theme={theme} projectTitle={project.title} projectDetailsOpen={showInspectorDrawer} onProjectDetailsOpenChange={setShowInspectorDrawer}\nrootProps={{'+attrs+'}}\nslots={{\nheader: '+fragment(headerText)+',\nnavigator: showNavigatorPanel && !minimalNavigation && !viewBoardId ? ('+navText+') : null,\nboardNavigation: '+fragment(text(boardNavigation))+',\nworkspace: '+fragment(text(workspace))+',\ninspector: '+fragment(text(inspector))+',\nboardStrip: '+fragment(text(strip))+',\noverlays: '+fragment(overlays)+',\nstatus: '+fragment(text(status))+',\nfocusBar: '+fragment(text(focus))+'\n}} />'
source=source.slice(0,root.getStart(sf))+assembled+source.slice(root.end)
source=source.replace(/  const \[inspectorIsDrawer, setInspectorIsDrawer\][\s\S]*?  const inspectorToggleRef/,'  const inspectorToggleRef')
source=source.replace("import { PrototypeDocumentTabs", "import { Prototype25Shell } from './ui/Prototype25Shell'\nimport { ProductionStudio } from './ui/ProductionStudio'\nimport { PrototypeDocumentTabs")
fs.writeFileSync(file,source)
console.log('Normal shell return replaced with the Prototype25Shell boundary; canonical CanvasPane and controller callbacks retained.')

