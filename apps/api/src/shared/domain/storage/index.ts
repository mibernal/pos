import type { StorageProvider } from './storage-provider.js';
import { LocalStorageProvider } from './local-storage-provider.js';
import { S3StorageProvider } from './s3-storage-provider.js';

let providerInstance: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (providerInstance) {
    return providerInstance;
  }

  const providerType = process.env.STORAGE_PROVIDER || 'local';

  if (providerType === 's3') {
    providerInstance = new S3StorageProvider();
  } else {
    providerInstance = new LocalStorageProvider();
  }

  return providerInstance;
}

export type { StorageProvider } from './storage-provider.js';
