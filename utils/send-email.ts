/**
 * CLI para enviar el correo OTP de 8 dígitos de AYR vía Resend.
 *
 * Uso:
 *   npx tsx utils/send-email.ts                       # usa la configuración de código
 *   npx tsx utils/send-email.ts --to correo@x.com --code 12345678
 *   npx tsx utils/send-email.ts --dry-run             # genera el HTML y no envía nada
 *   npx tsx utils/send-email.ts --help
 *
 * Nota de seguridad: la API key en el bloque CONFIG es una credencial real.
 * Para no dejarla en el código, define la variable de entorno RESEND_API_KEY
 * (toma precedencia sobre CONFIG.apiKey) y commitea solo .env.example.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GMAIL_CLIP_BYTES, sendOtpEmail } from './email/email.service.ts';
import { LOGO_CID, resolveLogoPath } from './email/brand.ts';
import { renderOtpHtml, renderOtpText } from './email/otp.template.ts';

// ══════════════════════════════════════════════════════════════
//  CONFIGURACIÓN — edita aquí tus datos y ejecuta el script
// ══════════════════════════════════════════════════════════════
const CONFIG = {
  /** API key de Resend (https://resend.com/api-keys). Si está vacía, usa RESEND_API_KEY. */
  apiKey: 're_TU_API_KEY',
  /** Destinatario del correo. */
  to: 'tu_correo@gmail.com',
  /** Código OTP de 8 dígitos. */
  code: '12345678',
  /** Nombre del destinatario (opcional, aparece en el saludo). */
  recipientName: '',
  /** Minutos de validez del código. */
  expiresInMinutes: 10,
  /** Propósito del código (opcional). */
  purpose: 'verificación de identidad',
  /** Botón de acción (opcional). Ej: 'https://ayrnetworxv.ve' */
  actionUrl: '',
  /** Texto del botón de acción (opcional). */
  actionLabel: '',
};
// ══════════════════════════════════════════════════════════════

const FLAGS_WITH_VALUE = new Set([
  '--to',
  '--code',
  '--api-key',
  '--name',
  '--expires',
  '--purpose',
  '--action-url',
  '--action-label',
  '--preview',
]);

type ParsedArgs = {
  to: string;
  code: string;
  apiKey: string;
  recipientName: string;
  expiresInMinutes: number;
  purpose: string;
  actionUrl: string;
  actionLabel: string;
  dryRun: boolean;
  previewPath: string | null;
};

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    to: CONFIG.to,
    code: CONFIG.code,
    apiKey: process.env.RESEND_API_KEY?.trim() || CONFIG.apiKey,
    recipientName: CONFIG.recipientName,
    expiresInMinutes: CONFIG.expiresInMinutes,
    purpose: CONFIG.purpose,
    actionUrl: CONFIG.actionUrl,
    actionLabel: CONFIG.actionLabel,
    dryRun: false,
    previewPath: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '') continue;
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (!FLAGS_WITH_VALUE.has(arg)) {
      console.error(`[email] Flag desconocido: ${arg}`);
      printHelp();
      process.exit(1);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      console.error(`[email] Falta el valor de ${arg}`);
      process.exit(1);
    }
    i += 1;
    switch (arg) {
      case '--to':
        args.to = value;
        break;
      case '--code':
        args.code = value;
        break;
      case '--api-key':
        args.apiKey = value;
        break;
      case '--name':
        args.recipientName = value;
        break;
      case '--expires':
        args.expiresInMinutes = Number.parseInt(value, 10);
        break;
      case '--purpose':
        args.purpose = value;
        break;
      case '--action-url':
        args.actionUrl = value;
        break;
      case '--action-label':
        args.actionLabel = value;
        break;
      case '--preview':
        args.previewPath = value;
        break;
    }
  }

  if (!Number.isFinite(args.expiresInMinutes) || args.expiresInMinutes <= 0) {
    args.expiresInMinutes = CONFIG.expiresInMinutes;
  }

  return args;
}

function printHelp(): void {
  console.log(`
Correo OTP de 8 dígitos - AYR (Resend)

  npx tsx utils/send-email.ts [opciones]

Opciones:
  --to <correo>          Destinatario
  --code <8 dígitos>     Código OTP
  --api-key <re_...>     API key de Resend (o usa RESEND_API_KEY)
  --name <nombre>        Nombre del destinatario (saludo)
  --expires <min>        Minutos de validez (default: ${CONFIG.expiresInMinutes})
  --purpose <texto>      Propósito del código
  --action-url <url>     URL del botón de acción (opcional)
  --action-label <txt>   Texto del botón de acción (opcional)
  --preview <ruta>       Escribe el HTML en esa ruta
  --dry-run              Genera el HTML y NO envía el correo
  -h, --help             Esta ayuda

Edita el bloque CONFIG de utils/send-email.ts para dejar tus valores fijos.
`);
}

/** "12.3 KB / 102 KB (límite de recorte de Gmail)" */
function formatHtmlSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB de ${GMAIL_CLIP_BYTES / 1024} KB (límite de recorte de Gmail)`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const templateData = {
    code: args.code,
    expiresInMinutes: args.expiresInMinutes,
    recipientName: args.recipientName || undefined,
    purpose: args.purpose,
    actionUrl: args.actionUrl || undefined,
    actionLabel: args.actionLabel || undefined,
  };

  if (args.dryRun || args.previewPath) {
    const target = path.resolve(args.previewPath ?? 'otp-preview.html');
    // En la vista previa el logo se referencia por archivo (en el envío real va inline vía cid:).
    const logoPath = resolveLogoPath();
    const html = renderOtpHtml(templateData).replace(
      `cid:${LOGO_CID}`,
      logoPath ? `file://${logoPath}` : '',
    );
    fs.writeFileSync(target, html, 'utf8');
    const textPath = target.replace(/\.html?$/, '.txt');
    fs.writeFileSync(textPath, renderOtpText(templateData), 'utf8');
    console.log(`[email] Vista previa (sin envío):`);
    console.log(`        HTML: ${target}`);
    console.log(`        TXT : ${textPath}`);
    console.log(`        Peso HTML: ${formatHtmlSize(Buffer.byteLength(html, 'utf8'))}`);
    if (!args.dryRun) {
      return;
    }
    console.log('[email] Modo --dry-run: no se envió ningún correo.');
    return;
  }

  if (!args.to || args.to.includes('tu_correo')) {
    console.error('[email] Falta el destinatario. Edítalo en CONFIG o usa --to correo@dominio.com');
    process.exit(1);
  }
  if (!args.apiKey || args.apiKey.includes('TU_API_KEY')) {
    console.error('[email] Falta la API key de Resend. Edítala en CONFIG, usa --api-key o define RESEND_API_KEY.');
    process.exit(1);
  }

  const result = await sendOtpEmail({
    ...templateData,
    to: args.to,
    apiKey: args.apiKey,
  });

  if (!result.ok) {
    console.error(`[email] Error al enviar: ${result.error}`);
    if (result.code) {
      console.error(`[email] Código: ${result.code}${result.status ? ` (HTTP ${result.status})` : ''}`);
    }
    process.exit(1);
  }

  console.log(`[email] Correo enviado correctamente.`);
  console.log(`        id: ${result.id}`);
  console.log(`        to: ${result.to}`);
  console.log(`        Peso HTML: ${formatHtmlSize(result.htmlBytes)}`);
}

await main();
