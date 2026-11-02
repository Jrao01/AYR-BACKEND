import { COLORS, COMPANY, LOGO_CID } from './brand.ts';

export type OtpEmailData = {
  /** Código OTP de 8 dígitos. */
  code: string;
  /** Minutos de validez del código. */
  expiresInMinutes: number;
  /** Nombre opcional del destinatario ("Hola, Ana"). */
  recipientName?: string;
  /** Propósito del código, ej. "verificación de identidad". */
  purpose?: string;
  /** URL del botón de acción (opcional). */
  actionUrl?: string;
  /** Texto del botón de acción (opcional). */
  actionLabel?: string;
};

/** Escapa texto plano para interpolarlo en el HTML sin romper el documento. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Normaliza a 8 dígitos; lanza si el formato no es válido. */
export function normalizeOtp(code: string): string {
  const digits = code.replace(/\D/g, '');
  if (digits.length !== 8) {
    throw new Error(`El código OTP debe tener 8 dígitos (recibido: "${code}").`);
  }
  return digits;
}

const GREETING = (name?: string): string =>
  name ? `Hola, ${escapeHtml(name)}:` : 'Hola:';

const STYLES = `
    body { margin: 0 !important; padding: 0 !important; width: 100% !important;
      -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    a { color: ${COLORS.accent}; }
    @media only screen and (max-width: 620px) {
      .shell { width: 100% !important; }
      .pad-x { padding-left: 22px !important; padding-right: 22px !important; }
      .h1 { font-size: 21px !important; line-height: 28px !important; }
      .code { font-size: 30px !important; letter-spacing: 6px !important; padding-left: 6px !important; }
      .code-box { padding: 22px 12px !important; }
      .stack { display: block !important; width: 100% !important; padding-right: 0 !important; }
    }
    @media (prefers-color-scheme: dark) {
      .d-body { background-color: #0b1622 !important; }
      .d-card { background-color: #12202f !important; }
      .d-code { background-color: #16283b !important; border-color: #24425f !important; }
      .d-text { color: #e6edf5 !important; }
      .d-muted { color: #9db0c6 !important; }
    }
`;

/**
 * Plantilla HTML del correo OTP de 8 dígitos.
 * Construida con tablas y estilos inline para máximo alcance
 * (Gmail, Outlook/Word, Yahoo, Apple Mail, Samsung Mail).
 */
