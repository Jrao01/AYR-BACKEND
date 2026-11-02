import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raíz del backend (AYR-BACKEND/). */
export const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Candidatos para el logo, en orden de prioridad.
 * El primero es el asset local del propio script (self-contained para Docker/CI);
 * los demás son fallbacks para cuando el script corre dentro del monorepo.
 */
const LOGO_CANDIDATES = [
  path.join(BACKEND_ROOT, 'utils', 'email', 'assets', 'ayr-logo-blanco.png'),
  path.resolve(BACKEND_ROOT, '..', 'web', 'public', 'imgs', 'logo_blanco.png'),
  path.join(BACKEND_ROOT, 'uploads', 'imgs', 'logo_blanco.png'),
];

/** Content-ID del logo inline (`<img src="cid:ayr-logo">`). */
export const LOGO_CID = 'ayr-logo';

/** Devuelve la ruta del logo AYR (blanco) o null si no existe en ninguna ubicación. */
export function resolveLogoPath(): string | null {
  for (const candidate of LOGO_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Paleta tomada de web/src/styles/tokens.css + el azul de barra del header (#092745). */
export const COLORS = {
  navy: '#092745',
  navyDeep: '#0a2540',
  accent: '#1f62d4',
  accentHover: '#1e56b0',
  mist: '#edf3f8',
  rule: '#dce4ee',
  slate: '#5a6b80',
  slateLight: '#8a9aad',
  body: '#f2f5f9',
  white: '#ffffff',
  success: '#16a34a',
  successBg: '#f0fdf4',
  successText: '#166534',
} as const;

/** Datos corporativos de AYR NETWORK XV C.A. (fuente: prisma/seed-content.ts). */
export const COMPANY = {
  name: 'AYR NETWORK XV C.A.',
  brand: 'AyrNetworx',
  slogan: '¡Somos tú mejor opción!',
  rif: 'J-505663380',
  conatel: 'Providencia N.º HGST-00876',
  address: 'Av. Bolívar cruce con Girardot, Local N.º 02, Sector Centro, Miranda, estado Carabobo, Zona Postal 2041',
  email: 'ayrnetwork15@gmail.com',
  phone: '0412-0189289',
  website: 'https://ayrnetworxv.ve',
  websiteLabel: 'ayrnetworxv.ve',
} as const;

/** Remitente y reply-to por defecto (dominio verificado en Resend). */
export const MAIL_FROM = 'AyrNetworx <admin@ayrnetworxv.ve>';
export const MAIL_REPLY_TO = 'soporte@ayrnetworxv.ve';
