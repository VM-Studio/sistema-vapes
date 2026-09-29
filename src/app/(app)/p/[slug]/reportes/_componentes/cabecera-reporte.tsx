import { ChevronLeft, FileSpreadsheet, FileText } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { rutaPanel } from "@/lib/paneles";

/**
 * Cabecera de un reporte: volver al índice + Exportar PDF / Excel (la misma
 * URL de filtros que se está viendo, hacia /api/p/{slug}/reportes/{clave}).
 */
export function CabeceraReporte({
  slug,
  clave,
  titulo,
  subtitulo,
  params,
  excel = true,
  extra,
}: {
  slug: string;
  clave: string;
  titulo: string;
  subtitulo?: ReactNode;
  params: Record<string, string>;
  excel?: boolean;
  extra?: ReactNode;
}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([k, v]) => v !== "" && k !== "page" && k !== "vista"),
  );
  const url = (formato: string) => {
    const q = new URLSearchParams(qs);
    q.set("formato", formato);
    return `/api/p/${slug}/reportes/${clave}?${q.toString()}`;
  };
  return (
    <>
      <Link
        href={rutaPanel(slug, "/reportes")}
        className="text-muted hover:text-foreground mb-2 inline-flex min-h-10 items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden /> Reportes
      </Link>
      <PageHeader
        title={titulo}
        subtitle={subtitulo}
        actions={
          <>
            {extra}
            <a
              href={url("pdf")}
              target="_blank"
              rel="noopener"
              data-testid="exportar-pdf"
              className={buttonVariants({ variant: "secondary" })}
            >
              <FileText strokeWidth={1.75} /> Exportar PDF
            </a>
            {excel && (
              <a
                href={url("xlsx")}
                download
                data-testid="exportar-excel"
                className={buttonVariants({ variant: "secondary" })}
              >
                <FileSpreadsheet strokeWidth={1.75} /> Excel
              </a>
            )}
          </>
        }
      />
    </>
  );
}
