"use client";

import { MedioPago } from "@prisma/client";
import { Ban, HandCoins, Undo2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { CantidadInput } from "@/components/ui/cantidad-input";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import { linkWhatsApp, textoComprobante } from "@/lib/whatsapp";

import {
  anularPagoAction,
  anularVentaAction,
  devolucionAction,
  registrarPagoAction,
} from "../actions";
import { ETIQUETA_MEDIO } from "../nueva/tipos";

const MEDIOS_DINERO = Object.values(MedioPago).filter((m) => m !== MedioPago.CREDITO_CLIENTE);
const campos = (fields?: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, v[0] ?? ""]));

interface VentaAcciones {
  id: string;
  numero: number;
  saldoPendiente: string;
  montoPagado: string;
  tieneDevoluciones: boolean;
  cliente: { nombre: string; saldoAFavor: string } | null;
  depositoId: string;
  items: { id: string; nombre: string; cantidad: number; cantidadDevuelta: number }[];
}

export function AccionesVenta({
  venta,
  depositos,
  puedeCobrar,
  puedeDevolver,
  puedeAnular,
}: {
  venta: VentaAcciones;
  depositos: { id: string; nombre: string }[];
  puedeCobrar: boolean;
  puedeDevolver: boolean;
  puedeAnular: boolean;
}) {
  const [abierto, setAbierto] = useState<"pago" | "devolucion" | "anular" | null>(null);
  const quedanUnidades = venta.items.some((i) => i.cantidad > i.cantidadDevuelta);
  const conSaldo = Number(venta.saldoPendiente) > 0;
  const acciones = [
    puedeCobrar && conSaldo && (
      <Button key="pago" onClick={() => setAbierto("pago")}>
        <HandCoins /> Registrar pago
      </Button>
    ),
    puedeDevolver && quedanUnidades && (
      <Button key="devolucion" variant="secondary" onClick={() => setAbierto("devolucion")}>
        <Undo2 /> Devolución parcial
      </Button>
    ),
    puedeAnular && !venta.tieneDevoluciones && (
      <Button
        key="anular"
        variant="secondary"
        className="text-danger"
        onClick={() => setAbierto("anular")}
      >
        <Ban /> Anular venta
      </Button>
    ),
  ].filter(Boolean);
  if (acciones.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {acciones}
      {abierto === "pago" && <RegistrarPago venta={venta} onClose={() => setAbierto(null)} />}
      {abierto === "devolucion" && (
        <Devolucion venta={venta} depositos={depositos} onClose={() => setAbierto(null)} />
      )}
      {abierto === "anular" && <Anular venta={venta} onClose={() => setAbierto(null)} />}
    </div>
  );
}

