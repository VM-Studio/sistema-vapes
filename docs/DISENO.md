# Sistema de diseño

Referencia única del aspecto del sistema. La versión viva, con todos los
componentes y sus variantes, está en **`/diseno`** (solo en desarrollo y solo
para dueños). Los tokens viven en `src/app/globals.css`; los gráficos toman sus
colores de `src/components/ui/chart-theme.tsx`.

## Reglas de color

Todos los colores salen del logo — marrón `#594A42`, azul `#004AAC`, naranja
`#FF914D` y oliva `#AEB03F` — y se usan **sutiles**: el marrón reemplaza al
negro; el azul entra como velos transparentes de fondo; naranja y oliva quedan
para datos y semánticos.

| Uso                                                   | Color                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Fondo de página (`fondo-marca`)                       | `#F5F7FB` + dos velos radiales `rgb(0 74 172 / 0.04–0.075)`                                                 |
| Barras superiores, sidebar, inputs, tablas            | Blanco `#FFFFFF` (`bg-surface`)                                                                             |
| Texto principal, botón primario, bordes de secundario | Marrón `#594A42` (`text-foreground`, `bg-primary`)                                                          |
| Hover del primario                                    | `#473A33`                                                                                                   |
| Texto secundario                                      | `#6E625B` (`text-muted`)                                                                                    |
| Texto terciario, placeholders                         | `#736861` (`text-subtle`)                                                                                   |
| Tarjetas, Sheets, Dialogs                             | Blanco (`bg-card`) con filete y sombra muy suave (`--sombra-tarjeta`, automática en `bg-card rounded-card`) |
| Encabezado de tablas                                  | `#F3F6FB` (`bg-surface-2`)                                                                                  |
| Hover de tarjeta clickeable                           | `shadow-card-hover`: filete azul y sombra un poco más marcada                                               |
| Superficie de contraste dentro de una tarjeta         | `#E5ECF6` (`bg-surface-3`)                                                                                  |
| Bordes y separadores                                  | `#E3E9F1` (`border-border`); dentro de tarjetas `border-marca-azul/[0.08]`                                  |
| Borde de inputs                                       | `#CFD8E4` (`border-input`)                                                                                  |
| Foco (`--ring`), selección de texto                   | Azul `#004AAC` / azul al 14%                                                                                |
| Ítem activo de sidebar y nav global                   | `bg-azul-velo-2`, texto e ícono azul semibold, línea azul de 3px; grupos en versalitas chicas               |
| Selector de período activo                            | Azul `#004AAC` con texto blanco                                                                             |
| Hover de navegación                                   | `bg-azul-velo-1` (azul al 3,5%)                                                                             |

Velos azules (transparentes, se apoyan sobre blanco): `--azul-velo-1` 3,5%,
`--azul-velo-2` 6%, `--azul-velo-3` 10% (`bg-azul-velo-*`).

**Colores del logo** (`--marca-*`, también en `COLORES_MARCA` de `chart-theme.tsx`):

| Token                    | Hex       | Uso                                      |
| ------------------------ | --------- | ---------------------------------------- |
| `--marca-marron`         | `#594A42` | texto y acción (en lugar del negro)      |
| `--marca-marron-oscuro`  | `#473A33` | hover del primario                       |
| `--marca-azul-oscuro`    | `#003580` | texto sobre `primary-soft`, escala       |
| `--marca-azul`           | `#004AAC` | serie **Actual**, deltas que suben, foco |
| `--marca-azul-claro`     | `#7FA3D6` | segunda categoría                        |
| `--marca-naranja-oscuro` | `#D9661F` | deltas que bajan                         |
| `--marca-naranja`        | `#FF914D` | serie **Anterior**                       |
| `--marca-naranja-claro`  | `#FFC59F` | cuarta categoría                         |
| `--marca-oliva`          | `#AEB03F` | quinta categoría                         |

