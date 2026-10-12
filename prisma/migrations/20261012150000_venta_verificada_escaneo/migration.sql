-- Bloque 11: venta verificada por escaneo ("Verificar con pistola").
ALTER TABLE "Venta" ADD COLUMN "verificadaPorEscaneo" BOOLEAN NOT NULL DEFAULT false;
