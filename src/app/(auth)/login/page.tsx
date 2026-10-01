import type { Metadata } from "next";
import Image from "next/image";

import { nombreNegocio } from "@/server/services/identidad.service";

import portada from "../../../../public/portadaApp.png";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

/**
 * Desktop: portada a pantalla completa a la izquierda, formulario centrado a
 * la derecha. Mobile: portada arriba (40vh) y el formulario debajo.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [{ next }, negocio] = await Promise.all([searchParams, nombreNegocio()]);
  return (
    <div className="grid min-h-dvh md:grid-cols-2">
      {/* La portada es cuadrada y su fondo es blanco: "contain" la muestra entera (con
          "cover" se recortaba la marca) y se funde con el panel a pantalla completa. */}
      <div className="border-border bg-surface relative h-[40vh] overflow-hidden border-b md:sticky md:top-0 md:h-dvh md:border-r md:border-b-0">
        <Image
          src={portada}
          alt={negocio}
          fill
          priority
          placeholder="empty"
          sizes="(min-width: 768px) 50vw, 100vw"
          className="object-contain p-6 md:p-16"
        />
      </div>
      <div className="fondo-marca pb-safe relative flex items-start justify-center overflow-hidden px-4 py-10 md:items-center md:px-8">
        <div
          aria-hidden
          className="marca-agua text-marca-azul absolute -right-24 -bottom-24 hidden size-96 opacity-[0.05] md:block"
        />
        <div className="relative flex w-full max-w-sm flex-col gap-8">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-display font-semibold">Ingresar</h1>
            <p className="text-muted text-body">Usá tu email y contraseña</p>
          </div>
          <LoginForm next={next} />
        </div>
      </div>
    </div>
  );
}
