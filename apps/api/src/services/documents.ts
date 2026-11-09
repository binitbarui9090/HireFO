import type { DocChange, DocSnapshot, LanguageId } from '@hirefo/shared';
import { LANGUAGES } from '@hirefo/shared';
import { prisma } from '../db/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { defaultDocumentContent } from './interviews.js';

/**
 * Collaborative editing model
 * ---------------------------
 * The server owns the buffer. A client sends the changes it just applied plus the
 * version it was based on:
 *
 *   - baseVersion === server version  -> apply, bump version, broadcast to others
 *   - baseVersion !== server version  -> reject with a `stale` conflict; the client
 *                                        re-syncs from the authoritative snapshot
 *
 * This is last-writer-wins at document granularity rather than a CRDT. It is
 * deliberate: a two-person interview has very low concurrent-edit pressure, and a
 * server-authoritative buffer means the code that gets executed is exactly the code
 * the server has, with no merge ambiguity. The trade-off (a rare "resynced" blip
 * when both type in the same instant) is documented in docs/ARCHITECTURE.md.
 */

export const MAX_DOCUMENT_BYTES = 256 * 1024;

export interface DocumentRecord {
  id: string;
  interviewId: string;
  questionId: string | null;
  language: LanguageId;
  content: string;
  version: number;
}

function toSnapshot(doc: DocumentRecord): DocSnapshot {
  return {
    documentId: doc.id,
    questionId: doc.questionId,
    language: doc.language,
    content: doc.content,
    version: doc.version,
  };
}

/** Loads (or lazily creates) the document for an interview + question pair. */
export async function ensureDocument(
  interviewId: string,
  questionId: string | null,
): Promise<DocSnapshot> {
  // Prisma types a nullable column as non-null inside a compound-unique input, so
  // the scratch document (questionId = null) is looked up with findFirst. Uniqueness
  // is still enforced in the database — see the partial unique index in
  // migrations/.../add_scratch_document_unique_index.
  const existing = await prisma.codeDocument.findFirst({
    where: { interviewId, questionId },
  });
  if (existing) {
    return toSnapshot({
      id: existing.id,
      interviewId: existing.interviewId,
      questionId: existing.questionId,
      language: existing.language as LanguageId,
      content: existing.content,
      version: existing.version,
    });
  }

  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: { language: true },
  });
  if (!interview) throw notFound('Interview not found.');

  let starter: unknown = null;
  if (questionId) {
    const link = await prisma.interviewQuestion.findUnique({
      where: { interviewId_questionId: { interviewId, questionId } },
      include: { question: { select: { starterCode: true } } },
    });
    if (!link) throw badRequest('That question is not part of this interview.');
    starter = link.question.starterCode;
  }

  const language = interview.language as LanguageId;
  const created = await prisma.codeDocument.create({
    data: {
      interviewId,
      questionId,
      language,
      content: defaultDocumentContent(starter, language),
      version: 0,
    },
  });

  return toSnapshot({
    id: created.id,
    interviewId: created.interviewId,
    questionId: created.questionId,
    language: created.language as LanguageId,
    content: created.content,
    version: created.version,
  });
}

async function loadDocument(documentId: string) {
  const doc = await prisma.codeDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw notFound('Document not found.');
  return doc;
}

export async function getSnapshot(documentId: string): Promise<DocSnapshot> {
  const doc = await loadDocument(documentId);
  return toSnapshot({
    id: doc.id,
    interviewId: doc.interviewId,
    questionId: doc.questionId,
    language: doc.language as LanguageId,
    content: doc.content,
    version: doc.version,
  });
}

/** Applies Monaco-style range edits to a plain string, in reverse document order. */
export function applyChanges(content: string, changes: DocChange[]): string {
  const lineStarts = (text: string): number[] => {
    const starts = [0];
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) === 10) starts.push(i + 1);
    }
    return starts;
  };

  const offsetOf = (starts: number[], text: string, line: number, column: number): number => {
    // A position past the last line means "past the end of the document", so it
    // clamps to the very end rather than to the start of the last line. A stale
    // client sending line 99 of a two-line buffer must not have its edit land at
    // the top of the file.
    if (line > starts.length) return text.length;
    const lineIndex = Math.max(line, 1) - 1;
    const lineStart = starts[lineIndex] ?? 0;
    const nextStart = starts[lineIndex + 1] ?? text.length + 1;
    const lineLength = Math.max(nextStart - 1 - lineStart, 0);
    const col = Math.min(Math.max(column, 1), lineLength + 1) - 1;
    return lineStart + col;
  };

  // Sort descending so earlier offsets stay valid while we splice.
  const starts = lineStarts(content);
  const resolved = changes.map((change) => ({
    start: offsetOf(starts, content, change.range.startLineNumber, change.range.startColumn),
    end: offsetOf(starts, content, change.range.endLineNumber, change.range.endColumn),
    text: change.text,
  }));
  resolved.sort((a, b) => b.start - a.start || b.end - a.end);

  let next = content;
  for (const change of resolved) {
    const start = Math.min(change.start, next.length);
    const end = Math.min(Math.max(change.end, start), next.length);
    next = next.slice(0, start) + change.text + next.slice(end);
  }
  return next;
}

