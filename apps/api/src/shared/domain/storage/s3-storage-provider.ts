import type { Readable } from 'node:stream';
import {
  S3Client,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { StorageProvider } from './storage-provider.js';

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET_NAME || '';
    if (!this.bucket) {
      throw new Error('S3_BUCKET_NAME is required when using S3 storage provider');
    }

    this.client = new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      },
    });
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<string> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Optional ACL could be provided if making objects public
      },
    });

    await upload.done();
    return key;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  async getUrl(key: string): Promise<string> {
    // Return direct S3 URL or configured CDN
    const domain = process.env.S3_CDN_DOMAIN || `https://${this.bucket}.s3.${process.env.S3_REGION || 'us-east-1'}.amazonaws.com`;
    return `${domain}/${key}`;
  }

  async getStream(key: string): Promise<Readable> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    return response.Body as Readable;
  }
}
