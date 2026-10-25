import { CheckCircle2, Clock, FileDown, Link2Off } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { FirmarRemito } from "@/components/ganancia/firmar-remito";
import { LogoPanel } from "@/components/layout/logo-panel";
import { buttonVariants } from "@/components/ui/button";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { ETIQUETA_CATEGORIA, nombreMes } from "@/lib/ganancia-vendedor";
import { formatearFecha, formatearFechaHora } from "@/lib/utils";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";
import { metaDesdeHeaders } from "@/server/auth/request-meta";
import { consumir } from "@/server/seguridad/rate-limit";
import { remitoPorToken, type Remito } from "@/server/services/remito-liquidacion.service";

export const metadata: Metadata = {
  title: "Firmar remito",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * /firma/{token} (pública): el vendedor ve el remito de su pago, firmado por
 * el dueño, firma con el dedo y toca «Firmado». Link de un solo uso, vence a
 * los 14 días. Rate limit por IP. Pensada para el celular.
 */
export default async function FirmaPage({ params }: { params: Promise<{ token: string }> }) {
  const meta = metaDesdeHeaders(await headers());
  const limite = await consumir(`firma-pagina:${meta.ip ?? "local"}`, 30);
  if (!limite.permitido)
    return (
      <Marco>
        <Mensaje icono={<Clock aria-hidden />} titulo="Demasiados intentos">
          Esperá un minuto y volvé a abrir el link.
        </Mensaje>
      </Marco>
    );
  const { token } = await params;
  const { estado, remito: r } = await remitoPorToken(token);

  if (estado === "INVALIDO" || !r)
    return (
      <Marco>
        <Mensaje icono={<Link2Off aria-hidden />} titulo="Este link no sirve">
          Puede estar mal copiado o haber sido reemplazado por uno nuevo. Pedile a un dueño que te
          reenvíe el remito.
        </Mensaje>
      </Marco>
    );
  if (estado === "VENCIDO")
    return (
      <Marco r={r}>
        <Mensaje icono={<Clock aria-hidden />} titulo="El link venció">
          Pedile a un dueño que te reenvíe el remito de {nombreMes(r.mes)} para firmarlo.
        </Mensaje>
      </Marco>
    );

  const pdf = `/api/publico/remito/${token}`;
  return (
    <Marco r={r}>
      <div className="flex flex-col gap-1">
        <p className="text-muted text-small">Remito de pago · N° {r.numero}</p>
        <h1 className="text-h1 font-semibold">
          {estado === "USADO" ? "Remito firmado" : `Hola, ${r.vendedor.nombre}`}
        </h1>
        <p className="text-muted text-sm">
          {estado === "USADO"
            ? `Las dos firmas quedaron registradas. Podés bajar el remito final.`
            : `${r.pago?.registradoPor} te registró el pago de tu ganancia por vape de ${nombreMes(r.mes)} y firmó el remito. Revisalo y firmalo abajo.`}
        </p>
      </div>

      <Resumen r={r} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Firma titulo="Firma del dueño" f={r.firmaDueno} />
        <Firma titulo={`Firma de ${r.vendedor.nombre}`} f={r.firmaVendedor} />
      </div>

      <a
        href={pdf}
        target="_blank"
        rel="noopener"
        className={buttonVariants({ variant: "secondary", fullWidth: true })}
        data-testid="pdf-remito-publico"
      >
        <FileDown strokeWidth={1.75} aria-hidden />
        {estado === "USADO" ? "Bajar el remito firmado (PDF)" : "Ver el remito (PDF)"}
      </a>

      {estado === "VALIDO" ? (
        <FirmarRemito nombre={r.vendedor.nombre} modo={{ token }} />
      ) : (
        <div className="bg-success-soft text-success-soft-foreground rounded-card flex items-center gap-3 p-4">
          <CheckCircle2 className="size-6 shrink-0" strokeWidth={1.75} aria-hidden />
          <p className="text-sm font-medium">
            Firmado el {r.firmadaAt ? formatearFechaHora(r.firmadaAt) : ""}.
          </p>
        </div>
      )}
    </Marco>
  );
}

function Marco({ r, children }: { r?: Remito; children: ReactNode }) {
  return (
    <main className="bg-page-bg min-h-dvh px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:py-12">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-5">
        {r && (
          <header className="flex items-center justify-between gap-3">
            <LogoPanel panel={{ ...r.panel, colorAcento: null }} size={36} />
            <span className="text-muted text-small truncate">{r.negocio}</span>
          </header>
        )}
        <div className="bg-card rounded-card flex flex-col gap-5 p-5 md:p-6">{children}</div>
      </div>
    </main>
  );
}

function Mensaje({
  icono,
  titulo,
  children,
}: {
  icono: ReactNode;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <span className="bg-surface-2 text-muted rounded-circle flex size-12 items-center justify-center [&_svg]:size-6">
        {icono}
      </span>
      <h1 className="text-h2 font-semibold">{titulo}</h1>
      <p className="text-muted text-sm">{children}</p>
    </div>
  );
}

function Resumen({ r }: { r: Remito }) {
  const pago = r.pago!;
  return (
    <div className="flex flex-col gap-3">
      <dl className="bg-surface rounded-inner grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-4 text-sm">
        <dt className="text-muted">Período</dt>
        <dd className="text-right font-medium capitalize">{nombreMes(r.mes)}</dd>
        <dt className="text-muted">Pagado</dt>
        <dd className="text-right font-semibold tabular-nums" data-testid="monto-remito">
          {formatearPesos(pago.monto)}
        </dd>
        <dt className="text-muted">Cómo</dt>
        <dd className="text-right">
          {ETIQUETA_MEDIO_PAGO[pago.medioPago]} · {formatearFecha(pago.fecha)}
        </dd>
        {pago.referencia && (
          <>
            <dt className="text-muted">Referencia</dt>
            <dd className="truncate text-right">{pago.referencia}</dd>
          </>
        )}
      </dl>
      <ul className="divide-border divide-y text-sm">
        {r.categorias.map((c) => (
          <li key={c.categoria} className="flex items-baseline justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="block">{ETIQUETA_CATEGORIA[c.categoria]}</span>
              <span className="text-subtle text-small tabular-nums">
                {formatearNumero(c.unidades - c.unidadesDevueltas)} vapes ×{" "}
                {formatearPesos(c.tarifa)}
              </span>
            </span>
            <span className="font-medium tabular-nums">{formatearPesos(c.monto)}</span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 py-2 font-semibold">
          <span>Total que te corresponde</span>
          <span className="tabular-nums">{formatearPesos(r.total)}</span>
        </li>
      </ul>
    </div>
  );
}

function Firma({ titulo, f }: { titulo: string; f: Remito["firmaDueno"] }) {
  return (
    <figure className="bg-surface rounded-inner flex flex-col gap-2 p-3">
      <figcaption className="text-muted text-small font-medium">{titulo}</figcaption>
      <div className="bg-card rounded-inner flex h-24 items-center justify-center overflow-hidden">
        {f ? (
          // eslint-disable-next-line @next/next/no-img-element -- firma guardada en la DB (data URL)
          <img
            src={f.imagen}
            alt={`${titulo}: ${f.nombre}`}
            className="max-h-20 max-w-full object-contain"
          />
        ) : (
          <span className="text-subtle text-small">Pendiente</span>
        )}
      </div>
      {f && (
        <p className="text-small">
          <span className="font-semibold">{f.nombre}</span>{" "}
          <span className="text-muted">· {formatearFechaHora(f.firmadaAt)}</span>
        </p>
      )}
    </figure>
  );
}
