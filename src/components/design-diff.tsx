import { MultiFileDiff } from '@pierre/diffs/react'
import type { Shape } from '#/lib/canvas'

export function DesignDiff({
  oldShapes,
  newShapes,
  oldKey,
  newKey,
}: {
  oldShapes: Shape[]
  newShapes: Shape[]
  oldKey: string
  newKey: string
}) {
  return (
    <div key={`${oldKey}:${newKey}`} className="h-full overflow-auto overscroll-contain p-4">
      <MultiFileDiff
        oldFile={{
          name: 'design.json',
          contents: JSON.stringify(oldShapes, null, 2),
          lang: 'json',
          cacheKey: oldKey,
        }}
        newFile={{
          name: 'design.json',
          contents: JSON.stringify(newShapes, null, 2),
          lang: 'json',
          cacheKey: newKey,
        }}
        options={{
          diffStyle: 'unified',
          diffIndicators: 'classic',
          lineDiffType: 'word',
          overflow: 'wrap',
          theme: 'github-light',
          themeType: 'light',
        }}
      />
    </div>
  )
}
