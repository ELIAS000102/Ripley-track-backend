# APIs que expone el backend

Listado completo de los endpoints de este backend, con su URL de ejemplo lista para
copiar, método HTTP y para qué sirve cada uno.

## Datos comunes

| | |
| --- | --- |
| **Base URL local** | `http://localhost:3000` (configurable con `PORT`) |
| **Formato** | JSON en request y response |
| **CORS** | Habilitado para cualquier origen |
| **Autenticación** | Obligatoria en todos los endpoints salvo `/auth/login` y `/auth/refresh` |

**Todas las llamadas necesitan el header** `Authorization: Bearer <accessToken>`, que se
obtiene en `/auth/login`. Sin él responden `401`. El detalle del flujo de sesión está en
[auth-supabase.md](auth-supabase.md).

```bash
curl http://localhost:3000/agendas/picking/oficinas?pais=PE \
  -H "Authorization: Bearer eyJhbGciOi..."
```

Las operaciones que **modifican datos** (los `PUT` y el `POST` de activación masiva) quedan
registradas en Supabase con el usuario, los datos enviados, cómo estaban antes, cómo
quedaron después y la hora. Las consultas no se registran.

**El parámetro `pais`** es opcional en todos los endpoints y acepta solo `PE` o `CL`.
Si se omite, se asume `PE`. Define contra qué API de Ripley (host y token) se consulta.

**Validación:** todos los parámetros y bodies se validan con `class-validator`. Los campos
no declarados se descartan silenciosamente, y si algo no valida se responde `400` con el
detalle:

```json
{ "statusCode": 400, "message": ["from debe tener el formato DD-MM-YYYY"], "error": "Bad Request" }
```

**Formatos de fecha según el endpoint:**

| Formato | Dónde se usa |
| --- | --- |
| `DD-MM-YYYY` | `from` y `date` de las agendas de picking y despacho |
| `YYYY-MM-DD` | `desde` del reporte de CDs |
| `DD/MM/YYYY` | `date` de la simulación |
| ISO completo | `day` del PUT de picking (`2026-09-15T00:00:00.000Z`) |

> Los ids largos (`643d9ac3b686840012dd4848`) y los códigos (`20026`, `1130`) de los
> ejemplos son ilustrativos: se obtienen de los endpoints de catálogo de cada módulo.

---

## Resumen — 39 endpoints

### Sesión y perfil

| Método | URL | Uso |
| --- | --- | --- |
| POST | `/auth/registro` | Crear una cuenta (público) |
| POST | `/auth/login` | Iniciar sesión (público) |
| POST | `/auth/refresh` | Renovar el accessToken (público) |
| POST | `/auth/logout` | Cerrar la sesión actual |
| GET | `/auth/me` | Perfil del usuario conectado |
| PUT | `/auth/me` | Editar el propio perfil |

### Agente de IA

| Método | URL | Uso |
| --- | --- | --- |
| GET | `/agente/capacidad` | Capacidad de picking o despacho, resuelta en una llamada |

### Agendas de picking

| Método | URL | Uso |
| --- | --- | --- |
| GET | `/agendas/picking/oficinas` | Catálogo de almacenes |
| GET | `/agendas/picking/agendas` | Agendas de un almacén |
| GET | `/agendas/picking/buscar` | Capacidades por almacén + servicio |
| GET | `/agendas/picking` | Capacidades por scheduleId |
| PUT | `/agendas/picking` | Guardar un día |

### Agendas de despacho

| Método | URL | Uso |
| --- | --- | --- |
| GET | `/agendas/despacho/oficinas` | Catálogo de operadores logísticos |
| GET | `/agendas/despacho/zonas` | Zonas de un operador |
| GET | `/agendas/despacho/agendas` | Agendas de una zona |
| GET | `/agendas/despacho/buscar` | Capacidades de una agenda |
| PUT | `/agendas/despacho` | Guardar un día |

### Reportes

| Método | URL | Uso |
| --- | --- | --- |
| GET | `/reportes/cds` | Reporte de ocupación de los CDs |

### Configuración — tipos de servicio por OPL

| Método | URL | Uso |
| --- | --- | --- |
| GET | `/configuracion/tipo-servicio/opl/canales` | Canales de venta |
| GET | `/configuracion/tipo-servicio/opl/buscar` | Buscar operador logístico |
| GET | `/configuracion/tipo-servicio/opl/zonas` | Zonas de un operador |
| GET | `/configuracion/tipo-servicio/opl/agendas` | Agendas de una zona |
| POST | `/configuracion/tipo-servicio/opl/servicios` | Servicios de una agenda |
| PUT | `/configuracion/tipo-servicio/opl/servicios/{id}` | Guardar un servicio |