export interface ApplyResult {
  snapshot: DocSnapshot;
  /** Changes to fan out to the other participants. */
  changes: DocChange[];
}

export async function applyDocumentChange(params: {
  documentId: string;
  baseVersion: number;
  changes: DocChange[];
}): Promise<ApplyResult> {
  if (params.changes.length === 0 || params.changes.length > 200) {
    throw badRequest('A change batch must contain between 1 and 200 edits.');
  }

  const doc = await loadDocument(params.documentId);
  if (doc.version !== params.baseVersion) {
    throw conflict('Document has moved on; resync required.', {
      reason: 'stale',
      version: doc.version,
    });
  }

  const nextContent = applyChanges(doc.content, params.changes);
  if (Buffer.byteLength(nextContent, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw badRequest(`Document would exceed the ${MAX_DOCUMENT_BYTES / 1024}KB limit.`);
  }

  // The version guard in `where` makes the write atomic against a concurrent
  // apply: whoever loses the race gets 0 rows updated and is told to resync.
  const updated = await prisma.codeDocument.updateMany({
    where: { id: doc.id, version: params.baseVersion },
    data: { content: nextContent, version: params.baseVersion + 1 },
  });
  if (updated.count === 0) {
    const fresh = await getSnapshot(doc.id);
    throw conflict('Document has moved on; resync required.', {
      reason: 'stale',
      version: fresh.version,
    });
  }

  return {
    snapshot: {
      documentId: doc.id,
      questionId: doc.questionId,
      language: doc.language as LanguageId,
      content: nextContent,
      version: params.baseVersion + 1,
    },
    changes: params.changes,
  };
}

export async function setDocumentLanguage(
  documentId: string,
  language: LanguageId,
): Promise<DocSnapshot> {
  if (!LANGUAGES[language]) throw badRequest(`Unknown language "${language}".`);
  const doc = await loadDocument(documentId);

  // Switching language on an untouched buffer swaps in that language's starter
  // code. Once the buffer has been edited we keep the author's text.
  let content = doc.content;
  if (doc.version === 0) {
    let starter: unknown = null;
    if (doc.questionId) {
      const link = await prisma.interviewQuestion.findUnique({
        where: { interviewId_questionId: { interviewId: doc.interviewId, questionId: doc.questionId } },
        include: { question: { select: { starterCode: true } } },
      });
      starter = link?.question.starterCode ?? null;
    }
    content = defaultDocumentContent(starter, language);
  }

  const updated = await prisma.codeDocument.update({
    where: { id: documentId },
    data: { language, content, version: { increment: 1 } },
  });

  return toSnapshot({
    id: updated.id,
    interviewId: updated.interviewId,
    questionId: updated.questionId,
    language: updated.language as LanguageId,
    content: updated.content,
    version: updated.version,
  });
}

export async function setActiveQuestion(
  interviewId: string,
  questionId: string,
): Promise<DocSnapshot> {
  const link = await prisma.interviewQuestion.findUnique({
    where: { interviewId_questionId: { interviewId, questionId } },
    select: { questionId: true },
  });
  if (!link) throw badRequest('That question is not part of this interview.');
  await prisma.interview.update({ where: { id: interviewId }, data: { activeQuestionId: questionId } });
  return ensureDocument(interviewId, questionId);
}

export async function listDocuments(interviewId: string): Promise<DocSnapshot[]> {
  const docs = await prisma.codeDocument.findMany({
    where: { interviewId },
    orderBy: { createdAt: 'asc' },
  });
  return docs.map((d) =>
    toSnapshot({
      id: d.id,
      interviewId: d.interviewId,
      questionId: d.questionId,
      language: d.language as LanguageId,
      content: d.content,
      version: d.version,
    }),
  );
}
