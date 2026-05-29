import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE dian_documents
    ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'INVOICE'
  `.execute(db);

  await sql`
    ALTER TABLE dian_documents
    ADD COLUMN IF NOT EXISTS parent_document_id UUID NULL
  `.execute(db);

  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_dian_documents_document_type'
          AND conrelid = 'dian_documents'::regclass
      ) THEN
        ALTER TABLE dian_documents
        ADD CONSTRAINT ck_dian_documents_document_type
        CHECK (document_type IN ('INVOICE', 'CREDIT_NOTE'));
      END IF;
    END $$
  `.execute(db);

  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_dian_documents_parent_document'
          AND conrelid = 'dian_documents'::regclass
      ) THEN
        ALTER TABLE dian_documents
        ADD CONSTRAINT fk_dian_documents_parent_document
        FOREIGN KEY (parent_document_id) REFERENCES dian_documents (id) ON DELETE SET NULL;
      END IF;
    END $$
  `.execute(db);

  await sql`
    ALTER TABLE dian_documents
    DROP CONSTRAINT IF EXISTS uq_dian_documents_tenant_sale
  `.execute(db);

  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_dian_documents_tenant_sale_type'
          AND conrelid = 'dian_documents'::regclass
      ) THEN
        ALTER TABLE dian_documents
        ADD CONSTRAINT uq_dian_documents_tenant_sale_type
        UNIQUE (tenant_id, sale_id, document_type);
      END IF;
    END $$
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_dian_documents_tenant_sale_type
    ON dian_documents (tenant_id, sale_id, document_type)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS idx_dian_documents_tenant_sale_type
  `.execute(db);

  await sql`
    ALTER TABLE dian_documents
    DROP CONSTRAINT IF EXISTS uq_dian_documents_tenant_sale_type
  `.execute(db);

  await sql`
    DELETE FROM dian_documents
    WHERE document_type = 'CREDIT_NOTE'
  `.execute(db);

  await sql`
    ALTER TABLE dian_documents
    ADD CONSTRAINT uq_dian_documents_tenant_sale UNIQUE (tenant_id, sale_id)
  `.execute(db);

  await sql`
    ALTER TABLE dian_documents
    DROP CONSTRAINT IF EXISTS fk_dian_documents_parent_document
  `.execute(db);

  await sql`
    ALTER TABLE dian_documents
    DROP CONSTRAINT IF EXISTS ck_dian_documents_document_type
  `.execute(db);

  await sql`
    ALTER TABLE dian_documents
    DROP COLUMN IF EXISTS parent_document_id
  `.execute(db);

  await sql`
    ALTER TABLE dian_documents
    DROP COLUMN IF EXISTS document_type
  `.execute(db);
}
