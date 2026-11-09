import bcrypt from 'bcryptjs';

/**
 * bcrypt with cost 12. Chosen over argon2 to keep the project free of native
 * build steps; cost is configurable here if the deployment has more CPU budget.
 */
const COST = process.env.NODE_ENV === 'test' ? 4 : 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) return Promise.resolve(false);
  return bcrypt.compare(plain, hash);
}

/**
 * Constant-ish work factor for unknown emails so that login timing does not
 * reveal whether an account exists.
 */
const DUMMY_HASH = bcrypt.hashSync('hirefo-timing-equaliser', COST);

export async function burnPasswordTime(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH);
}
