/**
 * Banco de pruebas de entregabilidad: envía la MISMA plantilla OTP por distintos
 * transportes para aislar qué variable provoca la caída en spam.
 *
 * Escenarios cubiertos (todos con idéntico contenido, cambiando solo el transporte):
 *
 *   A) API de Resend            → línea base (ya sabemos que llega a Inbox)
 *   B) SMTP directo a Resend    → ¿cambia algo frente a la API?
 *   C) SMTP a Stalwart          → aísla el relay de Stalwart (origen del problema)
 *   D) .eml para Thunderbird    → aísla el cliente de origen
 *
 * Uso:
 *   npx tsx utils/send-email-smtp.ts --scenario resend-api --to correo@x.com --code 48291357
 *   npx tsx utils/send-email-smtp.ts --scenario resend-smtp --to correo@x.com --code 48291357
 *   npx tsx utils/send-email-smtp.ts --scenario stalwart --to correo@x.com --code 48291357
 *   npx tsx utils/send-email-smtp.ts --scenario eml --eml /tmp/ayr-otp.eml
 *
 * Credenciales por variable de entorno (nunca en el código):
 *   RESEND_API_KEY   → escenarios resend-api / resend-smtp
 *   STALWART_PASS    → escenario stalwart (STALWART_USER, STALWART_HOST por defecto)
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildOtpEml, GMAIL_CLIP_BYTES } from './email/eml.ts';
import { sendOtpEmail } from './email/email.service.ts';
import { sendViaSmtp } from './email/smtp.ts';

type Scenario = 'resend-api' | 'resend-smtp' | 'stalwart' | 'eml';

const DEFAULTS = {
  resendSmtpHost: 'smtp.resend.com',
  resendSmtpPort: 587,
  stalwartHost: 'mail.ayrnetworxv.ve',
  stalwartPort: 587,
  from: 'AyrNetworx <admin@ayrnetworxv.ve>',
  subject: 'Código de verificación - AyrNetworx',
};

const FLAGS_WITH_VALUE = new Set([
  '--scenario',
  '--to',
  '--code',
  '--name',
  '--expires',
  '--purpose',
  '--subject',
  '--from',
  '--eml',
  '--api-key',
  '--host',
  '--port',
  '--user',
  '--pass',
  '--no-logo',
]);

type Args = {
  scenario: Scenario;
  to: string;
  code: string;
  name: string;
  expires: number;
  purpose: string;
  subject: string;
  from: string;
  emlPath: string | null;
  apiKey: string;
  host: string | null;
  port: number | null;
  user: string | null;
  pass: string | null;
  inlineLogo: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    scenario: 'resend-api',
    to: '',
    code: '48291357',
    name: '',
    expires: 10,
    purpose: 'verificación de tu cuenta',
    subject: DEFAULTS.subject,
    from: DEFAULTS.from,
    emlPath: null,
    apiKey: process.env.RESEND_API_KEY?.trim() ?? '',
    host: null,
    port: null,
    user: null,
    pass: null,
    inlineLogo: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '') continue;
    if (arg === '--no-logo') {
      args.inlineLogo = false;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (!FLAGS_WITH_VALUE.has(arg)) {
      console.error(`[prueba] Flag desconocido: ${arg}`);
      printHelp();
      process.exit(1);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      console.error(`[prueba] Falta el valor de ${arg}`);
      process.exit(1);
    }
    i += 1;
    switch (arg) {
      case '--scenario':
        args.scenario = value as Scenario;
        break;
      case '--to':
        args.to = value;
        break;
      case '--code':
        args.code = value;
        break;
      case '--name':
        args.name = value;
        break;
      case '--expires':
        args.expires = Number.parseInt(value, 10);
        break;
      case '--purpose':
        args.purpose = value;
        break;
      case '--subject':
        args.subject = value;
        break;
      case '--from':
        args.from = value;
        break;
      case '--eml':
        args.emlPath = value;
        break;
      case '--api-key':
        args.apiKey = value;
        break;
      case '--host':
        args.host = value;
        break;
      case '--port':
        args.port = Number.parseInt(value, 10);
        break;
      case '--user':
        args.user = value;
        break;
      case '--pass':
        args.pass = value;
        break;
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
Banco de pruebas de entregabilidad - AYR

  npx tsx utils/send-email-smtp.ts --scenario <escenario> --to <correo> [opciones]

Escenarios:
  resend-api    Envío por la API HTTP de Resend (línea base)
  resend-smtp   Envío por SMTP directo a smtp.resend.com (puerto 587)
  stalwart      Envío por SMTP a mail.ayrnetworxv.ve (puerto 587)
  eml           Genera el .eml para abrir y enviar desde Thunderbird

Opciones:
  --to <correo>        Destinatario (obligario salvo en "eml")
  --code <8 dígitos>   Código OTP
  --name <nombre>      Nombre para el saludo
  --expires <min>      Minutos de validez
  --purpose <texto>    Propósito del código
  --subject <texto>    Asunto
  --from <remitente>   Remitente
  --eml <ruta>         Ruta del .eml a generar (escenario eml)
  --host <host>        Host SMTP (sobrescribe el del escenario)
  --port <puerto>      Puerto SMTP
  --user <usuario>     Usuario SMTP
  --pass <clave>       Clave SMTP (preferible la variable de entorno)
  --no-logo            Omite el logo inline (para medir el peso del texto)
  --help               Esta ayuda

Variables de entorno:
  RESEND_API_KEY   API key de Resend
  STALWART_PASS    Clave del usuario de Stalwart
  STALWART_USER    Usuario de Stalwart (por defecto admin@ayrnetworxv.ve)
`);
}

function reportSize(bytes: number): void {
  const percent = ((bytes / GMAIL_CLIP_BYTES) * 100).toFixed(1);
  console.log(`[prueba] Tamaño del mensaje: ${(bytes / 1024).toFixed(1)} KB (${percent}% del límite de Gmail)`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const template = {
    code: args.code,
    expiresInMinutes: args.expires,
    recipientName: args.name || undefined,
    purpose: args.purpose,
  };

  if (args.scenario === 'eml') {
    const target = path.resolve(args.emlPath ?? 'ayr-otp.eml');
    const { raw, bytes } = buildOtpEml({ ...template, to: args.to || 'destinatario@example.com', inlineLogo: args.inlineLogo });
    fs.writeFileSync(target, raw, 'utf8');
    console.log('[prueba] Archivo .eml generado:');
    console.log(`         Ruta : ${target}`);
    reportSize(bytes);
    console.log('[prueba] Para probarlo desde Thunderbird:');
    console.log('         1) Abre Thunderbird y redacta el mensaje con el mismo asunto/cuerpo.');
    console.log('         2) Adjunta el .eml como contenido o usa "Insertar > Archivo de texto" con el HTML.');
    console.log('         3) Envía y compara los headers con "Mostrar original".');
    return;
  }

  if (!args.to) {
    console.error('[prueba] Falta --to');
    process.exit(1);
  }

  console.log(`[prueba] Escenario: ${args.scenario} → ${args.to}`);

  if (args.scenario === 'resend-api') {
    if (!args.apiKey) {
      console.error('[prueba] Falta RESEND_API_KEY');
      process.exit(1);
    }
    const result = await sendOtpEmail({ ...template, to: args.to, apiKey: args.apiKey, from: args.from, subject: args.subject });
    if (!result.ok) {
      console.error(`[prueba] Error: ${result.error}`);
      process.exit(1);
    }
    console.log(`[prueba] Enviado por API. id: ${result.id}`);
    reportSize(result.htmlBytes);
    return;
  }

  const { raw, bytes } = buildOtpEml({
    ...template,
    to: args.to,
    from: args.from,
    subject: args.subject,
    inlineLogo: args.inlineLogo,
  });
  reportSize(bytes);

  let host: string;
  let port: number;
  let user: string;
  let pass: string;

  if (args.scenario === 'resend-smtp') {
    host = args.host ?? DEFAULTS.resendSmtpHost;
    port = args.port ?? DEFAULTS.resendSmtpPort;
    user = args.user ?? 'resend';
    pass = args.pass ?? args.apiKey;
    if (!pass) {
      console.error('[prueba] Falta RESEND_API_KEY (o --pass)');
      process.exit(1);
    }
  } else {
    host = args.host ?? DEFAULTS.stalwartHost;
    port = args.port ?? DEFAULTS.stalwartPort;
    user = args.user ?? process.env.STALWART_USER?.trim() ?? 'admin@ayrnetworxv.ve';
    pass = args.pass ?? process.env.STALWART_PASS?.trim() ?? '';
    if (!pass) {
      console.error('[prueba] Falta STALWART_PASS (o --pass)');
      process.exit(1);
    }
  }

  const result = await sendViaSmtp({
    host,
    port,
    auth: { user, pass },
    from: args.from,
    to: [args.to],
    message: raw,
  });

  if (!result.ok) {
    console.error(`[prueba] Error (${result.stage}): ${result.error}`);
    process.exit(1);
  }
  console.log(`[prueba] Aceptado por el servidor SMTP ${host}:${port} a las ${new Date().toISOString()}.`);
  console.log('[prueba] OJO: "aceptado" ≠ "entregado". Stalwart encola y reintenta; la entrega puede tardar minutos.');
  console.log('[prueba] Revisa en el destinatario si llegó a Inbox o Spam, y compara "Mostrar original".');
}

await main();
