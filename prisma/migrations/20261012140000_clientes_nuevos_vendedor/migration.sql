-- =============================================================================
-- CLIENTES NUEVOS BIEN REGISTRADOS (rendimiento por vendedor)
-- =============================================================================
-- - Cliente.creadoPorId: quién lo dio de alta. Cliente.creadoEnVentaId: la venta
--   en la que se dio de alta (una venta crea a lo sumo un cliente).
-- - Venta.clienteNuevo: el cliente se dio de alta con esta venta. Es parte de
--   lo que la venta "fue" y queda inmutable como el resto (trigger de estado).
-- - Backfill: primero el rastro de la auditoría (CREATE Cliente / CREATE Venta
--   con clienteNuevo); después, para lo que no tenga rastro, los clientes cuyo
--   alta coincide (±5 s) con su primera venta.
-- =============================================================================

-- 1. Columnas, índices y FKs ---------------------------------------------------
ALTER TABLE "Cliente"
  ADD COLUMN "creadoEnVentaId" TEXT,
  ADD COLUMN "creadoPorId" TEXT;

ALTER TABLE "Venta" ADD COLUMN "clienteNuevo" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Cliente_creadoEnVentaId_key" ON "Cliente"("creadoEnVentaId");
CREATE INDEX "Cliente_panelId_creadoPorId_createdAt_idx" ON "Cliente"("panelId", "creadoPorId", "createdAt");

ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_creadoPorId_fkey"
  FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_creadoEnVentaId_fkey"
  FOREIGN KEY ("creadoEnVentaId") REFERENCES "Venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- La venta de alta es del mismo panel y del mismo cliente.
CREATE OR REPLACE FUNCTION trg_fn_cliente_creado_en_venta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."creadoEnVentaId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Venta" v
    WHERE v."id" = NEW."creadoEnVentaId" AND v."panelId" = NEW."panelId" AND v."clienteId" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'La venta de alta del cliente % no es suya o es de otro panel', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cliente_creado_en_venta
  BEFORE INSERT OR UPDATE OF "creadoEnVentaId", "panelId" ON "Cliente"
  FOR EACH ROW EXECUTE FUNCTION trg_fn_cliente_creado_en_venta();

-- 2. Backfill -------------------------------------------------------------------
-- 2a. Quién lo cargó: el CREATE de la auditoría.
UPDATE "Cliente" c
SET "creadoPorId" = a."usuarioId"
FROM (
  SELECT DISTINCT ON (al."entidadId") al."entidadId", al."usuarioId"
  FROM "AuditLog" al
  JOIN "Usuario" u ON u."id" = al."usuarioId"
  WHERE al."entidad" = 'Cliente' AND al."accion" = 'CREATE'
  ORDER BY al."entidadId", al."createdAt"
) a
WHERE a."entidadId" = c."id";

-- 2b. Ventas que dieron de alta al cliente según su auditoría.
UPDATE "Venta" v
SET "clienteNuevo" = true
FROM "AuditLog" a
WHERE a."entidad" = 'Venta' AND a."accion" = 'CREATE' AND a."entidadId" = v."id"
  AND (a."datosDespues" ->> 'clienteNuevo') = 'true';

-- 2c. Sin rastro: el alta del cliente coincide con su primera venta.
WITH primera AS (
  SELECT DISTINCT ON (v."clienteId") v."id", v."clienteId", v."createdAt"
  FROM "Venta" v
  ORDER BY v."clienteId", v."createdAt", v."numero"
)
UPDATE "Venta" v
SET "clienteNuevo" = true
FROM primera p
JOIN "Cliente" c ON c."id" = p."clienteId"
WHERE v."id" = p."id" AND NOT v."clienteNuevo"
  AND NOT EXISTS (
    SELECT 1 FROM "Venta" otra WHERE otra."clienteId" = p."clienteId" AND otra."clienteNuevo"
  )
  AND abs(extract(epoch FROM (c."createdAt" - p."createdAt"))) <= 5;

-- 2d. El cliente apunta a su venta de alta y, si no se sabía quién lo cargó, es quien vendió.
WITH alta AS (
  SELECT DISTINCT ON (v."clienteId") v."id", v."clienteId", v."vendedorId"
  FROM "Venta" v
  WHERE v."clienteNuevo"
  ORDER BY v."clienteId", v."createdAt", v."numero"
)
UPDATE "Cliente" c
SET "creadoEnVentaId" = alta."id",
    "creadoPorId" = COALESCE(c."creadoPorId", alta."vendedorId")
FROM alta
WHERE alta."clienteId" = c."id";

-- 3. clienteNuevo es inmutable, como el resto de la venta ------------------------
CREATE OR REPLACE FUNCTION trg_fn_venta_estado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."estado" = 'CONFIRMADA' AND NEW."estado" NOT IN ('CONFIRMADA', 'ANULADA'))
     OR (OLD."estado" = 'ANULADA' AND NEW."estado" <> 'ANULADA') THEN
    RAISE EXCEPTION 'Transición de estado inválida en la venta %: % -> %', OLD."codigo", OLD."estado", NEW."estado"
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."numero", NEW."codigo", NEW."fecha", NEW."clienteId", NEW."depositoId", NEW."vendedorId", NEW."tipo",
      NEW."medioPago", NEW."subtotal", NEW."descuento", NEW."total", NEW."costoTotal", NEW."gananciaBruta",
      NEW."clienteNuevo")
     IS DISTINCT FROM
     (OLD."numero", OLD."codigo", OLD."fecha", OLD."clienteId", OLD."depositoId", OLD."vendedorId", OLD."tipo",
      OLD."medioPago", OLD."subtotal", OLD."descuento", OLD."total", OLD."costoTotal", OLD."gananciaBruta",
      OLD."clienteNuevo") THEN
    RAISE EXCEPTION 'La venta % está %: no se modifica, se anula', OLD."codigo", OLD."estado"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."estado" = 'ANULADA'
     AND (NEW."anuladaPorId", NEW."anuladaAt", NEW."motivoAnulacion")
         IS DISTINCT FROM (OLD."anuladaPorId", OLD."anuladaAt", OLD."motivoAnulacion") THEN
    RAISE EXCEPTION 'Los datos de anulación de la venta % no se modifican', OLD."codigo"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
