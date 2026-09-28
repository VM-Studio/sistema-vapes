import { Sparkles, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Módulo que todavía no está disponible: la página existe y ya está protegida
 * por permisos; muestra qué va a tener y un camino de vuelta al inicio.
 */
export function ModuloProximamente({
  titulo,
  descripcion,
  icono: Icono,
  incluye,
  inicioHref,
}: {
  titulo: string;
  descripcion: string;
  icono: LucideIcon;
  /** Qué va a poder hacerse (2-4 puntos cortos). */
  incluye: readonly string[];
  inicioHref: string;
}) {
  return (
    <>
      <PageHeader title={titulo} subtitle={descripcion} />
      <Card className="mx-auto w-full max-w-2xl">
        <CardContent className="flex flex-col items-center gap-6 px-6 py-12 text-center md:px-10 md:py-16">
          <span className="bg-primary-soft text-primary-soft-foreground flex size-14 items-center justify-center rounded-2xl">
            <Icono className="size-7" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="flex flex-col items-center gap-2">
            <span className="bg-surface-2 text-muted ring-border inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset">
              <Sparkles className="size-3.5" strokeWidth={1.75} aria-hidden />
              Próximamente
            </span>
            <p className="text-lg font-semibold tracking-tight">Estamos preparando este módulo</p>
          </div>
          <ul className="text-muted flex w-full max-w-md flex-col gap-2 text-left text-sm">
            {incluye.map((punto) => (
              <li key={punto} className="flex gap-2.5">
                <span className="bg-primary mt-2 size-1.5 shrink-0 rounded-full" aria-hidden />
                {punto}
              </li>
            ))}
          </ul>
          <Link href={inicioHref} className={buttonVariants({ variant: "secondary" })}>
            Volver al inicio
          </Link>
        </CardContent>
      </Card>
    </>
  );
}
