import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { randomUUID } from 'node:crypto';
import Papa from 'papaparse';
import * as xlsx from 'xlsx';

declare module 'fastify' {
  interface FastifyInstance {
    bulkImportQueue: import('bullmq').Queue;
  }
}

const enterpriseBulkImportRowSchema = z.object({
  name: z.string().min(1, 'Nombre es requerido'),
  category: z.string().min(1, 'Categoría es requerida'),
  tax_category: z.enum(['IVA_19', 'IVA_5', 'IVA_0', 'EXEMPT', 'EXCLUDED', 'INC_8']),
  barcode: z.string().optional(),
  price_cents: z.coerce.number().int().min(0, 'El precio debe ser 0 o mayor'),
  active: z.union([z.boolean(), z.string()]).transform(val => {
    if (typeof val === 'string') return val.toLowerCase() === 'true' || val === '1' || val.toLowerCase() === 'sí' || val.toLowerCase() === 'si';
    return val;
  }).default(true),
  stock_to_add: z.coerce.number().int().default(0)
});

export const enterpriseBulkRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // 1. UPLOAD AND PREVIEW
  typedApp.post(
    '/upload',
    {
      preHandler: [app.requirePermissions(['products:manage', 'inventory:adjust'])],
      schema: {
        tags: ['inventory-bulk'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request, reply) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const data = await request.file({ limits: { fileSize: 50 * 1024 * 1024 } });
      if (!data) {
        throw new AppError(400, 'NO_FILE', 'No se ha subido ningún archivo');
      }

      const tenantId = request.auth!.tenantId!;
      const userId = request.auth.userId;
      const fileName = data.filename;
      
      let rawRows: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
      const buffer = await data.toBuffer();

      try {
        if (data.mimetype === 'text/csv' || fileName.endsWith('.csv')) {
          const csvText = buffer.toString('utf-8');
          const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
          rawRows = result.data;
        } else if (
          data.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          data.mimetype === 'application/vnd.ms-excel' ||
          fileName.endsWith('.xlsx') ||
          fileName.endsWith('.xls')
        ) {
          const workbook = xlsx.read(buffer, { type: 'buffer' });
          const firstSheetName = workbook.SheetNames[0] as string;
          const worksheet = workbook.Sheets[firstSheetName]!;
          rawRows = xlsx.utils.sheet_to_json(worksheet);
        } else {
          throw new AppError(400, 'INVALID_FILE_TYPE', 'Solo se permiten archivos CSV o Excel (XLSX)');
        }
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        throw new AppError(400, 'PARSE_ERROR', `Error parseando archivo: ${err.message}`);
      }

      if (rawRows.length === 0) {
        throw new AppError(400, 'EMPTY_FILE', 'El archivo está vacío');
      }

      if (rawRows.length > 50000) {
        throw new AppError(400, 'FILE_TOO_LARGE', 'El límite máximo es de 50.000 filas por importación');
      }

      const validRows: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
      const errors: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        const parsed = enterpriseBulkImportRowSchema.safeParse(row);
        if (parsed.success) {
          validRows.push(parsed.data);
        } else {
          errors.push({
            rowNumber: i + 2, // +1 for 1-index, +1 for header
            rowData: row,
            error: parsed.error.issues.map((e: any) => e.message).join(', ') // eslint-disable-line @typescript-eslint/no-explicit-any
          });
        }
      }

      const jobId = randomUUID();

      await app.db
        .insertInto('bulk_import_jobs')
        .values({
          id: jobId,
          tenant_id: tenantId!,
          user_id: userId,
          file_name: fileName,
          status: 'PENDING',
          total_rows: rawRows.length,
          valid_rows: validRows.length,
          invalid_rows: errors.length,
          processed_rows: 0,
          payload_json: JSON.stringify(validRows) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          errors_json: JSON.stringify(errors.slice(0, 100)) as any // Store max 100 errors to save space
        })
        .execute();

      return reply.code(200).send({
        jobId,
        fileName,
        totalRows: rawRows.length,
        validRows: validRows.length,
        invalidRows: errors.length,
        previewErrors: errors.slice(0, 10),
        previewValid: validRows.slice(0, 5)
      });
    }
  );

  // 2. CONFIRM
  typedApp.post(
    '/:jobId/confirm',
    {
      preHandler: [app.requirePermissions(['products:manage', 'inventory:adjust'])],
      schema: {
        tags: ['inventory-bulk'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          jobId: z.string().uuid()
        }),
        body: z.object({
          branchId: z.string().uuid() // Target branch for inventory adjust
        })
      }
    },
    async (request, reply) => {
      const { jobId } = request.params;
      const { branchId } = request.body;
      const tenantId = request.auth!.tenantId!;

      const job = await app.db
        .selectFrom('bulk_import_jobs')
        .select(['id', 'status'])
        .where('id', '=', jobId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!job) {
        throw new AppError(404, 'JOB_NOT_FOUND', 'El trabajo de importación no existe');
      }

      if (job.status !== 'PENDING') {
        throw new AppError(400, 'INVALID_STATE', `El trabajo no está en estado PENDING (actual: ${job.status})`);
      }

      await app.db
        .updateTable('bulk_import_jobs')
        .set({ status: 'QUEUED' })
        .where('id', '=', jobId)
        .execute();

      await app.bulkImportQueue.add('process-bulk-import', {
        jobId,
        tenantId,
        branchId,
        userId: request.auth!.userId
      });

      return reply.code(200).send({ success: true, status: 'QUEUED' });
    }
  );

  // 3. GET STATUS
  typedApp.get(
    '/:jobId',
    {
      preHandler: [app.requirePermissions(['products:manage'])],
      schema: {
        tags: ['inventory-bulk'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          jobId: z.string().uuid()
        })
      }
    },
    async (request, reply) => {
      const { jobId } = request.params;
      const tenantId = request.auth!.tenantId!;

      const job = await app.db
        .selectFrom('bulk_import_jobs')
        .select([
          'id', 'status', 'file_name', 'total_rows', 'valid_rows', 
          'invalid_rows', 'processed_rows', 'created_at', 'completed_at', 'errors_json'
        ])
        .where('id', '=', jobId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!job) {
        throw new AppError(404, 'JOB_NOT_FOUND', 'El trabajo de importación no existe');
      }

      return reply.code(200).send({
        id: job.id,
        status: job.status,
        fileName: job.file_name,
        totalRows: job.total_rows,
        validRows: job.valid_rows,
        invalidRows: job.invalid_rows,
        processedRows: job.processed_rows,
        createdAt: job.created_at,
        completedAt: job.completed_at,
        errors: job.errors_json
      });
    }
  );
};
