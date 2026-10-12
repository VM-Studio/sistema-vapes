/**
 * Rutas de los PDFs del sistema (Route Handlers GET que generan el PDF en el
 * momento y lo sirven inline). Los botones son links a estas rutas en una
 * pestaña nueva: sin Server Actions de por medio ni archivos guardados antes.
 * Los reportes y el resumen mensual usan `/api/p/{slug}/reportes/{clave}`.
 */
export const rutaPdf = {
  cotizacion: (slug: string, id: string) => `/api/p/${slug}/cotizaciones/${id}/pdf`,
  remito: (slug: string, transferenciaId: string) =>
    `/api/p/${slug}/transferencias/${transferenciaId}/remito`,
  recibo: (slug: string, cobroId: string) =>
    `/api/p/${slug}/fiados/cobros/${encodeURIComponent(cobroId)}/recibo`,
};
