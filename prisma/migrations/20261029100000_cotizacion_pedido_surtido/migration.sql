-- Pedido surtido (mayorista): el escalón lo definen las unidades de TODO el
-- pedido, mezclando modelos. Las cotizaciones ya guardadas se calcularon por
-- producto: quedan en false. El modo vigente del panel vive en
-- Configuracion("cotizacion").pedidoSurtido (default true).
ALTER TABLE "Cotizacion" ADD COLUMN "pedidoSurtido" BOOLEAN NOT NULL DEFAULT false;
