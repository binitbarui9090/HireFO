/**
 * Monaco setup.
 *
 * `@monaco-editor/react` fetches Monaco from a CDN (jsdelivr) by default. That
 * would make the interview workspace — the one screen that absolutely must work —
 * depend on public internet access at the moment an interview starts, and would
 * send a request to a third party from inside a customer's network.
 *
 * So Monaco is bundled from the local dependency instead, and its web workers are
 * built by Vite as real workers. The trade is a larger bundle, split into its own
 * chunk so it is cached separately from the app.
 *
 * Only the editor worker and the TypeScript worker are wired up: those are the
 * languages with real language services. Python and SQL use Monaco's tokenizer
 * only, which needs no worker.
 */
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
window.MonacoEnvironment = {
    getWorker(_workerId, label) {
        if (label === 'typescript' || label === 'javascript')
            return new tsWorker();
        return new editorWorker();
    },
};
// The candidate's buffer is a single standalone file, so cross-file resolution
// and lib checking only produce noise. Diagnostics that matter (real type errors)
// are reported by the sandbox's tsc pass at run time instead.
monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    strict: false,
});
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    // 2307: "cannot find module" — expected, since node_modules is not in the browser.
    diagnosticCodesToIgnore: [2307, 2792],
});
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
});
loader.config({ monaco });
// Development-only debug handle. Monaco is already fully loaded in the page, so
// this exposes nothing new; it makes the editor inspectable from the console and
// lets the end-to-end tests set a buffer deterministically instead of depending
// on select-all keybindings reaching the right element. Stripped from production
// builds by the `import.meta.env.DEV` guard.
if (import.meta.env.DEV) {
    window.monaco = monaco;
}
export { monaco };
