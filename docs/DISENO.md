# Sistema de diseño

Referencia única del aspecto del sistema. La versión viva, con todos los
componentes y sus variantes, está en **`/diseno`** (solo en desarrollo y solo
para dueños). Los tokens viven en `src/app/globals.css`; los gráficos toman sus
colores de `src/components/ui/chart-theme.tsx`.

## Reglas de color (sin excepciones)

| Uso                                                          | Color                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| Fondo de toda página, panel y módulo                         | Blanco puro `#FFFFFF`                                             |
| Texto principal                                              | `#0A0A0A` (`text-foreground`)                                     |
| Texto secundario                                             | `#525252` (`text-muted`)                                          |
| Texto terciario, placeholders                                | `#8A8A8A` (`text-subtle`)                                         |
| Tarjetas, Sheets, Dialogs, encabezado de tablas              | Gris clarito `#F4F5F7` (`bg-card`), sin borde ni sombra en reposo |
| Hover de tarjeta clickeable                                  | `#EEF0F3` (`bg-card-hover`) + sombra sutil (`shadow-card-hover`)  |
| Superficie de contraste dentro de una tarjeta (chips, hover) | `#E9EBEE` (`bg-surface-3`)                                        |
| Bordes y separadores                                         | `#E6E8EB` (`border-border`)                                       |
| Borde de inputs                                              | `#D4D7DC` (`border-input`)                                        |

Se compararon tres grises sobre blanco, con un input blanco adentro:
`#F5F5F5` (neutro puro, algo más plano y cálido), `#F3F4F6` (un punto más
oscuro) y `#F4F5F7`. Las diferencias son sutiles; se eligió `#F4F5F7` porque
es levemente frío, igual que el azul de la marca, se separa del blanco sin
verse sucio y el input blanco se sigue leyendo.

**Azul y naranja del logo** (extraídos con `sharp` de los tres logos y la portada):

| Token                    | Hex       | Uso                                |
| ------------------------ | --------- | ---------------------------------- |
| `--marca-azul-oscuro`    | `#00337F` | escala / énfasis en gráficos       |
| `--marca-azul`           | `#0047B0` | serie **Actual**, deltas que suben |
| `--marca-azul-claro`     | `#7FA6E0` | segunda categoría                  |
| `--marca-naranja-oscuro` | `#D95E1E` | deltas que bajan                   |
| `--marca-naranja`        | `#FE7B38` | serie **Anterior**                 |
| `--marca-naranja-claro`  | `#FFB892` | cuarta categoría                   |

> El segundo color de la marca es **naranja** (`#FE7B38`), no amarillo: es el
> del círculo del logo y de "VAPE / COSMETIC / ESPECIAL".

Aparecen **solo** en gráficos y comparación de datos (series, barras, donuts,
deltas de `StatCard`/tooltips). Nunca en botones, badges, links ni fondos.
Única excepción: la línea vertical fina del ítem activo del sidebar (azul).

**Semánticos apagados** — solo badges, toasts y validaciones:
éxito `#3E7A56` / `#EDF4EF`, error `#B04A45` / `#F8EEED`, alerta `#A0721F` / `#F8F2E6`.

Prohibido: acento por panel, dark mode, gradientes, sombras fuertes, bordes
gruesos, colores de la paleta de Tailwind (`bg-blue-500`, etc.) y hex sueltos
en componentes (salvo `chart-theme.tsx`).

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

Inter (`next/font`). Toda cifra con `tabular-nums` (aplicado en `body`).
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
- Barra superior blanca de 56px con línea inferior fina (panel y global).
- Sidebar desktop 240px (colapsable a 64px), fondo blanco, grupos con etiqueta
  gris chica; activo sobre `bg-card` con línea azul de 2px a la izquierda.
- Bottom bar mobile blanca con línea superior, 5 ítems; activo en negro,
  inactivo en gris. Safe areas respetadas (`pt-safe`, `pb-safe`, `env()`).

## Íconos

