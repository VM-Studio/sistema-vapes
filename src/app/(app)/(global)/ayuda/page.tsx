import { readFile } from "node:fs/promises";
import path from "node:path";

import { ArrowRight, ScanLine } from "lucide-react";
import { Marked } from "marked";
import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { requirePaginaUsuario } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Ayuda" };

/** Id de la sección de la pistola (se destaca y se enlaza desde arriba). */
const ID_PISTOLA = "configurar-la-pistola-lectora";

/** "Configurar la pistola lectora" → "configurar-la-pistola-lectora" */
function slug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const escaparAtributo = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

interface Seccion {
  id: string;
  titulo: string;
  html: string;
}

/**
 * Manual de usuario (docs/MANUAL-USUARIO.md) como página de la app, para
 * todos los usuarios. El Markdown es del repo (no lo escribe nadie desde la
 * app), así que se renderiza tal cual. Se parte en secciones por cada `##`:
 * arman el índice y cada una va en su bloque. Las capturas `-375` (celular)
 * se muestran angostas.
 */
async function manual(): Promise<{ intro: string; secciones: Seccion[] }> {
  const md = await readFile(path.join(process.cwd(), "docs", "MANUAL-USUARIO.md"), "utf8");
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const texto = this.parser.parseInline(tokens);
        if (depth <= 2) return ""; // el # lo pone PageHeader; los ## los pone cada sección
        const id = slug(texto.replace(/<[^>]+>/g, ""));
        return `<h${depth} id="${id}">${texto}</h${depth}>`;
      },
      image({ href, title, text }) {
        const celular = /-375\.\w+$/.test(href);
        const alt = escaparAtributo(text);
        const t = title ? ` title="${escaparAtributo(title)}"` : "";
        return `<img src="${escaparAtributo(href)}" alt="${alt}"${t} loading="lazy" decoding="async" class="${
          celular ? "captura captura-celular" : "captura"
        }" />`;
      },
    },
  });

  const partes = md.split(/^## /m);
  const intro = await marked.parse(partes[0] ?? "");
  const secciones: Seccion[] = [];
  for (const parte of partes.slice(1)) {
    const salto = parte.indexOf("\n");
    const tituloMd = (salto === -1 ? parte : parte.slice(0, salto)).trim();
    const titulo = (await marked.parseInline(tituloMd)).replace(/<[^>]+>/g, "");
    const cuerpo = salto === -1 ? "" : parte.slice(salto + 1);
    secciones.push({ id: slug(titulo), titulo, html: await marked.parse(cuerpo) });
  }
  return { intro, secciones };
}

/** Tipografía del manual (HTML generado): solo tokens del sistema. */
const PROSA = cn(
  "text-body text-foreground",
  "[&_p]:my-3 [&_p]:max-w-[72ch]",
  "[&_h3]:text-h3 [&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:scroll-mt-24 [&_h3]:font-semibold",
  "[&_h4]:mt-6 [&_h4]:mb-1 [&_h4]:font-semibold",
  "[&_ul]:my-3 [&_ul]:max-w-[72ch] [&_ul]:list-disc [&_ul]:pl-6",
  "[&_ol]:my-3 [&_ol]:max-w-[72ch] [&_ol]:list-decimal [&_ol]:pl-6",
  "[&_li]:my-1.5 [&_li]:pl-1 [&_li::marker]:text-subtle",
  "[&_strong]:font-semibold",
  "[&_a]:text-foreground [&_a]:decoration-input [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:decoration-foreground",
  "[&_code]:bg-surface-3 [&_code]:rounded-inner [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.875em]",
  "[&_blockquote]:border-border [&_blockquote]:bg-card [&_blockquote]:text-muted [&_blockquote]:my-4 [&_blockquote]:rounded-card [&_blockquote]:border-l-2 [&_blockquote]:px-4 [&_blockquote]:py-1",
  "[&_table]:text-small [&_table]:my-4 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto md:[&_table]:table",
  "[&_th]:border-border [&_th]:bg-card [&_th]:text-muted [&_th]:border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium",
  "[&_td]:border-border [&_td]:border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top",
  "[&_hr]:border-border [&_hr]:my-8",
  "[&_img.captura]:border-border [&_img.captura]:rounded-card [&_img.captura]:my-5 [&_img.captura]:h-auto [&_img.captura]:w-full [&_img.captura]:border",
  "[&_img.captura-celular]:max-w-[17.5rem]",
);