**Semánticos apagados** (en la gama del logo) — badges, toasts y validaciones:
éxito oliva `#66691C` / `#F3F4E3`, error `#B04A45` / `#F8EEED`, alerta naranja
`#A64F15` / `#FFF3EA`.

**Métricas (StatCard / KpiCard)**: ícono en un círculo de su tono
(`--tono-*`: azul, cielo, oliva, naranja, marrón; fondo suave + ícono), valor
en negrita y la variación en una pastilla (oliva si sube, naranja si baja, con
flecha). El ícono y el tono salen de la etiqueta (`iconoMetrica()` en
`src/components/ui/icono-metrica.ts`: facturado azul, cobrado oliva, deudas
naranja, ganancia marrón, clientes celeste); se pueden fijar con `icono` /
`acento` (StatCard) o `icono` / `tono` (KpiCard). Desde 1280px el ícono va a
la izquierda; en pantallas más angostas, arriba.

**Gráficos**: línea Actual azul con relleno en degradé, Anterior naranja
punteada con un relleno muy tenue; leyendas con puntos. El donut de medios de
pago lleva la leyenda al costado cuando la tarjeta tiene lugar (container query).

**Osito sin fondo** (`public/brand/osito.png` 256px y `osito-512.png`,
generados desde `favicon-fuente.png`): marca en la barra global y el login; en
azul tenue al pie del sidebar; marca de agua teñida de azul (`.marca-agua
text-marca-azul opacity-[0.05–0.06]`)
en los estados vacíos y detrás del formulario de login.

Prohibido: acento por panel, dark mode, sombras fuertes, bordes gruesos,
negro puro, colores de la paleta de Tailwind (`bg-blue-500`, etc.) y hex
sueltos en componentes (salvo `chart-theme.tsx`). Los únicos gradientes son los
velos de `fondo-marca`.

## Forma

| Token              | Valor | Dónde                                                |
| ------------------ | ----- | ---------------------------------------------------- |
| `--radius-control` | 6px   | botones, inputs, selects, chips, tabs, badges, menús |
| `--radius-card`    | 10px  | tarjetas, Sheets, Dialogs, tablas, estados vacíos    |

La escala de Tailwind está remapeada: `rounded-md/lg/xl` = 6px y
`rounded-2xl/3xl` = 10px, así el código existente cae dentro del sistema.
`rounded-full` queda solo para avatares, puntos de estado y el switch. Nada de
píldoras.

## Tipografía

Dos familias, las dos self-hosteadas con `next/font` (`src/app/layout.tsx`):

- **Títulos: Poppins** (`--font-titulo`, clase `font-titulo`), la misma
  tipografía del wordmark "BISSCHEN" del logo. Se aplica sola, desde la capa
  base de `globals.css`, a todo `h1`–`h6` y a las clases `text-display`,
  `text-h1`, `text-h2` y `text-h3`: títulos de página, de tarjeta, de Sheet y
  Dialog, estados vacíos, secciones del inicio y de reportes. Una utilidad la
  pisa (p. ej. `font-mono` en el número de venta). La marca "Gestión" de la
  barra global va en Poppins extrabold itálica, como el logo.
- **Texto, botones, tablas y cifras: Inter** (`--font-sans`). Las cifras de
  KPIs quedan en Inter: es más angosta y los montos grandes entran en media
  pantalla de 375px.

Toda cifra con `tabular-nums` (aplicado en `body`).
Montos siempre con `formatearPesos()` → `$ 12.345` (`Intl.NumberFormat("es-AR")`).

| Clase          | Tamaño / alto de línea | Uso                               |
| -------------- | ---------------------- | --------------------------------- |
| `text-display` | 32/36                  | título de /paneles y login        |
| `text-h1`      | 24/32                  | título de página (`PageHeader`)   |
| `text-h2`      | 20/28                  | secciones, título de Sheet/Dialog |
| `text-h3`      | 16/24                  | título de tarjeta                 |
| `text-body`    | 15/24                  | texto base                        |
| `text-small`   | 13/20                  | labels, ayudas, metadatos         |