`lucide-react`, 20px (`size-5`), trazo 1.75, negro o gris. Nunca de color.
Estados vacíos: ícono de 56px, trazo 1.25, gris.

## Componentes (`src/components/ui/`)

| Componente                                                           | Variantes / notas                                                                                                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Button`                                                             | `primary` (negro), `secondary` (blanco, borde negro fino), `ghost`, `danger` (rojo apagado); `sm` 36px, `md` 44/40px, `lg` 48/44px, `icon`; `loading`, `disabled`, `fullWidth` |
| `IconButton`                                                         | solo ícono, `aria-label` obligatorio; `ghost`/`secondary`/`primary`, `md`/`sm`                                                                                                 |
| `Input`, `Select`, `Textarea`, `CantidadInput`, `SearchInput`        | borde gris, foco negro con halo suave, error en rojo apagado; 44px mobile / 40px desktop                                                                                       |
| `Switch`, `Checkbox`, `Radio`                                        | negro al activarse                                                                                                                                                             |
| `ChipLink` / `FilterChip`                                            | filtro rectangular; activo = negro                                                                                                                                             |
| `Tabs` (estado local, `linea` / `segmentado`), `TabsNav` (por URL)   | subrayado negro                                                                                                                                                                |
| `Badge`                                                              | `neutral`, `primary` (negro), `success`, `warning`, `danger`                                                                                                                   |
| `Card`                                                               | `default`/`flat` (gris), `kpi`, `clickable` (hover), `outline` (blanco con borde, para ir dentro de otra tarjeta)                                                              |
| `StatCard`                                                           | valor grande, etiqueta, `anterior` + `deltaPct` (azul sube / naranja baja, con flecha), `href`                                                                                 |
| `SectionCard`                                                        | tarjeta con título, descripción y acción                                                                                                                                       |
| `DataTable`                                                          | desktop: tabla (encabezado gris, filas blancas, hover suave); mobile: cards. Numéricas con `className: "text-right"`; acciones con `MenuFila` al final                         |
| `MenuFila`                                                           | menú "…" de acciones de una fila                                                                                                                                               |
| `EmptyState`                                                         | ícono grande gris, título, descripción, acción principal                                                                                                                       |
| `Skeleton`                                                           | gris con pulso                                                                                                                                                                 |
| `PageHeader`                                                         | título + subtítulo + acciones (derecha en desktop, apiladas en mobile), `breadcrumb` opcional                                                                                  |
| `Breadcrumb`                                                         | migas; la última es la página actual                                                                                                                                           |
| `Stepper`                                                            | pasos de modales en varias etapas                                                                                                                                              |
| `Sheet`                                                              | abajo en mobile, lateral en desktop; fondo gris                                                                                                                                |
| `Dialog` / `ConfirmDialog`                                           | centrado; fondo gris                                                                                                                                                           |
| `Toast`                                                              | tarjeta gris, ícono semántico                                                                                                                                                  |
| `Tooltip`                                                            | negro, texto blanco, hover y foco                                                                                                                                              |
| `Avatar`                                                             | circular, iniciales o foto (`src`)                                                                                                                                             |
| `ChartTheme`, `ChartTooltipCard`, `ChartPlaceholder`, `colorSerie()` | ver abajo                                                                                                                                                                      |

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

| Texto | Sobre tarjeta `#F4F5F7` | Sobre hover `#EEF0F3` | Sobre blanco |
| --- | --- | --- | --- |
| Principal `#0A0A0A` | 18,15 | 17,34 | 19,80 |
| Secundario `#525252` | 7,16 | 6,84 | 7,81 |
| Terciario `#6D6D6D` | 4,74 | 4,53 | 5,17 |
| Éxito `#3E7A56` | 4,67 | 4,46* | 5,09 |
| Error `#B04A45` | 4,92 | 4,70 | 5,37 |
| Alerta `#7D5816` | 5,87 | 5,61 | 6,40 |

Badges sobre su fondo suave: éxito 5,99 · error 6,47 · alerta 5,74.
\* El verde de éxito no se usa como texto sobre el hover de tarjeta.
