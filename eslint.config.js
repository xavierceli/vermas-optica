import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // public/vendor contiene el JsBarcode minificado, copiado tal cual para que la
  // etiqueta se imprima sin internet. No es codigo nuestro: lintarlo solo da
  // 49 errores de formato y no dice nada de nuestra seguridad.
  globalIgnores(['dist', 'public/vendor/**']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        // Identificador global inyectado por Vite (define) en tiempo de build.
        __BUILD_ID__: 'readonly',
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
