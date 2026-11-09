import type { z } from 'zod';
import type { createNoteSchema, updateNoteSchema } from '@hirefo/shared';
import { prisma } from '../db/prisma.js';
import { recordAudit } from '../lib/audit.js';
import { forbidden, notFound } from '../lib/errors.js';
import type { Actor } from './questions.js';

type CreateInput = z.infer<typeof createNoteSchema>;
type UpdateInput = z.infer<typeof updateNoteSchema>;

export async function createNote(interviewId: string, input: CreateInput, actor: Actor) {
  const note = await prisma.interviewNote.create({
    data: {
      interviewId,
      authorId: actor.userId,
      questionId: input.questionId ?? null,
      body: input.body,
      isPrivate: input.isPrivate,
    },
    include: { author: { select: { id: true, name: true, avatarColor: true } } },
  });

  await recordAudit({
    action: 'note.create',
    organizationId: actor.organizationId,
    actorId: actor.userId,
    targetType: 'interview_note',
    targetId: note.id,
    metadata: { interviewId, isPrivate: note.isPrivate, questionId: note.questionId },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return note;
}

/**
 * Private notes are visible to interviewers and admins only. A candidate reading
 * their own interview sees shared notes and nothing else.
 */
export async function listNotes(interviewId: string, isStaff: boolean) {
  const notes = await prisma.interviewNote.findMany({
    where: { interviewId, ...(isStaff ? {} : { isPrivate: false }) },
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: { id: true, name: true, avatarColor: true } },
      question: { select: { id: true, title: true } },
    },
  });
  return notes;
}

export async function updateNote(noteId: string, input: UpdateInput, actor: Actor) {
  const note = await prisma.interviewNote.findFirst({
    where: { id: noteId, interview: { organizationId: actor.organizationId } },
    select: { id: true, authorId: true },
  });
  if (!note) throw notFound('Note not found.');
  if (note.authorId !== actor.userId) throw forbidden('You can only edit your own notes.');

  const updated = await prisma.interviewNote.update({
    where: { id: noteId },
    data: {
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.isPrivate !== undefined ? { isPrivate: input.isPrivate } : {}),
    },
    include: { author: { select: { id: true, name: true, avatarColor: true } } },
  });

  await recordAudit({
    action: 'note.update',
    organizationId: actor.organizationId,
    actorId: actor.userId,
    targetType: 'interview_note',
    targetId: noteId,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return updated;
}

export async function deleteNote(noteId: string, actor: Actor): Promise<void> {
  const note = await prisma.interviewNote.findFirst({
    where: { id: noteId, interview: { organizationId: actor.organizationId } },
    select: { id: true, authorId: true },
  });
  if (!note) throw notFound('Note not found.');
  if (note.authorId !== actor.userId) throw forbidden('You can only delete your own notes.');

  await prisma.interviewNote.delete({ where: { id: noteId } });
  await recordAudit({
    action: 'note.delete',
    organizationId: actor.organizationId,
    actorId: actor.userId,
    targetType: 'interview_note',
    targetId: noteId,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
}
