import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@deck.gl-community/editable-layers/line-network',
        replacement: fileURLToPath(
          new URL(
            '../../../deck.gl-community/modules/editable-layers/src/edit-modes/line-string-network/index.ts',
            import.meta.url
          )
        )
      },
      {
        find: '@deck.gl-community/editable-layers',
        replacement: fileURLToPath(
          new URL('../../../deck.gl-community/modules/editable-layers/src/index.ts', import.meta.url)
        )
      }
    ]
  }
})
