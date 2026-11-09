import { useCallback, useEffect, useRef } from 'react';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { CursorState, DocChange, LanguageId } from '@hirefo/shared';
import { PRESENCE_COLORS } from '@hirefo/shared';
import { useThemeStore } from '../../store/theme';
import type { CollaborativeDoc } from './useCollaborativeDoc';
import styles from './Workspace.module.css';

export interface EditorPanelProps {
  doc: CollaborativeDoc;
  monacoLanguage: string;
  readOnly: boolean;
  /** Remote participants' cursors, keyed by user id. */
  remoteCursors: Map<string, { cursor: CursorState; name: string; colorIndex: number }>;
  onCursorMove: (cursor: Omit<CursorState, 'userId'>) => void;
  onRun: () => void;
  onSubmit: () => void;
}

/** Monaco themes that match the app's design tokens. */
function defineThemes(monaco: Monaco): void {
  monaco.editor.defineTheme('hirefo-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6f7988', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'bb9af7' },
      { token: 'string', foreground: '9ece6a' },
      { token: 'number', foreground: 'e0af68' },
      { token: 'type', foreground: '2ac3de' },
      { token: 'function', foreground: '5b8cff' },
    ],
    colors: {
      'editor.background': '#0b0d10',
      'editor.foreground': '#e8ebf0',
      'editorLineNumber.foreground': '#4a5260',
      'editorLineNumber.activeForeground': '#a2abba',
      'editor.selectionBackground': '#1f3157',
      'editor.lineHighlightBackground': '#11141a',
      'editorCursor.foreground': '#5b8cff',
      'editorIndentGuide.background1': '#1d222b',
      'editorIndentGuide.activeBackground1': '#353d4a',
      'editorWidget.background': '#171b22',
      'editorWidget.border': '#262c37',
      'editorGutter.background': '#0b0d10',
      'scrollbarSlider.background': '#262c3780',
    },
  });

  monaco.editor.defineTheme('hirefo-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7b8495', fontStyle: 'italic' },
      { token: 'keyword', foreground: '7a3fd0' },
      { token: 'string', foreground: '197e42' },
      { token: 'number', foreground: '9a6200' },
      { token: 'type', foreground: '0b7285' },
      { token: 'function', foreground: '2b6cf0' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#10141c',
      'editorLineNumber.foreground': '#a9b0bc',
      'editorLineNumber.activeForeground': '#525b6b',
      'editor.lineHighlightBackground': '#f6f7f9',
      'editorCursor.foreground': '#2b6cf0',
      'editorIndentGuide.background1': '#ebedf1',
      'editorGutter.background': '#ffffff',
    },
  });
}

