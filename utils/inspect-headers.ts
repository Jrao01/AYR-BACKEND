/**
 * Analiza un correo crudo pegado (salida de "Mostrar original" de Gmail) y
 * resume lo que Gmail/auth verificó: SPF, DKIM, DMARC, lista de firmantes,
 * List-Unsubscribe, IP de salida y presencia de relay por Gmail.
 *
 * Uso:
 *   npx tsx utils/inspect-headers.ts /tmp/headers.txt
 *   cat headers.txt | npx tsx utils/inspect-headers.ts -
 *
 * Sirve para comparar un correo que llega a Inbox (referencia) contra uno que
 * llega a Spam, y aislar qué cambia entre ambos.
 */
import fs from 'node:fs';

type Finding = { label: string; value: string; ok: boolean | null };

function unfold(input: string): string {
  return input.replace(/\r?\n[ \t]+/g, ' ');
}

function pickAll(raw: string, header: string): string[] {
  const pattern = new RegExp(`^${header}:[ \\t]*(.*)$`, 'gim');
  const found: string[] = [];
  let match = pattern.exec(raw);
  while (match) {
    found.push(match[1]!.trim());
    match = pattern.exec(raw);
  }
  return found;
}

function inspect(raw: string): void {
  const findings: Finding[] = [];

  const auth = unfold(pickAll(raw, 'Authentication-Results').join(' | '));
  const spf = /\bspf=(\w+)/.exec(auth)?.[1] ?? null;
  const dmarc = /\bdmarc=(\w+)/.exec(auth)?.[1] ?? null;
  const dkimResults = [...auth.matchAll(/\bdkim=(\w+)\s+header\.i=([^;,\s]+)/g)];

  findings.push({
    label: 'SPF',
    value: spf ?? 'no evaluado',
    ok: spf === 'pass' ? true : spf === null ? null : false,
  });
  findings.push({
    label: 'DKIM',
    value: dkimResults.length
      ? dkimResults.map((m) => `${m[1]} (i=${m[2]})`).join(' | ')
      : 'sin DKIM',
    ok: dkimResults.some((m) => m[1] === 'pass') ? true : dkimResults.length ? false : null,
  });
  findings.push({
    label: 'DMARC',
    value: dmarc ?? 'no evaluado',
    ok: dmarc === 'pass' ? true : dmarc === null ? null : false,
  });

  for (const signature of pickAll(raw, 'DKIM-Signature')) {
    const domain = /d=([^;\s]+)/.exec(signature)?.[1] ?? '?';
    const selector = /s=([^;\s]+)/.exec(signature)?.[1] ?? '?';
    findings.push({ label: `Firma DKIM`, value: `d=${domain} s=${selector}`, ok: null });
  }

  const returnPath = pickAll(raw, 'Return-Path')[0]?.replace(/[<>]/g, '') ?? null;
  findings.push({ label: 'Return-Path', value: returnPath ?? 'ausente', ok: null });

  const from = pickAll(raw, 'From')[0] ?? null;
  findings.push({ label: 'From', value: from ?? 'ausente', ok: null });

  const listUnsubscribe = pickAll(raw, 'List-Unsubscribe');
  findings.push({
    label: 'List-Unsubscribe',
    value: listUnsubscribe[0] ? 'presente' : 'AUSENTE (Google lo exige para bulk)',
    ok: listUnsubscribe.length ? true : false,
  });

  const received = pickAll(raw, 'Received');
  const gmailHops = received.filter((line) => /by \d{4}:a05:|\bgmail\b|mail\.google\.com/i.test(line));
  findings.push({
    label: 'Saltos por Gmail',
    value: gmailHops.length ? `${gmailHops.length} (⚠ penaliza)` : '0 (directo)',
    ok: gmailHops.length ? false : true,
  });

  const outgoingIp = pickAll(raw, 'X-Originating-IP')
    .concat(pickAll(raw, 'X-SES-Outgoing'))
    .join(' | ');
  findings.push({ label: 'IP/cliente de salida', value: outgoingIp || 'no declarada', ok: null });

  const contentTypes = pickAll(raw, 'Content-Type').filter((v) => /multipart|text\//.test(v));
  findings.push({
    label: 'Estructura MIME',
    value: contentTypes.length ? `${contentTypes.length} parte(s): ${contentTypes.map((v) => v.split(';')[0]).join(' + ')}` : 'no declarada',
    ok: null,
  });

  const hasTextPart = /text\/plain/i.test(contentTypes.join(' '));
  findings.push({
    label: 'Parte texto plano',
    value: hasTextPart ? 'sí' : 'NO (HTML solo = señal de spam)',
    ok: hasTextPart ? true : false,
  });

  const originalId = pickAll(raw, 'X-Gmail-Original-Message-ID');
  findings.push({
    label: 'X-Gmail-Original-Message-ID',
    value: originalId.length ? `PRESENTE (${originalId[0]})` : 'ausente (correcto)',
    ok: originalId.length ? false : true,
  });

  console.log('\n=== Diagnóstico de headers ===\n');
  for (const finding of findings) {
    const mark = finding.ok === true ? '✅' : finding.ok === false ? '❌' : 'ℹ️ ';
    console.log(`${mark} ${finding.label.padEnd(26)} ${finding.value}`);
  }

  const failures = findings.filter((f) => f.ok === false);
  console.log('');
  if (failures.length === 0) {
    console.log('Sin fallos evidentes en la autenticación. Si cae en spam, la causa probable es');
    console.log('volumen/reputación del dominio o el contenido, no los headers.');
  } else {
    console.log(`Fallos detectados: ${failures.map((f) => f.label).join(', ')}`);
    console.log('Cada fallo listado es un factor conocido que Gmail usa para decidir spam.');
  }
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error('[headers] Indica la ruta del archivo o "-" para stdin');
    process.exit(1);
  }
  const raw = target === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(target, 'utf8');
  if (!raw.trim()) {
    console.error('[headers] El archivo está vacío');
    process.exit(1);
  }
  inspect(unfold(raw));
}

await main();