### Configuración — activación masiva

| Método | URL | Uso |
| --- | --- | --- |
| GET | `/configuracion/tipo-servicio/opl-masivo/metodos-entrega` | Métodos de entrega |
| GET | `/configuracion/tipo-servicio/opl-masivo/origenes` | Orígenes de stock |
| POST | `/configuracion/tipo-servicio/opl-masivo/consultar` | Buscar agendas |
| POST | `/configuracion/tipo-servicio/opl-masivo/actualizar` | Activar/desactivar en bloque |

### Configuración — transferencia entre sucursales

| Método | URL | Uso |
| --- | --- | --- |
| GET | `/configuracion/transferencia-sucursales/buscar` | Buscar sucursal origen |
| GET | `/configuracion/transferencia-sucursales/relaciones` | Relaciones de la sucursal |
| PUT | `/configuracion/transferencia-sucursales/relaciones` | Guardar una relación |

### Simulación

| Método | URL | Uso |
| --- | --- | --- |
| GET | `/simulacion/metodos-entrega` | Métodos de entrega |
| GET | `/simulacion/almacenes` | Buscar almacén de stock |
| GET | `/simulacion/opl` | Buscar punto de entrega |
| GET | `/simulacion/regiones` | Departamentos |
| GET | `/simulacion/provincias` | Provincias de un departamento |
| GET | `/simulacion/distritos` | Distritos de una provincia |
| GET | `/simulacion/sku` | Buscar producto |
| POST | `/simulacion/simular` | Ejecutar la simulación |

---

## Sesión y perfil

Están documentados en detalle, con ejemplos de respuesta, en
[auth-supabase.md](auth-supabase.md). En resumen:

### 0.0 Crear una cuenta

```
POST http://localhost:3000/auth/registro
```

```json
{
  "email": "ana@ripley.com.pe",
  "password": "MiClaveSegura123",
  "nombre": "Ana",
  "apellido": "López",
  "tienda": "20026"
}
```

**Para qué sirve:** da de alta un usuario nuevo con el rol `user`. Todos los campos son
obligatorios menos `tienda`. Devuelve `201` con la sesión ya iniciada, o `409` si el correo
ya existe. El rol nunca se toma del body: lo fija el backend.

### 0.1 Iniciar sesión

```
POST http://localhost:3000/auth/login
```

```json
{ "email": "usuario@ripley.com", "password": "la-contraseña" }
```

**Para qué sirve:** el único endpoint público junto con `/auth/refresh`. Devuelve
`accessToken` y `refreshToken`; el primero es el que se manda en el header de todas las
demás llamadas.

### 0.2 Renovar el token

```
POST http://localhost:3000/auth/refresh
```

```json
{ "refreshToken": "xxxxx" }
```

**Para qué sirve:** el `accessToken` dura una hora. Cuando una llamada responda `401`, se
renueva aquí y se reintenta, sin volver a pedir credenciales.

### 0.3 Cerrar sesión

```
POST http://localhost:3000/auth/logout
```

**Para qué sirve:** invalida la sesión en Supabase. El token deja de servir de inmediato.

### 0.4 Perfil del usuario conectado

```
GET http://localhost:3000/auth/me
```

**Para qué sirve:** devuelve los datos no sensibles del usuario, listos para pintar una
pantalla de perfil. También sirve para comprobar si la sesión sigue viva.

```json
{
  "id": "fd865a91-…",
  "email": "ana@ripley.com.pe",
  "nombre": "Ana",
  "apellido": "López",
  "rol": "user",
  "tienda": "20026",
  "actualizadoEn": "2026-09-16T15:39:33.742+00:00"
}
```

### 0.5 Editar el propio perfil

```
PUT http://localhost:3000/auth/me
```

```json
{ "nombre": "Ana María", "apellido": "López", "tienda": "20096" }
```

**Para qué sirve:** el usuario cambia sus propios datos. Los tres campos son opcionales: lo
que no se envía se mantiene. **El rol no se puede cambiar por aquí** — si llega en el body
se ignora, porque de lo contrario cualquiera se ascendería a administrador. Los cambios de
rol se hacen por SQL.

---

## Agendas de picking

Flujo: **almacén → agenda (tipo de servicio) → capacidades → guardar día**.

### 1. Catálogo de almacenes

