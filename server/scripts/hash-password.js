// Reads a password on stdin and prints its scrypt hash for .env.
// Used by ../../set-password.sh; never echoes the password.
import { hashPassword } from '../auth.js';

const min = Number(process.env.MIN_LENGTH || 12);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  const password = input.replace(/\r?\n$/, '');
  if (password.length < min) {
    console.error(`Password must be at least ${min} characters.`);
    process.exit(1);
  }
  console.log(await hashPassword(password));
});
