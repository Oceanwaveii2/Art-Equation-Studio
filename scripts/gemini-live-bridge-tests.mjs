import assert from 'node:assert/strict'
import { inspectApp } from '../src/codex/appInspection.ts'
import { geminiStore } from '../src/gemini/geminiStore.ts'

console.log('--- Starting Gemini Live Bridge & MCP Integration Tests ---')

// 1. Initial Context Setup
let project = {
  id: 'test-project',
  title: 'Test Project for Gemini Bridge',
  updatedAt: 'rev-0',
  boards: [
    {
      id: 'board-1',
      title: 'Canvas Board Alpha',
      viewport: { scale: 1.0, x: 0, y: 0 },
      nodes: [
        { id: 'node-1', kind: 'note', title: 'Original Note', content: 'Initial text', x: 50, y: 50, width: 200, height: 100 }
      ],
      connectors: []
    }
  ],
  documents: [],
  assets: []
}

let dispatchedActions = []
const context = {
  project,
  ui: { activeBoardId: 'board-1', theme: 'navy' },
  onMutateProject: updater => {
    project = updater(project)
    context.project = project
  },
  onDispatchAction: (action, payload) => {
    dispatchedActions.push({ action, payload })
    return { executed: true, action }
  }
}

// 2. Test Bug Tracking (`gemini_app_track_bug`)
console.log('Testing gemini_app_track_bug...')
const bugRes = inspectApp(context, 'gemini_app_track_bug', {
  title: 'Vello compute scanline latency during rapid zoom',
  description: 'Compute pass takes 18ms when zooming through dense raster cards',
  component: 'vello',
  severity: 'high',
  reproductionSteps: ['Zoom from 0.1x to 2.0x in 200ms', 'Observe frame drop'],
  suggestedFix: 'Implement Bevy 2D instanced quad hybrid rendering for large images'
})

assert.equal(bugRes.ok, true)
assert.ok(bugRes.issueId.startsWith('bug-'))
assert.equal(bugRes.issue.severity, 'high')
assert.equal(bugRes.issue.component, 'vello')
assert.equal(bugRes.issue.suggestedFix, 'Implement Bevy 2D instanced quad hybrid rendering for large images')

// Status update
geminiStore.updateBugStatus(bugRes.issueId, 'investigating')
const trackedList = geminiStore.getBugs()
const updatedBug = trackedList.find(b => b.id === bugRes.issueId)
assert.equal(updatedBug.status, 'investigating')

// 3. Test Live Feedback (`gemini_app_feedback`)
console.log('Testing gemini_app_feedback...')
const fbRes = inspectApp(context, 'gemini_app_feedback', {
  message: 'Memory footprint optimal: 42MB resident, zero GPU memory leaks detected.',
  level: 'success',
  suggestedAction: 'Proceed with dual engine transition pass'
})

assert.equal(fbRes.ok, true)
assert.equal(fbRes.feedback.level, 'success')
assert.equal(fbRes.feedback.suggestedAction, 'Proceed with dual engine transition pass')
assert.ok(geminiStore.getFeedbackLog().some(f => f.message.includes('Memory footprint optimal')))

// 4. Test Live Alteration (`gemini_app_alter`)
console.log('Testing gemini_app_alter...')
const alterNodeRes = inspectApp(context, 'gemini_app_alter', {
  boardId: 'board-1',
  nodeId: 'node-1',
  changes: {
    title: 'Altered by Gemini',
    x: 180,
    y: 220,
    width: 320
  }
})

assert.equal(alterNodeRes.ok, true)
assert.equal(alterNodeRes.mutated, true)
// Verify live project was mutated through onMutateProject
const alteredNode = project.boards[0].nodes.find(n => n.id === 'node-1')
assert.equal(alteredNode.title, 'Altered by Gemini')
assert.equal(alteredNode.x, 180)
assert.equal(alteredNode.width, 320)

// 5. Test Live Data Injection (`gemini_app_send_data`)
console.log('Testing gemini_app_send_data...')
const sendDataRes = inspectApp(context, 'gemini_app_send_data', {
  boardId: 'board-1',
  target: 'board',
  cards: [
    { title: 'Gemini Injected Card 1', content: 'Auto-generated analysis', x: 400, y: 100, width: 250, height: 160 },
    { title: 'Gemini Injected Card 2', content: 'Architecture benchmark', x: 400, y: 300, width: 250, height: 160 }
  ]
})

assert.equal(sendDataRes.ok, true)
assert.equal(sendDataRes.addedCount, 2)
assert.equal(project.boards[0].nodes.length, 3, 'Board now has original altered note plus 2 injected cards')
assert.equal(project.boards[0].nodes[1].title, 'Gemini Injected Card 1')
assert.equal(project.boards[0].nodes[2].title, 'Gemini Injected Card 2')

// 6. Test Live Action Execution (`gemini_app_execute`)
console.log('Testing gemini_app_execute...')
const execRes = inspectApp(context, 'gemini_app_execute', {
  action: 'switchTool',
  payload: { tool: 'select' }
})

assert.equal(execRes.ok, true)
assert.equal(execRes.action, 'switchTool')
assert.equal(dispatchedActions.length, 1)
assert.equal(dispatchedActions[0].action, 'switchTool')
assert.equal(dispatchedActions[0].payload.tool, 'select')

// 7. Test Reading Gemini Domain via `art_app_read`
console.log('Testing art_app_read domain: gemini...')
const geminiReadRes = inspectApp(context, 'art_app_read', {
  domain: 'gemini'
})

assert.ok(geminiReadRes.jsonText)
const parsedGeminiData = JSON.parse(geminiReadRes.jsonText)
assert.ok(Array.isArray(parsedGeminiData.bugs))
assert.ok(parsedGeminiData.bugs.length >= 1)
assert.ok(Array.isArray(parsedGeminiData.feedback))
assert.ok(parsedGeminiData.feedback.length >= 2)

console.log('Gemini Live Bridge & MCP Integration: ALL TESTS PASSED SUCCESSFULLY! ✓')
