import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Cargar variables de entorno del raíz si existen
const rootEnv = resolve(__dirname, '../../.env');
if (existsSync(rootEnv)) {
  try {
    process.loadEnvFile(rootEnv);
  } catch {
    // Ignorar si ya fueron cargadas
  }
}

const apiEnv = resolve(__dirname, '../.env');
if (existsSync(apiEnv)) {
  try {
    process.loadEnvFile(apiEnv);
  } catch {
    // Ignorar si ya fueron cargadas
  }
}

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-at-least-thirty-two-chars-long';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://pos_api:pos_api@localhost:5432/pos_dian';
process.env.ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL || 'postgres://pos:pos@localhost:5432/pos_dian';
