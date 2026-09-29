import { readFile } from "node:fs/promises";
import path from "node:path";

import { Marked } from "marked";
import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { requirePaginaUsuario } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Ayuda" };

/** "Configurar la pistola lectora" → "configurar-la-pistola-lectora" */
function slug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Manual de usuario (docs/MANUAL-USUARIO.md) como página de la app, para
 * todos los usuarios. El Markdown es del repo (no lo escribe nadie desde la
 * app), así que se renderiza tal cual; los títulos ## arman el índice.
 */
async function manual() {
  const md = await readFile(path.join(process.cwd(), "docs", "MANUAL-USUARIO.md"), "utf8");
  const indice: { id: string; titulo: string }[] = [];
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const texto = this.parser.parseInline(tokens);
        const plano = texto.replace(/<[^>]+>/g, "");
        if (depth === 1) return ""; // el título lo pone PageHeader
        const id = slug(plano);
        if (depth === 2) indice.push({ id, titulo: plano });
        return `<h${depth} id="${id}">${texto}</h${depth}>`;
      },
    },
  });
  const html = await marked.parse(md);
  return { html, indice };
}

export default async function AyudaPage() {
  await requirePaginaUsuario();
  const { html, indice } = await manual();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader title="Ayuda" subtitle="Manual de uso del sistema" />
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <nav
          aria-label="Índice del manual"
          className="border-border bg-surface rounded-control border p-4 lg:sticky lg:top-4 lg:w-64 lg:shrink-0"
        >
          <p className="mb-2 text-sm font-semibold">Contenido</p>
          <ol className="flex flex-col gap-1 text-sm">
            {indice.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="text-muted hover:text-foreground block rounded px-1 py-1 hover:underline"
                >
                  {s.titulo}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article
          className="manual [&_code]:bg-surface-2 min-w-0 flex-1 text-[15px] leading-relaxed [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_code]:rounded [&_code]:px-1 [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:scroll-mt-20 [&_h2]:border-b [&_h2]:pb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:scroll-mt-20 [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_table]:my-4 [&_table]:w-full [&_table]:text-sm [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_th]:text-left [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