`cn()` (`src/lib/utils.ts`) conoce esta escala: `text-body` no pisa colores.

## Espaciado y layout

- Grilla de 8px. Márgenes de página 16px mobile / 32px desktop.
- Separación entre tarjetas 16px (`gap-4`). Contenido máximo 1280px centrado.
- Barra superior blanca de 56px en mobile y 64px en desktop, con línea inferior fina; logo del panel de 44 / 52px. Las pantallas globales (usuarios, configuración, cuenta, ayuda) van dentro de la barra y el menú del último panel abierto (cookie `panel_ultimo`); solo el selector de sistemas usa la barra global.
- Sidebar desktop 240px (colapsable a 64px), fondo blanco, grupos con etiqueta
  gris chica; activo sobre `bg-azul-velo-2` con ícono azul y línea azul de 2px a la izquierda;
  osito en azul tenue al pie.
- Bottom bar mobile blanca con línea superior, 5 ítems; activo en marrón con ícono azul,
  inactivo en gris. Safe areas respetadas (`pt-safe`, `pb-safe`, `env()`).

## Íconos

`lucide-react`, 20px (`size-5`), trazo 1.75, marrón o gris; azul solo en el ítem activo de la navegación.
Estados vacíos: ícono de 56px, trazo 1.25, gris.

## Componentes (`src/components/ui/`)

| Componente                                                           | Variantes / notas                                                                                                                                                                |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                                             | `primary` (marrón), `secondary` (blanco, borde marrón fino), `ghost`, `danger` (rojo apagado); `sm` 36px, `md` 44/40px, `lg` 48/44px, `icon`; `loading`, `disabled`, `fullWidth` |
| `IconButton`                                                         | solo ícono, `aria-label` obligatorio; `ghost`/`secondary`/`primary`, `md`/`sm`                                                                                                   |
| `Input`, `Select`, `Textarea`, `CantidadInput`, `SearchInput`        | borde gris, foco con halo suave, error en rojo apagado; 44px mobile / 40px desktop                                                                                               |
| `Switch`, `Checkbox`, `Radio`                                        | marrón al activarse                                                                                                                                                              |
| `ChipLink` / `FilterChip`                                            | filtro rectangular; activo = marrón                                                                                                                                              |
| `Tabs` (estado local, `linea` / `segmentado`), `TabsNav` (por URL)   | subrayado marrón                                                                                                                                                                 |
| `Badge`                                                              | `neutral`, `primary` (marrón), `success`, `warning`, `danger`                                                                                                                    |
| `Card`                                                               | `default`/`flat` (gris), `kpi`, `clickable` (hover), `outline` (blanco con borde, para ir dentro de otra tarjeta)                                                                |
| `StatCard`                                                           | valor grande, etiqueta, `anterior` + `deltaPct` (azul sube / naranja baja, con flecha), `href`                                                                                   |
| `SectionCard`                                                        | tarjeta con título, descripción y acción                                                                                                                                         |
| `DataTable`                                                          | desktop: tabla (encabezado gris, filas blancas, hover suave); mobile: cards. Numéricas con `className: "text-right"`; acciones con `MenuFila` al final                           |
| `MenuFila`                                                           | menú "…" de acciones de una fila                                                                                                                                                 |
| `EmptyState`                                                         | ícono grande gris, título, descripción, acción principal                                                                                                                         |
| `Skeleton`                                                           | gris con pulso                                                                                                                                                                   |
| `PageHeader`                                                         | título + subtítulo + acciones (derecha en desktop, apiladas en mobile), `breadcrumb` opcional                                                                                    |
| `Breadcrumb`                                                         | migas; la última es la página actual                                                                                                                                             |
| `Stepper`                                                            | pasos de modales en varias etapas                                                                                                                                                |
| `Sheet`                                                              | abajo en mobile, lateral en desktop; fondo gris                                                                                                                                  |
| `Dialog` / `ConfirmDialog`                                           | centrado; fondo gris                                                                                                                                                             |
| `Toast`                                                              | tarjeta gris, ícono semántico                                                                                                                                                    |
| `Tooltip`                                                            | marrón, texto blanco, hover y foco                                                                                                                                               |
| `Avatar`                                                             | circular, iniciales o foto (`src`)                                                                                                                                               |
| `ChartTheme`, `ChartTooltipCard`, `ChartPlaceholder`, `colorSerie()` | ver abajo                                                                                                                                                                        |

