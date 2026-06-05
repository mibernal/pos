-- ==========================================
-- SCRIPT DE VALIDACIÓN DE SEGURIDAD (RLS)
-- ==========================================
-- Propósito: Verificar que PostgreSQL bloquea lecturas y escrituras cruzadas
-- entre Tenants, confirmando el Aislamiento RLS en la base de datos real.
-- 
-- Ejecución: psql -U postgres -d pos_db -f apps/api/scripts/verify-rls.sql
-- ==========================================

\set ON_ERROR_STOP on

BEGIN;

DO $$ 
DECLARE 
  tenant_a_id uuid;
  tenant_b_id uuid;
  product_a_id uuid;
  product_b_id uuid;
  count_a integer;
  count_b integer;
BEGIN
  RAISE NOTICE '1. Inicializando datos de prueba...';

  -- Crear dos tenants (bypassando RLS como superuser temporalmente)
  INSERT INTO tenants (name, nit, business_name, email, plan)
  VALUES ('Tenant A RLS Test', 'TEST-A', 'Business A', 'a@test.com', 'PRO')
  RETURNING id INTO tenant_a_id;

  INSERT INTO tenants (name, nit, business_name, email, plan)
  VALUES ('Tenant B RLS Test', 'TEST-B', 'Business B', 'b@test.com', 'PRO')
  RETURNING id INTO tenant_b_id;

  -- Crear productos para cada tenant
  INSERT INTO products (tenant_id, name, type, price_cents, tax_category, status)
  VALUES (tenant_a_id, 'Producto Exclusivo A', 'STANDARD', 1000, 'IVA_19', 'ACTIVE')
  RETURNING id INTO product_a_id;

  INSERT INTO products (tenant_id, name, type, price_cents, tax_category, status)
  VALUES (tenant_b_id, 'Producto Exclusivo B', 'STANDARD', 2000, 'IVA_19', 'ACTIVE')
  RETURNING id INTO product_b_id;

  RAISE NOTICE '2. Cambiando rol a app_api (sujeto a RLS)...';
  -- Cambiamos a un rol que SÍ esté restringido por RLS
  SET ROLE app_api;

  ---------------------------------------------------------
  -- CASO 1: FALLO SEGURO POR DEFECTO (Fail-Closed)
  ---------------------------------------------------------
  RAISE NOTICE '3. Verificando estado Fail-Closed sin app.current_tenant...';
  -- Asegurarnos que no hay tenant seteado
  RESET app.current_tenant;
  
  SELECT count(*) INTO count_a FROM products WHERE id = product_a_id;
  IF count_a > 0 THEN
    RAISE EXCEPTION 'CRÍTICO: Productos expuestos sin app.current_tenant configurado';
  ELSE
    RAISE NOTICE ' ✓ ÉXITO: Lecturas bloqueadas cuando no hay contexto RLS';
  END IF;

  ---------------------------------------------------------
  -- CASO 2: LECTURA AISLADA CORRECTA
  ---------------------------------------------------------
  RAISE NOTICE '4. Verificando aislamiento de lectura (Tenant A)...';
  PERFORM set_config('app.current_tenant', tenant_a_id::text, true);

  -- Leer propio producto
  SELECT count(*) INTO count_a FROM products WHERE id = product_a_id;
  IF count_a != 1 THEN
    RAISE EXCEPTION 'CRÍTICO: Tenant A no puede leer sus propios productos';
  END IF;

  -- Intentar leer producto ajeno (Tenant B)
  SELECT count(*) INTO count_b FROM products WHERE id = product_b_id;
  IF count_b > 0 THEN
    RAISE EXCEPTION 'CRÍTICO: Tenant A PUDO LEER producto del Tenant B';
  ELSE
    RAISE NOTICE ' ✓ ÉXITO: Tenant A no puede leer datos del Tenant B';
  END IF;

  ---------------------------------------------------------
  -- CASO 3: ESCRITURA AISLADA (UPDATE CRUZADO)
  ---------------------------------------------------------
  RAISE NOTICE '5. Verificando protección contra modificaciones (Tenant A modifica Tenant B)...';
  
  -- Intentar actualizar precio del producto B como Tenant A
  UPDATE products SET price_cents = 9999 WHERE id = product_b_id;
  
  -- Volvemos a modo admin para comprobar el precio real
  RESET ROLE;
  SELECT price_cents INTO count_b FROM products WHERE id = product_b_id;
  IF count_b = 9999 THEN
    RAISE EXCEPTION 'CRÍTICO: Tenant A PUDO MODIFICAR producto del Tenant B';
  ELSE
    RAISE NOTICE ' ✓ ÉXITO: El intento de UPDATE cruzado fue bloqueado por RLS (filas afectadas: 0)';
  END IF;

  RAISE NOTICE '=======================================================';
  RAISE NOTICE '✅ AUDITORÍA RLS EXITOSA: Aislamiento estricto verificado';
  RAISE NOTICE '=======================================================';
END $$;

-- Rollback explícito para no dejar basura en la DB
ROLLBACK;
