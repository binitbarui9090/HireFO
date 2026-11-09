import type { ExecutionStatus, ParticipantRole } from './enums.js';
import type { LanguageId } from './languages.js';

/** Socket.IO room name for an interview. */
export const interviewRoom = (interviewId: string) => `interview:${interviewId}`;

export interface PresenceUser {
  userId: string;
  name: string;
  role: ParticipantRole;
  colorIndex: number;
  socketCount: number;
}

export interface CursorState {
  userId: string;
  lineNumber: number;
  column: number;
  selection?: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
}

/** A Monaco-compatible content change. */
export interface DocChange {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  text: string;
}

export interface DocSnapshot {
  documentId: string;
  questionId: string | null;
  language: LanguageId;
  content: string;
  version: number;
}

export interface ExecutionProgress {
  jobId: string;
  submissionId: string;
  status: ExecutionStatus;
  passedCount?: number;
  totalCount?: number;
  message?: string;
}

/** Client -> server events. */
export interface ClientToServerEvents {
  'interview:join': (p: { interviewId: string }, ack: (r: AckResult<JoinPayload>) => void) => void;
  'interview:leave': (p: { interviewId: string }) => void;
  'doc:sync': (p: { documentId: string }, ack: (r: AckResult<DocSnapshot>) => void) => void;
  'doc:change': (
    p: { documentId: string; baseVersion: number; changes: DocChange[] },
    ack: (r: AckResult<{ version: number }>) => void,
  ) => void;
  'doc:language': (
    p: { documentId: string; language: LanguageId },
    ack: (r: AckResult<DocSnapshot>) => void,
  ) => void;
  'doc:switch-question': (
    p: { interviewId: string; questionId: string },
    ack: (r: AckResult<DocSnapshot>) => void,
  ) => void;
  'cursor:update': (p: { documentId: string; cursor: Omit<CursorState, 'userId'> }) => void;
}

/** Server -> client events. */
export interface ServerToClientEvents {
  'presence:state': (p: { interviewId: string; users: PresenceUser[] }) => void;
  'doc:change': (p: {
    documentId: string;
    version: number;
    changes: DocChange[];
    authorId: string;
  }) => void;
  'doc:snapshot': (p: DocSnapshot) => void;
  'doc:language': (p: { documentId: string; language: LanguageId }) => void;
  'cursor:update': (p: { documentId: string; cursor: CursorState }) => void;
  'execution:update': (p: ExecutionProgress) => void;
  'interview:status': (p: { interviewId: string; status: string }) => void;
  'note:created': (p: { interviewId: string; noteId: string }) => void;
  'error:notice': (p: { message: string }) => void;
}

export interface JoinPayload {
  interviewId: string;
  role: ParticipantRole;
  users: PresenceUser[];
  activeQuestionId: string | null;
}

export type AckResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const PRESENCE_COLORS = [
  '#5b8cff',
  '#f7768e',
  '#9ece6a',
  '#e0af68',
  '#bb9af7',
  '#2ac3de',
] as const;
