# Ripley Track Backend

API NestJS que actúa como capa intermedia hacia las APIs corporativas de Ripley
(picking, despacho, configuración de tipos de servicio, transferencias entre
sucursales y simulación de entregas), para Perú y Chile.

**Los datos de negocio no se guardan aquí**: cada request resuelve su estado leyendo
en vivo los catálogos y capacidades de la API de Ripley, y arma el payload de
escritura reconstruyendo los campos que la API exige pero que el cliente nunca
recibió (identificadores internos, campos "espejo", etc.).

En Supabase solo vive lo que es del backend y no de Ripley: las cuentas y sus perfiles,
el historial de cambios y el token corporativo de cada usuario, cifrado.

## Arquitectura

Cada carpeta bajo `src/` es un módulo de Nest independiente, con la carpeta
espejando el path de su propio `@Controller(...)`:

| Módulo | Ruta base | Qué hace |
| --- | --- | --- |
| [auth](src/auth) | `/auth` | Sesión y perfil: registro, login, refresh, logout y datos del usuario |
| [agendas/picking](src/agendas/picking) | `/agendas/picking` | Capacidades de picking por almacén y tipo de servicio |
| [agendas/despacho](src/agendas/despacho) | `/agendas/despacho` | Capacidades de despacho por operador logístico, zona y agenda |
| [reportes/cds](src/reportes/cds) | `/reportes/cds` | Reporte pivote de uso de capacidad por centro de distribución |
| [configuracion/tipo-servicio/opl](src/configuracion/tipo-servicio/opl) | `/configuracion/tipo-servicio/opl` | Servicios configurados en la agenda de un OPL |
| [configuracion/tipo-servicio/opl-masivo](src/configuracion/tipo-servicio/opl-masivo) | `/configuracion/tipo-servicio/opl-masivo` | Activación/desactivación masiva de tipos de servicio |
| [configuracion/transf-suc](src/configuracion/transf-suc) | `/configuracion/transferencia-sucursales` | Relaciones de transferencia de stock entre sucursales |
| [simulacion](src/simulacion) | `/simulacion` | Simulación de fecha/hora de entrega antes de vender |
| [agente](src/agente) | `/agente` | Consultas consolidadas para Silvana, la agente de IA en n8n |
| [chats](src/chats) | `/chats` | Conversaciones con Silvana, guardadas en Supabase por usuario |
| [configuracion/token-ripley](src/configuracion/token-ripley) | `/configuracion/token-ripley` | El token corporativo de cada usuario, cifrado |
| [auditoria](src/auditoria) | — | Registro de uso: quién hizo qué y qué cambió. No expone rutas |

## Autenticación

**Todos los endpoints exigen sesión** salvo `/auth/login` y `/auth/refresh`. El cliente
inicia sesión, guarda el `accessToken` y lo manda en `Authorization: Bearer <token>` en
cada llamada.

Además se guarda un **historial de cambios** en Supabase: cada operación que modifica datos
en Ripley queda registrada con quién la hizo, qué envió, **cómo estaban los datos antes y
cómo quedaron después**, y a qué hora. Las consultas no se registran.

La puesta en marcha (crear la tabla, configurar las claves, dar de alta usuarios) está en
[docs/auth-supabase.md](docs/auth-supabase.md), y el SQL de la tabla en
[docs/supabase-setup.sql](docs/supabase-setup.sql).

## Silvana, la agente de IA

Un flujo de n8n conversa con los usuarios y consulta este backend en su nombre. Las
peticiones que llegan con `X-Origen: agente` solo pasan por los endpoints marcados con
`@PermitidoAgente()`, y el resto recibe `403`. La lista es cerrada, así que un endpoint
nuevo nace bloqueado para el agente hasta que alguien lo marque a conciencia.

**Consultor o editor.** Por defecto el agente solo lee. Un interruptor en el chat lo pasa a
modo editor, y solo entonces puede usar la única ruta que escribe —`PUT /agente/capacidad`,
que cambia un día de una agenda de picking o despacho—, marcada con el decorador aparte
`@PermitidoAgenteEditor()`.

Tres cosas hacen que el interruptor sea un control y no un adorno:

- **El modo lo guarda el servidor**, no viaja en la petición. Si llegara en una cabecera,
  cualquiera podría declararse en modo editor y el interruptor no serviría de nada.
- **Caduca solo a la media hora**, porque un permiso olvidado encendido es justo lo que hay
  que evitar.
- **El agente no puede tocarlo.** `/agente/modo` está en la lista negra del guard: responde
  `403` a una petición del agente aunque alguien la marque por error. Un permiso que el
  permitido puede concederse a sí mismo no es un permiso.

Además, la escritura se niega sola cuando la petición es ambigua: si el filtro deja más de
una agenda no elige ninguna, no edita el pasado, y no baja el asignado por debajo de lo ya
ocupado. El detalle está en [docs/apis-backend.md](docs/apis-backend.md).

