-- =============================================================================
-- REFORMA R2: CATÁLOGO SIMPLIFICADO, PRECIOS POR PROVEEDOR Y COMPRAS POR SABOR
--
-- Producto = marca + modelo + especificación ("Elf Bar" + "BC" + "5000"), con
-- precio de venta único para todos sus sabores; Variante = sabor, con precio
-- propio opcional y el costo de la última compra. ProveedorProducto guarda
-- qué vende cada proveedor y a cuánto. CompraItem lleva el producto
-- desnormalizado.
--
-- Datos existentes:
--  - productos sin marca → marca "Sin marca" de su panel;
--  - el modelo pierde el prefijo repetido de la marca ("Elf Bar BC5000" con
--    marca "Elf Bar" → modelo "BC5000");
--  - precio del producto = el precio de sabor más frecuente (empate: el
--    mayor); los sabores con ese precio quedan en null ("usa el del producto");
--  - precioCosto → ultimoCosto (mismo valor);
--  - proveedores: el nombre pasa también a nombreTienda; CUIT, email y
--    dirección se conservan en las notas antes de borrar esas columnas.
-- =============================================================================

CREATE TYPE "Moneda" AS ENUM ('ARS', 'USD');

-- -----------------------------------------------------------------------------
-- 1. Producto
-- -----------------------------------------------------------------------------