```
GET http://localhost:3000/agendas/picking/oficinas?pais=PE
```

**Para qué sirve:** lista los almacenes disponibles (código y nombre) para poblar el
selector inicial. Todos los parámetros son opcionales.

### 2. Agendas de un almacén

```
GET http://localhost:3000/agendas/picking/agendas?officeCode=20026&pais=PE
```

**Para qué sirve:** devuelve las agendas de picking del almacén con su `scheduleId`,
nombre, tipo de servicio ya traducido (`S`, `ST`...) y unidad de medida. Es el paso previo
para consultar capacidades.

| Parámetro | Obligatorio | Descripción |
| --- | --- | --- |
| `officeCode` | Sí | Código visible del almacén |
| `pais` | No | `PE` (defecto) o `CL` |

### 3. Capacidades por almacén y servicio

```
GET http://localhost:3000/agendas/picking/buscar?officeCode=20026&typeOfService=S&from=15-09-2026&pais=PE
```

**Para qué sirve:** la forma cómoda de consultar. Recibe el código de almacén y el tipo de
servicio, y devuelve la agenda y sus días (asignado, ocupado, activo) sin que el cliente
tenga que conocer el `scheduleId`.

| Parámetro | Obligatorio | Descripción |
| --- | --- | --- |
| `officeCode` | Sí | Código visible del almacén |
| `typeOfService` | Sí | Código del servicio (`S`, `ST`...) |
| `from` | No | Desde qué fecha, en `DD-MM-YYYY` |
| `pais` | No | `PE` (defecto) o `CL` |

### 4. Capacidades por scheduleId

```
GET http://localhost:3000/agendas/picking?scheduleId=643d9ac3b686840012dd4848&from=15-09-2026&pais=PE
```

**Para qué sirve:** igual que el anterior pero cuando ya se conoce el `scheduleId`.
Devuelve la respuesta cruda de Ripley, sin la agenda resuelta.

### 5. Guardar un día de picking

```
PUT http://localhost:3000/agendas/picking?scheduleId=643d9ac3b686840012dd4848&pais=PE
```

```json
{
  "day": "2026-09-15T00:00:00.000Z",
  "assigned": 500,
  "active": true
}
```

**Para qué sirve:** actualiza la capacidad asignada y el estado de un día concreto. El
cliente **solo** manda estos tres campos: `occupied` y toda la configuración de la agenda
las resuelve el backend releyendo el estado actual desde Ripley.

| Campo | Obligatorio | Descripción |
| --- | --- | --- |
| `day` | Sí | Fecha ISO completa, tal como la devuelve la consulta |
| `assigned` | Sí | Entero ≥ 0 |
| `active` | Sí | Booleano |

---

## Agendas de despacho

Flujo: **operador logístico → zona → agenda → capacidades → guardar día**.

### 6. Catálogo de operadores logísticos

```
GET http://localhost:3000/agendas/despacho/oficinas?pais=PE
```

**Para qué sirve:** lista los operadores logísticos (OPL) para el selector inicial.

### 7. Zonas de un operador

```
GET http://localhost:3000/agendas/despacho/zonas?officeCode=1130&pais=PE
```

**Para qué sirve:** zonas de cobertura del operador, con su `zoneId`. Obligatorio:
`officeCode`.

### 8. Agendas de una zona

```
GET http://localhost:3000/agendas/despacho/agendas?zoneId=643d9ac3b686840012dd4848&pais=PE
```

**Para qué sirve:** agendas de despacho de la zona, con su `mainScheduleId`. Una zona
puede tener varias. Obligatorio: `zoneId`.

### 9. Capacidades de una agenda

```
GET http://localhost:3000/agendas/despacho/buscar?mainScheduleId=643d9ac3b686840012dd4848&date=15-09-2026&pais=PE
```

**Para qué sirve:** devuelve la configuración de la agenda (servicios, unidad de medida,
vigencia) junto con los días y su ocupación.

| Parámetro | Obligatorio | Descripción |
| --- | --- | --- |
| `mainScheduleId` | Sí | Id de la agenda |
| `date` | No | Desde qué fecha, en `DD-MM-YYYY` |
| `pais` | No | `PE` (defecto) o `CL` |

### 10. Guardar un día de despacho

```
PUT http://localhost:3000/agendas/despacho?officeCode=1130&zoneId=643d9ac3b686840012dd4848&mainScheduleId=643d9ac3b686840012dd4849&pais=PE
```

```json
{
  "date": "15-09-2026",
  "assigned": 300,
  "active": true
}
```

