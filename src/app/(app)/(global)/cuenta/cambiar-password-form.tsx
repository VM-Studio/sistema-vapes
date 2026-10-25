"use client";

import { Check, CircleAlert, KeyRound, MailCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { aplicarErroresServidor, Form, FormInput, useZodForm } from "@/components/ui/form";
import { Stepper } from "@/components/ui/stepper";
import { useToast } from "@/components/ui/toast";
import {
  ETIQUETA_FUERZA,
  enmascararEmail,
  fuerzaPassword,
  requisitosPassword,
} from "@/lib/password-fuerza";
import { cn } from "@/lib/utils";
import {
  cambiarPasswordSchema,
  passwordNuevaSchema,
  codigoMailSchema,
  type CambiarPassword,
  type PasswordNueva,
  type CodigoMail,
} from "@/lib/validations/usuario";

import {
  cambiarPasswordAction,
  cambiarPasswordConCodigoAction,
  enviarCodigoAction,
  verificarCodigoAction,
} from "./actions";

const PASOS = ["Pedir código", "Verificar", "Contraseña nueva"];

const SIN_MAIL =
  "No pudimos mandar el mail. Pedile a un dueño que te cambie la contraseña desde Usuarios.";

type Estado =
  | { paso: "inicio"; aviso?: { tipo: "error" | "info"; texto: string } }
  | { paso: "codigo"; para: string; venceAt: string; reenviarDesde: number }
  | { paso: "nueva"; token: string }
  | { paso: "listo"; sesionesCerradas: number; avisoEnviado: boolean };

const horaAR = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(iso));

function Aviso({ tipo, children }: { tipo: "error" | "info" | "ok"; children: React.ReactNode }) {
  const Icono = tipo === "ok" ? Check : tipo === "error" ? CircleAlert : MailCheck;
  return (
    <div
      role={tipo === "error" ? "alert" : "status"}
      className={cn(
        "rounded-control flex gap-3 px-4 py-3 text-sm",
        tipo === "error" && "bg-danger-soft text-danger-soft-foreground",
        tipo === "info" && "bg-surface-2 text-foreground",
        tipo === "ok" && "bg-success-soft text-success-soft-foreground",
      )}
    >
      <Icono className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Segundos que faltan hasta `desde + 60 s` (se actualiza cada segundo). */
function useCuentaRegresiva(hasta: number | null): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (hasta === null) return;
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasta]);
  return hasta === null ? 0 : Math.max(0, Math.ceil((hasta - ahora) / 1000));
}

