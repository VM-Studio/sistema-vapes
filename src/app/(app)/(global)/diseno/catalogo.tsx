"use client";

import {
  Boxes,
  Download,
  Package,
  Pencil,
  Plus,
  ScanLine,
  Search,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { BarrasHorizontales } from "@/components/analitica/barras";
import { DonutMedios } from "@/components/analitica/donut-medios";
import { GraficoComparativo, type PuntoGrafico } from "@/components/analitica/grafico-comparativo";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartPlaceholder, ChartTheme, COLORES_MARCA } from "@/components/ui/chart-theme";
import { Checkbox } from "@/components/ui/checkbox";
import { FilterChip } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { MenuFila } from "@/components/ui/menu-fila";
import { PageHeader } from "@/components/ui/page-header";
import { Radio } from "@/components/ui/radio";
import { SectionCard } from "@/components/ui/section-card";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { Stepper } from "@/components/ui/stepper";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { formatearPesos } from "@/lib/format";

function Seccion({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-4">
      <h2 className="text-h2 font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

function Muestra({ nombre, hex, borde }: { nombre: string; hex: string; borde?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className={`h-16 rounded-control ${borde ? "border-border border" : ""}`}
        style={{ background: hex }}
      />
      <div className="flex flex-col">
        <span className="text-small font-medium">{nombre}</span>
        <span className="text-subtle font-mono text-xs uppercase">{hex}</span>
      </div>
    </div>
  );
}

const SERIE: PuntoGrafico[] = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d, i) => ({
  etiqueta: d,
  actual: [120, 180, 150, 240, 310, 420, 260][i]! * 1000,
  anterior: [100, 150, 170, 200, 260, 380, 300][i]! * 1000,
  fechaActual: null,
  fechaAnterior: null,
}));

interface Fila {
  id: string;
  producto: string;
  deposito: string;
  stock: number;
  precio: number;
}
const FILAS: Fila[] = [
  { id: "1", producto: "Ignite V80 · Menta", deposito: "Ayres Plaza", stock: 24, precio: 18500 },
  { id: "2", producto: "Elf Bar BC5000 · Uva", deposito: "Mercedes", stock: 3, precio: 16900 },
  {
    id: "3",
    producto: "Lost Mary MO5000 · Frutilla",
    deposito: "Ayres Plaza",
    stock: 0,
    precio: 17200,
  },
];

const INDICE = [
  ["colores", "Colores"],
  ["tipografia", "Tipografía"],
  ["botones", "Botones"],
  ["formularios", "Formularios"],
  ["filtros", "Filtros y pestañas"],
  ["badges", "Badges y avatares"],
  ["tarjetas", "Tarjetas"],
  ["tablas", "Tablas"],
  ["vacios", "Estados vacíos y carga"],
  ["navegacion", "Encabezados y pasos"],
  ["overlays", "Sheet, Dialog, Toast, Tooltip"],
  ["graficos", "Gráficos"],
] as const;

