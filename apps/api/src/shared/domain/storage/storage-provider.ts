import type { Readable } from 'node:stream';

export interface StorageProvider {
  /**
   * Uploads a file buffer to storage.
   * @param key Unique key/path for the file
   * @param body The file buffer
   * @param contentType MIME type of the file
   */
  upload(key: string, body: Buffer, contentType: string): Promise<string>;

  /**
   * Deletes a file from storage.
   * @param key The storage key of the file
   */
  delete(key: string): Promise<void>;

  /**
   * Checks if a file exists in storage.
   * @param key The storage key of the file
   */
  exists(key: string): Promise<boolean>;

  /**
   * Gets a direct or signed URL to access the file, if supported.
   * @param key The storage key
   */
  getUrl(key: string): Promise<string>;

  /**
   * Gets a readable stream for the file.
   * @param key The storage key
   */
  getStream(key: string): Promise<Readable>;
}
