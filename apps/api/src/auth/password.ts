// M23 password hashing (ADR-0023): argon2id from node:crypto (Node 24.7+), OWASP baseline
// parameters (19 MiB, 2 passes, 1 lane). Stored as a PHC string so parameters can change later
// without breaking existing hashes.
import { argon2 as argon2Cb, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2 = promisify(argon2Cb);

const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string): Promise<string> {
  const nonce = randomBytes(16);
  const tag = await argon2('argon2id', { message: password, nonce, ...PARAMS });
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${b64(nonce)}$${b64(tag)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** False for a wrong password or a hash this code cannot read. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const m = PHC.exec(stored);
  if (!m) return false;
  const [, memory, passes, parallelism, nonce, hash] = m;
  const expected = Buffer.from(hash ?? '', 'base64');
  const tag = await argon2('argon2id', {
    message: password,
    nonce: Buffer.from(nonce ?? '', 'base64'),
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: expected.length,
  });
  return tag.length === expected.length && timingSafeEqual(tag, expected);
}

/** A hash to verify against when the email is unknown, so both cases take the same time. */
export const dummyHash = hashPassword(randomBytes(12).toString('hex'));

/** Random password for user-cli: 20 characters without look-alikes (about 115 bits). */
export function generatePassword(length = 20): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const out: string[] = [];
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      // rejection sampling keeps every character equally likely
      if (byte < 256 - (256 % alphabet.length) && out.length < length)
        out.push(alphabet[byte % alphabet.length] ?? '');
    }
  }
  return out.join('');
}
