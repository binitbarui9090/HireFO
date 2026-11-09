import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  EXECUTION_EVENTS_CHANNEL,
  executionEventSchema,
  interviewRoom,
  LANGUAGE_IDS,
  type ClientToServerEvents,
  type LanguageId,
  type ParticipantRole,
  type ServerToClientEvents,
} from '@hirefo/shared';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../db/prisma.js';
import { createRedis } from '../db/redis.js';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../services/tokens.js';
import {
  applyDocumentChange,
  getSnapshot,
  setActiveQuestion,
  setDocumentLanguage,
} from '../services/documents.js';
import { markParticipantJoined } from '../services/interviews.js';
import { addPresence, listPresence, removePresence } from './presence.js';

interface SocketData {
  userId: string;
  name: string;
  sessionId: string;
  /** Interview ids this socket has been authorised for. */
  rooms: Map<string, { role: ParticipantRole; organizationId: string; isStaff: boolean }>;
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

let io: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData> | null =
  null;

export function realtime() {
  if (!io) throw new Error('Socket.IO server has not been initialised.');
  return io;
}

/** Fans an execution update out to everyone in the interview room. */
export function emitExecutionUpdate(payload: {
  interviewId: string;
  jobId: string;
  submissionId: string;
  status: string;
  passedCount?: number;
  totalCount?: number;
  message?: string;
}): void {
  io?.to(interviewRoom(payload.interviewId)).emit('execution:update', {
    jobId: payload.jobId,
    submissionId: payload.submissionId,
    status: payload.status as never,
    ...(payload.passedCount !== undefined ? { passedCount: payload.passedCount } : {}),
    ...(payload.totalCount !== undefined ? { totalCount: payload.totalCount } : {}),
    ...(payload.message !== undefined ? { message: payload.message } : {}),
  });
}

/**
 * Authorises a socket for an interview room. Mirrors `resolveInterviewAccess`:
 * the interview must be in an organization the user is an active member of, and a
 * non-staff user must be a listed participant.
 */
async function authoriseRoom(
  userId: string,
  interviewId: string,
): Promise<{ role: ParticipantRole; organizationId: string; isStaff: boolean } | null> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: { id: true, organizationId: true },
  });
  if (!interview) return null;

  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId: interview.organizationId } },
    select: { role: true, status: true },
  });
  if (!membership || membership.status !== 'ACTIVE') return null;

  const participant = await prisma.interviewParticipant.findUnique({
    where: { interviewId_userId: { interviewId, userId } },
    select: { role: true },
  });

  const isStaff = membership.role === 'ADMIN' || membership.role === 'INTERVIEWER';
  if (!isStaff && !participant) return null;

  return {
    role: participant?.role ?? (isStaff ? 'INTERVIEWER' : 'OBSERVER'),
    organizationId: interview.organizationId,
    isStaff,
  };
}

function roomOf(socket: AppSocket, interviewId: string) {
  return socket.data.rooms.get(interviewId) ?? null;
}

/** Resolves which interview a document belongs to, and whether the socket may touch it. */
async function authoriseDocument(socket: AppSocket, documentId: string) {
  const doc = await prisma.codeDocument.findUnique({
    where: { id: documentId },
    select: { id: true, interviewId: true },
  });
  if (!doc) return null;
  const membership = roomOf(socket, doc.interviewId);
  if (!membership) return null;
  return { doc, membership };
}

