import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/error.js';
import { EXT_MIME, folderFromQuery } from './images.constants.js';

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      const folder = folderFromQuery(req.query);
      const dir = path.join(env.UPLOAD_DIR, folder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err instanceof Error ? err : new Error(String(err)), '');
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!EXT_MIME.has(ext)) {
      cb(
        new AppError(
          400,
          'TIPO_NO_PERMITIDO',
          `Extensión no permitida: ${ext || '(ninguna)'}. Permitidas: jpg, jpeg, png, webp, gif, svg`,
        ),
      );
      return;
    }
    cb(null, true);
  },
});
