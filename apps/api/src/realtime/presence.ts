import { PRESENCE_COLORS, type ParticipantRole, type PresenceUser } from '@hirefo/shared';
import { redis } from '../db/redis.js';

/**
 * Presence lives in Redis so it survives a single API process and works when the
 * API is scaled horizontally. One hash per interview; one field per user holding
 * the socket count, so a second tab does not evict the first.
 */
const key = (interviewId: string) => `hirefo:presence:${interviewId}`;
const TTL_SECONDS = 60 * 60 * 12;

interface StoredPresence {
  name: string;
  role: ParticipantRole;
  colorIndex: number;
  sockets: number;
}

export async function addPresence(
  interviewId: string,
  user: { userId: string; name: string; role: ParticipantRole },
): Promise<PresenceUser[]> {
  const client = redis();
  const raw = await client.hget(key(interviewId), user.userId);
  const existing: StoredPresence | null = raw ? (JSON.parse(raw) as StoredPresence) : null;

  const colorIndex =
    existing?.colorIndex ??
    // Deterministic per user so a colour stays stable across reconnects.
    [...user.userId].reduce((acc, ch) => (acc + ch.charCodeAt(0)) % PRESENCE_COLORS.length, 0);

  const next: StoredPresence = {
    name: user.name,
    role: user.role,
    colorIndex,
    sockets: (existing?.sockets ?? 0) + 1,
  };
  await client.hset(key(interviewId), user.userId, JSON.stringify(next));
  await client.expire(key(interviewId), TTL_SECONDS);
  return listPresence(interviewId);
}

export async function removePresence(interviewId: string, userId: string): Promise<PresenceUser[]> {
  const client = redis();
  const raw = await client.hget(key(interviewId), userId);
  if (raw) {
    const stored = JSON.parse(raw) as StoredPresence;
    const sockets = stored.sockets - 1;
    if (sockets <= 0) await client.hdel(key(interviewId), userId);
    else await client.hset(key(interviewId), userId, JSON.stringify({ ...stored, sockets }));
  }
  return listPresence(interviewId);
}

export async function listPresence(interviewId: string): Promise<PresenceUser[]> {
  const entries = await redis().hgetall(key(interviewId));
  return Object.entries(entries)
    .map(([userId, raw]) => {
      const stored = JSON.parse(raw) as StoredPresence;
      return {
        userId,
        name: stored.name,
        role: stored.role,
        colorIndex: stored.colorIndex,
        socketCount: stored.sockets,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Clears stale presence left behind by an unclean shutdown. */
export async function clearPresence(interviewId: string): Promise<void> {
  await redis().del(key(interviewId));
}
