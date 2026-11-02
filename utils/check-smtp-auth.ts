/**
 * Verificación de credenciales SMTP contra un servidor, sin enviar ningún correo.
 * Útil para comprobar qué cuentas existen y qué claves sirven antes de configurar
 * un cliente externo (WispHub, Thunderbird, etc.).
 *
 * Uso:
 *   npx tsx utils/check-smtp-auth.ts --host mail.ayrnetworxv.ve --port 465 \
 *     --user gerencia@ayrnetworxv.ve --pass 'CLAVE'
 *
 *   # Varias cuentas de una vez (formato usuario:clave por línea):
 *   npx tsx utils/check-smtp-auth.ts --host mail.ayrnetworxv.ve --port 465 \
 *     --creds-file /tmp/creds.txt
 */
import fs from 'node:fs';
import { SmtpClient } from './email/smtp.ts';

const FLAGS_WITH_VALUE = new Set(['--host', '--port', '--user', '--pass', '--creds-file']);

type Cred = { user: string; pass: string };

function parseArgs(argv: string[]): { host: string; port: number; creds: Cred[] } {
  let host = 'mail.ayrnetworxv.ve';
  let port = 465;
  let user: string | null = null;
  let pass: string | null = null;
  let credsFile: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (!FLAGS_WITH_VALUE.has(arg)) continue;
    const value = argv[i + 1];
    if (value === undefined) continue;
    i += 1;
    switch (arg) {
      case '--host':
        host = value;
        break;
      case '--port':
        port = Number.parseInt(value, 10);
        break;
      case '--user':
        user = value;
        break;
      case '--pass':
        pass = value;
        break;
      case '--creds-file':
        credsFile = value;
        break;
    }
  }

  const creds: Cred[] = [];
  if (credsFile) {
    for (const line of fs.readFileSync(credsFile, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf(':');
      if (separator === -1) continue;
      creds.push({ user: trimmed.slice(0, separator), pass: trimmed.slice(separator + 1) });
    }
  } else if (user !== null && pass !== null) {
    creds.push({ user, pass });
  }

  return { host, port, creds };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.creds.length === 0) {
    console.error('[auth] Indica --user/--pass o --creds-file');
    process.exit(1);
  }

  for (const cred of args.creds) {
    process.stdout.write(`[auth] ${cred.user} → `);
    try {
      const client = await SmtpClient.connect({
        host: args.host,
        port: args.port,
        auth: { user: cred.user, pass: cred.pass },
        timeoutMs: 12_000,
      });
      client.close();
      console.log('✅ credenciales válidas');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`❌ ${message}`);
    }
  }
}

await main();
