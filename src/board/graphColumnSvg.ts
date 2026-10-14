import type { BoardModel, BoardNode } from '../model/project'
import { GraphColumnRuntime, projectGraphColumns, graphColumnRows } from './graphColumnV2'

/** Export the canonical graph, including its computed value and stable ports.
 * Full authored records remain in the project; display labels are clipped. */
export function graphColumnSvg(board: BoardModel, node: BoardNode): string {
  if (!node.graphColumn) throw Error('Not a Graph Column 2 item')
  const safe = (value: string | number) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
  const value = new GraphColumnRuntime().evaluate(board, node.id)
  const result = value.type === 'records' ? `${value.value.length} records` : String(value.value)
  const rows = graphColumnRows(node,board.nodes)
  const clip = 'graph-export-' + [...node.id].map(c=>c.codePointAt(0)!.toString(16)).join('-')
  const text = (label:string,y:number,size=12,weight=400) => `<text x="${node.x+12}" y="${y}" font-size="${size}" font-weight="${weight}">${safe(label.replace(/[\r\n]+/g,' '))}</text>`
  const ports = projectGraphColumns(board).ports.filter(p=>p.groupId===node.id&&!p.hidden).map(p=>`<circle cx="${p.x+4}" cy="${p.y+4}" r="4" fill="#67d5cd"/>`).join('')
  // Ports are already in rotated world coordinates; rotate only body and text.
  return `<g opacity="${Math.max(0,Math.min(1,node.opacity??1))}"><g transform="rotate(${node.rotation||0} ${node.x+node.width/2} ${node.y+node.height/2})"><defs><clipPath id="${clip}"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"/></clipPath></defs><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="${safe(node.columnBodyColor||node.color||'#34546c')}" stroke="#67d5cd"/><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${Math.min(58,node.height)}" fill="${safe(node.color||'#34546c')}"/><g clip-path="url(#${clip})" fill="${safe(node.textColor||'#fff')}" font-family="Segoe UI, sans-serif">${text(node.title,node.y+24,14,700)}${rows.map((r,i)=>34+i*20<=node.height-54?text(r,node.y+46+i*20):'').join('')}${text(result,node.y+node.height-18,12,700)}</g></g>${ports}</g>`
}
