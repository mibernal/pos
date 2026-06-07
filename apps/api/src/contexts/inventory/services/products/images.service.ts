import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { getStorageProvider } from '../../../../shared/domain/storage/index.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';
import { writeAuditLog } from '../../../../shared/domain/audit/write-audit-log.js';

const storageProvider = getStorageProvider();

export async function processAndUploadProductImage(
  db: FastifyInstance['db'],
  tenantId: string,
  productId: string,
  userId: string,
  fileBuffer: Buffer,
  originalFilename: string
) {
  // Check if product exists and belongs to tenant
  const product = await db
    .selectFrom('products')
    .select(['id', 'branch_id'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', productId)
    .executeTakeFirst();

  if (!product) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  }

  // Use Sharp to process the image: convert to webp, resize if too large, extract metadata
  const image = sharp(fileBuffer);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new AppError(400, 'INVALID_IMAGE', 'El archivo no es una imagen válida');
  }

  const processedBuffer = await image
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }) // Max 1200px
    .webp({ quality: 80 })
    .toBuffer();

  const processedMetadata = await sharp(processedBuffer).metadata();
  
  const imageId = randomUUID();
  const providerType = process.env.STORAGE_PROVIDER === 's3' ? 's3' : 'local';
  const filename = `${imageId}.webp`;
  const storageKey = `tenants/${tenantId}/products/${productId}/${filename}`;
  const mimeType = 'image/webp';
  const sizeBytes = processedBuffer.length;

  // Upload to storage
  await storageProvider.upload(storageKey, processedBuffer, mimeType);

  // Check if it's the first image to make it primary
  const existingImages = await db
    .selectFrom('product_images')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .where('product_id', '=', productId)
    .limit(1)
    .execute();

  const isPrimary = existingImages.length === 0;

  // Save to database
  const createdImage = await db
    .insertInto('product_images')
    .values({
      id: imageId,
      tenant_id: tenantId,
      product_id: productId,
      storage_provider: providerType,
      storage_key: storageKey,
      filename: originalFilename,
      mime_type: mimeType,
      size_bytes: sizeBytes.toString(),
      width: processedMetadata.width,
      height: processedMetadata.height,
      is_primary: isPrimary
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await writeAuditLog(db, {
    tenantId,
    branchId: product.branch_id,
    userId,
    entityType: 'PRODUCT_IMAGE',
    entityId: imageId,
    action: 'PRODUCT_IMAGE_UPLOADED',
    payloadJson: {
      product_id: productId,
      storage_key: storageKey,
      size_bytes: sizeBytes
    }
  });

  return createdImage;
}

export async function setPrimaryProductImage(
  db: FastifyInstance['db'],
  tenantId: string,
  productId: string,
  imageId: string,
  userId: string
) {
  // Validate image belongs to tenant/product
  const image = await db
    .selectFrom('product_images')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .where('product_id', '=', productId)
    .where('id', '=', imageId)
    .executeTakeFirst();

  if (!image) {
    throw new AppError(404, 'IMAGE_NOT_FOUND', 'Imagen no encontrada');
  }

  await db.transaction().execute(async (trx) => {
    // Reset all images for this product
    await trx
      .updateTable('product_images')
      .set({ is_primary: false })
      .where('tenant_id', '=', tenantId)
      .where('product_id', '=', productId)
      .execute();

    // Set the new primary
    await trx
      .updateTable('product_images')
      .set({ is_primary: true })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', imageId)
      .execute();
      
    // Write audit log
    await writeAuditLog(trx, {
      tenantId,
      branchId: null, // we don't have branch context easily here, but it's ok
      userId,
      entityType: 'PRODUCT_IMAGE',
      entityId: imageId,
      action: 'PRODUCT_IMAGE_SET_PRIMARY',
      payloadJson: { product_id: productId }
    });
  });
}

export async function deleteProductImage(
  db: FastifyInstance['db'],
  tenantId: string,
  productId: string,
  imageId: string,
  userId: string
) {
  const image = await db
    .selectFrom('product_images')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('product_id', '=', productId)
    .where('id', '=', imageId)
    .executeTakeFirst();

  if (!image) {
    throw new AppError(404, 'IMAGE_NOT_FOUND', 'Imagen no encontrada');
  }

  // Delete from storage
  await storageProvider.delete(image.storage_key);

  // Delete from DB
  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom('product_images')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', imageId)
      .execute();

    // If we deleted the primary image, randomly assign a new one if available
    if (image.is_primary) {
      const remainingImage = await trx
        .selectFrom('product_images')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('product_id', '=', productId)
        .orderBy('created_at', 'asc')
        .limit(1)
        .executeTakeFirst();

      if (remainingImage) {
        await trx
          .updateTable('product_images')
          .set({ is_primary: true })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', remainingImage.id)
          .execute();
      }
    }

    await writeAuditLog(trx, {
      tenantId,
      branchId: null,
      userId,
      entityType: 'PRODUCT_IMAGE',
      entityId: imageId,
      action: 'PRODUCT_IMAGE_DELETED',
      payloadJson: { product_id: productId, storage_key: image.storage_key }
    });
  });
}

export async function getProductImageStream(
  db: FastifyInstance['db'],
  tenantId: string,
  imageId: string
) {
  const image = await db
    .selectFrom('product_images')
    .select(['storage_key', 'mime_type', 'size_bytes'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', imageId)
    .executeTakeFirst();

  if (!image) {
    throw new AppError(404, 'IMAGE_NOT_FOUND', 'Imagen no encontrada');
  }

  const exists = await storageProvider.exists(image.storage_key);
  if (!exists) {
    throw new AppError(404, 'IMAGE_NOT_FOUND', 'El archivo de imagen no existe en el storage');
  }

  const stream = await storageProvider.getStream(image.storage_key);
  
  return {
    stream,
    mimeType: image.mime_type,
    sizeBytes: parseInt(image.size_bytes, 10)
  };
}
