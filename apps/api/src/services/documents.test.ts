import { beforeEach, describe, expect, it } from 'vitest';
import type { DocChange } from '@hirefo/shared';
import { prisma } from '../db/prisma.js';
import { AppError } from '../lib/errors.js';
import {
  addMember,
  createOrgWithAdmin,
  resetDatabase,
  seedInterview,
  seedQuestion,
  type TestOrg,
  type TestUser,
} from '../test/helpers.js';
import {
  applyChanges,
  applyDocumentChange,
  ensureDocument,
  getSnapshot,
  setDocumentLanguage,
} from './documents.js';

/** Monaco-shaped change helper. */
const edit = (
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
  text: string,
): DocChange => ({
  range: {
    startLineNumber: startLine,
    startColumn: startCol,
    endLineNumber: endLine,
    endColumn: endCol,
  },
  text,
});

describe('applyChanges (pure)', () => {
  it('inserts at the start of a line', () => {
    expect(applyChanges('world', [edit(1, 1, 1, 1, 'hello ')])).toBe('hello world');
  });

  it('appends at the end of a line', () => {
    expect(applyChanges('hello', [edit(1, 6, 1, 6, ' world')])).toBe('hello world');
  });

  it('replaces a range', () => {
    expect(applyChanges('hello world', [edit(1, 7, 1, 12, 'there')])).toBe('hello there');
  });

  it('deletes a range', () => {
    expect(applyChanges('hello world', [edit(1, 6, 1, 12, '')])).toBe('hello');
  });

  it('edits across multiple lines', () => {
    const before = 'line one\nline two\nline three';
    expect(applyChanges(before, [edit(2, 1, 2, 9, 'LINE TWO')])).toBe(
      'line one\nLINE TWO\nline three',
    );
  });

  it('replaces a multi-line selection', () => {
    const before = 'a\nb\nc\nd';
    expect(applyChanges(before, [edit(2, 1, 3, 2, 'X')])).toBe('a\nX\nd');
  });

  it('inserts a newline', () => {
    expect(applyChanges('ab', [edit(1, 2, 1, 2, '\n')])).toBe('a\nb');
  });

  it('applies a batch of edits in reverse document order, so earlier offsets stay valid', () => {
    // Two independent insertions in one keystroke batch (e.g. multi-cursor).
    const result = applyChanges('aaa bbb', [
      edit(1, 1, 1, 1, '['),
      edit(1, 8, 1, 8, ']'),
    ]);
    expect(result).toBe('[aaa bbb]');
  });

  it('handles a multi-cursor replacement batch', () => {
    const result = applyChanges('x = 1;\nx = 1;', [
      edit(1, 5, 1, 6, '2'),
      edit(2, 5, 2, 6, '3'),
    ]);
    expect(result).toBe('x = 2;\nx = 3;');
  });

  it('clamps a column past the end of a line to the line end', () => {
    expect(applyChanges('ab', [edit(1, 50, 1, 99, 'c')])).toBe('abc');
  });

  it('clamps a line past the end of the document to the document end, not the last line start', () => {
    // A stale client sending line 99 of a short buffer must not land its edit at
    // the top of the file.
    expect(applyChanges('ab', [edit(99, 1, 99, 1, 'c')])).toBe('abc');
    expect(applyChanges('line one\nline two', [edit(99, 1, 99, 1, '!')])).toBe('line one\nline two!');
  });

  it('treats column 0 or negative as the line start', () => {
    expect(applyChanges('bc', [edit(1, 0, 1, 1, 'a')])).toBe('abc');
  });

  it('is a no-op for an empty change list', () => {
    expect(applyChanges('unchanged', [])).toBe('unchanged');
  });

  it('round-trips a realistic typing sequence', () => {
    let content = '';
    for (const ch of 'const x = 1;') {
      const lines = content.split('\n');
      const lastLine = lines.length;
      const lastCol = lines[lines.length - 1]!.length + 1;
      content = applyChanges(content, [edit(lastLine, lastCol, lastLine, lastCol, ch)]);
    }
    expect(content).toBe('const x = 1;');
  });
});