function RegistrarPago({ venta, onClose }: { venta: VentaAcciones; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [medio, setMedio] = useState<MedioPago>(MedioPago.EFECTIVO);
  const [monto, setMonto] = useState(String(Number(venta.saldoPendiente)));
  const [referencia, setReferencia] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const medios = Object.values(MedioPago).filter(
    (m) => m !== MedioPago.CREDITO_CLIENTE || Number(venta.cliente?.saldoAFavor ?? 0) > 0,
  );

  async function enviar() {
    setEnviando(true);
    const r = await registrarPagoAction({
      ventaId: venta.id,
      pago: { medioPago: medio, monto, referencia },
    });
    setEnviando(false);
    if (!r.ok) {
      setErrores(campos(r.error.fields));
      return toast.error("No se pudo registrar el pago", r.error.message);
    }
    toast.success(
      "Pago registrado",
      Number(r.data.saldoPendiente) > 0
        ? `Queda ${formatearPesos(r.data.saldoPendiente)}`
        : "La venta quedó pagada.",
    );
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Cobrar venta #${venta.numero}`}
      description={`Saldo pendiente: ${formatearPesos(venta.saldoPendiente)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Volver
          </Button>
          <Button onClick={() => void enviar()} loading={enviando}>
            Registrar pago
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select
          label="Medio de pago"
          options={medios.map((m) => ({ value: m, label: ETIQUETA_MEDIO[m] }))}
          value={medio}
          onChange={(e) => setMedio(e.target.value as MedioPago)}
        />
        <Input
          label="Monto"
          inputMode="decimal"
          value={monto}
          onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ""))}
          error={errores["pago.monto"] ?? errores.monto}
        />
        {(medio === MedioPago.TRANSFERENCIA || medio === MedioPago.MERCADOPAGO) && (
          <Input
            label="N.º de operación (opcional)"
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
          />
        )}
      </div>
    </Dialog>
  );
}

function Devolucion({
  venta,
  depositos,
  onClose,
}: {
  venta: VentaAcciones;
  depositos: { id: string; nombre: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [depositoId, setDepositoId] = useState(
    depositos.some((d) => d.id === venta.depositoId) ? venta.depositoId : (depositos[0]?.id ?? ""),
  );
  const [motivo, setMotivo] = useState("");
  const [tipo, setTipo] = useState<"dinero" | "cuentaCorriente">("dinero");
  const [medio, setMedio] = useState<MedioPago>(MedioPago.EFECTIVO);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const items = Object.entries(cantidades).filter(([, n]) => n > 0);

  async function enviar() {
    setEnviando(true);
    const r = await devolucionAction({
      ventaId: venta.id,
      depositoId,
      motivo,
      items: items.map(([ventaItemId, cantidad]) => ({ ventaItemId, cantidad })),
      reintegro: tipo === "dinero" ? { tipo, medioPago: medio } : { tipo },
    });
    setEnviando(false);
    if (!r.ok) {
      setErrores(campos(r.error.fields));
      if (!r.error.fields) toast.error("No se pudo registrar la devolución", r.error.message);
      return;
    }
    toast.success(
      `Devolución #${r.data.numero} registrada`,
      Number(r.data.reintegroMonto) > 0
        ? `Devolvé ${formatearPesos(r.data.reintegroMonto)} (${ETIQUETA_MEDIO[medio].toLowerCase()}).`
        : `Se acreditaron ${formatearPesos(r.data.aCuentaCorriente)} a la cuenta del cliente.`,
    );
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Devolución de la venta #${venta.numero}`}
      description="La mercadería vuelve al stock del depósito elegido. El importe se calcula con el precio que pagó el cliente."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={() => void enviar()} loading={enviando} disabled={items.length === 0}>
            Registrar devolución
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ul aria-label="Productos a devolver" className="flex flex-col gap-2">
          {venta.items.map((i) => {
            const quedan = i.cantidad - i.cantidadDevuelta;
            return (
              <li
                key={i.id}
                className={cn(
                  "border-border flex items-center justify-between gap-3 rounded-xl border p-3",
                  quedan === 0 && "opacity-50",
                )}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{i.nombre}</p>
                  <p className="text-muted text-xs">
                    Vendidas {i.cantidad}
                    {i.cantidadDevuelta > 0 && ` · ya devueltas ${i.cantidadDevuelta}`}
                  </p>
                </div>
                {quedan > 0 && (
                  <CantidadInput
                    etiqueta={`Devolver de ${i.nombre}`}
                    valor={cantidades[i.id] ?? 0}
                    min={0}
                    max={quedan}
                    onCambio={(n) => setCantidades((c) => ({ ...c, [i.id]: n }))}
                    className="h-10 w-16"
                  />
                )}
              </li>
            );
          })}
        </ul>
        {errores.items && <p className="text-danger text-sm">{errores.items}</p>}
        <Select
          label="Vuelve al depósito"
          options={depositos.map((d) => ({ value: d.id, label: d.nombre }))}
          value={depositoId}
          onChange={(e) => setDepositoId(e.target.value)}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Reintegro</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="reintegro"
              checked={tipo === "dinero"}
              onChange={() => setTipo("dinero")}
              className="accent-primary size-4"
            />
            Devolver el dinero
          </label>
          {tipo === "dinero" && (
            <Select
              aria-label="Medio del reintegro"
              options={MEDIOS_DINERO.map((m) => ({ value: m, label: ETIQUETA_MEDIO[m] }))}
              value={medio}
              onChange={(e) => setMedio(e.target.value as MedioPago)}
            />
          )}
          {venta.cliente && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="radio"
                name="reintegro"
                checked={tipo === "cuentaCorriente"}
                onChange={() => setTipo("cuentaCorriente")}
                className="accent-primary size-4"
              />
              Acreditar a la cuenta de {venta.cliente.nombre} (cancela deuda o queda a favor)
            </label>
          )}
        </fieldset>
        <Textarea
          label="Motivo"
          required
          rows={2}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          error={errores.motivo}
        />
      </div>
    </Sheet>
  );
}

