import { defineConfig } from 'tsdown'

const clientGlobals: Record<string, string> = {
  react: 'react',
  'react/jsx-runtime': 'react_jsx_runtime',
  '@deepseek-ai/dsh-client-ui-primitives': '_deepseek_ai_dsh_client_ui_primitives',
}

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: 'esm',
    platform: 'node',
    outDir: 'lib',
    clean: true,
    minify: false,
  },
  {
    entry: ['src/client/index.ts'],
    format: 'iife',
    platform: 'browser',
    outDir: 'lib',
    clean: false,
    minify: false,
    globalName: '__dshAirdrop',
    external: Object.keys(clientGlobals),
    outputOptions: {
      globals: clientGlobals,
      entryFileNames: 'client.js',
    },
    plugins: [
      {
        name: 'dsh-client-wrapper',
        renderChunk: {
          order: 'post',
          handler(code) {
            const match = code.match(/^var __dshAirdrop = ([\s\S]+);\s*$/u)
            if (match?.[1] === undefined) {
              throw new Error('Unexpected dsh client bundle shape')
            }
            const body = match[1]
            return `window.__ModuleLoader__.load({\n  id: "dsh-airdrop",\n  factory: (require) => {\n    const module = { exports: {} };\n    const exports = module.exports;\n    const react = require("react");\n    const react_jsx_runtime = require("react/jsx-runtime");\n    const _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");\n    Object.assign(module.exports, ${body});\n    return module.exports;\n  },\n});\n`
          },
        },
      },
    ],
  },
])
