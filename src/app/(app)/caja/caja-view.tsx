"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  FileText,
  Lock,
  LockOpen,
  MessageCircle,
  Minus,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { formatearPesos } from "@/lib/format";
import { cn, formatearFechaHora } from "@/lib/utils";
import { linkWhatsApp } from "@/lib/whatsapp";
import type { CajaDetalle } from "@/server/services/caja.service";

import {
  abrirCajaAction,
  cerrarCajaAction,
  compartirCierreAction,
  ingresoExtraAction,
  retiroAction,
} from "./actions";

interface EstadoDeposito {
  depositoId: string;
  deposito: string;
  ultimoCierre: Date | null;
  caja: CajaDetalle | null;
}

type Accion =
  | { tipo: "abrir"; depositoId: string; deposito: string }
  | { tipo: "ingreso" | "retiro"; caja: CajaDetalle }
  | { tipo: "cerrar"; caja: CajaDetalle };

export function CajaView({
  cajas,
  tolerancia,
  permisos,
  inicial,
}: {
  cajas: EstadoDeposito[];
  tolerancia: number;
  permisos: { operar: boolean; retirar: boolean };
  inicial: { depositoId: string | null; accion: string | null };
}) {
  const [accion, setAccion] = useState<Accion | null>(null);

  // Desde el dashboard: /caja?deposito=…&accion=abrir|cerrar abre la pantalla directo.
  useEffect(() => {
    if (!permisos.operar || !inicial.depositoId) return;
    const e = cajas.find((c) => c.depositoId === inicial.depositoId);
    if (!e) return;
    if (inicial.accion === "abrir" && !e.caja)
      setAccion({ tipo: "abrir", depositoId: e.depositoId, deposito: e.deposito });
    if (inicial.accion === "cerrar" && e.caja) setAccion({ tipo: "cerrar", caja: e.caja });
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {cajas.map((e) => (
        <section
          key={e.depositoId}
          className="border-border bg-surface flex min-w-0 flex-col gap-4 rounded-xl border p-4 md:p-5"
          aria-label={`Caja de ${e.deposito}`}
        >
          <header className="flex items-center gap-3">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full",
                e.caja ? "bg-success-soft text-success-soft-foreground" : "bg-surface-2 text-muted",
              )}
            >
              {e.caja ? (
                <LockOpen className="size-5" aria-hidden />
              ) : (
                <Lock className="size-5" aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">{e.deposito}</h2>
              <p className="text-muted text-sm">
                {e.caja
                  ? `Abierta el ${formatearFechaHora(e.caja.abiertaAt)} por ${e.caja.abiertaPor}`
                  : e.ultimoCierre
                    ? `Cerrada · último cierre ${formatearFechaHora(e.ultimoCierre)}`
                    : "Cerrada"}
              </p>
            </div>
          </header>

          {e.caja ? (
            <>
              <Resumen caja={e.caja} />
              <div className="flex flex-wrap gap-2 [&>*]:flex-1">
                {permisos.operar && (
                  <Button
                    variant="secondary"
                    onClick={() => setAccion({ tipo: "ingreso", caja: e.caja! })}
                  >
                    <ArrowDownToLine /> Ingreso extra
                  </Button>
                )}
                {permisos.retirar && (
                  <Button
                    variant="secondary"
                    onClick={() => setAccion({ tipo: "retiro", caja: e.caja! })}
                  >
                    <ArrowUpFromLine /> Retiro
                  </Button>
                )}
                {permisos.operar && (
                  <Button onClick={() => setAccion({ tipo: "cerrar", caja: e.caja! })}>
                    <Lock /> Cerrar caja
                  </Button>
                )}
              </div>
              <Movimientos caja={e.caja} />
            </>
          ) : (
            permisos.operar && (
              <Button
                onClick={() =>
                  setAccion({ tipo: "abrir", depositoId: e.depositoId, deposito: e.deposito })
                }
              >
                <LockOpen /> Abrir caja
              </Button>
            )
          )}
        </section>
      ))}

      {accion?.tipo === "abrir" && <AbrirSheet {...accion} onClose={() => setAccion(null)} />}
      {(accion?.tipo === "ingreso" || accion?.tipo === "retiro") && (
        <MovimientoSheet tipo={accion.tipo} caja={accion.caja} onClose={() => setAccion(null)} />
      )}
      {accion?.tipo === "cerrar" && (
        <ArqueoSheet caja={accion.caja} tolerancia={tolerancia} onClose={() => setAccion(null)} />
      )}
    </div>
  );
}

function Resumen({ caja }: { caja: CajaDetalle }) {
  const t = caja.totales;
  const filas: [string, string, "+" | "-" | ""][] = [
    ["Monto inicial", t.inicial, ""],
    ["Ventas en efectivo", t.ventas, "+"],
    ["Cobros a clientes", t.pagosClientes, "+"],
    ["Ingresos extra", t.ingresosExtra, "+"],
    ["Devoluciones", t.devoluciones, "-"],
    ["Gastos", t.gastos, "-"],
    ["Retiros", t.retiros, "-"],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      {filas
        .filter(([, v, s]) => s === "" || Number(v) !== 0)
        .map(([k, v, s]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right tabular-nums">
              {s === "-" ? "−" : s}
              {formatearPesos(v)}
            </dd>
          </div>
        ))}
      <dt className="border-border mt-1 border-t pt-2 font-semibold">Efectivo esperado</dt>
      <dd className="border-border mt-1 border-t pt-2 text-right text-lg font-semibold tabular-nums">
        {formatearPesos(t.esperado)}
      </dd>
    </dl>
  );
}

function Movimientos({ caja }: { caja: CajaDetalle }) {
  const ultimos = [...caja.movimientos].reverse().slice(0, 8);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-muted text-xs font-semibold tracking-wide uppercase">
          Últimos movimientos
        </h3>
        <Link href={`/caja/${caja.id}`} className="text-primary text-sm hover:underline">
          Ver todos ({caja.movimientos.length})
        </Link>
      </div>
      <ul className="divide-border divide-y text-sm">
        {ultimos.map((m) => (
          <li key={m.id} className="flex items-center gap-2 py-2">
            <span className="text-muted w-12 shrink-0 text-xs tabular-nums">
              {formatearFechaHora(m.fecha).slice(9)}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {m.href ? (
                <Link href={m.href} className="hover:underline">
                  {m.descripcion ?? m.etiqueta}
                </Link>
              ) : (
                (m.descripcion ?? m.etiqueta)
              )}
            </span>
            <span
              className={cn(
                "shrink-0 font-medium tabular-nums",
                Number(m.monto) < 0 && "text-danger",
              )}
            >
              {formatearPesos(m.monto)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useEnviar() {
  const router = useRouter();
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string[]>>({});
  async function enviar<T>(
    fn: () => Promise<
      | { ok: true; data: T }
      | { ok: false; error: { message: string; fields?: Record<string, string[]> } }
    >,
    ok: (d: T) => void,
    tituloError: string,
  ) {
    setEnviando(true);
    const r = await fn();
    setEnviando(false);
    if (!r.ok) {
      setErrores(r.error.fields ?? {});
      toast.error(tituloError, r.error.message);
      return;
    }
    setErrores({});
    ok(r.data);
    router.refresh();
  }
  return { enviando, errores, enviar, toast };
}

function AbrirSheet({
  depositoId,
  deposito,
  onClose,
}: {
  depositoId: string;
  deposito: string;
  onClose: () => void;
}) {
  const { enviando, errores, enviar, toast } = useEnviar();
  const [monto, setMonto] = useState("");
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Abrir caja · ${deposito}`}
      description="Contá el efectivo con el que arrancás (el cambio)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            loading={enviando}
            onClick={() =>
              enviar(
                () => abrirCajaAction({ depositoId, montoInicial: monto || 0 }),
                () => {
                  toast.success(`Caja de ${deposito} abierta`);
                  onClose();
                },
                "No se pudo abrir la caja",
              )
            }
          >
            Abrir caja
          </Button>
        </>
      }
    >
      <Input
        label="Monto inicial"
        inputMode="decimal"
        value={monto}
        onChange={(e) => setMonto(e.target.value)}
        placeholder="0"
        autoFocus
        error={errores.montoInicial?.[0]}
      />
    </Sheet>
  );
}

function MovimientoSheet({
  tipo,
  caja,
  onClose,
}: {
  tipo: "ingreso" | "retiro";
  caja: CajaDetalle;
  onClose: () => void;
}) {
  const { enviando, errores, enviar, toast } = useEnviar();
  const [monto, setMonto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const retiro = tipo === "retiro";
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={retiro ? "Retiro de efectivo" : "Ingreso extra"}
      description={
        retiro ? "Ej.: «me llevé plata al banco». Solo dueños." : "Ej.: «puse plata para cambio»."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            loading={enviando}
            onClick={() =>
              enviar(
                () =>
                  (retiro ? retiroAction : ingresoExtraAction)({
                    cajaId: caja.id,
                    monto,
                    descripcion,
                  }),
                () => {
                  toast.success(retiro ? "Retiro registrado" : "Ingreso registrado");
                  onClose();
                },
                "No se pudo registrar",
              )
            }
          >
            Registrar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted text-sm">
          En la caja debería haber{" "}
          <strong className="text-foreground">{formatearPesos(caja.totales.esperado)}</strong>.
        </p>
        <Input
          label="Monto"
          inputMode="decimal"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          autoFocus
          error={errores.monto?.[0]}
        />
        <Input
          label="Motivo"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          maxLength={200}
          error={errores.descripcion?.[0]}
        />
      </div>
    </Sheet>
  );
}

const BILLETES = [20000, 10000, 2000, 1000, 500, 200, 100] as const;

/**
 * Arqueo: se cuenta billete por billete (suma sola), se ve el esperado y la
 * diferencia con color, y con diferencia fuera de tolerancia se exigen
 * observaciones. Al cerrar: PDF del cierre y WhatsApp.
 */
function ArqueoSheet({
  caja,
  tolerancia,
  onClose,
}: {
  caja: CajaDetalle;
  tolerancia: number;
  onClose: () => void;
}) {
  const { enviando, errores, enviar, toast } = useEnviar();
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [monedas, setMonedas] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [cerrada, setCerrada] = useState<{
    id: string;
    diferencia: string;
    requiereRevision: boolean;
  } | null>(null);
  const [compartiendo, setCompartiendo] = useState(false);

  const contado = useMemo(
    () =>
      BILLETES.reduce((a, b) => a + b * (Number(conteo[b]) || 0), 0) +
      (Number(monedas.replace(",", ".")) || 0),
    [conteo, monedas],
  );
  const esperado = Number(caja.totales.esperado);
  const diferencia = Math.round((contado - esperado) * 100) / 100;
  const fueraDeTolerancia = Math.abs(diferencia) > tolerancia;
  const cambiar = (b: number, delta: number) =>
    setConteo((c) => ({ ...c, [b]: String(Math.max(0, (Number(c[b]) || 0) + delta)) }));

  async function compartir(id: string) {
    setCompartiendo(true);
    const r = await compartirCierreAction({ cajaId: id });
    setCompartiendo(false);
    if (!r.ok) return toast.error("No se pudo generar el PDF", r.error.message);
    window.open(
      linkWhatsApp(
        null,
        `Cierre de caja · ${caja.deposito.nombre}\nDiferencia: ${formatearPesos(cerrada?.diferencia ?? diferencia)}\n${location.origin}${r.data.url}`,
      ),
      "_blank",
      "noopener",
    );
  }

  if (cerrada) {
    const d = Number(cerrada.diferencia);
    return (
      <Sheet
        open
        onOpenChange={(o) => !o && onClose()}
        title={`Caja de ${caja.deposito.nombre} cerrada`}
        footer={
          <>
            <a
              href={`/api/caja/${cerrada.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "secondary" })}
            >
              <FileText /> PDF del cierre
            </a>
            <Button onClick={() => compartir(cerrada.id)} loading={compartiendo}>
              <MessageCircle /> WhatsApp
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <p className="text-muted text-sm">Diferencia</p>
          <p
            className={cn(
              "text-3xl font-semibold tabular-nums",
              d === 0 ? "text-success" : "text-danger",
            )}
          >
            {d > 0 ? "+" : ""}
            {formatearPesos(cerrada.diferencia)}
          </p>
          {cerrada.requiereRevision && (
            <p className="bg-danger-soft text-danger-soft-foreground rounded-lg px-3 py-2 text-sm">
              Supera la tolerancia: quedó marcada para revisión y se avisó a los dueños.
            </p>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Cerrar caja · ${caja.deposito.nombre}`}
      description="Contá los billetes: el total se suma solo."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            loading={enviando}
            onClick={() =>
              enviar(
                () =>
                  cerrarCajaAction({
                    cajaId: caja.id,
                    montoContado: contado,
                    observaciones,
                    conteo: {
                      ...Object.fromEntries(
                        BILLETES.map((b) => [String(b), Number(conteo[b]) || 0]),
                      ),
                    },
                  }),
                (d) => setCerrada(d),
                "No se pudo cerrar la caja",
              )
            }
          >
            Confirmar cierre
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2" aria-label="Conteo de billetes">
          {BILLETES.map((b) => (
            <li key={b} className="flex items-center gap-2">
              <span className="w-20 shrink-0 font-medium tabular-nums">{formatearPesos(b)}</span>
              <Button
                variant="secondary"
                size="icon"
                aria-label={`Un billete de ${b} menos`}
                onClick={() => cambiar(b, -1)}
              >
                <Minus />
              </Button>
              <input
                aria-label={`Billetes de ${b}`}
                inputMode="numeric"
                className="border-input bg-surface h-11 w-16 rounded-lg border text-center text-base tabular-nums"
                value={conteo[b] ?? ""}
                placeholder="0"
                onChange={(e) =>
                  setConteo((c) => ({ ...c, [b]: e.target.value.replace(/\D/g, "") }))
                }
              />
              <Button
                variant="secondary"
                size="icon"
                aria-label={`Un billete de ${b} más`}
                onClick={() => cambiar(b, 1)}
              >
                <Plus />
              </Button>
              <span className="text-muted ml-auto text-sm tabular-nums">
                {formatearPesos(b * (Number(conteo[b]) || 0))}
              </span>
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span className="w-20 shrink-0 font-medium">Monedas</span>
            <input
              aria-label="Total en monedas"
              inputMode="decimal"
              className="border-input bg-surface h-11 min-w-0 flex-1 rounded-lg border px-3 text-base tabular-nums"
              value={monedas}
              placeholder="$ 0"
              onChange={(e) => setMonedas(e.target.value.replace(/[^\d.,]/g, ""))}
            />
          </li>
        </ul>

        <dl className="bg-surface-2 grid grid-cols-2 gap-y-1 rounded-xl p-4 text-sm">
          <dt className="text-muted">Esperado</dt>
          <dd className="text-right font-medium tabular-nums">{formatearPesos(esperado)}</dd>
          <dt className="text-muted">Contado</dt>
          <dd className="text-right font-medium tabular-nums" data-testid="contado">
            {formatearPesos(contado)}
          </dd>
          <dt className="font-semibold">Diferencia</dt>
          <dd
            data-testid="diferencia"
            className={cn(
              "text-right text-lg font-semibold tabular-nums",
              diferencia === 0
                ? "text-success"
                : fueraDeTolerancia
                  ? "text-danger"
                  : "text-warning-soft-foreground",
            )}
          >
            {diferencia > 0 ? "+" : ""}
            {formatearPesos(diferencia)}
          </dd>
        </dl>

        <Textarea
          label={fueraDeTolerancia ? "Observaciones (obligatorias)" : "Observaciones"}
          hint={
            fueraDeTolerancia
              ? `La diferencia supera la tolerancia de ${formatearPesos(tolerancia)}: explicá qué pasó.`
              : undefined
          }
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          rows={3}
          maxLength={1000}
          required={fueraDeTolerancia}
          error={errores.observaciones?.[0]}
        />
      </div>
    </Sheet>
  );
}
