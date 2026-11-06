import { AppError } from '../../middleware/error.js';

export const FOLDERS = ['imgs', 'docs'] as const;
export type Folder = (typeof FOLDERS)[number];

/** Extensión → tipo MIME que aceptamos en subidas. */
export const EXT_MIME = new Map<string, string>([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
]);

export function mimeForExt(ext: string): string | null {
  return EXT_MIME.get(ext.toLowerCase()) ?? null;
}

export function folderFromQuery(query: unknown): Folder {
  const raw = (query as { folder?: unknown } | undefined)?.folder;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const folder = typeof value === 'string' && value.length > 0 ? value : 'imgs';
  if (!(FOLDERS as readonly string[]).includes(folder)) {
    throw new AppError(
      400,
      'FOLDER_INVALIDO',
      `Carpeta inválida: "${folder}". Permitidas: ${FOLDERS.join(', ')}`,
    );
  }
  return folder as Folder;
}

/**
 * Catálogo fijo de imágenes del sitio que el panel puede reemplazar.
 *
 * La clave es estable y está bloqueada: el frontend la usa para pedir la
 * imagen de cada sección. `fallback` es la imagen local que se muestra
 * mientras no haya una subida o si la API no responde. El logo, el sello
 * CONATEL y el favicon quedan fuera a propósito: no se gestionan aquí.
 */
export type SectionImageDefinition = {
  key: string;
  label: string;
  description: string;
  fallback: string;
  defaultAlt: string;
};

export const SECTION_IMAGES: readonly SectionImageDefinition[] = [
  {
    key: 'home-hero',
    label: 'Portada · imagen principal',
    description: 'Imagen grande del hero en la página de inicio.',
    fallback: '/imgs/fondo1.webp',
    defaultAlt: '',
  },
  {
    key: 'home-editorial',
    label: 'Portada · comparación de velocidad',
    description: 'Ilustración que compara velocidad asimétrica y simétrica.',
    fallback: '/imgs/af_asymmetriclvssymmetrical_rounded.gif',
    defaultAlt: 'Comparación animada entre velocidad asimétrica y simétrica',
  },
  {
    key: 'about-nosotros',
    label: 'Nosotros · imagen lateral',
    description: 'Foto del equipo u oficina en la página Nosotros.',
    fallback: '/imgs/nosotros.webp',
    defaultAlt: 'Equipo y oficina de AYR NETWORK',
  },
  {
    key: 'contact-cta',
    label: 'Contacto · imagen lateral',
    description: 'Imagen del panel de contacto en la página Solicitar servicio.',
    fallback: '/imgs/contactanos.JPG',
    defaultAlt: 'Contáctanos: AYR NETWORK',
  },
];

export const SECTION_KEYS: ReadonlySet<string> = new Set(SECTION_IMAGES.map((item) => item.key));

export function isSectionKey(key: string): boolean {
  return SECTION_KEYS.has(key);
}

/** Valida el `:key` de las rutas de secciones y devuelve la definición. */
export function sectionFromParam(value: unknown): SectionImageDefinition {
  const key = String(value);
  const section = SECTION_IMAGES.find((item) => item.key === key);
  if (!section) {
    throw new AppError(
      404,
      'SECCION_NO_ENCONTRADA',
      `Sección desconocida: "${key}". Claves válidas: ${SECTION_IMAGES.map((item) => item.key).join(', ')}`,
    );
  }
  return section;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
