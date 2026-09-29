import type { Metadata } from "next";

import { EscanerOffline } from "./escaner-offline";

export const metadata: Metadata = { title: "Sin conexión" };

/**
 * /offline — la precachea el service worker y la muestra cuando una página no
 * se puede cargar por falta de red. No tiene datos del negocio en el HTML: el
 * escáner lee el catálogo que ya está en el celular (IndexedDB), solo para consultar.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 bg-white px-4 py-6 pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1 font-semibold">Sin conexión</h1>
        <p className="text-muted text-sm">
          No hay señal para abrir esa pantalla. Mientras tanto podés escanear para consultar
          producto, precio y stock del último catálogo guardado. Ventas, ingresos, recuentos y
          transferencias necesitan conexión.
        </p>
      </header>
      <EscanerOffline />
    </main>
  );
}
