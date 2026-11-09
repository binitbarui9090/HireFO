import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocChange, DocSnapshot, LanguageId } from '@hirefo/shared';
import { emitWithAck, getSocket } from '../../lib/socket';

/**
 * Client half of the collaborative editing protocol.
 *
 * The server owns the buffer and its version. This hook:
 *
 *  - applies local Monaco edits immediately (no input latency), then ships them
 *    with the version they were based on;
 *  - applies remote edits only when their version is exactly ours + 1, so an
 *    out-of-order delivery cannot silently corrupt the text;
 *  - on any rejection or gap, asks the server for a snapshot and replaces the
 *    buffer wholesale.
 *
 * `applyingRemote` guards against feeding a remote edit straight back as a local
 * change, which would otherwise loop forever.
 */

export type SyncState = 'connecting' | 'live' | 'syncing' | 'offline';

export interface CollaborativeDoc {
  documentId: string | null;
  content: string;
  version: number;
  language: LanguageId | null;
  syncState: SyncState;
  /** Edits made locally in Monaco, to be forwarded to the server. */
  pushLocalChanges: (changes: DocChange[], nextContent: string) => void;
  /** True while a remote patch is being applied — suppress local-change handling. */
  isApplyingRemote: () => boolean;
  /** Remote edits to apply to the Monaco model. */
  onRemotePatch: (handler: (changes: DocChange[]) => void) => () => void;
  /** Full-document replacements (resync, language switch, question switch). */
  onSnapshot: (handler: (snapshot: DocSnapshot) => void) => () => void;
  resync: () => Promise<void>;
  setLanguage: (language: LanguageId) => Promise<boolean>;
}