/** Cambio de contraseña en 3 pasos: código por mail → validarlo → contraseña nueva. */
export function CambiarPasswordConCodigo({ email }: { email: string }) {
  const router = useRouter();
  const toast = useToast();
  const [estado, setEstado] = useState<Estado>({ paso: "inicio" });
  const [enviando, setEnviando] = useState(false);

  async function enviar(): Promise<boolean> {
    setEnviando(true);
    try {
      const r = await enviarCodigoAction();
      if (!r.ok) {
        if (estado.paso === "codigo") toast.error("No se pudo reenviar", r.error.message);
        else setEstado({ paso: "inicio", aviso: { tipo: "error", texto: r.error.message } });
        return false;
      }
      if (r.data.estado !== "ENVIADO") {
        setEstado({ paso: "inicio", aviso: { tipo: "error", texto: SIN_MAIL } });
        return false;
      }
      setEstado({
        paso: "codigo",
        para: r.data.para,
        venceAt: r.data.venceAt,
        reenviarDesde: Date.now() + r.data.reenviarEnSegundos * 1000,
      });
      return true;
    } finally {
      setEnviando(false);
    }
  }

  const paso = estado.paso === "inicio" ? 0 : estado.paso === "codigo" ? 1 : 2;

  return (
    <div className="flex flex-col gap-5">
      {estado.paso !== "listo" && <Stepper pasos={PASOS} actual={paso} />}

      {estado.paso === "inicio" && (
        <>
          {estado.aviso && <Aviso tipo={estado.aviso.tipo}>{estado.aviso.texto}</Aviso>}
          <p className="text-small text-muted">
            Para confirmar que sos vos te mandamos un código de 6 dígitos a{" "}
            <strong className="text-foreground break-all">{enmascararEmail(email)}</strong>. Vence a
            los 10 minutos.
          </p>
          <div className="flex md:justify-end">
            <Button onClick={enviar} loading={enviando} className="w-full md:w-auto">
              <KeyRound strokeWidth={1.75} /> Enviar código
            </Button>
          </div>
        </>
      )}

      {estado.paso === "codigo" && (
        <PasoCodigo
          para={estado.para}
          venceAt={estado.venceAt}
          reenviarDesde={estado.reenviarDesde}
          reenviando={enviando}
          onReenviar={async () => {
            if (await enviar()) toast.success("Te mandamos un código nuevo");
          }}
          onCancelar={() => setEstado({ paso: "inicio" })}
          onVerificado={(token) => setEstado({ paso: "nueva", token })}
        />
      )}

      {estado.paso === "nueva" && (
        <PasoNueva
          token={estado.token}
          onVencido={(texto) => setEstado({ paso: "inicio", aviso: { tipo: "error", texto } })}
          onListo={(r) => {
            toast.success("Contraseña actualizada");
            // Carga completa: el layout deja el modo restringido y muestra la navegación.
            if (r.habilitado) return window.location.assign("/");
            setEstado({
              paso: "listo",
              sesionesCerradas: r.sesionesCerradas,
              avisoEnviado: r.aviso === "ENVIADO",
            });
            router.refresh();
          }}
        />
      )}

      {estado.paso === "listo" && (
        <>
          <Aviso tipo="ok">
            <p className="font-semibold">Listo: tu contraseña se cambió.</p>
            <p>
              {estado.sesionesCerradas > 0
                ? `Cerramos tu sesión en ${estado.sesionesCerradas} ${estado.sesionesCerradas === 1 ? "dispositivo más" : "dispositivos más"}; este sigue abierto.`
                : "Este dispositivo sigue con la sesión abierta."}
              {estado.avisoEnviado && " Te mandamos un aviso por mail."}
            </p>
          </Aviso>
          <div className="flex md:justify-end">
            <Button
              variant="secondary"
              onClick={() => setEstado({ paso: "inicio" })}
              className="w-full md:w-auto"
            >
              Listo
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function PasoCodigo({
  para,
  venceAt,
  reenviarDesde,
  reenviando,
  onReenviar,
  onCancelar,
  onVerificado,
}: {
  para: string;
  venceAt: string;
  reenviarDesde: number;
  reenviando: boolean;
  onReenviar: () => void;
  onCancelar: () => void;
  onVerificado: (token: string) => void;
}) {
  const faltan = useCuentaRegresiva(reenviarDesde);
  const form = useZodForm(codigoMailSchema, { defaultValues: { codigo: "" } });

  async function onSubmit(data: CodigoMail) {
    const r = await verificarCodigoAction(data);
    if (!r.ok) return aplicarErroresServidor(form, r.error);
    onVerificado(r.data.token);
  }

  return (
    <Form form={form} onSubmit={onSubmit}>
      <Aviso tipo="info">
        Te mandamos el código a <strong className="break-all">{para}</strong>. Vence a las{" "}
        <strong className="tabular-nums">{horaAR(venceAt)}</strong>.
      </Aviso>
      <FormInput
        name="codigo"
        label="Código de 6 dígitos"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        autoFocus
        className="text-h3 text-center font-mono tracking-[0.4em] tabular-nums"
        hint="¿No te llegó? Revisá en spam o correo no deseado."
      />
      <div className="flex flex-col gap-2 md:flex-row-reverse md:items-center">
        <Button type="submit" loading={form.formState.isSubmitting} className="w-full md:w-auto">
          Verificar código
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onReenviar}
          disabled={faltan > 0}
          loading={reenviando}
          className="w-full tabular-nums md:w-auto"
        >
          {faltan > 0 ? `Reenviar en ${faltan} s` : "Reenviar código"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancelar}
          className="w-full md:mr-auto md:w-auto"
        >
          Cancelar
        </Button>
      </div>
    </Form>
  );
}

/** Requisitos en vivo + barra de fuerza (la política la valida el servidor igual). */
function Requisitos({ nueva, repetida }: { nueva: string; repetida: string }) {
  const nivel = fuerzaPassword(nueva);
  const color = nivel <= 1 ? "bg-danger" : nivel === 2 ? "bg-warning" : "bg-success";
  return (
    <div className="flex flex-col gap-3" data-testid="requisitos-password">
      <div className="flex items-center gap-3">
        <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn("rounded-circle h-1.5", i <= nivel ? color : "bg-surface-3")}
            />
          ))}
        </div>
        <span className="text-small text-muted w-20 text-right" aria-live="polite">
          {ETIQUETA_FUERZA[nivel]}
        </span>
      </div>
      <ul className="text-small grid gap-1.5 sm:grid-cols-2">
        {requisitosPassword(nueva, repetida).map((r) => (
          <li
            key={r.id}
            className={cn("flex items-center gap-2", r.cumple ? "text-foreground" : "text-muted")}
          >
            <span
              className={cn(
                "rounded-circle flex size-4 shrink-0 items-center justify-center",
                r.cumple ? "bg-success text-background" : "border-border border",
              )}
              aria-hidden
            >
              {r.cumple && <Check className="size-3" strokeWidth={3} />}
            </span>
            {r.texto}
            <span className="sr-only">{r.cumple ? "(cumple)" : "(falta)"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PasoNueva({
  token,
  onVencido,
  onListo,
}: {
  token: string;
  onVencido: (mensaje: string) => void;
  onListo: (r: { habilitado: boolean; sesionesCerradas: number; aviso: string }) => void;
}) {
  const form = useZodForm(passwordNuevaSchema, {
    defaultValues: { passwordNueva: "", confirmacion: "" },
  });
  const [nueva = "", repetida = ""] = useWatch({
    control: form.control,
    name: ["passwordNueva", "confirmacion"],
  });

  async function onSubmit(data: PasswordNueva) {
    const r = await cambiarPasswordConCodigoAction({ ...data, token });
    if (!r.ok) {
      if (r.error.code === "VERIFICACION_VENCIDA") return onVencido(r.error.message);
      return aplicarErroresServidor(form, r.error);
    }
    onListo(r.data);
  }

  return (
    <Form form={form} onSubmit={onSubmit}>
      <Aviso tipo="ok">Código verificado. Elegí tu contraseña nueva.</Aviso>
      <FormInput
        name="passwordNueva"
        label="Contraseña nueva"
        type="password"
        autoComplete="new-password"
        autoFocus
      />
      <FormInput
        name="confirmacion"
        label="Repetir contraseña nueva"
        type="password"
        autoComplete="new-password"
      />
      <Requisitos nueva={nueva} repetida={repetida} />
      <p className="text-small text-muted">
        Al guardarla cerramos tu sesión en los demás dispositivos (este sigue abierto) y te avisamos
        por mail.
      </p>
      <div className="flex md:justify-end">
        <Button type="submit" loading={form.formState.isSubmitting} className="w-full md:w-auto">
          Guardar contraseña nueva
        </Button>
      </div>
    </Form>
  );
}

/**
 * Plan B, SOLO si el servidor no tiene mail configurado: con la contraseña
 * actual (la acción lo rechaza si hay mail). Así nadie queda trabado.
 */
export function CambiarPasswordConActual() {
  const toast = useToast();
  const form = useZodForm(cambiarPasswordSchema, {
    defaultValues: { passwordActual: "", passwordNueva: "", confirmacion: "" },
  });
  const [nueva = "", repetida = ""] = useWatch({
    control: form.control,
    name: ["passwordNueva", "confirmacion"],
  });

  async function onSubmit(data: CambiarPassword) {
    const r = await cambiarPasswordAction(data);
    if (!r.ok) return aplicarErroresServidor(form, r.error);
    form.reset();
    toast.success("Contraseña actualizada");
    if (r.data.habilitado) window.location.assign("/");
  }

  return (
    <Form form={form} onSubmit={onSubmit}>
      <Aviso tipo="error">
        {SIN_MAIL} Mientras tanto podés cambiarla con tu contraseña actual.
      </Aviso>
      <FormInput
        name="passwordActual"
        label="Contraseña actual"
        type="password"
        autoComplete="current-password"
      />
      <FormInput
        name="passwordNueva"
        label="Contraseña nueva"
        type="password"
        autoComplete="new-password"
      />
      <FormInput
        name="confirmacion"
        label="Repetir contraseña nueva"
        type="password"
        autoComplete="new-password"
      />
      <Requisitos nueva={nueva} repetida={repetida} />
      <div className="flex md:justify-end">
        <Button type="submit" loading={form.formState.isSubmitting} className="w-full md:w-auto">
          Cambiar contraseña
        </Button>
      </div>
    </Form>
  );
}
