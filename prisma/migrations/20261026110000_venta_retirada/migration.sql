-- «Retirado»: registrar cuándo (y quién) entregó la mercadería de una venta.
-- La venta ya descontó el stock al generarse (VENTA en el ledger): el retiro NO
-- mueve stock, solo separa lo vendido que sigue en el galpón (pendiente de
-- retiro / escaneado = reservado) de lo que ya salió (retirado).

ALTER TABLE "Venta"
  ADD COLUMN "retiradaAt" TIMESTAMP(3),
  ADD COLUMN "retiradaPorId" TEXT;

ALTER TABLE "Venta" ADD CONSTRAINT "Venta_retiradaPorId_fkey" FOREIGN KEY ("retiradaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Coherencia: retirada ⇒ quién; con el escaneo pendiente no se retira.
ALTER TABLE "Venta" ADD CONSTRAINT "venta_retiro_coherente" CHECK (
  ("retiradaAt" IS NULL) = ("retiradaPorId" IS NULL)
);
ALTER TABLE "Venta" ADD CONSTRAINT "venta_retiro_sin_escaneo_pendiente" CHECK (
  "retiradaAt" IS NULL OR "escaneoRemoto" IS DISTINCT FROM 'PENDIENTE'
);

-- Stock reservado / pendiente de retiro por galpón (tarjetas de Stock).
CREATE INDEX "Venta_panelId_depositoId_retiradaAt_idx" ON "Venta"("panelId", "depositoId", "retiradaAt");

-- Congelamiento: el retiro se marca una vez (no se deshace ni se cambia) y una
-- venta anulada no se retira. El resto, igual que antes.
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
  IF OLD."retiradaAt" IS NOT NULL
     AND (NEW."retiradaAt", NEW."retiradaPorId") IS DISTINCT FROM (OLD."retiradaAt", OLD."retiradaPorId") THEN
    RAISE EXCEPTION 'La venta % ya está retirada: el retiro no se modifica', OLD."codigo"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."estado" = 'ANULADA' AND OLD."retiradaAt" IS NULL AND NEW."retiradaAt" IS NOT NULL THEN
    RAISE EXCEPTION 'La venta % está anulada: no se puede marcar como retirada', OLD."codigo"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Histórico: las ventas confirmadas ya se entregaron (si no, todo aparecería
-- como reservado). Las que esperan el escaneo de Charly quedan pendientes.
-- retiradaAt = fecha de la venta marca estos retiros "de migración" (el ledger
-- no los lista: serían un duplicado de la VENTA). Va AL FINAL: el UPDATE deja
-- eventos de triggers diferidos (totales/pagos de Venta) y después de eso
-- Postgres no deja hacer ALTER TABLE en la misma transacción.
UPDATE "Venta"
SET "retiradaAt" = "fecha", "retiradaPorId" = "vendedorId"
WHERE "estado" = 'CONFIRMADA' AND "escaneoRemoto" IS DISTINCT FROM 'PENDIENTE';
