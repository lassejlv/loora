// Starter code for the toolbar insert tools. Every canvas element is code;
// these are the smallest useful snippets for each kind.

export type InsertTool = 'text' | 'box' | 'image'

export interface ElementTemplate {
  name: string
  w: number
  h: number
  code: string
}

export function imageTemplate(src?: string, alt = ''): string {
  if (!src) {
    return '<div class="h-full w-full rounded-lg bg-[repeating-conic-gradient(#e5e3dc_0%_25%,#f1f0ec_0%_50%)] bg-[length:24px_24px] ring-1 ring-black/10"></div>'
  }
  return `<img src="${src}" alt="${alt.replace(/"/g, '&quot;')}" class="h-full w-full rounded-lg object-cover" />`
}

// Web Page mode: one top-level element per page, designed at a fixed width.
// h is just the initial frame height — page content flows taller and scrolls
// inside the element iframe.
export function pageTemplate(index = 1): ElementTemplate {
  return {
    name: index > 1 ? `Page ${index}` : 'Page',
    w: 1440,
    h: 900,
    code: '<div class="min-h-full w-full bg-white"></div>',
  }
}

export const TEMPLATE_DEFAULTS: Record<InsertTool, ElementTemplate> = {
  text: {
    name: 'Text',
    w: 200,
    h: 40,
    code: '<p class="text-xl font-medium text-[#1a1917]">Text</p>',
  },
  box: {
    name: 'Box',
    w: 240,
    h: 160,
    code: '<div class="h-full w-full rounded-lg bg-white ring-1 ring-black/10"></div>',
  },
  image: {
    name: 'Image',
    w: 320,
    h: 240,
    code: imageTemplate(),
  },
}
