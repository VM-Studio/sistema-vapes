/**
 * Utilidades PURAS de paneles (servidor y cliente).
 */

/** Lo que la app necesita saber de un panel (serializable: viaja al cliente). */
export interface PanelBasico {
  id: string;
  nombre: string;
  slug: string;
  logoUrl: string | null;
  colorAcento: string | null;
  etiquetaEspecificacion: string;
  /** Cómo se llaman las unidades vendidas en el dashboard ("Vapes vendidos"). */
  etiquetaUnidades: string;
  orden: number;
}

/** Prefijo de los IDs visibles del panel: 3 primeras letras del slug ("vapes" → "VAP"). */
export function prefijoPanel(slug: string): string {
  return slug
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 3)
    .toUpperCase();
}

/** ID de venta visible: VAP-000001. */
export function formatearIdVenta(slug: string, numero: number): string {
  return `${prefijoPanel(slug)}-${String(numero).padStart(6, "0")}`;
}

/** ID de compra visible: VAP-C-000001. */
export function formatearIdCompra(slug: string, numero: number): string {
  return `${prefijoPanel(slug)}-C-${String(numero).padStart(6, "0")}`;
}

/** "VAP-000123" / "vap-123" / "123" → 123 (null si no es un ID de venta). */
export function numeroDeIdVenta(texto: string): number | null {
  const m = texto.trim().match(/^(?:[a-z]{1,3}-)?0*(\d{1,9})$/i);
  return m ? Number(m[1]) : null;
}

/** "Cosmética & Más" → "cosmetica-mas". */
export function slugDesdeNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export const SLUG_VALIDO = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Ruta dentro de un panel: rutaPanel("vapes", "/productos") → "/p/vapes/productos". */
export function rutaPanel(slug: string, ruta = ""): string {
  const r = ruta === "/" ? "" : ruta;
  return `/p/${slug}${r && !r.startsWith("/") ? `/${r}` : r}`;
}

/** Iniciales para el placeholder de un panel sin logo ("Especiales" → "ES"). */
export function inicialesPanel(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  const ini =
    palabras.length > 1 ? palabras[0]![0]! + palabras[1]![0]! : (palabras[0] ?? "?").slice(0, 2);
  return ini.toUpperCase();
}

/** Clave de localStorage con el último panel abierto (la PWA arranca ahí). */
export const CLAVE_ULTIMO_PANEL = "panel.ultimo";