export function EditorPanel({
  doc,
  monacoLanguage,
  readOnly,
  remoteCursors,
  onCursorMove,
  onRun,
  onSubmit,
}: EditorPanelProps) {
  const resolvedTheme = useThemeStore((s) => s.resolved);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const styleElementRef = useRef<HTMLStyleElement | null>(null);

  // Keep the newest callbacks reachable from Monaco commands, which capture once.
  const onRunRef = useRef(onRun);
  const onSubmitRef = useRef(onSubmit);
  onRunRef.current = onRun;
  onSubmitRef.current = onSubmit;

  const handleMount: OnMount = useCallback(
    (instance, monaco) => {
      editorRef.current = instance;
      monacoRef.current = monaco;
      defineThemes(monaco);
      monaco.editor.setTheme(resolvedTheme === 'light' ? 'hirefo-light' : 'hirefo-dark');
      decorationsRef.current = instance.createDecorationsCollection([]);

      instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current());
      instance.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
        () => onSubmitRef.current(),
      );

      instance.onDidChangeCursorSelection((event) => {
        onCursorMove({
          lineNumber: event.selection.positionLineNumber,
          column: event.selection.positionColumn,
          selection: event.selection.isEmpty()
            ? null
            : {
                startLineNumber: event.selection.startLineNumber,
                startColumn: event.selection.startColumn,
                endLineNumber: event.selection.endLineNumber,
                endColumn: event.selection.endColumn,
              },
        });
      });
    },
    [resolvedTheme, onCursorMove],
  );

  useEffect(() => {
    monacoRef.current?.editor.setTheme(resolvedTheme === 'light' ? 'hirefo-light' : 'hirefo-dark');
  }, [resolvedTheme]);

  /* ---------------- remote patches ---------------- */

  useEffect(
    () =>
      doc.onRemotePatch((changes: DocChange[]) => {
        const instance = editorRef.current;
        const model = instance?.getModel();
        if (!instance || !model) return;

        // executeEdits keeps the local cursor and the undo stack sane, which a
        // wholesale setValue would destroy on every remote keystroke.
        instance.executeEdits(
          'hirefo-remote',
          changes.map((change) => ({
            range: {
              startLineNumber: change.range.startLineNumber,
              startColumn: change.range.startColumn,
              endLineNumber: change.range.endLineNumber,
              endColumn: change.range.endColumn,
            },
            text: change.text,
            forceMoveMarkers: true,
          })),
        );
      }),
    [doc],
  );

  useEffect(
    () =>
      doc.onSnapshot((snapshot) => {
        const model = editorRef.current?.getModel();
        if (!model) return;
        if (model.getValue() === snapshot.content) return;
        // A snapshot is a hard reset: push it as a single undoable edit so the
        // viewport and cursor survive.
        model.pushEditOperations(
          [],
          [{ range: model.getFullModelRange(), text: snapshot.content }],
          () => null,
        );
      }),
    [doc],
  );

  /* ---------------- remote cursors ---------------- */

  useEffect(() => {
    const monaco = monacoRef.current;
    const collection = decorationsRef.current;
    if (!monaco || !collection) return;

    // One stylesheet holding a class per presence colour; Monaco decorations can
    // only reference class names, not inline styles.
    if (!styleElementRef.current) {
      const element = document.createElement('style');
      element.dataset['hirefoCursors'] = 'true';
      element.textContent = PRESENCE_COLORS.map(
        (color, index) => `
        .hirefo-cursor-${index} {
          background: ${color} !important;
          width: 2px !important;
        }
        .hirefo-selection-${index} {
          background: ${color}33 !important;
        }
        .hirefo-cursor-label-${index}::after {
          content: attr(data-name);
          position: absolute;
          top: -1.15em;
          left: 0;
          padding: 0 4px;
          background: ${color};
          color: #fff;
          font-size: 10px;
          line-height: 1.4;
          border-radius: 3px;
          white-space: nowrap;
          pointer-events: none;
        }`,
      ).join('\n');
      document.head.appendChild(element);
      styleElementRef.current = element;
    }

    const decorations: editor.IModelDeltaDecoration[] = [];
    for (const [userId, entry] of remoteCursors) {
      const colorIndex = entry.colorIndex % PRESENCE_COLORS.length;
      const { cursor } = entry;

      decorations.push({
        range: new monaco.Range(cursor.lineNumber, cursor.column, cursor.lineNumber, cursor.column),
        options: {
          className: `hirefo-cursor-${colorIndex}`,
          hoverMessage: { value: entry.name },
          stickiness: 1,
        },
      });

      if (cursor.selection) {
        decorations.push({
          range: new monaco.Range(
            cursor.selection.startLineNumber,
            cursor.selection.startColumn,
            cursor.selection.endLineNumber,
            cursor.selection.endColumn,
          ),
          options: { className: `hirefo-selection-${colorIndex}`, stickiness: 1 },
        });
      }

      void userId;
    }

    collection.set(decorations);
  }, [remoteCursors]);

  useEffect(
    () => () => {
      styleElementRef.current?.remove();
      styleElementRef.current = null;
    },
    [],
  );

  return (
    <div className={styles.editorShell}>
      <Editor
        height="100%"
        language={monacoLanguage}
        value={doc.content}
        theme={resolvedTheme === 'light' ? 'hirefo-light' : 'hirefo-dark'}
        onMount={handleMount}
        onChange={(value, event) => {
          if (doc.isApplyingRemote()) return;
          if (value === undefined) return;
          const changes: DocChange[] = event.changes.map((change) => ({
            range: {
              startLineNumber: change.range.startLineNumber,
              startColumn: change.range.startColumn,
              endLineNumber: change.range.endLineNumber,
              endColumn: change.range.endColumn,
            },
            text: change.text,
          }));
          doc.pushLocalChanges(changes, value);
        }}
        options={{
          readOnly,
          fontFamily:
            "ui-monospace, 'SF Mono', 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
          fontSize: 13,
          lineHeight: 20,
          fontLigatures: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          renderWhitespace: 'selection',
          renderLineHighlight: 'line',
          lineNumbersMinChars: 3,
          padding: { top: 12, bottom: 12 },
          tabSize: 2,
          insertSpaces: true,
          detectIndentation: false,
          automaticLayout: true,
          bracketPairColorization: { enabled: true },
          guides: { indentation: true, bracketPairs: false },
          formatOnPaste: true,
          formatOnType: false,
          suggestOnTriggerCharacters: true,
          quickSuggestions: { other: true, comments: false, strings: false },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          overviewRulerLanes: 0,
          stickyScroll: { enabled: false },
        }}
        loading={<div className={styles.centered}>Loading editor…</div>}
      />
    </div>
  );
}

/** Monaco wants `typescript`/`javascript`/`python`/`sql`; our ids already match. */
export function monacoLanguageFor(language: LanguageId | string | null): string {
  return language ?? 'plaintext';
}
