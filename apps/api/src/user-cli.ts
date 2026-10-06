// M23 account management on the server (ADR-0023); there is no web page for it.
//   docker exec -it sbc-noc-api node dist/user-cli.js <command>
// Commands:
//   list
//   add <email> <operator|admin>[,<role>] [--staff STF-01] [--stdin]
//   passwd <email> [--stdin]
//   roles <email> <operator|admin>[,<role>]
//   disable <email> | enable <email>
// add/passwd print a new random password once (hand it to the person). With --stdin the
// password is read from standard input instead (at least 12 characters).
import {
  AccountError,
  createAccount,
  createDbPool,
  listAccounts,
  setAccountActive,
  setAccountPassword,
  setAccountRoles,
  USER_ROLES,
  type UserRole,
} from '@sbc-noc/db';
import { PASSWORD_MIN_LENGTH } from '@sbc-noc/shared';
import { generatePassword, hashPassword } from './auth/password.js';

const ACTOR = 'cli:user-cli';
const USAGE = `usage: user-cli list
       user-cli add <email> <operator|admin>[,...] [--staff STF-01] [--stdin]
       user-cli passwd <email> [--stdin]
       user-cli roles <email> <operator|admin>[,...]
       user-cli disable <email> | enable <email>`;

function parseRoles(raw: string | undefined): UserRole[] {
  const roles = (raw ?? '').split(',').filter(Boolean);
  const bad = roles.filter((r) => !(USER_ROLES as readonly string[]).includes(r));
  if (!roles.length || bad.length) throw new AccountError(`roles: ${USER_ROLES.join(', ')}`);
  return roles as UserRole[];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

/** New password from stdin or generated; returns [hash, password to show or null]. */
async function newPassword(fromStdin: boolean): Promise<[string, string | null]> {
  const password = fromStdin ? await readStdin() : generatePassword();
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AccountError(`password needs at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  return [await hashPassword(password), fromStdin ? null : password];
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const [command, email, third] = args.filter(
  (a, i) => !a.startsWith('--') && args[i - 1] !== '--staff',
);

const url = process.env['DATABASE_URL'];
if (!url || !command) {
  console.error(USAGE);
  process.exit(1);
}

const pool = createDbPool(url);
try {
  switch (command) {
    case 'list': {
      for (const a of await listAccounts(pool)) {
        console.info(
          [
            a.email.padEnd(32),
            a.label === a.email ? '-'.padEnd(8) : a.label.padEnd(8),
            (a.roles.join(',') || '(no role)').padEnd(15),
            a.active ? 'active  ' : 'DISABLED',
            a.hasPassword ? '' : 'no-password',
            a.lastLoginAt ? `last login ${a.lastLoginAt}` : 'never logged in',
          ].join('  '),
        );
      }
      break;
    }
    case 'add': {
      if (!email) throw new AccountError(USAGE);
      const roles = parseRoles(third);
      const [hash, shown] = await newPassword(flag('--stdin'));
      await createAccount(
        pool,
        { email, roles, staffCode: option('--staff') ?? null, passwordHash: hash },
        ACTOR,
      );
      console.info(`created ${email.toLowerCase()} (${roles.join(',')})`);
      if (shown) console.info(`password: ${shown}`);
      break;
    }
    case 'passwd': {
      if (!email) throw new AccountError(USAGE);
      const [hash, shown] = await newPassword(flag('--stdin'));
      await setAccountPassword(pool, email, hash, ACTOR);
      console.info(`password changed for ${email.toLowerCase()}`);
      if (shown) console.info(`password: ${shown}`);
      break;
    }
    case 'roles': {
      if (!email) throw new AccountError(USAGE);
      const roles = parseRoles(third);
      await setAccountRoles(pool, email, roles, ACTOR);
      console.info(`roles of ${email.toLowerCase()}: ${roles.join(',')}`);
      break;
    }
    case 'disable':
    case 'enable': {
      if (!email) throw new AccountError(USAGE);
      await setAccountActive(pool, email, command === 'enable', ACTOR);
      console.info(`${email.toLowerCase()} ${command}d (takes effect on the next request)`);
      break;
    }
    default:
      throw new AccountError(USAGE);
  }
} catch (err) {
  console.error(err instanceof AccountError ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