export function initRealtime(httpServer: HttpServer) {
  io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
    httpServer,
    {
      path: '/socket.io',
      cors: { origin: config().webOrigins, credentials: true },
      maxHttpBufferSize: 512 * 1024,
      pingTimeout: 25_000,
    },
  );

  // Handshake auth: the same short-lived access token used for the REST API.
  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth as { token?: string } | undefined)?.token ??
        (typeof socket.handshake.query['token'] === 'string' ? socket.handshake.query['token'] : null);
      if (!token) return next(new Error('missing access token'));

      const claims = verifyAccessToken(token);
      const session = await prisma.session.findUnique({
        where: { id: claims.sid },
        include: { user: { select: { id: true, name: true } } },
      });
      if (!session || session.revokedAt || session.expiresAt <= new Date()) {
        return next(new Error('session expired'));
      }

      socket.data.userId = session.userId;
      socket.data.name = session.user.name;
      socket.data.sessionId = session.id;
      socket.data.rooms = new Map();
      return next();
    } catch (err) {
      logger.debug({ err }, 'socket handshake rejected');
      return next(new Error('unauthorised'));
    }
  });

  io.on('connection', (socket: AppSocket) => {
    const log = logger.child({ socketId: socket.id, userId: socket.data.userId });

    socket.on('interview:join', async ({ interviewId }, ack) => {
      try {
        const access = await authoriseRoom(socket.data.userId, interviewId);
        if (!access) {
          ack?.({ ok: false, error: 'You do not have access to this interview.' });
          return;
        }

        socket.data.rooms.set(interviewId, access);
        await socket.join(interviewRoom(interviewId));
        await markParticipantJoined(interviewId, socket.data.userId);

        const users = await addPresence(interviewId, {
          userId: socket.data.userId,
          name: socket.data.name,
          role: access.role,
        });
        io?.to(interviewRoom(interviewId)).emit('presence:state', { interviewId, users });

        const interview = await prisma.interview.findUnique({
          where: { id: interviewId },
          select: { activeQuestionId: true },
        });

        ack?.({
          ok: true,
          data: {
            interviewId,
            role: access.role,
            users,
            activeQuestionId: interview?.activeQuestionId ?? null,
          },
        });
      } catch (err) {
        log.error({ err, interviewId }, 'interview:join failed');
        ack?.({ ok: false, error: 'Could not join the interview.' });
      }
    });

    socket.on('interview:leave', async ({ interviewId }) => {
      if (!socket.data.rooms.has(interviewId)) return;
      socket.data.rooms.delete(interviewId);
      await socket.leave(interviewRoom(interviewId));
      const users = await removePresence(interviewId, socket.data.userId);
      io?.to(interviewRoom(interviewId)).emit('presence:state', { interviewId, users });
    });

    socket.on('doc:sync', async ({ documentId }, ack) => {
      try {
        const authorised = await authoriseDocument(socket, documentId);
        if (!authorised) {
          ack?.({ ok: false, error: 'Document is not available to you.' });
          return;
        }
        ack?.({ ok: true, data: await getSnapshot(documentId) });
      } catch (err) {
        log.error({ err, documentId }, 'doc:sync failed');
        ack?.({ ok: false, error: 'Could not load the document.' });
      }
    });

    socket.on('doc:change', async ({ documentId, baseVersion, changes }, ack) => {
      try {
        const authorised = await authoriseDocument(socket, documentId);
        if (!authorised) {
          ack?.({ ok: false, error: 'Document is not available to you.' });
          return;
        }

        const result = await applyDocumentChange({ documentId, baseVersion, changes });
        ack?.({ ok: true, data: { version: result.snapshot.version } });

        // Fan out to everyone except the author, who already applied it locally.
        socket.to(interviewRoom(authorised.doc.interviewId)).emit('doc:change', {
          documentId,
          version: result.snapshot.version,
          changes: result.changes,
          authorId: socket.data.userId,
        });
      } catch (err) {
        if (err instanceof AppError && err.status === 409) {
          // Stale base version: hand the author the authoritative snapshot back.
          const snapshot = await getSnapshot(documentId).catch(() => null);
          if (snapshot) socket.emit('doc:snapshot', snapshot);
          ack?.({ ok: false, error: 'stale' });
          return;
        }
        log.error({ err, documentId }, 'doc:change failed');
        ack?.({ ok: false, error: err instanceof AppError ? err.message : 'Could not apply the edit.' });
      }
    });

    socket.on('doc:language', async ({ documentId, language }, ack) => {
      try {
        const authorised = await authoriseDocument(socket, documentId);
        if (!authorised || !authorised.membership.isStaff) {
          ack?.({ ok: false, error: 'Only interviewers can change the language.' });
          return;
        }
        if (!(LANGUAGE_IDS as readonly string[]).includes(language)) {
          ack?.({ ok: false, error: 'Unknown language.' });
          return;
        }
        const snapshot = await setDocumentLanguage(documentId, language as LanguageId);
        ack?.({ ok: true, data: snapshot });
        io?.to(interviewRoom(authorised.doc.interviewId)).emit('doc:snapshot', snapshot);
      } catch (err) {
        log.error({ err, documentId }, 'doc:language failed');
        ack?.({ ok: false, error: 'Could not change the language.' });
      }
    });

    socket.on('doc:switch-question', async ({ interviewId, questionId }, ack) => {
      try {
        const access = roomOf(socket, interviewId);
        if (!access || !access.isStaff) {
          ack?.({ ok: false, error: 'Only interviewers can change the active question.' });
          return;
        }
        const snapshot = await setActiveQuestion(interviewId, questionId);
        ack?.({ ok: true, data: snapshot });
        io?.to(interviewRoom(interviewId)).emit('doc:snapshot', snapshot);
      } catch (err) {
        log.error({ err, interviewId }, 'doc:switch-question failed');
        ack?.({ ok: false, error: err instanceof AppError ? err.message : 'Could not switch question.' });
      }
    });

    socket.on('cursor:update', async ({ documentId, cursor }) => {
      const authorised = await authoriseDocument(socket, documentId);
      if (!authorised) return;
      socket.to(interviewRoom(authorised.doc.interviewId)).emit('cursor:update', {
        documentId,
        cursor: { ...cursor, userId: socket.data.userId },
      });
    });

    socket.on('disconnect', async () => {
      for (const interviewId of socket.data.rooms.keys()) {
        const users = await removePresence(interviewId, socket.data.userId).catch(() => null);
        if (users) io?.to(interviewRoom(interviewId)).emit('presence:state', { interviewId, users });
      }
    });
  });

  subscribeToExecutionEvents();
  return io;
}

/**
 * The worker is a separate process, so it publishes progress on a Redis channel
 * and the API relays it to the browser. This keeps the worker free of any socket
 * or HTTP coupling to the API.
 */
function subscribeToExecutionEvents(): void {
  const subscriber = createRedis('execution-events-sub');
  subscriber.subscribe(EXECUTION_EVENTS_CHANNEL).catch((err) => {
    logger.error({ err }, 'failed to subscribe to execution events');
  });
  subscriber.on('message', (_channel, message) => {
    const parsed = executionEventSchema.safeParse(JSON.parse(message) as unknown);
    if (!parsed.success) {
      logger.warn({ message }, 'ignored malformed execution event');
      return;
    }
    const event = parsed.data;
    emitExecutionUpdate({
      interviewId: event.interviewId,
      jobId: event.executionJobId,
      submissionId: event.submissionId,
      status: event.status,
      ...(event.passedCount !== undefined ? { passedCount: event.passedCount } : {}),
      ...(event.totalCount !== undefined ? { totalCount: event.totalCount } : {}),
      ...(event.message !== undefined ? { message: event.message } : {}),
    });
  });
}

export async function closeRealtime(): Promise<void> {
  await io?.close();
  io = null;
}

export { listPresence };