export function Catalogo() {
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [sw, setSw] = useState(true);
  const [chip, setChip] = useState("todos");
  const [tab, setTab] = useState<"resumen" | "detalle" | "historial">("resumen");
  const [seg, setSeg] = useState<"dia" | "semana" | "mes">("semana");
  const [paso, setPaso] = useState(1);

  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        breadcrumb={
          <Breadcrumb items={[{ label: "Sistemas", href: "/paneles" }, { label: "Diseño" }]} />
        }
        title="Sistema de diseño"
        subtitle="Referencia de tokens y componentes. Detalle en docs/DISENO.md."
      />

      <nav aria-label="Índice" className="flex flex-wrap gap-2">
        {INDICE.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="text-muted hover:text-foreground border-border rounded-control border px-3 py-1.5 text-sm"
          >
            {label}
          </a>
        ))}
      </nav>

      <Seccion id="colores" titulo="Colores">
        <p className="text-muted max-w-2xl text-sm">
          Blanco y negro. Tarjetas en gris clarito. Azul y naranja del logo solo en gráficos y
          comparación de datos (y la línea del ítem activo del menú). Semánticos apagados solo en
          badges, toasts y validaciones.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          <Muestra nombre="Fondo" hex="#FFFFFF" borde />
          <Muestra nombre="Tarjeta" hex="#F4F5F7" />
          <Muestra nombre="Superficie 3" hex="#E9EBEE" />
          <Muestra nombre="Borde" hex="#E6E8EB" />
          <Muestra nombre="Texto" hex="#0A0A0A" />
          <Muestra nombre="Secundario" hex="#525252" />
          <Muestra nombre="Terciario" hex="#8A8A8A" />
        </div>
        <div className="grid grid-cols-3 gap-4 lg:grid-cols-6">
          <Muestra nombre="Azul oscuro" hex={COLORES_MARCA.azulOscuro.toUpperCase()} />
          <Muestra nombre="Azul (actual)" hex={COLORES_MARCA.azul.toUpperCase()} />
          <Muestra nombre="Azul claro" hex={COLORES_MARCA.azulClaro.toUpperCase()} />
          <Muestra nombre="Naranja oscuro" hex={COLORES_MARCA.naranjaOscuro.toUpperCase()} />
          <Muestra nombre="Naranja (anterior)" hex={COLORES_MARCA.naranja.toUpperCase()} />
          <Muestra nombre="Naranja claro" hex={COLORES_MARCA.naranjaClaro.toUpperCase()} />
        </div>
        <div className="grid grid-cols-3 gap-4 lg:grid-cols-6">
          <Muestra nombre="Éxito" hex="#3E7A56" />
          <Muestra nombre="Error" hex="#B04A45" />
          <Muestra nombre="Alerta" hex="#A0721F" />
        </div>
      </Seccion>

      <Seccion id="tipografia" titulo="Tipografía">
        <Card className="flex flex-col gap-3 p-6">
          <p className="text-display font-semibold">Display 32/36</p>
          <p className="text-h1 font-semibold">H1 24 · Título de página</p>
          <p className="text-h2 font-semibold">H2 20 · Sección</p>
          <p className="text-h3 font-semibold">H3 16 · Tarjeta</p>
          <p className="text-body">Body 15 · Texto de lectura y controles en mobile.</p>
          <p className="text-small text-muted">Small 13 · Ayudas, etiquetas, metadatos.</p>
          <p className="text-h2 font-semibold tabular-nums">
            {formatearPesos(12345)} · {formatearPesos(1111111)} · {formatearPesos(340000)}
          </p>
        </Card>
      </Seccion>

      <Seccion id="botones" titulo="Botones">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primario</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="ghost">Terciario</Button>
          <Button variant="danger">Peligro</Button>
          <Button loading>Guardando</Button>
          <Button disabled>Deshabilitado</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">
            <Plus strokeWidth={1.75} /> Chico
          </Button>
          <Button>
            <ScanLine strokeWidth={1.75} /> Mediano
          </Button>
          <Button size="lg">Grande</Button>
          <Button variant="secondary" size="icon" aria-label="Descargar">
            <Download strokeWidth={1.75} />
          </Button>
          <IconButton aria-label="Editar">
            <Pencil strokeWidth={1.75} />
          </IconButton>
          <IconButton aria-label="Borrar" variant="secondary" size="sm">
            <Trash2 strokeWidth={1.75} />
          </IconButton>
        </div>
      </Seccion>

      <Seccion id="formularios" titulo="Formularios">
        <Card className="grid gap-5 p-6 md:grid-cols-2">
          <Input label="Nombre" placeholder="Ej: Ignite V80" hint="Como aparece en el ticket" />
          <Input label="Precio" defaultValue="-5" error="El precio no puede ser negativo" />
          <Select
            label="Depósito"
            placeholder="Elegí un depósito"
            defaultValue=""
            options={[
              { value: "a", label: "Ayres Plaza" },
              { value: "m", label: "Mercedes" },
            ]}
          />
          <Input label="Deshabilitado" disabled defaultValue="No editable" />
          <Textarea label="Notas" placeholder="Opcional" containerClassName="md:col-span-2" />
          <div className="flex flex-col gap-1">
            <Switch checked={sw} onCheckedChange={setSw} label="Avisar stock bajo" />
            <Checkbox label="Incluir desactivados" defaultChecked />
          </div>
          <fieldset className="flex flex-col">
            <legend className="text-small mb-1 font-medium">Medio de pago</legend>
            <Radio name="medio" label="Efectivo" defaultChecked />
            <Radio name="medio" label="Transferencia" hint="Con comprobante" />
          </fieldset>
        </Card>
      </Seccion>

      <Seccion id="filtros" titulo="Filtros y pestañas">
        <div className="flex flex-wrap gap-2">
          {["todos", "bajo mínimo", "sin stock", "desactivados"].map((c) => (
            <FilterChip key={c} activo={chip === c} onClick={() => setChip(c)}>
              {c[0]!.toUpperCase() + c.slice(1)}
            </FilterChip>
          ))}
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "resumen", label: "Resumen" },
            { value: "detalle", label: "Detalle", badge: 12 },
            { value: "historial", label: "Historial" },
          ]}
        />
        <Tabs
          variant="segmentado"
          value={seg}
          onChange={setSeg}
          items={[
            { value: "dia", label: "Día" },
            { value: "semana", label: "Semana" },
            { value: "mes", label: "Mes" },
          ]}
        />
      </Seccion>

      <Seccion id="badges" titulo="Badges y avatares">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Neutral</Badge>
          <Badge variant="primary">Énfasis</Badge>
          <Badge variant="success">Pagada</Badge>
          <Badge variant="warning">Bajo mínimo</Badge>
          <Badge variant="danger">Anulada</Badge>
        </div>
        <div className="flex items-center gap-3">
          <Avatar nombre="Juan Cruz Benitez" />
          <Avatar nombre="Agustina" className="size-10" />
          <Avatar nombre="Trinidad" className="size-8" />
        </div>
      </Seccion>

      <Seccion id="tarjetas" titulo="Tarjetas">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            label="Facturado"
            value={formatearPesos(1284300)}
            anterior={formatearPesos(1102000)}
            etiquetaAnterior="Semana pasada"
            deltaPct={16.5}
          />
          <StatCard
            label="Ventas"
            value="84"
            anterior="91"
            etiquetaAnterior="Semana pasada"
            deltaPct={-7.7}
          />
          <StatCard label="Stock bajo" value="6" hint="Productos bajo el mínimo" href="#tarjetas" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Card por defecto</CardTitle>
              <CardDescription>Gris clarito, sin borde ni sombra.</CardDescription>
            </CardHeader>
            <CardContent>
              <Input label="Adentro, sobre blanco" placeholder="Input" />
            </CardContent>
          </Card>
          <Card variant="clickable" className="cursor-pointer p-6">
            <p className="text-h3 font-semibold">Clickeable</p>
            <p className="text-muted text-sm">Hover con sombra sutil.</p>
          </Card>
          <Card variant="kpi">
            <p className="text-muted text-small font-medium">Variante kpi</p>
            <p className="text-2xl font-semibold">{formatearPesos(340000)}</p>
          </Card>
        </div>
        <SectionCard
          title="Tarjeta de sección"
          description="Título + contenido, acción a la derecha."
          action={
            <Button variant="secondary" size="sm">
              Ver todo
            </Button>
          }
        >
          <p className="text-muted text-sm">Contenido de la sección.</p>
        </SectionCard>
      </Seccion>

      <Seccion id="tablas" titulo="Tablas">
        <DataTable
          caption="Productos de ejemplo"
          rows={FILAS}
          getRowKey={(f) => f.id}
          columns={[
            {
              key: "producto",
              header: "Producto",
              cell: (f) => <span className="font-medium">{f.producto}</span>,
            },
            { key: "deposito", header: "Depósito", cell: (f) => f.deposito },
            {
              key: "estado",
              header: "Estado",
              cell: (f) =>
                f.stock === 0 ? (
                  <Badge variant="danger">Sin stock</Badge>
                ) : f.stock < 5 ? (
                  <Badge variant="warning">Bajo mínimo</Badge>
                ) : (
                  <Badge>OK</Badge>
                ),
            },
            { key: "stock", header: "Stock", className: "text-right", cell: (f) => f.stock },
            {
              key: "precio",
              header: "Precio",
              className: "text-right",
              cell: (f) => formatearPesos(f.precio),
            },
            {
              key: "acciones",
              header: <span className="sr-only">Acciones</span>,
              className: "w-12 text-right",
              ocultarEnMobile: true,
              cell: () => (
                <MenuFila
                  acciones={[
                    { label: "Editar", icon: Pencil, onSelect: () => toast.info("Editar") },
                    {
                      label: "Dar de baja",
                      icon: Trash2,
                      peligro: true,
                      onSelect: () => toast.error("Baja"),
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </Seccion>

      <Seccion id="vacios" titulo="Estados vacíos y carga">
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState
            icon={Package}
            title="Todavía no hay productos"
            description="Escaneá el código de barras y cargá el primero en segundos."
            action={
              <Button>
                <ScanLine strokeWidth={1.75} /> Cargar tu primer producto escaneando
              </Button>
            }
          />
          <EmptyState
            icon={Search}
            title="No hay resultados con esos filtros"
            action={<Button variant="secondary">Limpiar filtros</Button>}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </Seccion>

      <Seccion id="navegacion" titulo="Encabezados y pasos">
        <Card className="p-6">
          <PageHeader
            className="mb-0 md:mb-0"
            breadcrumb={
              <Breadcrumb
                items={[
                  { label: "Vapes", href: "#" },
                  { label: "Productos", href: "#" },
                  { label: "Ignite V80" },
                ]}
              />
            }
            title="Ignite V80"
            subtitle="Menta · 8000 pitadas"
            actions={
              <>
                <Button variant="secondary">
                  <Pencil strokeWidth={1.75} /> Editar
                </Button>
                <Button>
                  <ShoppingCart strokeWidth={1.75} /> Vender
                </Button>
              </>
            }
          />
        </Card>
        <Card className="flex flex-col gap-4 p-6">
          <Stepper pasos={["Productos", "Cliente", "Pago", "Confirmar"]} actual={paso} />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPaso((p) => Math.max(0, p - 1))}
            >
              Anterior
            </Button>
            <Button size="sm" onClick={() => setPaso((p) => Math.min(3, p + 1))}>
              Siguiente
            </Button>
          </div>
        </Card>
      </Seccion>

      <Seccion id="overlays" titulo="Sheet, Dialog, Toast, Tooltip">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => setSheet(true)}>
            Abrir Sheet
          </Button>
          <Button variant="secondary" onClick={() => setDialog(true)}>
            Abrir Dialog
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.success("Venta registrada", "V-000123 · $ 18.500")}
          >
            Toast éxito
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.error("No se pudo guardar", "Revisá la conexión")}
          >
            Toast error
          </Button>
          <Button variant="secondary" onClick={() => toast.info("Catálogo actualizado")}>
            Toast info
          </Button>
          <Tooltip content="Stock sumado de todos los depósitos">
            <Button variant="ghost" aria-label="Qué es el stock total">
              <Boxes strokeWidth={1.75} /> Tooltip
            </Button>
          </Tooltip>
        </div>
        <Sheet
          open={sheet}
          onOpenChange={setSheet}
          title="Nuevo proveedor"
          description="Sheet: desde abajo en mobile, lateral en desktop."
          footer={
            <>
              <Button variant="secondary" onClick={() => setSheet(false)}>
                Cancelar
              </Button>
              <Button onClick={() => setSheet(false)}>Guardar</Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Input label="Nombre" />
            <Input label="Teléfono" inputMode="tel" />
          </div>
        </Sheet>
        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title="¿Anular la venta?"
          description="El stock vuelve al depósito. No se puede deshacer."
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialog(false)}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={() => setDialog(false)}>
                Anular
              </Button>
            </>
          }
        />
      </Seccion>

      <Seccion id="graficos" titulo="Gráficos">
        <p className="text-muted max-w-2xl text-sm">
          Configuración central en <code className="font-mono">ChartTheme</code>: actual azul{" "}
          <span className="font-mono">{ChartTheme.actual}</span>, anterior naranja{" "}
          <span className="font-mono">{ChartTheme.anterior}</span>, grilla gris, tooltips con estilo
          de tarjeta.
        </p>
        <SectionCard title="Facturado: esta semana vs. la anterior">
          <GraficoComparativo datos={SERIE} />
        </SectionCard>
        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard title="Por vendedor">
            <BarrasHorizontales
              datos={[
                { etiqueta: "Agustina", valor: 540000, detalle: "31 ventas" },
                { etiqueta: "Trinidad", valor: 410000, detalle: "24 ventas" },
                { etiqueta: "Juan Cruz", valor: 220000, detalle: "12 ventas" },
              ]}
            />
          </SectionCard>
          <SectionCard title="Medios de pago">
            <DonutMedios
              datos={[
                { etiqueta: "Efectivo", cantidad: 40, total: 620000 },
                { etiqueta: "Transferencia", cantidad: 22, total: 480000 },
                { etiqueta: "Binance", cantidad: 5, total: 90000 },
              ]}
            />
          </SectionCard>
        </div>
        <SectionCard title="Sin datos">
          <ChartPlaceholder mensaje="Todavía no hay ventas en este período" />
        </SectionCard>
      </Seccion>
    </div>
  );
}