**Para qué sirve:** actualiza la capacidad de un día. La agenda se identifica de forma
explícita con los tres ids en el query (no se deducen entre sí) porque el PUT de Ripley
los exige todos. La fecha aquí va en `DD-MM-YYYY`, no en ISO.

---

## Reportes

### 11. Reporte de ocupación de los CDs

```
GET http://localhost:3000/reportes/cds?pais=PE&dias=3&desde=2026-09-15
```

**Para qué sirve:** el reporte pivote del proyecto. Recorre todos los centros de
distribución configurados para el país, consulta sus agendas de picking y devuelve el
grano fino **CD × jornada × día** con asignado, utilizado y porcentaje de uso.

| Parámetro | Obligatorio | Descripción |
| --- | --- | --- |
| `pais` | No | `PE` (defecto) o `CL` |
| `dias` | No | Cuántos días mostrar, 1 a 60 (defecto 3) |
| `desde` | No | Fecha inicial `YYYY-MM-DD`; si es anterior a hoy se ignora |

La respuesta incluye un bloque `cobertura` con cuántas agendas respondieron, cuántas no
tienen capacidades cargadas y cuáles fallaron: el reporte se entrega aunque algunas
agendas fallen.

---

## Configuración — tipos de servicio por OPL

Flujo: **buscar OPL → zona → agenda → servicios → guardar servicio**.

### 12. Canales de venta

```
GET http://localhost:3000/configuracion/tipo-servicio/opl/canales?pais=CL
```

**Para qué sirve:** catálogo de canales de venta (POS, TVI...).

### 13. Buscar operador logístico

```
GET http://localhost:3000/configuracion/tipo-servicio/opl/buscar?q=1088&pais=CL
```

**Para qué sirve:** búsqueda incremental de OPL. El filtro lo hace Ripley, no el cliente:
el catálogo completo es demasiado grande para traerlo entero. Obligatorio: `q` (mínimo 1
carácter).

### 14. Zonas de un operador

```
GET http://localhost:3000/configuracion/tipo-servicio/opl/zonas?courier=643d9ac3b686840012dd4848&pais=CL
```

**Para qué sirve:** zonas del operador. Ojo: aquí el parámetro es `courier` (el **id**
del OPL que devuelve el buscador), no el código visible. Obligatorio: `courier`.

### 15. Agendas de una zona

```
GET http://localhost:3000/configuracion/tipo-servicio/opl/agendas?mainZone=643d9ac3b686840012dd4848&pais=CL
```

**Para qué sirve:** agendas de la zona, con su `mainSchedule`. Obligatorio: `mainZone`.

### 16. Servicios de una agenda

```
POST http://localhost:3000/configuracion/tipo-servicio/opl/servicios
```

```json
{
  "courier": "643d9ac3b686840012dd4848",
  "mainZone": "643d9ac3b686840012dd4849",
  "mainSchedule": "643d9ac3b686840012dd4850",
  "pais": "CL"
}
```

**Para qué sirve:** devuelve los servicios configurados en la agenda, con sus horas de
corte, canales de venta, `maxOcurrence`, `slackDays` y las banderas `isActive` y
`enabledForCheckout`. Es una consulta, pero va por POST porque necesita los tres
identificadores en el body.

### 17. Guardar un servicio

```
PUT http://localhost:3000/configuracion/tipo-servicio/opl/servicios/643d9ac3b686840012dd4851
```

```json
{
  "courier": "643d9ac3b686840012dd4848",
  "mainZone": "643d9ac3b686840012dd4849",
  "mainSchedule": "643d9ac3b686840012dd4850",
  "pais": "CL",
  "isActive": true,
  "enabledForCheckout": true,
  "maxOcurrence": 10,
  "slackDays": 2,
  "cortes": [
    { "id": 1, "value": "14:30" },
    { "id": 5, "value": "12:00" }
  ]
}
```

**Para qué sirve:** actualiza un servicio de la agenda. El id del servicio va en la URL;
los tres identificadores de la agenda son obligatorios en el body. **Todos los campos
editables son opcionales**: lo que no se envía conserva el valor que tenga hoy en Ripley.

| Campo | Obligatorio | Descripción |
| --- | --- | --- |
| `courier`, `mainZone`, `mainSchedule` | Sí | Ubican la agenda |
| `isActive` | No | Activa o desactiva el servicio |
| `enabledForCheckout` | No | Habilita el servicio en checkout |
| `maxOcurrence` | No | Entero ≥ 0 |
| `slackDays` | No | Entero ≥ 0 |
| `cortes` | No | Solo los días que cambian. `id` 1 = lunes … 7 = domingo, `value` en `HH:MM` |

