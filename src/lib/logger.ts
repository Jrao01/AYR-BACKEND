import { pino } from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["set-cookie"]',
      'res.headers["set-cookie"]',
      'res.headers.set-cookie',
      '*.password',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
    ],
    censor: '[redactado]',
  },
});
