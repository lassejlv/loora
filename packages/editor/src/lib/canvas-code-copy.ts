import {
  compileJsxComponent,
  compileStandaloneHtml,
  compileTailwindComponent,
  type CanvasExportOptions,
} from '@loora/canvas/export'
import type { CanvasDocument, NodeRef } from '@loora/canvas/model'

export type CanvasCodeFormat = 'html' | 'jsx' | 'tailwind'

export function compileCanvasCode(
  document: CanvasDocument,
  ref: NodeRef,
  format: CanvasCodeFormat,
  width = 1_440,
) {
  if (ref.instancePath.length > 0) {
    throw new Error('Select the instance itself to copy generated code')
  }
  const node = document.nodes[ref.nodeId]
  if (!node || node.type === 'component') {
    throw new Error('Select a page or visible Canvas node')
  }
  const options: CanvasExportOptions = {
    ...(node.type === 'page' ? { pageId: node.id } : { nodeId: node.id }),
    width,
  }
  if (format === 'html') return compileStandaloneHtml(document, options)
  if (format === 'jsx') return compileJsxComponent(document, options)
  return compileTailwindComponent(document, options)
}
