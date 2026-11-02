import fs from 'node:fs';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { AppError } from '../../middleware/error.js';
import { EXT_MIME } from './images.constants.js';

/**
 * Verifica por magic bytes que el contenido del archivo recién subido
 * corresponde a su extensión. Si no coincide, borra el archivo y lanza 400.
 * Devuelve el MIME confirmado.
 */
export async function assertImageContent(filePath: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();
  const buffer = await fs.promises.readFile(filePath);

  if (ext === '.svg') {
    const head = buffer.subarray(0, 4096).toString('utf8').trimStart().toLowerCase();
    if (!head.startsWith('<?xml') && !head.startsWith('<svg')) {
      throw new AppError(400, 'TIPO_INVALIDO', 'El archivo SVG está vacío o no es válido');
    }
    return 'image/svg+xml';
  }

  const expected = EXT_MIME.get(ext);
  if (!expected) {
    throw new AppError(400, 'TIPO_NO_PERMITIDO', `Extensión no permitida: ${ext || '(ninguna)'}`);
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || detected.mime !== expected) {
    throw new AppError(
      400,
      'TIPO_INVALIDO',
      `El contenido del archivo no corresponde a ${expected}`,
    );
  }
  return detected.mime;
}
