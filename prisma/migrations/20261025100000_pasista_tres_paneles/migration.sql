-- Bloque B (A3): módulo Pasista en los tres paneles (vapes, cosmetic, especiales).
-- Solo datos, sin cambios de esquema. Idempotente: se puede correr de nuevo sin efecto.

-- 1) Configuración "compras" (% de comisión del pasista que propone cada compra
--    nueva) explícita en cada panel que todavía no la tiene: el mismo 10 % que
--    el sistema ya usaba por defecto (COMISION_PASISTA_DEFAULT), ahora visible
--    y editable en Configuración → Ventas y compras de cada panel.
INSERT INTO "Configuracion" ("id", "panelId", "clave", "valor", "updatedAt")
SELECT 'cfg_compras_' || p."id", p."id", 'compras',
       jsonb_build_object('comisionPasistaPorcentajeDefault', 10), CURRENT_TIMESTAMP
FROM "Panel" p
WHERE NOT EXISTS (
  SELECT 1 FROM "Configuracion" c WHERE c."panelId" = p."id" AND c."clave" = 'compras'
);

-- 2) Comisión ORIGINAL (PENDIENTE) de las compras con tick que no tengan su
--    fila en ComisionPasista (compras cargadas antes del módulo o en un panel
--    donde no se sincronizó): mismo monto, %, base y fecha que la compra. Las
--    anuladas no devengan comisión.
INSERT INTO "ComisionPasista"
  ("id", "panelId", "compraId", "tipo", "monto", "porcentaje", "base", "fecha", "estado",
   "observacion", "createdAt", "updatedAt")
SELECT 'cpb_' || md5(c."id"), c."panelId", c."id", 'ORIGINAL', c."comisionPasistaMonto",
       c."comisionPasistaPorcentaje", c."total", c."fecha", 'PENDIENTE',
       'Cargada al habilitar Pasista en todos los paneles', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Compra" c
WHERE c."comisionPasistaMonto" > 0
  AND c."estado" <> 'ANULADA'
  AND NOT EXISTS (SELECT 1 FROM "ComisionPasista" cp WHERE cp."compraId" = c."id");
