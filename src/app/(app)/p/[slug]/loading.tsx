import { EsqueletoPantalla } from "@/components/layout/esqueleto-pantalla";

/**
 * Al pasar de un módulo a otro del panel: la barra y el sidebar quedan
 * quietos y el contenido muestra el esqueleto al instante, en vez de esperar
 * congelado la respuesta del servidor.
 *
 * Cada módulo (y cada sección con pantallas hijas) tiene además su propio
 * loading.tsx con este mismo esqueleto. Sin él, una navegación dentro del
 * módulo (listado → detalle) cae debajo de ESTE boundary, que ya está
 * resuelto: Next usa el prefetch parcial, la transición espera la carga
 * diferida del segmento y en Next 15.5 a veces no se confirma nunca (la URL
 * no cambia y el clic "no hace nada"). Lo controla
 * tests/unit/loading-boundaries.test.ts.
 */
export default function Loading() {
  return <EsqueletoPantalla />;
}
