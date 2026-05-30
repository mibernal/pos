import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Añadir columnas tenant_id y branch_id como NULLABLE inicialmente (para poder hacer backfill)

  // purchase_order_items
  await sql`ALTER TABLE purchase_order_items ADD COLUMN tenant_id UUID NULL`.execute(db);
  await sql`ALTER TABLE purchase_order_items ADD COLUMN branch_id UUID NULL`.execute(db);

  // inventory_receipt_items
  await sql`ALTER TABLE inventory_receipt_items ADD COLUMN tenant_id UUID NULL`.execute(db);
  await sql`ALTER TABLE inventory_receipt_items ADD COLUMN branch_id UUID NULL`.execute(db);

  // inventory_transfer_items
  // Los transfers involucran dos branches, por simplicidad a nivel item solo exigiremos tenant_id
  await sql`ALTER TABLE inventory_transfer_items ADD COLUMN tenant_id UUID NULL`.execute(db);

  // inventory_adjustment_items
  await sql`ALTER TABLE inventory_adjustment_items ADD COLUMN tenant_id UUID NULL`.execute(db);
  await sql`ALTER TABLE inventory_adjustment_items ADD COLUMN branch_id UUID NULL`.execute(db);

  // sale_items (ya tiene tenant_id, le falta branch_id)
  await sql`ALTER TABLE sale_items ADD COLUMN branch_id UUID NULL`.execute(db);

  // return_items (ya tiene tenant_id, le falta branch_id)
  await sql`ALTER TABLE return_items ADD COLUMN branch_id UUID NULL`.execute(db);


  // 2. BACKFILL (Llenar los datos consultando a las tablas padres)

  // purchase_order_items
  await sql`
    UPDATE purchase_order_items poi
    SET tenant_id = po.tenant_id,
        branch_id = po.branch_id
    FROM purchase_orders po
    WHERE poi.po_id = po.id
  `.execute(db);

  // inventory_receipt_items
  // Nota: inventory_receipts no tiene branch_id directamente a menos que hagamos un join con PO.
  // Pero inventory_receipts en el schema actual no tiene branch_id? Veamos.
  // inventory_receipts tiene: tenant_id, po_id...
  // Si no tiene branch_id en receipt, backfilleamos de po_id si existe. Si es entrada libre, será nulo o de la sucursal activa.
  // Agregaremos branch_id a inventory_receipts también!
  await sql`ALTER TABLE inventory_receipts ADD COLUMN IF NOT EXISTS branch_id UUID NULL`.execute(db);
  
  await sql`
    UPDATE inventory_receipts ir
    SET branch_id = po.branch_id
    FROM purchase_orders po
    WHERE ir.po_id = po.id
  `.execute(db);

  await sql`
    UPDATE inventory_receipt_items iri
    SET tenant_id = ir.tenant_id,
        branch_id = ir.branch_id
    FROM inventory_receipts ir
    WHERE iri.receipt_id = ir.id
  `.execute(db);

  // inventory_transfer_items
  await sql`
    UPDATE inventory_transfer_items iti
    SET tenant_id = it.tenant_id
    FROM inventory_transfers it
    WHERE iti.transfer_id = it.id
  `.execute(db);

  // inventory_adjustment_items
  await sql`
    UPDATE inventory_adjustment_items iai
    SET tenant_id = ia.tenant_id,
        branch_id = ia.branch_id
    FROM inventory_adjustments ia
    WHERE iai.adjustment_id = ia.id
  `.execute(db);

  // sale_items
  await sql`
    UPDATE sale_items si
    SET branch_id = s.branch_id
    FROM sales s
    WHERE si.sale_id = s.id
  `.execute(db);

  // return_items
  // Las devoluciones no tienen branch_id explícito en sale_returns? Reviso...
  // sale_returns tiene tenant_id, sale_id.
  await sql`ALTER TABLE sale_returns ADD COLUMN IF NOT EXISTS branch_id UUID NULL`.execute(db);
  
  await sql`
    UPDATE sale_returns sr
    SET branch_id = s.branch_id
    FROM sales s
    WHERE sr.sale_id = s.id
  `.execute(db);

  await sql`
    UPDATE return_items ri
    SET branch_id = sr.branch_id
    FROM sale_returns sr
    WHERE ri.return_id = sr.id
  `.execute(db);

  
  // 3. UNIQUE constraints faltantes en padres para permitir FKs compuestas (si no existen)
  // purchase_orders necesita UNIQUE (tenant_id, id)
  await sql`ALTER TABLE purchase_orders ADD CONSTRAINT uq_po_tenant_id UNIQUE (tenant_id, id)`.execute(db);
  // inventory_receipts necesita UNIQUE (tenant_id, id)
  await sql`ALTER TABLE inventory_receipts ADD CONSTRAINT uq_ir_tenant_id UNIQUE (tenant_id, id)`.execute(db);
  // inventory_transfers necesita UNIQUE (tenant_id, id)
  await sql`ALTER TABLE inventory_transfers ADD CONSTRAINT uq_it_tenant_id UNIQUE (tenant_id, id)`.execute(db);
  // inventory_adjustments necesita UNIQUE (tenant_id, id)
  await sql`ALTER TABLE inventory_adjustments ADD CONSTRAINT uq_ia_tenant_id UNIQUE (tenant_id, id)`.execute(db);
  // sale_returns necesita UNIQUE (tenant_id, id)
  await sql`ALTER TABLE sale_returns ADD CONSTRAINT uq_sr_tenant_id UNIQUE (tenant_id, id)`.execute(db);

  // 4. Modificar a NOT NULL y crear Foreign Keys

  // purchase_order_items
  await sql`ALTER TABLE purchase_order_items ALTER COLUMN tenant_id SET NOT NULL`.execute(db);
  await sql`ALTER TABLE purchase_order_items ALTER COLUMN branch_id SET NOT NULL`.execute(db);
  await sql`ALTER TABLE purchase_order_items ADD CONSTRAINT fk_poi_tenant_po FOREIGN KEY (tenant_id, po_id) REFERENCES purchase_orders(tenant_id, id) ON DELETE CASCADE`.execute(db);
  await sql`ALTER TABLE purchase_order_items ADD CONSTRAINT fk_poi_tenant_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT`.execute(db);

  // inventory_receipt_items
  await sql`ALTER TABLE inventory_receipt_items ALTER COLUMN tenant_id SET NOT NULL`.execute(db);
  // (Branch_id podría ser nulo en receipts sin PO por ahora, lo dejaremos NULLABLE si no hay constraint, pero el backend lo debería asegurar)
  await sql`ALTER TABLE inventory_receipt_items ADD CONSTRAINT fk_iri_tenant_receipt FOREIGN KEY (tenant_id, receipt_id) REFERENCES inventory_receipts(tenant_id, id) ON DELETE CASCADE`.execute(db);

  // inventory_transfer_items
  await sql`ALTER TABLE inventory_transfer_items ALTER COLUMN tenant_id SET NOT NULL`.execute(db);
  await sql`ALTER TABLE inventory_transfer_items ADD CONSTRAINT fk_iti_tenant_transfer FOREIGN KEY (tenant_id, transfer_id) REFERENCES inventory_transfers(tenant_id, id) ON DELETE CASCADE`.execute(db);

  // inventory_adjustment_items
  await sql`ALTER TABLE inventory_adjustment_items ALTER COLUMN tenant_id SET NOT NULL`.execute(db);
  await sql`ALTER TABLE inventory_adjustment_items ALTER COLUMN branch_id SET NOT NULL`.execute(db);
  await sql`ALTER TABLE inventory_adjustment_items ADD CONSTRAINT fk_iai_tenant_adjustment FOREIGN KEY (tenant_id, adjustment_id) REFERENCES inventory_adjustments(tenant_id, id) ON DELETE CASCADE`.execute(db);
  await sql`ALTER TABLE inventory_adjustment_items ADD CONSTRAINT fk_iai_tenant_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT`.execute(db);

  // sale_items
  await sql`ALTER TABLE sale_items ALTER COLUMN branch_id SET NOT NULL`.execute(db);
  await sql`ALTER TABLE sale_items ADD CONSTRAINT fk_si_tenant_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT`.execute(db);

  // return_items
  await sql`ALTER TABLE return_items ALTER COLUMN branch_id SET NOT NULL`.execute(db);
  await sql`ALTER TABLE return_items ADD CONSTRAINT fk_ri_tenant_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT`.execute(db);
  

}