describe('document synchronisation', () => {
  let org: TestOrg;
  let admin: TestUser;
  let interviewer: TestUser;
  let questionId: string;
  let interviewId: string;

  beforeEach(async () => {
    await resetDatabase();
    const created = await createOrgWithAdmin('Acme', 'admin@acme.test');
    org = created.org;
    admin = created.admin;
    interviewer = await addMember(org.id, 'interviewer@acme.test', 'INTERVIEWER');
    questionId = (await seedQuestion(org.id, admin.id)).id;
    interviewId = await seedInterview(org.id, interviewer.id, { questionIds: [questionId] });
  });


  it('creates the document once, with the question starter code', async () => {
    const first = await ensureDocument(interviewId, questionId);
    const second = await ensureDocument(interviewId, questionId);

    expect(second.documentId).toBe(first.documentId);
    expect(first.content).toContain('solve me');
    expect(first.version).toBe(0);
  });

  it('falls back to the language default when the question has no starter code', async () => {
    const bare = await prisma.question.create({
      data: {
        organizationId: org.id,
        createdById: admin.id,
        title: 'No starter',
        slug: 'no-starter',
        description: 'A question with no starter code at all.',
        difficulty: 'EASY',
        categories: ['ALGORITHMS'],
        languages: ['javascript'],
      },
    });
    await prisma.interviewQuestion.create({
      data: { interviewId, questionId: bare.id, orderIndex: 1 },
    });

    const doc = await ensureDocument(interviewId, bare.id);
    // The shared registry's JavaScript skeleton reads stdin.
    expect(doc.content).toContain('readFileSync');
  });

  it('applies a change and bumps the version', async () => {
    const doc = await ensureDocument(interviewId, questionId);
    const result = await applyDocumentChange({
      documentId: doc.documentId,
      baseVersion: doc.version,
      changes: [edit(1, 1, 1, 1, '// mine\n')],
    });

    expect(result.snapshot.version).toBe(doc.version + 1);
    expect(result.snapshot.content.startsWith('// mine\n')).toBe(true);

    const persisted = await getSnapshot(doc.documentId);
    expect(persisted.content).toBe(result.snapshot.content);
    expect(persisted.version).toBe(doc.version + 1);
  });

  it('rejects a change based on a stale version and reports the current one', async () => {
    const doc = await ensureDocument(interviewId, questionId);
    await applyDocumentChange({
      documentId: doc.documentId,
      baseVersion: 0,
      changes: [edit(1, 1, 1, 1, 'a')],
    });

    // A second client still thinks it is on v0.
    const stale = applyDocumentChange({
      documentId: doc.documentId,
      baseVersion: 0,
      changes: [edit(1, 1, 1, 1, 'b')],
    });

    await expect(stale).rejects.toThrow(AppError);
    await stale.catch((err: AppError) => {
      expect(err.status).toBe(409);
      expect((err.details as { reason: string; version: number }).reason).toBe('stale');
      expect((err.details as { version: number }).version).toBe(1);
    });

    // The losing edit left no trace.
    const persisted = await getSnapshot(doc.documentId);
    expect(persisted.content.startsWith('a')).toBe(true);
    expect(persisted.version).toBe(1);
  });

  it('serialises concurrent edits so exactly one wins each version', async () => {
    const doc = await ensureDocument(interviewId, questionId);

    const results = await Promise.allSettled([
      applyDocumentChange({
        documentId: doc.documentId,
        baseVersion: 0,
        changes: [edit(1, 1, 1, 1, 'A')],
      }),
      applyDocumentChange({
        documentId: doc.documentId,
        baseVersion: 0,
        changes: [edit(1, 1, 1, 1, 'B')],
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const persisted = await getSnapshot(doc.documentId);
    expect(persisted.version).toBe(1);
    // Whichever won, the buffer is one of the two states — never an interleaving.
    expect(['A', 'B']).toContain(persisted.content[0]);
  });

  it('rejects an empty or oversized change batch', async () => {
    const doc = await ensureDocument(interviewId, questionId);
    await expect(
      applyDocumentChange({ documentId: doc.documentId, baseVersion: 0, changes: [] }),
    ).rejects.toThrow(/between 1 and 200/);

    const tooMany = Array.from({ length: 201 }, () => edit(1, 1, 1, 1, 'x'));
    await expect(
      applyDocumentChange({ documentId: doc.documentId, baseVersion: 0, changes: tooMany }),
    ).rejects.toThrow(/between 1 and 200/);
  });

  it('refuses a change that would exceed the document size limit', async () => {
    const doc = await ensureDocument(interviewId, questionId);
    // Use the snapshot's own version rather than assuming 0, so this can never
    // fail as a stale-version conflict and report the wrong reason.
    const attempt = applyDocumentChange({
      documentId: doc.documentId,
      baseVersion: doc.version,
      changes: [edit(1, 1, 1, 1, 'x'.repeat(300 * 1024))],
    });

    await expect(attempt).rejects.toThrow(/limit/);
    await attempt.catch((err: AppError) => {
      expect(err.status).toBe(400);
    });

    // The rejected write left the buffer untouched.
    const persisted = await getSnapshot(doc.documentId);
    expect(persisted.version).toBe(doc.version);
    expect(persisted.content).toBe(doc.content);
  });

  it('swaps in the new starter code when the language changes on an untouched buffer', async () => {
    const doc = await ensureDocument(interviewId, questionId);
    expect(doc.version).toBe(0);

    const switched = await setDocumentLanguage(doc.documentId, 'python');
    expect(switched.language).toBe('python');
    expect(switched.content).toContain('sys.stdin');
    expect(switched.content).not.toContain('solve me');
  });

  it('keeps the author text when the language changes on an edited buffer', async () => {
    const doc = await ensureDocument(interviewId, questionId);
    await applyDocumentChange({
      documentId: doc.documentId,
      baseVersion: 0,
      changes: [edit(1, 1, 1, 1, 'const mine = 1;\n')],
    });

    const switched = await setDocumentLanguage(doc.documentId, 'python');
    expect(switched.language).toBe('python');
    expect(switched.content).toContain('const mine = 1;');
  });

  it('rejects an unknown language', async () => {
    const doc = await ensureDocument(interviewId, questionId);
    await expect(
      setDocumentLanguage(doc.documentId, 'cobol' as never),
    ).rejects.toThrow(/Unknown language/);
  });

  it('keeps one document per question and one scratch document', async () => {
    const second = await seedQuestion(org.id, admin.id, { title: 'Second question' });
    await prisma.interviewQuestion.create({
      data: { interviewId, questionId: second.id, orderIndex: 1 },
    });

    await ensureDocument(interviewId, questionId);
    await ensureDocument(interviewId, second.id);
    await ensureDocument(interviewId, null);
    await ensureDocument(interviewId, null);

    const docs = await prisma.codeDocument.findMany({ where: { interviewId } });
    expect(docs).toHaveLength(3);
    expect(docs.filter((d) => d.questionId === null)).toHaveLength(1);
  });

  it('refuses a document for a question outside the interview', async () => {
    const detached = await seedQuestion(org.id, admin.id, { title: 'Detached question' });
    await expect(ensureDocument(interviewId, detached.id)).rejects.toThrow(/not part of this interview/);
  });
});
