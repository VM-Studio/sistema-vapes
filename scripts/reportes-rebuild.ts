/**
 * Reconstruye ResumenDiario entero desde el ledger (ventas, pagos,
 * devoluciones y gastos). Para recuperación: `pnpm reportes:rebuild`.
 */
import { prisma } from "../src/lib/db";
import { reconstruirResumenDiario } from "../src/server/services/resumen-diario.service";

async function main() {
  const t0 = performance.now();
  const r = await reconstruirResumenDiario();
  console.log(
    `ResumenDiario reconstruido: ${r.filas} filas (${r.desde ?? "sin actividad"} → ${r.hasta}) en ${Math.round(performance.now() - t0)} ms`,
  );
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