Las props existentes de todos los componentes se mantuvieron; las nuevas son
opcionales y con default que reproduce el comportamiento anterior.

## Gráficos (`ChartTheme`)

```tsx
import { ChartTheme, ChartPlaceholder } from "@/components/ui/chart-theme";

<CartesianGrid {...ChartTheme.grid} />
<XAxis dataKey="etiqueta" {...ChartTheme.ejeX} />
<YAxis {...ChartTheme.ejeY} />
<Tooltip contentStyle={ChartTheme.tooltip} />
<Line dataKey="actual" stroke={ChartTheme.actual} />
<Line dataKey="anterior" stroke={ChartTheme.anterior} strokeDasharray="5 4" />
```

- Actual = azul, Anterior = naranja punteado.
- Categorías con `ChartTheme.escala` en orden fijo: azul → azul claro →
  naranja → naranja claro → grises. El color sigue a la categoría.
- Sin datos: `<ChartPlaceholder mensaje="Todavía no hay ventas en este período" />`,
  nunca un gráfico vacío o roto.

## Estados vacíos

El sistema arranca sin datos. Cada listado distingue:

1. **Primera vez** (sin filtros): `EmptyState` con ícono, título "Todavía no
   hay …" y la acción principal ("Cargar tu primer producto escaneando",
   "Generar la primera venta", "Agregar un proveedor"…), solo si el usuario
   tiene permiso.
2. **Sin resultados** (con filtros): "No hay … con esos filtros" + "Limpiar filtros".

El dashboard sin ventas muestra las tarjetas en 0, el mensaje "Todavía no hay
ventas en este período" y los gráficos con placeholder.

## Marca y PWA

- Logos por panel: `public/logoVape.png`, `public/logoCosmetics.png`,
  `public/logoEspecial.png` (recortados y con fondo blanco puro; los originales
  en `public/brand/originales/`). `pnpm paneles:logos` actualiza `Panel.logoUrl`.
- Marca chica (barras y login): `public/brand/marca.png`.
- Favicon e íconos: `src/app/favicon.ico`, `icon1-3.png` (osito en el aro, fondo transparente y sin margen), `apple-icon.png` (sobre blanco). Fuente: `public/brand/favicon-fuente.png`.
- PWA desde `public/portadaApp.png`: `pnpm iconos` regenera íconos 192/512,
  maskable (zona segura 80%, fondo blanco), apple 180, splash de iPhone/iPad,
  screenshots del manifest y la imagen Open Graph.
- Sin logo, un panel muestra su nombre tipografiado (nunca iniciales).

## Contraste (WCAG AA, texto normal ≥ 4,5:1)

| Texto                | Sobre tarjeta `#F2F6FB` | Sobre hover `#EAF0F8` | Sobre blanco |
| -------------------- | ----------------------- | --------------------- | ------------ |
| Principal `#594A42`  | 7,79                    | 7,38                  | 8,46         |
| Secundario `#6E625B` | 5,43                    | 5,14                  | 5,90         |
| Terciario `#736861`  | 4,99                    | 4,72                  | 5,41         |
| Éxito `#66691C`      | 5,37                    | 5,09                  | 5,83         |
| Error `#B04A45`      | 4,95                    | 4,68                  | 5,37         |
| Alerta `#A64F15`     | 5,16                    | 4,88                  | 5,60         |

Blanco sobre el primario marrón: 8,46. Badges sobre su fondo suave: éxito 6,53
· error 6,47 · alerta 5,96.
