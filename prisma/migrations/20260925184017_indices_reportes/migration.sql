-- DropIndex
DROP INDEX "Venta_usuarioId_idx";

-- CreateIndex
CREATE INDEX "Devolucion_depositoId_fecha_idx" ON "Devolucion"("depositoId", "fecha");

-- CreateIndex
CREATE INDEX "Venta_usuarioId_fecha_idx" ON "Venta"("usuarioId", "fecha");