export async function down(db: Kysely<unknown>): Promise<void> {
  // En caso de rollback, eliminamos las columnas (y las FK caen en cascada)
  await sql`ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS tenant_id`.execute(db);
  await sql`ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS branch_id`.execute(db);

  await sql`ALTER TABLE inventory_receipt_items DROP COLUMN IF EXISTS tenant_id`.execute(db);
  await sql`ALTER TABLE inventory_receipt_items DROP COLUMN IF EXISTS branch_id`.execute(db);
  await sql`ALTER TABLE inventory_receipts DROP COLUMN IF EXISTS branch_id`.execute(db);

  await sql`ALTER TABLE inventory_transfer_items DROP COLUMN IF EXISTS tenant_id`.execute(db);

  await sql`ALTER TABLE inventory_adjustment_items DROP COLUMN IF EXISTS tenant_id`.execute(db);
  await sql`ALTER TABLE inventory_adjustment_items DROP COLUMN IF EXISTS branch_id`.execute(db);

  await sql`ALTER TABLE sale_items DROP COLUMN IF EXISTS branch_id`.execute(db);

  await sql`ALTER TABLE return_items DROP COLUMN IF EXISTS branch_id`.execute(db);
  await sql`ALTER TABLE sale_returns DROP COLUMN IF EXISTS branch_id`.execute(db);
  
  await sql`ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS uq_po_tenant_id`.execute(db);
  await sql`ALTER TABLE inventory_receipts DROP CONSTRAINT IF EXISTS uq_ir_tenant_id`.execute(db);
  await sql`ALTER TABLE inventory_transfers DROP CONSTRAINT IF EXISTS uq_it_tenant_id`.execute(db);
  await sql`ALTER TABLE inventory_adjustments DROP CONSTRAINT IF EXISTS uq_ia_tenant_id`.execute(db);
  await sql`ALTER TABLE sale_returns DROP CONSTRAINT IF EXISTS uq_sr_tenant_id`.execute(db);
}
