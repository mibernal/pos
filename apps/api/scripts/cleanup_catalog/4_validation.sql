-- Script para Validar la Integridad Post-Limpieza
-- Ejecutar y revisar que las cuentas sean 0 en operativas y que los productos estén inactivos.

SELECT 'Mesas Ocupadas' as Metrica, COUNT(*) as Valor FROM table_orders
UNION ALL
SELECT 'Comandas Cocina Pendientes', COUNT(*) FROM kitchen_tickets
UNION ALL
SELECT 'Stock General (Debe ser 0)', COUNT(*) FROM inventory_balances
UNION ALL
SELECT 'Ventas Históricas (No debe ser 0)', COUNT(*) FROM sales
UNION ALL
SELECT 'Items de Venta (No debe ser 0)', COUNT(*) FROM sale_items
UNION ALL
SELECT 'Productos Activos (Debe ser 0)', COUNT(*) FROM products WHERE active = true
UNION ALL
SELECT 'Productos Archivados', COUNT(*) FROM products WHERE active = false;
