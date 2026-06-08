import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import type { StorageProvider } from './storage-provider.js';

export class LocalStorageProvider implements StorageProvider {
  private readonly storageBasePath: string;

  constructor(basePath: string = process.env.STORAGE_LOCAL_PATH || 'storage') {
    this.storageBasePath = path.resolve(process.cwd(), basePath);
  }

  async upload(key: string, body: Buffer, _contentType: string): Promise<string> {
    const fullPath = path.join(this.storageBasePath, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, body);
    return key;
  }

  async delete(key: string): Promise<void> {
    const fullPath = path.join(this.storageBasePath, key);
    try {
      await fs.unlink(fullPath);
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = path.join(this.storageBasePath, key);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async getUrl(key: string): Promise<string> {
    return `/storage/${key}`;
  }

  async getStream(key: string): Promise<Readable> {
    const fullPath = path.join(this.storageBasePath, key);
    return createReadStream(fullPath);
  }
}
