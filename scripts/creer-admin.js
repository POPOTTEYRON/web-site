// Crée (ou met à jour le mot de passe d') un compte administrateur.
// Usage : npm run admin:creer -- email@exemple.fr
// Le mot de passe est demandé sans être affiché (ou lu dans ADMIN_PASSWORD pour un usage non interactif).
import readline from 'node:readline';
import { hash } from '@node-rs/argon2';
import { upsertAdmin } from '../src/db/repo.js';
import { pool } from '../src/db/pool.js';
import { EMAIL_RE } from '../src/validation.js';

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.startsWith(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const email = String(process.argv[2] ?? '').trim().toLowerCase();
if (!EMAIL_RE.test(email)) { console.error('Usage : npm run admin:creer -- email@exemple.fr'); process.exit(1); }

const password = process.env.ADMIN_PASSWORD ?? await askHidden('Mot de passe (12 caractères minimum) : ');
if (password.length < 12) { console.error('Mot de passe trop court (12 caractères minimum).'); process.exit(1); }

await upsertAdmin(email, await hash(password));
console.log(`Compte administrateur prêt : ${email}`);
await pool.end();