function Anular({ venta, onClose }: { venta: VentaAcciones; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    setEnviando(true);
    const r = await anularVentaAction({ ventaId: venta.id, motivo });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error.fields?.motivo?.[0]);
      if (!r.error.fields?.motivo) toast.error("No se pudo anular", r.error.message);
      return;
    }
    toast.success(
      `Venta #${venta.numero} anulada`,
      "El stock volvió al depósito y el comprobante quedó anulado.",
    );
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`¿Anular la venta #${venta.numero}?`}
      description={`Vuelve todo el stock al depósito, se anulan los pagos (${formatearPesos(venta.montoPagado)} cobrados: devolvéselos al cliente)${Number(venta.saldoPendiente) > 0 ? `, se cancela el saldo pendiente de ${formatearPesos(venta.saldoPendiente)}` : ""} y el comprobante queda ANULADO. No se puede deshacer.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Volver
          </Button>
          <Button variant="danger" onClick={() => void enviar()} loading={enviando}>
            Anular venta
          </Button>
        </>
      }
    >
      <Textarea
        label="Motivo"
        required
        rows={2}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        error={error}
      />
    </Dialog>
  );
}

/** Solo OWNER: anula un pago (la venta vuelve a deber ese monto). */
export function AnularPagoBoton({ pagoId, descripcion }: { pagoId: string; descripcion: string }) {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    setEnviando(true);
    const r = await anularPagoAction({ pagoId, motivo });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error.fields?.motivo?.[0]);
      if (!r.error.fields?.motivo) toast.error("No se pudo anular el pago", r.error.message);
      return;
    }
    setAbierto(false);
    toast.success("Pago anulado", "La venta vuelve a deber ese monto.");
    router.refresh();
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="text-danger size-8"
        onClick={() => setAbierto(true)}
        aria-label={`Anular pago ${descripcion}`}
      >
        <XCircle />
      </Button>
      <Dialog
        open={abierto}
        onOpenChange={setAbierto}
        title="¿Anular este pago?"
        description={`${descripcion}. La venta vuelve a deber ese monto (y si tiene cliente, suma a su cuenta corriente).`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAbierto(false)} disabled={enviando}>
              Volver
            </Button>
            <Button variant="danger" onClick={() => void enviar()} loading={enviando}>
              Anular pago
            </Button>
          </>
        }
      >
        <Textarea
          label="Motivo"
          required
          rows={2}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          error={error}
        />
      </Dialog>
    </>
  );
}

/** Link de WhatsApp con la URL pública del ticket (armada con el dominio actual). */
export function WhatsAppComprobante({
  pdfUrl,
  telefono,
  negocio,
  ventaNumero,
  total,
  comprobante,
  saldoPendiente,
  className,
  children,
}: {
  pdfUrl: string | null;
  telefono: string | null;
  negocio: string;
  ventaNumero: number;
  total: string;
  comprobante: string | null;
  saldoPendiente: string | null;
  className?: string;
  children: ReactNode;
}) {
  const [origen, setOrigen] = useState("");
  useEffect(() => setOrigen(window.location.origin), []);
  const href = linkWhatsApp(
    telefono,
    textoComprobante({
      negocio,
      ventaNumero,
      total,
      comprobante,
      urlPdf: pdfUrl ? (/^https?:\/\//.test(pdfUrl) ? pdfUrl : `${origen}${pdfUrl}`) : null,
      saldoPendiente,
    }),
  );
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className={cn(buttonVariants({ variant: "secondary", size: "sm" }), className)}
    >
      {children}
    </a>
  );
}
