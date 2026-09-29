import { SelectorPeriodo } from "@/components/analitica/selector-periodo";
import { describirPeriodo, diaDe, type Periodo } from "@/server/services/analitica.service";

/** Selector de período del dashboard (mismos parámetros: modo, preset, desde, hasta). */
export function PeriodoAnalitica({ periodo, preset }: { periodo: Periodo; preset: string | null }) {
  const d = describirPeriodo(periodo);
  return (
    <div className="mb-6">
      <SelectorPeriodo
        modo={periodo.modo}
        desde={diaDe(periodo.desde)}
        hasta={diaDe(periodo.hasta)}
        preset={preset}
        etiqueta={d.etiqueta}
        comparacion={d.comparacion}
      />
    </div>
  );
}
