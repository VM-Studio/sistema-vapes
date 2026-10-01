import { EsqueletoPantalla } from "@/components/layout/esqueleto-pantalla";

/**
 * Esqueleto de la primera carga (entrar desde afuera o cambiar entre paneles y
 * pantallas globales). Este boundary está por encima de los layouts de panel y
 * global: se muestra sin la barra ni el sidebar, así que lleva sus propios
 * márgenes (los mismos que el contenido de AppShell) para no quedar pegado al
 * borde. La navegación DENTRO de un panel o de las globales la cubren los
 * loading.tsx de p/[slug] y (global), que dejan el shell visible.
 */
export default function Loading() {
  return (
    <EsqueletoPantalla className="mx-auto w-full max-w-[1280px] px-4 pt-[calc(3.5rem+env(safe-area-inset-top)+1.5rem)] pb-6 md:px-8 md:pt-[calc(4rem+env(safe-area-inset-top)+2rem)] md:pb-8" />
  );
}