El **token corporativo de Ripley queda fuera de su alcance**: ningún endpoint lo devuelve, y
las rutas que lo gestionan están en una lista negra que ni siquiera un `@PermitidoAgente()`
puesto por error puede levantar. Cada consulta y cada cambio que hace el agente quedan en el
historial a nombre de quien preguntó, marcados como hechos por el agente. Activar el modo
editor también se registra.

El montaje del flujo está en [docs/agente-n8n.md](docs/agente-n8n.md), y el flujo listo para
importar en [docs/agente-capacidad-n8n.json](docs/agente-capacidad-n8n.json).

## Piezas compartidas

Todas comparten [common/ripley](src/common/ripley), que centraliza:

- **`RipleyHttpService`** — resuelve la URL base por país, adjunta el token corporativo
  del usuario que hace la petición, y traduce errores de la API corporativa a excepciones
  de Nest (un 404 se trata distinto de un 5xx). El token no sale del entorno: cada usuario
  guarda el suyo cifrado, ver [docs/token-ripley.md](docs/token-ripley.md). También
  resuelve el path de cada endpoint (`endpoint('offices')`), que antes cada service leía
  de la configuración por su cuenta con una copia idéntica del mismo método.
- **`CatalogosRipleyService`** — los catálogos que leen varios módulos: oficinas
  (`/offices`, que sirve almacenes y OPL según la bandera), servicios y agendas de
  picking. Los pedían por separado picking, despacho, el reporte de CDs, transferencias,
  tipo de servicio y simulación, cada uno armando la misma llamada. Solo lee; la
  interpretación —qué oficina elegir, qué hacer si falta— se queda en cada módulo.
- **`configuration.ts`** — carga URLs, tokens y endpoints desde variables de entorno.
- **`date.util.ts`** — conversión de fechas entre el formato ISO del backend y el
  `DD-MM-YYYY` que usa Ripley, utilidades de zona horaria (PE/CL) y `recortarDesde()`,
  que acota una agenda a los próximos días. Esa última es más delicada de lo que parece:
  Ripley devuelve la agenda entera aunque se le pase una fecha, así que hay que filtrar
  antes de cortar o se devuelven días del año pasado como si fueran los próximos.
- **`interfaces/ripley.interface.ts`** — las respuestas de Ripley que aparecen en más de
  un módulo (`OfficeRow`, `ScheduleRow`, `CapacitiesResponse`, `MainZoneRow`…). Cada
  módulo las re-exporta desde su propio archivo de interfaces, así que los imports no
  cambian, pero la forma se declara una sola vez.

Y [common/dto](src/common/dto), con `PaisDto` —el parámetro `pais`, que validaban por su
cuenta dieciséis DTOs— y `BuscarDto` para las búsquedas incrementales por texto.

Y [common/supabase](src/common/supabase), que expone los dos clientes de Supabase: uno con
la anon key para el login y otro con la service role key que escribe el registro de uso.

`prueba.html`, en la raíz del repo, es un panel HTML de un solo archivo para probar
manualmente todos los endpoints sin depender de un cliente externo.

## Requisitos

- Node.js 22+
- Acceso a la API corporativa de Ripley (URL base y token por país)
- Un proyecto de Supabase (autenticación y registro de uso)

## Configuración

```bash
cp .env.example .env
```

Completa en `.env` la URL base y los endpoints (`RIPLEY_EP_*`) de cada país. El
**token corporativo ya no va en el `.env`**: lo guarda cada usuario desde el panel y
se cifra con `TOKENS_CLAVE_CIFRADO`. `RIPLEY_PATH_PREFIX` es un prefijo común que se antepone a todos los
`RIPLEY_EP_*`; puede dejarse vacío si los endpoints ya vienen completos. El detalle
de cada variable está documentado en [`.env.example`](.env.example).

Completa también las tres variables `SUPABASE_*`. Sin ellas el servidor no arranca, porque
sin Supabase no puede autenticar a nadie. Antes del primer arranque hay que ejecutar
[`docs/supabase-setup.sql`](docs/supabase-setup.sql) en el SQL Editor de Supabase para
crear la tabla del registro de uso.

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
- Los DTOs validan con `class-validator` y heredan de `PaisDto` cuando aceptan país, en
  vez de repetir sus decoradores; los controllers no acceden a la API de Ripley
  directamente, siempre a través del service de su propio módulo.
- Lo que **lee varios módulos** vive en `common/`: un catálogo consultado desde dos sitios
  se comparte, uno consultado desde uno se queda en su módulo. La excepción es la
  escritura, que se queda siempre en el módulo dueño de la operación.
- Los campos que la API de Ripley exige pero el cliente no controla (identificadores
  internos, banderas de compatibilidad con el frontend original, etc.) se resuelven
  en el service releyendo el estado actual — nunca se confía en lo que envía el
  cliente para esos campos.
