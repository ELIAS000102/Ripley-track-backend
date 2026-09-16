# Ripley Track Backend

API NestJS que actúa como capa intermedia hacia las APIs corporativas de Ripley
(picking, despacho, configuración de tipos de servicio, transferencias entre
sucursales y simulación de entregas), para Perú y Chile.

El backend no tiene base de datos propia: cada request resuelve su estado leyendo
en vivo los catálogos y capacidades de la API de Ripley, y arma el payload de
escritura reconstruyendo los campos que la API exige pero que el cliente nunca
recibió (identificadores internos, campos "espejo", etc.).

## Arquitectura

Cada carpeta bajo `src/` es un módulo de Nest independiente, con la carpeta
espejando el path de su propio `@Controller(...)`:

| Módulo | Ruta base | Qué hace |
| --- | --- | --- |
| [agendas/picking](src/agendas/picking) | `/agendas/picking` | Capacidades de picking por almacén y tipo de servicio |
| [agendas/despacho](src/agendas/despacho) | `/agendas/despacho` | Capacidades de despacho por operador logístico, zona y agenda |
| [reportes/cds](src/reportes/cds) | `/reportes/cds` | Reporte pivote de uso de capacidad por centro de distribución |
| [configuracion/tipo-servicio/opl](src/configuracion/tipo-servicio/opl) | `/configuracion/tipo-servicio/opl` | Servicios configurados en la agenda de un OPL |
| [configuracion/tipo-servicio/opl-masivo](src/configuracion/tipo-servicio/opl-masivo) | `/configuracion/tipo-servicio/opl-masivo` | Activación/desactivación masiva de tipos de servicio |
| [configuracion/transf-suc](src/configuracion/transf-suc) | `/configuracion/transferencia-sucursales` | Relaciones de transferencia de stock entre sucursales |
| [simulacion](src/simulacion) | `/simulacion` | Simulación de fecha/hora de entrega antes de vender |

Todas comparten [common/ripley](src/common/ripley), que centraliza:

- **`RipleyHttpService`** — resuelve URL base y token por país, y traduce errores
  de la API corporativa a excepciones de Nest (un 404 se trata distinto de un 5xx).
- **`configuration.ts`** — carga URLs, tokens y endpoints desde variables de entorno.
- **`date.util.ts`** — conversión de fechas entre el formato ISO del backend y el
  `DD-MM-YYYY` que usa Ripley, y utilidades de zona horaria (PE/CL).

`prueba.html`, en la raíz del repo, es un panel HTML de un solo archivo para probar
manualmente todos los endpoints sin depender de un cliente externo.

## Requisitos

- Node.js 22+
- Acceso a la API corporativa de Ripley (URL base y token por país)

## Configuración

```bash
cp .env.example .env
```

Completa en `.env` la URL base, el token y los endpoints (`RIPLEY_EP_*`) de cada
país. `RIPLEY_PATH_PREFIX` es un prefijo común que se antepone a todos los
`RIPLEY_EP_*`; puede dejarse vacío si los endpoints ya vienen completos. El detalle
de cada variable está documentado en [`.env.example`](.env.example).

## Instalación y ejecución

```bash
npm install

# desarrollo, con recarga en caliente
npm run start:dev

# producción (requiere `npm run build` antes)
npm run start:prod
```

El servidor arranca en `http://localhost:3000` por defecto (`PORT` en `.env`).

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run start:dev` | Servidor en modo watch |
| `npm run build` | Compila a `dist/` |
| `npm run lint` | oxlint sobre `src/` y `test/` |
| `npm run format` | Prettier sobre `src/` y `test/` |
| `npm run test` | Tests unitarios (Vitest) |
| `npm run test:e2e` | Tests end-to-end |

## Convenciones del proyecto

- Cada carpeta de módulo sigue `feature.controller.ts` / `feature.service.ts` /
  `feature.module.ts`, con `dto/` e `interfaces/` como subcarpetas. Nombres de
  carpeta y archivo en minúsculas, kebab-case para nombres compuestos.
- Los DTOs validan con `class-validator`; los controllers no acceden a la API de
  Ripley directamente, siempre a través del service de su propio módulo.
- Los campos que la API de Ripley exige pero el cliente no controla (identificadores
  internos, banderas de compatibilidad con el frontend original, etc.) se resuelven
  en el service releyendo el estado actual — nunca se confía en lo que envía el
  cliente para esos campos.