---

## Configuración — activación masiva

Flujo: **método de entrega + servicio + orígenes → consultar → aplicar cambios**.

### 18. Métodos de entrega

```
GET http://localhost:3000/configuracion/tipo-servicio/opl-masivo/metodos-entrega?pais=PE
```

**Para qué sirve:** métodos de entrega (`RT`, `DP`, `V`...) con los tipos de servicio que
cuelgan de cada uno, para los dos primeros selectores.

### 19. Orígenes de stock

```
GET http://localhost:3000/configuracion/tipo-servicio/opl-masivo/origenes?pais=PE
```

**Para qué sirve:** catálogo de orígenes de stock: bodega, proveedor y tienda.

### 20. Consultar agendas

```
POST http://localhost:3000/configuracion/tipo-servicio/opl-masivo/consultar
```

```json
{
  "deliveryCode": "RT",
  "serviceCode": "SE",
  "origenes": ["warehouse", "store"],
  "pais": "PE"
}
```

**Para qué sirve:** busca todas las agendas que coinciden con esa combinación y devuelve,
por cada una, su `mainRouteId`, OPL, zona, agenda y el estado actual de `isActive` y
`enabledForCheckout`. El `mainRouteId` es lo que se usa después para aplicar cambios.

| Campo | Obligatorio | Descripción |
| --- | --- | --- |
| `deliveryCode` | Sí | Código del método de entrega |
| `serviceCode` | Sí | Código del tipo de servicio |
| `origenes` | Sí | Al menos un origen de stock |

### 21. Activar/desactivar en bloque

```
POST http://localhost:3000/configuracion/tipo-servicio/opl-masivo/actualizar
```

```json
{
  "deliveryCode": "RT",
  "serviceCode": "SE",
  "origenes": ["warehouse", "store"],
  "pais": "PE",
  "cambios": [
    { "mainRouteId": "643d9ac3b686840012dd4848", "isActive": false },
    { "mainRouteId": "643d9ac3b686840012dd4849", "enabledForCheckout": true }
  ]
}
```

**Para qué sirve:** aplica el cambio a varias agendas de una sola vez. Se repiten los
mismos filtros de la consulta porque el backend vuelve a traer las agendas para sacar de
ahí los identificadores internos, en vez de confiar en el cliente. En cada cambio,
`isActive` y `enabledForCheckout` son opcionales: el que no se envía conserva su valor.

Responde con cuántas se enviaron, cuántas modificó realmente Ripley y el detalle por fila.

---

## Configuración — transferencia entre sucursales

### 22. Buscar sucursal de origen

```
GET http://localhost:3000/configuracion/transferencia-sucursales/buscar?q=20026&pais=PE
```

**Para qué sirve:** búsqueda incremental de almacenes. Devuelve el `id` interno que hace
falta para el siguiente endpoint. Obligatorio: `q`.

### 23. Relaciones de una sucursal

```
GET http://localhost:3000/configuracion/transferencia-sucursales/relaciones?warehouseId=643d9ac3b686840012dd4848&pais=PE
```

**Para qué sirve:** lista los destinos a los que esa sucursal puede transferir stock, con
sus días habilitados, el período de transferencia y el de pre-transferencia. Obligatorio:
`warehouseId`.

### 24. Guardar una relación

```
PUT http://localhost:3000/configuracion/transferencia-sucursales/relaciones
```

```json
{
  "warehouseId": "643d9ac3b686840012dd4848",
  "relacionId": "643d9ac3b686840012dd4849",
  "pais": "PE",
  "canTransfer": true,
  "transferPeriod": 2,
  "preTransferPeriod": 1,
  "availableDays": {
    "monday": true,
    "saturday": false
  }
}
```

**Para qué sirve:** actualiza una relación. Todo va en el body, sin query params. Los
campos editables son opcionales y, en `availableDays`, **solo se reemplazan los días que
se envían**: los que se omiten mantienen su valor actual.

| Campo | Obligatorio | Descripción |
| --- | --- | --- |
| `warehouseId` | Sí | Sucursal de origen |
| `relacionId` | Sí | Id de la relación dentro del documento |
| `canTransfer` | No | Habilita la transferencia hacia ese destino |
| `transferPeriod` | No | Entero ≥ 0 |
| `preTransferPeriod` | No | Entero ≥ 0 |
| `availableDays` | No | `monday`…`sunday`, booleanos |
| `relationshipType` | No | Por defecto `"Directa"` |

