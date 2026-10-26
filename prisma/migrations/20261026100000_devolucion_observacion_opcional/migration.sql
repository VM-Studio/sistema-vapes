-- Devoluciones (A4): la observación pasa a ser opcional y sin mínimo de
-- caracteres (pedido del cliente). La columna sigue NOT NULL: sin observación
-- se guarda texto vacío.

ALTER TABLE "Devolucion" DROP CONSTRAINT "Devolucion_observacion_chk";
ALTER TABLE "Devolucion" ALTER COLUMN "observacion" SET DEFAULT '';