export function renderOtpHtml(data: OtpEmailData): string {
  const code = normalizeOtp(data.code);
  const purpose = data.purpose ?? 'verificación de identidad';
  const showAction = Boolean(data.actionUrl && data.actionLabel);

  return `<!DOCTYPE html>
<html lang="es" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Código de verificación - ${COMPANY.brand}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <style>
    table, td, div, p, a { font-family: Arial, Helvetica, sans-serif !important; mso-line-height-rule: exactly; }
    .code { letter-spacing: 8px !important; }
  </style>
  <![endif]-->
  <style>${STYLES}</style>
</head>
<body class="d-body" style="margin:0;padding:0;background-color:${COLORS.body};">
  <!-- Preheader: texto de vista previa en la bandeja de entrada -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">
    Tu código de verificación de ${COMPANY.brand} expira en ${data.expiresInMinutes} minutos.
    &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="d-body" style="background-color:${COLORS.body};">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="shell" style="width:600px;max-width:600px;">

          <!-- ── Cabecera ─────────────────────────────────────────── -->
          <!-- Sin eslogan ni texto promocional: es un correo transaccional -->
          <!-- y el contenido publicitario penaliza la entrega en la bandeja. -->
          <tr>
            <td style="background-color:${COLORS.navy};padding:26px 28px;border-radius:10px 10px 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">
                    <img src="cid:${LOGO_CID}" width="200" alt="${COMPANY.brand}" style="display:block;width:200px;max-width:200px;height:auto;outline:none;text-decoration:none;">
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── Cuerpo ───────────────────────────────────────────── -->
          <tr>
            <td class="d-card pad-x" style="background-color:${COLORS.white};padding:34px 38px 30px;">

              <h1 class="h1 d-text" style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:32px;font-weight:700;color:${COLORS.navyDeep};">
                Código de verificación
              </h1>

              <p class="d-text" style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:${COLORS.slate};">
                ${GREETING(data.recipientName)} usa el siguiente código para completar la ${escapeHtml(purpose)}.
              </p>

              <!-- Código OTP -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="code-box" style="background-color:${COLORS.mist};border:1px solid ${COLORS.rule};border-radius:10px;padding:26px 16px;">
                <tr>
                  <td align="center" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:14px;font-weight:700;letter-spacing:1.4px;color:${COLORS.slate};text-transform:uppercase;">
                    Tu código
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:12px 0 4px;">
                    <div class="code" role="presentation" aria-label="Código de verificación: ${code}" style="font-family:Arial,Helvetica,sans-serif;font-size:38px;line-height:46px;font-weight:700;letter-spacing:10px;color:${COLORS.navy};text-align:center;padding-left:10px;-webkit-user-select:text;user-select:text;">
                      ${code}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:6px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${COLORS.slate};">
                    Expira en ${data.expiresInMinutes} minutos
                  </td>
                </tr>
              </table>

              ${
                showAction
                  ? `
              <!-- Botón (VML para Outlook) -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:26px auto 0;">
                <tr>
                  <td align="center" bgcolor="${COLORS.accent}" style="border-radius:6px;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(data.actionUrl ?? '')}" style="height:46px;v-text-anchor:middle;width:240px;" arcsize="13%" stroke="f" fillcolor="${COLORS.accent}">
                      <w:anchorlock/>
                      <center style="color:${COLORS.white};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;">${escapeHtml(data.actionLabel ?? '')}</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <a href="${escapeHtml(data.actionUrl ?? '')}" style="display:inline-block;padding:14px 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:${COLORS.white};text-decoration:none;border-radius:6px;background-color:${COLORS.accent};">${escapeHtml(data.actionLabel ?? '')}</a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>`
                  : ''
              }

              <!-- Aviso de seguridad -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;background-color:${COLORS.mist};border-radius:8px;border-left:4px solid ${COLORS.accent};">
                <tr>
                  <td style="padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:${COLORS.navyDeep};">
                    <strong>¿No solicitaste este código?</strong> Puede ser un intento de acceso a tu cuenta.
                    Ignora este mensaje y tu cuenta seguirá protegida. Nunca compartas tu código con nadie.
                  </td>
                </tr>
              </table>

              <p class="d-muted" style="margin:24px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:${COLORS.slate};">
                ¿Necesitas ayuda? Escríbenos a
                <a href="mailto:${COMPANY.email}" style="color:${COLORS.accent};text-decoration:underline;">${COMPANY.email}</a>
                o llámanos al <a href="tel:${COMPANY.phone.replace(/^0/, '+58')}" style="color:${COLORS.accent};text-decoration:underline;">${COMPANY.phone}</a>.
              </p>
            </td>
          </tr>

          <!-- ── Pie ──────────────────────────────────────────────── -->
          <tr>
            <td class="d-card" style="background-color:${COLORS.mist};padding:24px 38px;border-radius:0 0 10px 10px;border-top:1px solid ${COLORS.rule};">
              <p class="d-muted" style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:${COLORS.slate};">
                <strong class="d-text" style="color:${COLORS.navyDeep};">${COMPANY.name}</strong><br>
                RIF ${COMPANY.rif} · Habilitación CONATEL ${COMPANY.conatel}
              </p>
              <p class="d-muted" style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:${COLORS.slateLight};">
                ${COMPANY.address}
              </p>
              <p class="d-muted" style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:${COLORS.slateLight};">
                <a href="${COMPANY.website}" style="color:${COLORS.accent};text-decoration:none;">${COMPANY.websiteLabel}</a>
                &nbsp;·&nbsp;
                <a href="${COMPANY.website}/legal" style="color:${COLORS.accent};text-decoration:none;">Términos y Privacidad</a>
              </p>
              <p class="d-muted" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:18px;color:${COLORS.slateLight};">
                © ${new Date().getFullYear()} ${COMPANY.name}. Todos los derechos reservados.
                Este mensaje fue enviado por ${COMPANY.brand} con fines de seguridad de la cuenta.
              </p>
            </td>
          </tr>

        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Versión en texto plano (obligatoria: sin ella, Resend la autogenera mal). */
export function renderOtpText(data: OtpEmailData): string {
  const code = normalizeOtp(data.code);
  const purpose = data.purpose ?? 'verificación de identidad';
  const lines = [
    `${COMPANY.brand} — Código de verificación`,
    '',
    data.recipientName ? `Hola, ${data.recipientName}:` : 'Hola:',
    `Usa el siguiente código para completar la ${purpose}:`,
    '',
    `    ${code}`,
    '',
    `El código expira en ${data.expiresInMinutes} minutos.`,
    '',
    '¿No solicitaste este código? Ignora este mensaje y tu cuenta seguirá protegida.',
    'Nunca compartas tu código con nadie.',
    '',
    `¿Necesitas ayuda? ${COMPANY.email} · ${COMPANY.phone}`,
    '',
    '---',
    `${COMPANY.name} · RIF ${COMPANY.rif}`,
    `Habilitación CONATEL ${COMPANY.conatel}`,
    COMPANY.address,
    COMPANY.website,
  ];

  if (data.actionUrl && data.actionLabel) {
    lines.splice(7, 0, '', `${data.actionLabel}: ${data.actionUrl}`);
  }

  return lines.join('\n');
}
