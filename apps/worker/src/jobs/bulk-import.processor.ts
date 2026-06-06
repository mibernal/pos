import { Job } from 'bullmq';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { logWorkerError, logWorkerInfo } from '../infra/logging/worker-log.js';

export interface BulkImportJobData {
  jobId: string;
  tenantId: string;
  branchId: string;
  userId: string;
}

export function buildBulkImportProcessor(pool: Pool) {
  return async function processBulkImport(job: Job<BulkImportJobData>) {
    const { jobId, tenantId, branchId, userId } = job.data;
    
    const res = await pool.query('SELECT payload_json FROM bulk_import_jobs WHERE id = $1 AND tenant_id = $2', [jobId, tenantId]);
    if (res.rowCount === 0) {
      throw new Error(`Job ${jobId} not found`);
    }
    
    const payload = res.rows[0].payload_json;
    if (!Array.isArray(payload)) {
      throw new Error(`Payload is not an array`);
    }
    
    await pool.query('UPDATE bulk_import_jobs SET status = $1 WHERE id = $2', ['PROCESSING', jobId]);
    
    const CHUNK_SIZE = 1000;
    let processed = 0;
    
    try {
      for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
        const chunk = payload.slice(i, i + CHUNK_SIZE);
        
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          
          for (const item of chunk) {
            const productId = randomUUID();
            let existingId: string | null = null;
            
            if (item.barcode) {
              const prod = await client.query('SELECT id FROM products WHERE tenant_id = $1 AND barcode = $2', [tenantId, item.barcode]);
              if (prod.rowCount && prod.rowCount > 0) {
                existingId = prod.rows[0].id;
              }
            } else {
              const prod = await client.query('SELECT id FROM products WHERE tenant_id = $1 AND name = $2', [tenantId, item.name]);
              if (prod.rowCount && prod.rowCount > 0) {
                existingId = prod.rows[0].id;
              }
            }
            
            const targetId = existingId || productId;
            
            if (existingId) {
              await client.query(`
                UPDATE products 
                SET name = $1, category = $2, tax_category = $3, price_cents = $4, active = $5, updated_at = NOW()
                WHERE id = $6
              `, [item.name, item.category, item.tax_category, item.price_cents, item.active, existingId]);
            } else {
              await client.query(`
                INSERT INTO products (id, tenant_id, branch_id, name, category, tax_category, barcode, price_cents, cost_cents, active)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9)
              `, [targetId, tenantId, branchId, item.name, item.category, item.tax_category, item.barcode || null, item.price_cents, item.active]);
            }
            
            if (item.stock_to_add && item.stock_to_add !== 0) {
              const txId = randomUUID();
              await client.query(`
                INSERT INTO inventory_transactions (id, tenant_id, branch_id, product_id, operation, qty_change, notes, created_by_user_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              `, [txId, tenantId, branchId, targetId, item.stock_to_add > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', item.stock_to_add.toString(), 'Carga masiva (CSV)', userId]);
              
              const bal = await client.query('SELECT id FROM inventory_balances WHERE tenant_id = $1 AND branch_id = $2 AND product_id = $3', [tenantId, branchId, targetId]);
              if (bal.rowCount && bal.rowCount > 0) {
                await client.query(`
                  UPDATE inventory_balances SET on_hand_qty = on_hand_qty::numeric + $1::numeric WHERE id = $2
                `, [item.stock_to_add, bal.rows[0].id]);
              } else {
                await client.query(`
                  INSERT INTO inventory_balances (tenant_id, branch_id, product_id, on_hand_qty)
                  VALUES ($1, $2, $3, $4)
                `, [tenantId, branchId, targetId, item.stock_to_add.toString()]);
              }
            }
            
            await client.query(`
              INSERT INTO audit_logs (id, tenant_id, branch_id, user_id, entity_type, entity_id, action, legacy_payload)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [randomUUID(), tenantId, branchId, userId, 'PRODUCT', targetId, existingId ? 'PRODUCT_UPDATED' : 'PRODUCT_CREATED', JSON.stringify({ source: 'BULK_IMPORT', ...item })]);
          }
          
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
        
        processed += chunk.length;
        await pool.query('UPDATE bulk_import_jobs SET processed_rows = $1 WHERE id = $2', [processed, jobId]);
        await job.updateProgress(Math.floor((processed / payload.length) * 100));
      }
      
      await pool.query('UPDATE bulk_import_jobs SET status = $1, completed_at = NOW() WHERE id = $2', ['COMPLETED', jobId]);
      logWorkerInfo({ event: 'bulk_import_completed', message: `Job ${jobId} completed`, details: { processed } });
    } catch (err: any) {
      await pool.query('UPDATE bulk_import_jobs SET status = $1, completed_at = NOW() WHERE id = $2', ['FAILED', jobId]);
      logWorkerError({ event: 'bulk_import_failed', message: `Job ${jobId} failed`, error: err });
      throw err;
    }
  }
}