export default async function AyudaPage() {
  await requirePaginaUsuario();
  const { intro, secciones } = await manual();
  const hayPistola = secciones.some((s) => s.id === ID_PISTOLA);

  return (
    <>
      <PageHeader title="Ayuda" subtitle="Manual de uso del sistema" />
      <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
        <nav
          aria-label="Índice del manual"
          className="bg-card rounded-card p-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto lg:bg-transparent lg:p-0"
        >
          <p className="text-subtle text-small mb-2 px-2 font-medium">Contenido</p>
          <ol className="text-small grid gap-0.5 sm:grid-cols-2 lg:grid-cols-1">
            {secciones.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={cn(
                    "text-muted hover:bg-card-hover hover:text-foreground rounded-control flex min-h-9 items-center gap-2 px-2 py-1.5 transition-colors",
                    s.id === ID_PISTOLA && "text-foreground font-medium",
                  )}
                >
                  {s.id === ID_PISTOLA && (
                    <ScanLine className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                  )}
                  {s.titulo}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="flex min-w-0 flex-col gap-10">
          <div className="flex flex-col gap-4">
            <div
              className={cn(PROSA, "[&>*:first-child]:mt-0")}
              dangerouslySetInnerHTML={{ __html: intro }}
            />
            {hayPistola && (
              <a
                href={`#${ID_PISTOLA}`}
                className="bg-card hover:bg-card-hover hover:shadow-card-hover group rounded-card flex items-center gap-4 p-4 transition-[background-color,box-shadow] md:p-5"
              >
                <span className="bg-surface rounded-control flex size-11 shrink-0 items-center justify-center">
                  <ScanLine className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-h3 font-semibold">¿Primera vez con la pistola?</span>
                  <span className="text-muted text-small">
                    Conectarla, configurar el sufijo Enter y el idioma del teclado, y probarla.
                  </span>
                </span>
                <ArrowRight
                  className="text-subtle size-5 shrink-0 transition-transform group-hover:translate-x-0.5"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </a>
            )}
          </div>

          {secciones.map((s) =>
            s.id === ID_PISTOLA ? (
              <section
                key={s.id}
                aria-labelledby={s.id}
                className="bg-card rounded-card scroll-mt-24 p-5 md:p-8"
              >
                <div className="flex items-center gap-3">
                  <span className="bg-surface rounded-control flex size-11 shrink-0 items-center justify-center">
                    <ScanLine className="size-5" strokeWidth={1.75} aria-hidden />
                  </span>
                  <h2 id={s.id} className="text-h2 scroll-mt-24 font-semibold">
                    {s.titulo}
                  </h2>
                </div>
                <div
                  className={cn(
                    PROSA,
                    "[&_code]:bg-surface [&_img.captura]:bg-surface [&_th]:bg-surface mt-2",
                  )}
                  dangerouslySetInnerHTML={{ __html: s.html }}
                />
              </section>
            ) : (
              <section
                key={s.id}
                aria-labelledby={s.id}
                className="border-border scroll-mt-24 border-t pt-8"
              >
                <h2 id={s.id} className="text-h2 scroll-mt-24 font-semibold">
                  {s.titulo}
                </h2>
                <div className={cn(PROSA, "mt-2")} dangerouslySetInnerHTML={{ __html: s.html }} />
              </section>
            ),
          )}
        </article>
      </div>
    </>
  );
}
