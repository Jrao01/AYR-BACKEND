import { compare, hash } from 'bcryptjs';

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return compare(plain, hashed);
}
