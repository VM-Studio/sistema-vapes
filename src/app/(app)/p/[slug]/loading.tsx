import { EsqueletoPantalla } from "@/components/layout/esqueleto-pantalla";

/**
 * Al pasar de un módulo a otro del panel: la barra y el sidebar quedan
 * quietos y el contenido muestra el esqueleto al instante, en vez de esperar
 * congelado la respuesta del servidor.
 */
export default function Loading() {
  return <EsqueletoPantalla />;
}
