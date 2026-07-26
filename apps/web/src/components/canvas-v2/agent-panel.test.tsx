import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CanvasEngine } from '@loora/canvas/engine'
import {
  createCanvasDocument,
  createPageNode,
  createTextNode,
} from '@loora/canvas/model'
import { CanvasProvider } from '@loora/canvas/react'
import {
  CanvasV2AgentSession,
  type CanvasAgentClient,
} from './agent-panel'

function fixture() {
  const document = createCanvasDocument('Agent fixture', 'design')
  document.nodes.page = createPageNode('Home', { id: 'page' })
  document.nodes.title = createTextNode('Title', {
    id: 'title',
    parentId: 'page',
  })
  return document
}

describe('Canvas V2 agent shell', () => {
  it('keeps the established chat surface around the structured transaction agent', () => {
    const html = renderToStaticMarkup(
      <CanvasProvider engine={new CanvasEngine(fixture())}>
        <CanvasV2AgentSession
          chatId="chat_main"
          initialTitle="New chat"
          active
          target={{ designId: 'design', draftId: null }}
          readOnly={false}
          queuedPrompt={null}
          onQueuedPromptConsumed={() => undefined}
          onTitleChange={() => undefined}
          onRunningChange={() => undefined}
          client={{} as CanvasAgentClient}
        />
      </CanvasProvider>,
    )

    expect(html).toContain('Direct the canvas')
    expect(html).toContain('Attach files')
    expect(html).toContain('Gemini 3.5 Flash')
    expect(html).toContain('Loading chat…')
    expect(html).not.toContain(
      'Ask Loora to build or change structured UI',
    )
  })
})
