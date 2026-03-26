import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['node-pty', 'electron-store', 'chokidar']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    optimizeDeps: {
      include: [
        'monaco-editor/esm/vs/editor/editor.api',
        'monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution',
        'monaco-editor/esm/vs/basic-languages/python/python.contribution',
        'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution',
        'monaco-editor/esm/vs/basic-languages/java/java.contribution',
        'monaco-editor/esm/vs/basic-languages/go/go.contribution',
        'monaco-editor/esm/vs/basic-languages/rust/rust.contribution',
        'monaco-editor/esm/vs/basic-languages/sql/sql.contribution',
        'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution',
        'monaco-editor/esm/vs/basic-languages/xml/xml.contribution',
        'monaco-editor/esm/vs/basic-languages/shell/shell.contribution',
        'monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution',
        'monaco-editor/esm/vs/basic-languages/bat/bat.contribution',
        'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution',
        'monaco-editor/esm/vs/basic-languages/css/css.contribution',
        'monaco-editor/esm/vs/basic-languages/html/html.contribution',
        'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution',
        'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'
      ]
    },
    plugins: [
      react()
    ]
  }
})