---

## Simulación

Flujo: **catálogos (método, servicio, almacén, punto de entrega, geografía, SKU) → simular**.

### 25. Métodos de entrega

```
GET http://localhost:3000/simulacion/metodos-entrega?pais=PE
```

**Para qué sirve:** métodos de entrega con sus tipos de servicio, para los dos primeros
selectores del formulario.

### 26. Buscar almacén de stock

```
GET http://localhost:3000/simulacion/almacenes?q=20026&pais=PE
```

**Para qué sirve:** busca la oficina que aporta el stock. Devuelve el `id` que va como
`warehouseId` en la simulación. Obligatorio: `q`.

### 27. Buscar punto de entrega

```
GET http://localhost:3000/simulacion/opl?q=20021&pais=PE
```

**Para qué sirve:** busca el operador logístico o tienda de retiro. Devuelve el `id` que
va como `courierId`. Obligatorio: `q`.

### 28. Departamentos

```
GET http://localhost:3000/simulacion/regiones?pais=PE
```

**Para qué sirve:** lista de departamentos/regiones, ordenada alfabéticamente.

### 29. Provincias

```
GET http://localhost:3000/simulacion/provincias?regionId=643d9ac3b686840012dd4848&pais=PE
```

**Para qué sirve:** provincias del departamento. Obligatorio: `regionId`.

### 30. Distritos

```
GET http://localhost:3000/simulacion/distritos?regionId=643d9ac3b686840012dd4848&provinciaId=643d9ac3b686840012dd4849&pais=PE
```

**Para qué sirve:** distritos de la provincia. El `id` del distrito elegido es el
`communeId` de la simulación. Obligatorios: `regionId` y `provinciaId`.

### 31. Buscar producto

```
GET http://localhost:3000/simulacion/sku?q=2013435160001&pais=PE
```

**Para qué sirve:** búsqueda incremental de SKU. Obligatorio: `q`.

### 32. Ejecutar la simulación

```
POST http://localhost:3000/simulacion/simular
```

```json
{
  "pais": "PE",
  "deliveryMethod": "RT",
  "typeOfServiceCode": "SE",
  "warehouseId": "643d9ac3b686840012dd4848",
  "courierId": "643d9ac3b686840012dd4849",
  "regionId": "643d9ac3b686840012dd4850",
  "communeId": "643d9ac3b686840012dd4851",
  "products": [{ "sku": 2013435160001, "quantity": 1 }],
  "date": "15/09/2026",
  "hour": "14:30"
}
```

**Para qué sirve:** simula una venta y devuelve, por cada tipo de servicio, las opciones de
entrega con su fecha, hora de corte, agenda, zona, el recorrido físico del pedido y el
detalle paso a paso del cálculo. Sirve para responder "si vendo esto ahora, ¿cuándo llega?"
antes de concretar la venta.

| Campo | Obligatorio | Descripción |
| --- | --- | --- |
| `deliveryMethod` | Sí | Código del método de entrega |
| `typeOfServiceCode` | Sí | Código del tipo de servicio |
| `warehouseId` | Sí | Id de la oficina que aporta el stock |
| `courierId` | Sí | Id del operador logístico o tienda de retiro |
| `regionId` | Sí | Id del departamento |
| `communeId` | Sí | Id del distrito |
| `products` | Sí | Al menos un producto: `sku` (entero) y `quantity` (≥ 1) |
| `date` | No | `DD/MM/YYYY`; por defecto, hoy en la zona del país |
| `hour` | No | `HH:MM`; por defecto, la hora actual en la zona del país |
| `channelSales` | No | Por defecto `"TVI"` |
| `stock` | No | Unidades disponibles en origen, por defecto `2` |
| `isCheckout` | No | Por defecto `false` |
| `useFreightEngineSimulation` | No | Por defecto `false` |

---

## Códigos de respuesta

| Código | Cuándo aparece |
| --- | --- |
| `200` | Consulta correcta |
| `400` | Un parámetro o campo del body no pasó la validación |
| `401` | Falta el token, no es válido o ya expiró; también, credenciales incorrectas en el login |
| `409` | El correo ya está registrado (solo en `/auth/registro`) |
| `404` | El recurso no existe: agenda, día, servicio, relación, SKU o distrito no encontrado |
| `502` | Falta configuración (URL, token o endpoint) o la API de Ripley falló |
