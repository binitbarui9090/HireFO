import { useCallback, useEffect, useRef, useState } from 'react';
import { emitWithAck, getSocket } from '../../lib/socket';
export function useCollaborativeDoc(initial) {
    const [documentId, setDocumentId] = useState(initial?.documentId ?? null);
    const [content, setContent] = useState(initial?.content ?? '');
    const [version, setVersion] = useState(initial?.version ?? 0);
    const [language, setLanguage] = useState(initial?.language ?? null);
    const [syncState, setSyncState] = useState(initial ? 'live' : 'connecting');
    // Refs mirror state so the socket handlers always read current values without
    // being re-registered on every keystroke.
    const versionRef = useRef(version);
    const contentRef = useRef(content);
    const documentIdRef = useRef(documentId);
    const applyingRemote = useRef(false);
    const inFlight = useRef(false);
    const pendingChanges = useRef([]);
    const patchHandlers = useRef(new Set());
    const snapshotHandlers = useRef(new Set());
    versionRef.current = version;
    contentRef.current = content;
    documentIdRef.current = documentId;
    const adoptSnapshot = useCallback((snapshot) => {
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
        if (!id)
            return;
        setSyncState('syncing');
        const result = await emitWithAck('doc:sync', { documentId: id });
        if (result.ok)
            adoptSnapshot(result.data);
        else
            setSyncState('offline');
    }, [adoptSnapshot]);
    /** Sends one batch at a time; later edits queue up behind the in-flight one. */
    const flush = useCallback(async () => {
        const id = documentIdRef.current;
        if (!id || inFlight.current || pendingChanges.current.length === 0)
            return;
        const batch = pendingChanges.current;
        pendingChanges.current = [];
        inFlight.current = true;
        const baseVersion = versionRef.current;
        const result = await emitWithAck('doc:change', {
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
    const pushLocalChanges = useCallback((changes, nextContent) => {
        if (applyingRemote.current || changes.length === 0)
            return;
        setContent(nextContent);
        contentRef.current = nextContent;
        pendingChanges.current = [...pendingChanges.current, ...changes];
        void flush();
    }, [flush]);
    useEffect(() => {
        if (initial)
            adoptSnapshot(initial);
    }, [initial, adoptSnapshot]);
    useEffect(() => {
        const socket = getSocket();
        const onDocChange = (payload) => {
            if (payload.documentId !== documentIdRef.current)
                return;
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
        const onDocSnapshot = (snapshot) => {
            // A snapshot for a different document means the interviewer switched the
            // active question; the workspace handles that by swapping documents.
            if (snapshot.documentId !== documentIdRef.current)
                return;
            adoptSnapshot(snapshot);
        };
        const onDisconnect = () => setSyncState('offline');
        const onConnect = () => {
            if (documentIdRef.current)
                void resync();
            else
                setSyncState('live');
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
    const onRemotePatch = useCallback((handler) => {
        patchHandlers.current.add(handler);
        return () => patchHandlers.current.delete(handler);
    }, []);
    const onSnapshot = useCallback((handler) => {
        snapshotHandlers.current.add(handler);
        return () => snapshotHandlers.current.delete(handler);
    }, []);
    const changeLanguage = useCallback(async (next) => {
        const id = documentIdRef.current;
        if (!id)
            return false;
        const result = await emitWithAck('doc:language', {
            documentId: id,
            language: next,
        });
        if (result.ok) {
            adoptSnapshot(result.data);
            return true;
        }
        return false;
    }, [adoptSnapshot]);
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