-- La regla "sin variantes = una sola variante Único" desaparece: todo producto
-- tiene al menos una variante (sabor).
CREATE OR REPLACE FUNCTION fn_verificar_variantes_producto(p_producto_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_producto "Producto"%ROWTYPE;
  v_cantidad integer;
BEGIN
  SELECT * INTO v_producto FROM "Producto" WHERE "id" = p_producto_id;
  IF NOT FOUND OR v_producto."deletedAt" IS NOT NULL THEN
    RETURN;
  END IF;
  SELECT COUNT(*) INTO v_cantidad FROM "Variante"
  WHERE "productoId" = p_producto_id AND "deletedAt" IS NULL;
  IF v_cantidad = 0 THEN
    RAISE EXCEPTION 'El producto "%" debe tener al menos un sabor (variante)', v_producto."nombre"
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- Marca obligatoria: "Sin marca" por panel para los productos que no tenían.
INSERT INTO "Marca" ("id", "panelId", "nombre", "updatedAt")
SELECT 'marca_sin_' || p."panelId", p."panelId", 'Sin marca', CURRENT_TIMESTAMP
FROM "Producto" p
WHERE p."marcaId" IS NULL
GROUP BY p."panelId"
ON CONFLICT ("panelId", "nombre") DO NOTHING;

UPDATE "Producto" p SET "marcaId" = m."id"
FROM "Marca" m
WHERE p."marcaId" IS NULL AND m."panelId" = p."panelId" AND m."nombre" = 'Sin marca';

ALTER TABLE "Producto"
  ADD COLUMN "especificacion" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "especificacionNorm" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "nombreCompleto" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "precioVenta" DECIMAL(12,2);

-- Modelo sin el prefijo repetido de la marca.
UPDATE "Producto" p
SET "nombre" = btrim(substr(p."nombre", length(m."nombre") + 1))
FROM "Marca" m
WHERE m."id" = p."marcaId"
  AND lower(p."nombre") LIKE lower(m."nombre") || ' %'
  AND btrim(substr(p."nombre", length(m."nombre") + 1)) <> '';

-- Precio del producto: el precio de sabor más frecuente (empate: el mayor).
UPDATE "Producto" p SET "precioVenta" = x.precio
FROM (
  SELECT DISTINCT ON ("productoId") "productoId", "precioVenta" AS precio
  FROM "Variante"
  WHERE "deletedAt" IS NULL
  GROUP BY "productoId", "precioVenta"
  ORDER BY "productoId", COUNT(*) DESC, "precioVenta" DESC
) x
WHERE x."productoId" = p."id";
-- Productos con todos sus sabores dados de baja: el precio del último sabor.
UPDATE "Producto" p SET "precioVenta" = COALESCE(
  (SELECT MAX(v."precioVenta") FROM "Variante" v WHERE v."productoId" = p."id"), 0)
WHERE p."precioVenta" IS NULL;

-- Los triggers diferidos se verifican ya: un ALTER TABLE no admite eventos pendientes.
SET CONSTRAINTS ALL IMMEDIATE;
-- El trigger de "producto con variantes" miraba tieneVariantes: ahora mira solo deletedAt.
DROP TRIGGER trg_producto_variantes ON "Producto";
CREATE CONSTRAINT TRIGGER trg_producto_variantes
  AFTER INSERT OR UPDATE OF "deletedAt" ON "Producto"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_fn_verificar_variantes();
ALTER TABLE "Producto"
  ALTER COLUMN "precioVenta" SET NOT NULL,
  ALTER COLUMN "categoriaId" DROP NOT NULL,
  ALTER COLUMN "marcaId" SET NOT NULL,
  DROP COLUMN "descripcion",
  DROP COLUMN "tieneVariantes",
  ADD CONSTRAINT "Producto_precioVenta_chk" CHECK ("precioVenta" >= 0);

-- nombreCompleto y especificacionNorm: los mantiene la DB (nunca la app).
-- La marca "Sin marca" no aparece en el nombre completo.
CREATE OR REPLACE FUNCTION trg_fn_producto_derivados() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_marca text;
BEGIN
  SELECT NULLIF("nombre", 'Sin marca') INTO v_marca FROM "Marca" WHERE "id" = NEW."marcaId";
  NEW."especificacion" := btrim(regexp_replace(coalesce(NEW."especificacion", ''), '\s+', ' ', 'g'));
  NEW."nombre" := btrim(regexp_replace(NEW."nombre", '\s+', ' ', 'g'));
  NEW."especificacionNorm" := lower(regexp_replace(NEW."especificacion", '\s+', '', 'g'));
  NEW."nombreCompleto" := btrim(regexp_replace(
    concat_ws(' ', v_marca, NEW."nombre", NULLIF(NEW."especificacion", '')), '\s+', ' ', 'g'));
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_producto_derivados BEFORE INSERT OR UPDATE ON "Producto"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_producto_derivados();

-- Renombrar una marca actualiza el nombre completo de sus productos.
CREATE OR REPLACE FUNCTION trg_fn_marca_renombrada() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Producto" SET "nombreCompleto" = "nombreCompleto" WHERE "marcaId" = NEW."id";
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_marca_renombrada AFTER UPDATE OF "nombre" ON "Marca"
  FOR EACH ROW WHEN (OLD."nombre" IS DISTINCT FROM NEW."nombre")
  EXECUTE FUNCTION trg_fn_marca_renombrada();

-- Calcula los derivados de las filas existentes (dispara el trigger).
UPDATE "Producto" SET "nombre" = "nombre";
SET CONSTRAINTS ALL IMMEDIATE;

DROP INDEX "Producto_panelId_nombre_marcaId_key";
DROP INDEX "producto_nombre_trgm";
CREATE UNIQUE INDEX "Producto_panelId_marcaId_nombre_especificacionNorm_key"
  ON "Producto"("panelId", "marcaId", "nombre", "especificacionNorm");
CREATE INDEX "producto_nombre_completo_trgm" ON "Producto" USING GIN ("nombreCompleto" gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 2. Variante: precio propio opcional y último costo
-- -----------------------------------------------------------------------------

ALTER TABLE "Variante" RENAME COLUMN "precioCosto" TO "ultimoCosto";
ALTER TABLE "Variante" RENAME CONSTRAINT "Variante_precioCosto_chk" TO "Variante_ultimoCosto_chk";
ALTER TABLE "Variante"
  ALTER COLUMN "ultimoCosto" DROP NOT NULL,
  ALTER COLUMN "precioVenta" DROP NOT NULL;

UPDATE "Variante" v SET "precioVenta" = NULL
FROM "Producto" p
WHERE p."id" = v."productoId" AND v."precioVenta" = p."precioVenta";
SET CONSTRAINTS ALL IMMEDIATE;

DROP INDEX "Variante_productoId_nombre_key";
CREATE UNIQUE INDEX "Variante_panelId_productoId_nombre_key" ON "Variante"("panelId", "productoId", "nombre");

-- -----------------------------------------------------------------------------
-- 3. Proveedor
-- -----------------------------------------------------------------------------

ALTER TABLE "Proveedor" ADD COLUMN "nombreTienda" TEXT;
UPDATE "Proveedor" SET
  "nombreTienda" = "nombre",
  "notas" = NULLIF(concat_ws(E'\n', "notas",
    CASE WHEN "cuit" IS NOT NULL THEN 'CUIT: ' || "cuit" END,
    CASE WHEN "email" IS NOT NULL THEN 'Email: ' || "email" END,
    CASE WHEN "direccion" IS NOT NULL THEN 'Dirección: ' || "direccion" END), '');

-- Teléfono normalizado (+54 + dígitos) y único por panel entre los vigentes.
UPDATE "Proveedor" SET "telefono" = fn_normalizar_telefono("telefono") WHERE "telefono" IS NOT NULL;
WITH dup AS (
  SELECT "id", "telefono",
         row_number() OVER (PARTITION BY "panelId", "telefono" ORDER BY "createdAt", "id") AS n
  FROM "Proveedor"
  WHERE "telefono" IS NOT NULL AND "deletedAt" IS NULL
)
UPDATE "Proveedor" p
SET "notas" = concat_ws(E'\n', p."notas", 'Teléfono (repetido con otro proveedor): ' || dup."telefono"),
    "telefono" = NULL
FROM dup
WHERE dup."id" = p."id" AND dup.n > 1;
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE "Proveedor"
  ALTER COLUMN "nombreTienda" SET NOT NULL,
  DROP COLUMN "cuit",
  DROP COLUMN "email",
  DROP COLUMN "direccion",
  ADD CONSTRAINT "Proveedor_nombreTienda_chk" CHECK (btrim("nombreTienda") <> ''),
  ADD CONSTRAINT "Proveedor_telefono_chk" CHECK ("telefono" IS NULL OR "telefono" ~ '^\+54[0-9]{6,13}$');

CREATE UNIQUE INDEX proveedor_telefono_unico ON "Proveedor" ("panelId", "telefono")
  WHERE "telefono" IS NOT NULL AND "deletedAt" IS NULL;
CREATE INDEX "Proveedor_panelId_nombreTienda_idx" ON "Proveedor"("panelId", "nombreTienda");

-- -----------------------------------------------------------------------------
-- 4. ProveedorProducto
-- -----------------------------------------------------------------------------

CREATE TABLE "ProveedorProducto" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL DEFAULT current_setting('app.panel_id'::text, true),
    "proveedorId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "precio" DECIMAL(12,2) NOT NULL,
    "moneda" "Moneda" NOT NULL DEFAULT 'ARS',
    "actualizadoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProveedorProducto_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProveedorProducto_precio_chk" CHECK ("precio" >= 0)
);
CREATE INDEX "ProveedorProducto_panelId_productoId_precio_idx" ON "ProveedorProducto"("panelId", "productoId", "precio");
CREATE UNIQUE INDEX "ProveedorProducto_panelId_proveedorId_productoId_key" ON "ProveedorProducto"("panelId", "proveedorId", "productoId");
ALTER TABLE "ProveedorProducto" ADD CONSTRAINT "ProveedorProducto_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProveedorProducto" ADD CONSTRAINT "ProveedorProducto_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProveedorProducto" ADD CONSTRAINT "ProveedorProducto_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProveedorProducto" ADD CONSTRAINT "ProveedorProducto_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER trg_panel_proveedor_producto BEFORE INSERT OR UPDATE OF "panelId", "proveedorId", "productoId" ON "ProveedorProducto"
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_mismo_panel('proveedorId', 'Proveedor', 'productoId', 'Producto');

-- Precios de proveedor iniciales: el último costo pagado en compras recibidas.
INSERT INTO "ProveedorProducto" ("id", "panelId", "proveedorId", "productoId", "precio", "actualizadoAt", "usuarioId")
SELECT DISTINCT ON (c."proveedorId", v."productoId")
  'pp_' || md5(c."proveedorId" || v."productoId"), c."panelId", c."proveedorId", v."productoId",
  ci."costoUnitario", c."fecha", c."usuarioId"
FROM "CompraItem" ci
JOIN "Compra" c ON c."id" = ci."compraId"
JOIN "Variante" v ON v."id" = ci."varianteId"
WHERE c."estado" = 'RECIBIDA' AND c."proveedorId" IS NOT NULL
ORDER BY c."proveedorId", v."productoId", c."fecha" DESC;

-- -----------------------------------------------------------------------------
-- 5. CompraItem: producto desnormalizado (= variante.productoId)
-- -----------------------------------------------------------------------------

ALTER TABLE "CompraItem" ADD COLUMN "productoId" TEXT;
ALTER TABLE "CompraItem" DISABLE TRIGGER USER;
UPDATE "CompraItem" ci SET "productoId" = v."productoId" FROM "Variante" v WHERE v."id" = ci."varianteId";
ALTER TABLE "CompraItem" ENABLE TRIGGER USER;
ALTER TABLE "CompraItem" ALTER COLUMN "productoId" SET NOT NULL;
CREATE INDEX "CompraItem_panelId_productoId_idx" ON "CompraItem"("panelId", "productoId");
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION trg_fn_compra_item_producto() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Variante" WHERE "id" = NEW."varianteId" AND "productoId" = NEW."productoId") THEN
    RAISE EXCEPTION 'CompraItem.productoId no corresponde a la variante %', NEW."varianteId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_compra_item_producto BEFORE INSERT OR UPDATE OF "varianteId", "productoId" ON "CompraItem"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_compra_item_producto();

-- -----------------------------------------------------------------------------
-- 6. Vistas con el nombre completo del producto
-- -----------------------------------------------------------------------------

DROP VIEW vw_stock_consolidado;
DROP VIEW vw_alertas_stock;

CREATE VIEW vw_stock_consolidado AS
SELECT
  v."panelId"        AS panel_id,
  p."id"             AS producto_id,
  p."nombreCompleto" AS producto,
  v."id"             AS variante_id,
  v."nombre"         AS variante,
  v."sku"            AS sku,
  v."codigoBarras"   AS codigo_barras,
  v."stockMinimo"    AS stock_minimo,
  COALESCE(SUM(s."cantidad"), 0)::integer AS total,
  COALESCE(
    jsonb_object_agg(s."depositoId", s."cantidad") FILTER (WHERE s."depositoId" IS NOT NULL),
    '{}'::jsonb
  ) AS por_deposito
FROM "Variante" v
JOIN "Producto" p ON p."id" = v."productoId"
LEFT JOIN "Stock" s ON s."varianteId" = v."id"
WHERE v."deletedAt" IS NULL AND p."deletedAt" IS NULL
GROUP BY v."panelId", p."id", p."nombreCompleto", v."id", v."nombre", v."sku", v."codigoBarras", v."stockMinimo";

CREATE VIEW vw_alertas_stock AS
SELECT
  v."panelId"        AS panel_id,
  p."id"             AS producto_id,
  p."nombreCompleto" AS producto,
  v."id"             AS variante_id,
  v."nombre"         AS variante,
  v."sku",
  v."codigoBarras"   AS codigo_barras,
  v."stockMinimo"    AS stock_minimo,
  t.total            AS stock_total,
  v."stockMinimo" - t.total AS faltante
FROM "Variante" v
JOIN "Producto" p ON p."id" = v."productoId"
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(s."cantidad"), 0)::integer AS total FROM "Stock" s WHERE s."varianteId" = v."id"
) t
WHERE v."deletedAt" IS NULL AND v."activo" AND p."deletedAt" IS NULL AND p."activo"
  AND t.total < v."stockMinimo";
