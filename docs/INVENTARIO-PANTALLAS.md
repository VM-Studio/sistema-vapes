# Inventario de pantallas

Todas las rutas (`find src/app -name page.tsx`) con los Sheets, Dialogs y modales que se abren desde ellas. Estado: ✅ = rediseñada con el sistema de `docs/DISENO.md` y revisada a 375px y 1440px.

| Módulo | Ruta | Sheets / Dialogs | Estado |
| --- | --- | --- | --- |
| ayuda | `/ayuda` | — | ⬜ |
| clientes | `/p/[slug]/clientes` | — | ⬜ |
| clientes | `/p/[slug]/clientes/[id]` | — | ⬜ |
| compras | `/p/[slug]/compras` | — | ⬜ |
| compras | `/p/[slug]/compras/[id]` | — | ⬜ |
| compras | `/p/[slug]/compras/[id]/editar` | — | ⬜ |
| compras | `/p/[slug]/compras/nueva` | — | ⬜ |
| configuracion | `/configuracion` | — | ⬜ |
| configuracion | `/configuracion/auditoria` | — | ⬜ |
| configuracion | `/configuracion/backups` | — | ⬜ |
| configuracion | `/configuracion/exportar-todo` | — | ⬜ |
| configuracion | `/configuracion/negocio` | — | ⬜ |
| configuracion | `/configuracion/sistemas` | ConfirmDialog «¿Desactivar ${nombre» | ⬜ |
| configuracion | `/p/[slug]/configuracion` | — | ⬜ |
| configuracion | `/p/[slug]/configuracion/categorias` | — | ⬜ |
| configuracion | `/p/[slug]/configuracion/depositos` | — | ⬜ |
| configuracion | `/p/[slug]/configuracion/escaner` | — | ⬜ |
| configuracion | `/p/[slug]/configuracion/marcas` | — | ⬜ |
| configuracion | `/p/[slug]/configuracion/ventas` | — | ⬜ |
| cotizador | `/p/[slug]/cotizador` | — | ⬜ |
| cotizador | `/p/[slug]/cotizador/[id]` | — | ⬜ |
| cotizador | `/p/[slug]/cotizador/[id]/editar` | — | ⬜ |
| cotizador | `/p/[slug]/cotizador/configuracion` | — | ⬜ |
| cotizador | `/p/[slug]/cotizador/mayorista/nueva` | — | ⬜ |
| cotizador | `/p/[slug]/cotizador/unitaria/nueva` | — | ⬜ |
| cuenta | `/cuenta` | ConfirmDialog «¿Cerrar sesión en todos los dispositivos?» | ⬜ |
| dashboard | `/p/[slug]` | — | ⬜ |
| devoluciones | `/p/[slug]/devoluciones` | — | ⬜ |
| devoluciones | `/p/[slug]/devoluciones/[id]` | — | ⬜ |
| diseno | `/diseno` | Dialog «¿Anular la venta?»<br>Sheet «Nuevo proveedor» | ⬜ |
| equipo | `/p/[slug]/equipo` | — | ⬜ |
| equipo | `/p/[slug]/equipo/[usuarioId]` | — | ⬜ |
| login | `/login` | — | ⬜ |
| offline | `/offline` | — | ⬜ |
| paneles | `/paneles` | Sheet «Nuevo sistema» | ⬜ |
| productos | `/p/[slug]/productos` | — | ⬜ |
| productos | `/p/[slug]/productos/[id]` | — | ⬜ |
| productos | `/p/[slug]/productos/[id]/editar` | — | ⬜ |
| productos | `/p/[slug]/productos/cargar` | — | ⬜ |
| productos | `/p/[slug]/productos/etiquetas` | — | ⬜ |
| productos | `/p/[slug]/productos/nuevo` | — | ⬜ |
| proveedores | `/p/[slug]/proveedores` | — | ⬜ |
| proveedores | `/p/[slug]/proveedores/[id]` | — | ⬜ |
| raíz | `/` | — | ⬜ |
| reportes | `/p/[slug]/reportes` | — | ⬜ |
| reportes | `/p/[slug]/reportes/clientes` | — | ⬜ |
| reportes | `/p/[slug]/reportes/comparador` | — | ⬜ |
| reportes | `/p/[slug]/reportes/compras` | — | ⬜ |
| reportes | `/p/[slug]/reportes/devoluciones` | — | ⬜ |
| reportes | `/p/[slug]/reportes/empresa` | — | ⬜ |
| reportes | `/p/[slug]/reportes/movimientos` | — | ⬜ |
| reportes | `/p/[slug]/reportes/resumen-mensual` | — | ⬜ |
| reportes | `/p/[slug]/reportes/stock` | — | ⬜ |
| reportes | `/p/[slug]/reportes/vendedores` | — | ⬜ |
| reportes | `/p/[slug]/reportes/ventas` | — | ⬜ |
| sin-acceso | `/p/[slug]/sin-acceso` | — | ⬜ |
| sin-acceso | `/sin-acceso` | — | ⬜ |
| stock | `/p/[slug]/stock` | — | ⬜ |
| stock | `/p/[slug]/stock/movimientos` | — | ⬜ |
| stock | `/p/[slug]/stock/movimientos/transferencias` | — | ⬜ |
| stock | `/p/[slug]/stock/movimientos/transferencias/[id]` | — | ⬜ |
| usuarios | `/usuarios` | — | ⬜ |
| usuarios | `/usuarios/[id]` | — | ⬜ |
| ventas | `/p/[slug]/ventas` | — | ⬜ |
| ventas | `/p/[slug]/ventas/[id]` | — | ⬜ |

## Sheets y Dialogs de componentes compartidos

| Componente | Overlay | Estado |
| --- | --- | --- |
| `src/components/catalogo/filtros-catalogo.tsx` | Sheet «Filtros» | ⬜ |
| `src/components/layout/mobile-nav.tsx` | Sheet «Más opciones» | ⬜ |
| `src/components/pwa/banner-instalar.tsx` | Dialog «Instalar en iPhone» | ⬜ |
