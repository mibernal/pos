import argon2 from 'argon2';

export async function hashPassword(plainPassword: string): Promise<string> {
  return argon2.hash(plainPassword, {
    type: argon2.argon2id,
    timeCost: 3,
    memoryCost: 19456,
    parallelism: 1
  });
}

export async function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return argon2.verify(passwordHash, plainPassword);
}
