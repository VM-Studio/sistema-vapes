/**
 * pnpm paneles:logos — asigna a cada panel su logo de marca (archivos en /public).
 * Idempotente: se puede correr en cualquier base (local o producción).
 * Si un slug no existe, lo avisa y sigue con el resto.
 */
import { prisma } from "../src/lib/db";

const LOGOS: Record<string, string> = {
  vapes: "/logoVape.png",
  cosmetic: "/logoCosmetics.png",
  especiales: "/logoEspecial.png",
};

async function main() {
  for (const [slug, logoUrl] of Object.entries(LOGOS)) {
    const r = await prisma.panel.updateMany({ where: { slug }, data: { logoUrl } });
    console.log(r.count ? `✓ ${slug} → ${logoUrl}` : `· ${slug}: no existe, se omite`);
  }
  const paneles = await prisma.panel.findMany({
    select: { slug: true, nombre: true, logoUrl: true },
    orderBy: { orden: "asc" },
  });
  console.table(paneles);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
