import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    alias: {
      '@deck.gl-community/editable-layers': fileURLToPath(
        new URL('../../../deck.gl-community/modules/editable-layers/src/index.ts', import.meta.url)
      ),
      '@deck.gl-community/editable-layers/line-network': fileURLToPath(
        new URL(
          '../../../deck.gl-community/modules/editable-layers/src/edit-modes/line-string-network/index.ts',
          import.meta.url
        )
      )
    }
  }
})
