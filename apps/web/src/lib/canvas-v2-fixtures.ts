import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  createTextNode,
  defaultLayout,
  defaultStyle,
  type CanvasDocumentV2,
} from '@loora/canvas/model'

/**
 * A new document opens empty: one blank Page and nothing else. The demo
 * composition below is only for the signed-out preview behind the auth screen.
 */
export function createEmptyCanvas(
  id: string,
  name = 'Untitled',
): CanvasDocumentV2 {
  const document = createCanvasDocument(name, id)
  const page = createPageNode('Page 1', {
    id: `${id}-page-1`,
    layout: defaultLayout(1440, 960, { x: 120, y: 80 }),
    viewport: { width: 1440, minHeight: 960 },
  })
  document.nodes[page.id] = page
  return document
}

export function createStarterCanvas(
  id: string,
  name = 'Untitled',
): CanvasDocumentV2 {
  const document = createCanvasDocument(name, id)
  const page = createPageNode('Home', {
    id: `${id}-home`,
    layout: defaultLayout(1440, 960, { x: 120, y: 80 }),
    viewport: { width: 1440, minHeight: 960 },
  })
  const hero = createFrameNode('Hero', {
    id: `${id}-hero`,
    parentId: page.id,
    order: 1024,
    semanticTag: 'section',
    layout: defaultLayout(1312, 620, {
      x: 64,
      y: 64,
      mode: 'flex',
      direction: 'column',
      align: 'start',
      justify: 'center',
      gap: 24,
      padding: { top: 72, right: 72, bottom: 72, left: 72 },
    }),
    style: defaultStyle({
      fills: [{
        type: 'linear-gradient',
        angle: 135,
        stops: [
          { offset: 0, color: '#17151f' },
          { offset: 1, color: '#3e3266' },
        ],
      }],
      radius: 32,
      overflow: 'hidden',
    }),
  })
  const eyebrow = createTextNode('STRUCTURED CANVAS V2', {
    id: `${id}-eyebrow`,
    parentId: hero.id,
    order: 1024,
    layout: defaultLayout(420, 24, {
      position: 'flow',
      height: { unit: 'hug' },
    }),
    style: defaultStyle({
      typography: {
        family: 'Archivo',
        size: 13,
        weight: 600,
        lineHeight: 1.4,
        letterSpacing: 2,
        align: 'left',
        transform: 'uppercase',
      },
      fills: [{ type: 'solid', color: '#b9a8ff' }],
    }),
  })
  const headline = createTextNode('Design real UI, not code strings.', {
    id: `${id}-headline`,
    parentId: hero.id,
    order: 2048,
    layout: defaultLayout(820, 180, {
      position: 'flow',
      height: { unit: 'hug' },
    }),
    style: defaultStyle({
      typography: {
        family: 'Archivo',
        size: 72,
        weight: 600,
        lineHeight: 1.02,
        letterSpacing: -3,
        align: 'left',
      },
      fills: [{ type: 'solid', color: '#ffffff' }],
    }),
    responsive: {
      mobile: {
        style: {
          typography: {
            family: 'Archivo',
            size: 42,
            weight: 600,
            lineHeight: 1.05,
            letterSpacing: -2,
            align: 'left',
          },
        },
      },
    },
  })
  const body = createTextNode(
    'Every page is an editable tree. Flex, grid, components, tokens and actions stay structured from the canvas to production.',
    {
      id: `${id}-body`,
      parentId: hero.id,
      order: 3072,
      layout: defaultLayout(680, 90, {
        position: 'flow',
        height: { unit: 'hug' },
      }),
      style: defaultStyle({
        typography: {
          family: 'Archivo',
          size: 20,
          weight: 400,
          lineHeight: 1.5,
          letterSpacing: 0,
          align: 'left',
        },
        fills: [{ type: 'solid', color: '#d7d1e9' }],
      }),
    },
  )
  const button = createFrameNode('Get started', {
    id: `${id}-button`,
    parentId: hero.id,
    order: 4096,
    semanticTag: 'button',
    layout: defaultLayout(156, 48, {
      position: 'flow',
      mode: 'flex',
      align: 'center',
      justify: 'center',
    }),
    style: defaultStyle({
      fills: [{ type: 'solid', color: '#ffffff' }],
      radius: 999,
      overflow: 'hidden',
    }),
  })
  const buttonLabel = createTextNode('Get started', {
    id: `${id}-button-label`,
    parentId: button.id,
    order: 1024,
    layout: defaultLayout(100, 22, {
      position: 'flow',
      width: { unit: 'hug' },
      height: { unit: 'hug' },
    }),
    style: defaultStyle({
      typography: {
        family: 'Archivo',
        size: 15,
        weight: 600,
        lineHeight: 1.4,
        letterSpacing: 0,
        align: 'center',
      },
      fills: [{ type: 'solid', color: '#201a33' }],
    }),
  })
  document.nodes = {
    [page.id]: page,
    [hero.id]: hero,
    [eyebrow.id]: eyebrow,
    [headline.id]: headline,
    [body.id]: body,
    [button.id]: button,
    [buttonLabel.id]: buttonLabel,
  }
  return document
}
