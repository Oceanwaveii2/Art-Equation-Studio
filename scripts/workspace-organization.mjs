import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const scriptDir = import.meta.dirname || path.dirname(fileURLToPath(import.meta.url))
const active = path.resolve(scriptDir, '..')
const integrationReceipt = path.join(active, '.build-info/prototype-integration.json')
const trial = fs.existsSync(integrationReceipt) ? JSON.parse(fs.readFileSync(integrationReceipt, 'utf8')) : null
if (trial && (trial.schema !== 1 || trial.kind !== 'prototype-shell-integration')) throw new Error('Unclassified integration source')
const workspace = trial ? path.resolve(trial.sourceWorkspace) : path.resolve(scriptDir, '../../../..')
if (fs.existsSync(path.join(workspace, 'current/2026-10'))) {
  if (trial && !active.replaceAll('\\', '/').endsWith('/current/2026-10/integration/prototype-2.5-engine')) throw new Error('Unclassified integration source')
  for (const retired of ['desktop-app', 'Direct X 12 version', 'Broken DX12 intergration', 'Release', 'Handoff', 'Upgrade'])
    if (fs.existsSync(path.join(workspace, retired))) throw new Error(`RETIRED_SOURCE_REACTIVATED: ${retired}; preserve it under archive`)
  if (!trial && active !== path.join(workspace, 'current/2026-10/desktop-app')) throw new Error('Build only from the current October source')
  if (trial && !fs.existsSync(path.join(workspace, 'current/2026-10/desktop-app/engine/vello-surface/build-receipt.json'))) throw new Error('Integration source engine receipt is missing')
  const experiments = fs.readdirSync(path.join(workspace, 'experiments'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
  if (experiments.some(name => name !== 'p1-v2.1-audit-2026-10-08')) throw new Error('Unclassified experiment: update workspace organization before packaging')
  const preserved = path.join(workspace, 'experiments/p1-v2.1-audit-2026-10-08')
  if (fs.existsSync(path.join(preserved, 'desktop-app'))) throw new Error('Decommissioned source reactivated in preserved evidence location')
  const project = JSON.parse(fs.readFileSync(path.join(workspace, 'current/2026-10/fixtures/workspace/projects/p1-v2-studies/project.json')))
  if (project.boards.filter(b => !b.parentBoardId).length !== 8) throw new Error('Missing graph or drawing benchmark board')
  console.log(trial ? 'Workspace organization: PASS (classified prototype shell integration; latest engine copied; eight preserved fixture boards; release acceptance still required)' : 'Workspace organization: PASS (one active source; archived runtimes excluded; eight independent test boards)')
} else {
  if (!fs.existsSync(path.join(active, 'engine/vello-surface/build-receipt.json'))) throw new Error('Engine build receipt is missing')
  console.log('Workspace organization: PASS (standalone repository checkout verified; engine receipt present)')
}
