import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import typescriptWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'

globalThis.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new typescriptWorker()
    return new editorWorker()
  },
}

const diagnostics = {
  noSemanticValidation: true,
  noSuggestionDiagnostics: true,
}
monaco.typescript.typescriptDefaults.setDiagnosticsOptions(diagnostics)
monaco.typescript.javascriptDefaults.setDiagnosticsOptions(diagnostics)
monaco.typescript.typescriptDefaults.setCompilerOptions({
  allowNonTsExtensions: true,
  jsx: monaco.typescript.JsxEmit.ReactJSX,
  target: monaco.typescript.ScriptTarget.ESNext,
})

// Use the bundled editor instead of fetching Monaco from a CDN at runtime.
loader.config({ monaco })
