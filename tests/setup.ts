// Se ejecuta antes de cada archivo de test (antes de que importen la app).
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '50';
process.env.MAX_UPLOAD_MB = '1';
process.env.LOG_LEVEL = 'silent';