export function useCollaborativeDoc(initial: DocSnapshot | null): CollaborativeDoc {
  const [documentId, setDocumentId] = useState<string | null>(initial?.documentId ?? null);
  const [content, setContent] = useState(initial?.content ?? '');
  const [version, setVersion] = useState(initial?.version ?? 0);
  const [language, setLanguage] = useState<LanguageId | null>(initial?.language ?? null);
  const [syncState, setSyncState] = useState<SyncState>(initial ? 'live' : 'connecting');

  // Refs mirror state so the socket handlers always read current values without
  // being re-registered on every keystroke.
  const versionRef = useRef(version);
  const contentRef = useRef(content);
  const documentIdRef = useRef(documentId);
  const applyingRemote = useRef(false);
  const inFlight = useRef(false);
  const pendingChanges = useRef<DocChange[]>([]);

  const patchHandlers = useRef(new Set<(changes: DocChange[]) => void>());
  const snapshotHandlers = useRef(new Set<(snapshot: DocSnapshot) => void>());

  versionRef.current = version;
  contentRef.current = content;
  documentIdRef.current = documentId;

  const adoptSnapshot = useCallback((snapshot: DocSnapshot) => {
    applyingRemote.current = true;
    setDocumentId(snapshot.documentId);
    setContent(snapshot.content);
    setVersion(snapshot.version);
    setLanguage(snapshot.language);
    versionRef.current = snapshot.version;
    contentRef.current = snapshot.content;
    documentIdRef.current = snapshot.documentId;
    pendingChanges.current = [];
    snapshotHandlers.current.forEach((handler) => handler(snapshot));
    setSyncState('live');
    // Released on the next macrotask, after Monaco has applied the new value.
    setTimeout(() => {
      applyingRemote.current = false;
    }, 0);
  }, []);

  const resync = useCallback(async () => {
    const id = documentIdRef.current;
    if (!id) return;
    setSyncState('syncing');
    const result = await emitWithAck<DocSnapshot>('doc:sync', { documentId: id });
    if (result.ok) adoptSnapshot(result.data);
    else setSyncState('offline');
  }, [adoptSnapshot]);

  /** Sends one batch at a time; later edits queue up behind the in-flight one. */
  const flush = useCallback(async () => {
    const id = documentIdRef.current;
    if (!id || inFlight.current || pendingChanges.current.length === 0) return;

    const batch = pendingChanges.current;
    pendingChanges.current = [];
    inFlight.current = true;
    const baseVersion = versionRef.current;

    const result = await emitWithAck<{ version: number }>('doc:change', {
      documentId: id,
      baseVersion,
      changes: batch,
    });
    inFlight.current = false;

    if (result.ok) {
      // Our local text already reflects the batch; only the version moves.
      setVersion(result.data.version);
      versionRef.current = result.data.version;
      setSyncState('live');
      void flush();
      return;
    }

    if (result.error === 'stale') {
      // The server will push a snapshot; drop anything queued behind this batch
      // since it was based on a buffer that no longer exists.
      pendingChanges.current = [];
      void resync();
      return;
    }

    setSyncState('offline');
    pendingChanges.current = [];
  }, [resync]);

  const pushLocalChanges = useCallback(
    (changes: DocChange[], nextContent: string) => {
      if (applyingRemote.current || changes.length === 0) return;
      setContent(nextContent);
      contentRef.current = nextContent;
      pendingChanges.current = [...pendingChanges.current, ...changes];
      void flush();
    },
    [flush],
  );

  useEffect(() => {
    if (initial) adoptSnapshot(initial);
  }, [initial, adoptSnapshot]);

  useEffect(() => {
    const socket = getSocket();

    const onDocChange = (payload: {
      documentId: string;
      version: number;
      changes: DocChange[];
      authorId: string;
    }) => {
      if (payload.documentId !== documentIdRef.current) return;

      // Only a contiguous next version can be applied as a patch. Anything else
      // means we missed an event, so fall back to a full resync.
      if (payload.version !== versionRef.current + 1) {
        void resync();
        return;
      }

      applyingRemote.current = true;
      patchHandlers.current.forEach((handler) => handler(payload.changes));
      setVersion(payload.version);
      versionRef.current = payload.version;
      setTimeout(() => {
        applyingRemote.current = false;
      }, 0);
    };

    const onDocSnapshot = (snapshot: DocSnapshot) => {
      // A snapshot for a different document means the interviewer switched the
      // active question; the workspace handles that by swapping documents.
      if (snapshot.documentId !== documentIdRef.current) return;
      adoptSnapshot(snapshot);
    };

    const onDisconnect = () => setSyncState('offline');
    const onConnect = () => {
      if (documentIdRef.current) void resync();
      else setSyncState('live');
    };

    socket.on('doc:change', onDocChange);
    socket.on('doc:snapshot', onDocSnapshot);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);

    return () => {
      socket.off('doc:change', onDocChange);
      socket.off('doc:snapshot', onDocSnapshot);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  }, [resync, adoptSnapshot]);

  const onRemotePatch = useCallback((handler: (changes: DocChange[]) => void) => {
    patchHandlers.current.add(handler);
    return () => patchHandlers.current.delete(handler);
  }, []);

  const onSnapshot = useCallback((handler: (snapshot: DocSnapshot) => void) => {
    snapshotHandlers.current.add(handler);
    return () => snapshotHandlers.current.delete(handler);
  }, []);

  const changeLanguage = useCallback(
    async (next: LanguageId): Promise<boolean> => {
      const id = documentIdRef.current;
      if (!id) return false;
      const result = await emitWithAck<DocSnapshot>('doc:language', {
        documentId: id,
        language: next,
      });
      if (result.ok) {
        adoptSnapshot(result.data);
        return true;
      }
      return false;
    },
    [adoptSnapshot],
  );

  return {
    documentId,
    content,
    version,
    language,
    syncState,
    pushLocalChanges,
    isApplyingRemote: () => applyingRemote.current,
    onRemotePatch,
    onSnapshot,
    resync,
    setLanguage: changeLanguage,
  };
}
