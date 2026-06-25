-- Script Transaccional: Limpieza de Catálogo (Archivado Lógico)
-- IMPORTANTE: Este script debe ejecutarse con cuidado en el entorno deseado.
-- 
-- Para ejecutar vía psql:
-- psql -h localhost -U pos -d pos_dian -f 2_cleanup.sql

BEGIN;

-- 1. Eliminar datos operativos en vivo (Mesas, Comandas, Cocina)
-- Esto vacía todas las mesas activas para que no queden bloqueadas con productos archivados.
DELETE FROM kitchen_ticket_items;
DELETE FROM kitchen_tickets;
DELETE FROM order_rounds;
DELETE FROM table_orders;
UPDATE tables SET status = 'AVAILABLE', current_order_id = NULL, waiter_id = NULL;

-- 2. Eliminar transferencias y ajustes pendientes (Evita transacciones "fantasma" de productos viejos)
DELETE FROM inventory_transfer_items;
DELETE FROM inventory_transfers;
DELETE FROM purchase_order_items;
DELETE FROM purchase_orders;
DELETE FROM inventory_receipt_items;
DELETE FROM inventory_receipts;
DELETE FROM inventory_adjustment_items;
DELETE FROM inventory_adjustments;
DELETE FROM inventory_count_items;
DELETE FROM inventory_counts;

-- 3. Limpiar stock actual absoluto (Regresa el balance a cero absoluto sin afectar el historial/ledger)
DELETE FROM inventory_balances;

-- 4. Borrar entidades dependientes de productos de forma física
-- Las promociones, imágenes y modificadores no son históricos intocables, se pueden borrar para limpiar peso.
DELETE FROM product_images;
DELETE FROM promotions;

-- 5. Archivar Variantes y Productos Lógicamente
-- IMPORTANTE: No usamos DELETE para preservar llaves foráneas en `sale_items` y `inventory_transactions`.
-- Liberamos el código de barras y cambiamos el nombre para que el usuario pueda reutilizarlos.
UPDATE product_variants 
SET 
  active = false, 
  name = '[ARCHIVADO] ' || name, 
  barcode = NULL, 
  updated_at = NOW()
WHERE active = true OR name NOT LIKE '[ARCHIVADO]%';

UPDATE products 
SET 
  active = false, 
  name = '[ARCHIVADO] ' || name, 
  barcode = NULL, 
  updated_at = NOW()
WHERE active = true OR name NOT LIKE '[ARCHIVADO]%';

-- Terminar exitosamente
COMMIT;
