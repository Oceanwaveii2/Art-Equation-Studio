import type { ProjectModel } from '../model/project'
import { boardAncestors } from '../board/boardHierarchy'

export type ProjectSearchKind = 'board' | 'document' | 'worksheets' | 'recipes' | 'prompts' | 'references' | 'assets'
export type ProjectSearchResult = { key: string; kind: ProjectSearchKind; id: string; nodeId?: string; title: string; context: string }
export function searchProject(project: ProjectModel, query: string, limit = 30): ProjectSearchResult[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const matches: ProjectSearchResult[] = [], includes = (value: unknown) => JSON.stringify(value ?? '').toLocaleLowerCase().includes(needle)
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  for (const board of project.boards) {
    const path = [...boardAncestors(project.boards, board.id), board].map((entry) => entry.title).join(' / ')
    if (includes(board.title)) matches.push({ key: 'board-' + board.id, kind: 'board', id: board.id, title: board.title, context: path })
    for (const node of board.nodes) {
      const asset = node.assetId ? assets.get(node.assetId) : undefined
      if (includes({ title: node.title, body: node.body, captured: node.captured, annotations: node.videoAnnotations, asset: asset && { name: asset.displayName, aliases: asset.aliases, tags: asset.tags } })) matches.push({ key: board.id + '-' + node.id, kind: 'board', id: board.id, nodeId: node.id, title: node.title || asset?.displayName || node.kind, context: path + ' · ' + node.kind })
    }
  }
  for (const document of project.documents) if (includes({ title: document.title, content: document.content })) matches.push({ key: 'document-' + document.id, kind: 'document', id: document.id, title: document.title, context: 'Document text' })
  for (const asset of project.assets) if (includes(asset)) matches.push({ key: 'asset-' + asset.id, kind: 'assets', id: asset.id, title: asset.displayName, context: asset.extension.toUpperCase() + ' · asset catalog' })
  for (const worksheet of project.worksheets || []) if (includes({ date: worksheet.date, notes: worksheet.notesHtml, tasks: worksheet.tasks })) matches.push({ key: 'worksheet-' + worksheet.date, kind: 'worksheets', id: worksheet.date, title: worksheet.date, context: 'Daily worksheet' })
  for (const recipe of project.recipeSnapshots || []) if (includes(recipe)) matches.push({ key: 'recipe-' + recipe.id, kind: 'recipes', id: recipe.id, title: recipe.title, context: 'Attached recipe' })
  for (const prompt of project.promptHistory || []) if (includes(prompt)) matches.push({ key: 'prompt-' + prompt.id, kind: 'prompts', id: prompt.id, title: prompt.subject || prompt.prompt.slice(0, 60) || 'Prompt draft', context: prompt.mode + ' · ' + prompt.targetModel })
  for (const library of project.referenceLibraries || []) if (includes(library)) matches.push({ key: 'library-' + library.id, kind: 'references', id: library.id, title: library.name, context: 'Reference library' })
  for (const crop of project.referenceCrops || []) if (includes(crop)) matches.push({ key: 'crop-' + crop.id, kind: 'references', id: crop.id, title: crop.title, context: 'Saved reference crop' })
  return matches.slice(0, Math.max(0, limit))
}
