import { FileSpreadsheet, FileText } from "lucide-react";
import type { ReactNode } from "react";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { rutaPanel } from "@/lib/paneles";

/**
 * Cabecera de un reporte: migas hacia el índice + Exportar PDF / Excel (la
 * misma URL de filtros que se está viendo, hacia /api/p/{slug}/reportes/{clave}).
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
    <PageHeader
      title={titulo}
      subtitle={subtitulo}
      breadcrumb={
        <Breadcrumb
          items={[{ label: "Reportes", href: rutaPanel(slug, "/reportes") }, { label: titulo }]}
        />
      }
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
              <FileSpreadsheet strokeWidth={1.75} /> Exportar Excel
            </a>
          )}
        </>
      }
    />
  );
}
