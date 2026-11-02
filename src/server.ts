import { createApp, closeApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API AYR escuchando');
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Cerrando servidor…');

  const force = setTimeout(() => {
    logger.error('Cierre forzado tras 10 s');
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close(async () => {
    await closeApp();
    logger.info('Servidor cerrado');
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Promesa rechazada sin manejar');
});
