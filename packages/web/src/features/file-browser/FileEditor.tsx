/**
 * FileEditor — CodeMirror 6 wrapper for editing workspace files.
 *
 * Lazy-loaded (only imported when a file tab is opened).
 * Features: syntax highlighting, line numbers, search (Ctrl+F),
 * undo/redo, bracket matching, and Ctrl+S save.
 */

import { useEffect, useRef } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { bracketMatching, foldGutter } from '@codemirror/language';
import { Loader2, AlertTriangle, RotateCw, LockKeyhole } from 'lucide-react';
import { peonTheme, peonHighlighting } from './editorTheme';
import { getLanguageExtension, shouldWrap } from './utils/languageMap';
import type { OpenFile } from './types';

interface FileEditorProps {
  file: OpenFile;
  onContentChange: (path: string, content: string) => void;
  onSave: (path: string) => void;
  onRetry: (path: string) => void;
}

export function FileEditor({ file, onContentChange, onSave, onRetry }: FileEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  const onContentChangeRef = useRef(onContentChange);
  const onSaveRef = useRef(onSave);
  onContentChangeRef.current = onContentChange;
  onSaveRef.current = onSave;
  const filePathRef = useRef(file.path);
  filePathRef.current = file.path;

  useEffect(() => {
    if (file.loading || file.error || !containerRef.current) return;

    let destroyed = false;

    const setup = async () => {
      const langExt = await getLanguageExtension(file.name);
      if (destroyed) return;

      const extensions: Extension[] = [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        foldGutter(),
        bracketMatching(),
        history(),
        search(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          {
            key: 'Mod-s',
            run: () => {
              onSaveRef.current(filePathRef.current);
              return true;
            },
          },
        ]),
        peonTheme,
        peonHighlighting,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onContentChangeRef.current(
              filePathRef.current,
              update.state.doc.toString(),
            );
          }
        }),
        readOnlyCompartment.current.of(EditorState.readOnly.of(false)),
      ];

      if (shouldWrap(file.name)) {
        extensions.push(EditorView.lineWrapping);
      }

      if (langExt) {
        extensions.push(langExt);
      }

      const state = EditorState.create({
        doc: file.content,
        extensions,
      });

      if (destroyed || !containerRef.current) return;

      if (viewRef.current) {
        viewRef.current.destroy();
      }

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      viewRef.current = view;
    };

    setup();

    return () => {
      destroyed = true;
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, file.loading, file.error]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        EditorState.readOnly.of(file.locked),
      ),
    });
  }, [file.locked]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || file.loading || file.error) return;

    const currentDoc = view.state.doc.toString();
    if (file.savedContent !== currentDoc && file.savedContent === file.content) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentDoc.length,
          insert: file.content,
        },
      });
    }
  }, [file.savedContent, file.content, file.loading, file.error]);

  if (file.loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs gap-2">
        <Loader2 className="animate-spin" size={14} />
        Loading {file.name}...
      </div>
    );
  }

  if (file.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <AlertTriangle size={24} className="text-destructive" />
        <div className="text-sm">
          Failed to load <span className="font-mono text-foreground">{file.name}</span>
        </div>
        <div className="text-xs">{file.error}</div>
        <button
          onClick={() => onRetry(file.path)}
          className="flex items-center gap-1.5 text-xs text-primary hover:underline mt-1"
        >
          <RotateCw size={12} />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0 relative">
      <div ref={containerRef} className={`flex-1 min-h-0 overflow-hidden transition-opacity duration-200 ${file.locked ? 'opacity-30' : ''}`} />

      {file.locked && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none" role="status" aria-live="polite">
          <div className="flex items-center gap-3 px-5 py-3 rounded-lg bg-background/90 border border-primary/30 shadow-lg shadow-primary/5 pointer-events-auto">
            <LockKeyhole size={16} className="text-primary shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">AI is editing this file</span>
              <span className="text-[11px] text-muted-foreground">Editor locked until changes complete</span>
            </div>
            <span className="text-primary animate-pulse text-lg leading-none ml-1">···</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default FileEditor;
