import fs from 'node:fs'
let p=fs.readFileSync('src/App.tsx','utf8').replace('import { LayoutResearchPanel }','import { LayoutResearchPanel, PersistentGuideLayer }');p=p.replace('          {freehandDraft.length > 0', '          <PersistentGuideLayer board={board} />\n          {freehandDraft.length > 0');fs.writeFileSync('src/App.tsx',p)
