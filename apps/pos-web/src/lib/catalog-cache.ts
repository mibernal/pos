import Dexie, { type Table } from 'dexie';
import type { Customer, ProductItem } from './api';

export class POSDatabase extends Dexie {
  products!: Table<ProductItem, string>;
  customers!: Table<Customer, string>;
  syncMeta!: Table<{ key: string; lastSyncAt: number; branchId?: string }, string>;

  constructor() {
    super('pos-dexie-db');
    this.version(1).stores({
      products: 'id, name, barcode',
      customers: 'id, document_number, name',
      syncMeta: 'key'
    });
  }
}

export const db = new POSDatabase();

export async function getCachedProducts(): Promise<ProductItem[] | null> {
  try {
    const items = await db.products.toArray();
    return items.length > 0 ? items : null;
  } catch (err) {
    console.warn('Failed to read from Dexie products', err);
    return null;
  }
}

export async function setCachedProducts(products: ProductItem[], branchId: string): Promise<void> {
  try {
    await db.transaction('rw', db.products, db.syncMeta, async () => {
      await db.products.clear();
      await db.products.bulkAdd(products);
      await db.syncMeta.put({ key: 'products', lastSyncAt: Date.now(), branchId });
    });
  } catch (err) {
    console.warn('Failed to write to Dexie products', err);
  }
}

export async function getCachedCustomers(): Promise<Customer[] | null> {
  try {
    const items = await db.customers.toArray();
    return items.length > 0 ? items : null;
  } catch (err) {
    console.warn('Failed to read from Dexie customers', err);
    return null;
  }
}

export async function setCachedCustomers(customers: Customer[]): Promise<void> {
  try {
    await db.transaction('rw', db.customers, db.syncMeta, async () => {
      await db.customers.clear();
      await db.customers.bulkAdd(customers);
      await db.syncMeta.put({ key: 'customers', lastSyncAt: Date.now() });
    });
  } catch (err) {
    console.warn('Failed to write to Dexie customers', err);
  }
}

export async function getLastSyncTime(key: 'products' | 'customers', expectedBranchId?: string): Promise<number | null> {
  try {
    const meta = await db.syncMeta.get(key);
    if (!meta) return null;
    if (key === 'products' && expectedBranchId && meta.branchId !== expectedBranchId) {
      return null; // Invalid cache if branch changed
    }
    return meta.lastSyncAt;
  } catch {
    return null;
  }
}
