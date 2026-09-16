# APIs de Ripley consumidas por el backend

Listado completo de los endpoints de la API corporativa de Ripley que este backend
consume, con su URL completa, método HTTP y para qué sirve cada uno.

## Datos comunes a todas las llamadas

| | |
| --- | --- |
| **Host Perú** | `https://api-pe.ripley.com` |
| **Host Chile** | `https://api.ripley.com` |
| **Prefijo de ruta** | `/retail/supply/logistic/configuration/v1` |
| **Autenticación** | Header `x-access-token` con el token del país |

El host y el token se eligen según el parámetro `pais` (`PE` o `CL`) que llega en cada
request; la ruta es idéntica en ambos países. En este documento las URLs se muestran con
el host de Perú — para Chile se reemplaza el host y todo lo demás queda igual.

Ambos valores y las rutas se configuran por variables de entorno (ver `.env.example`) y
se resuelven en `src/config/configuration.ts`; el cliente HTTP que las arma es
`src/common/ripley/ripley-http.service.ts`.

---

## Resumen

| # | Método | URL completa | Para qué sirve |
| --- | --- | --- | --- |
| 1 | GET | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/offices` | Catálogo de oficinas: almacenes u operadores logísticos |
| 2 | GET | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/offices/{id}` | Detalle de una oficina por su id interno |
| 3 | GET | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/services` | Catálogo de tipos de servicio (id → código) |
| 4 | GET | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/catalogs` | Catálogos genéricos por identificador |
| 5 | GET | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/delivery` | Métodos de entrega con sus tipos de servicio |
| 6 | GET | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/schedules/picking` | Agendas de picking de un almacén |
| 7 | GET | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/capacities/picking/{scheduleId}` | Capacidades diarias de una agenda de picking |
| 8 | PUT | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/capacities/picking/{scheduleId}` | Guardar la capacidad de un día de picking |
| 9 | GET | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/mainzones` | Zonas de cobertura de un operador logístico |
| 10 | GET | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/mainschedules` | Agendas de despacho de una zona |
| 11 | GET | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/capacities/base` | Configuración general de una agenda de despacho |
| 12 | GET | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/capacities/schedule` | Capacidades diarias de una agenda de despacho |
| 13 | PUT | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/capacities/schedule` | Guardar la capacidad de un día de despacho |
| 14 | POST | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/services/listFullTypeOfServices` | Servicios configurados en la agenda de un OPL |
| 15 | PUT | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/services/saveTypeOfOPLService/{idServicio}` | Guardar un servicio de la agenda de un OPL |
| 16 | POST | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/mainroutes/schedules/state` | Buscar agendas para activación masiva |
| 17 | POST | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/mainroutes/update/state` | Activar/desactivar agendas en bloque |
| 18 | GET | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/officerelationship/by-warehouse` | Relaciones de transferencia de un almacén |
| 19 | PUT | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/officerelationship/by-warehouse` | Guardar una relación de transferencia |
| 20 | GET | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/regions` | Lista de departamentos/regiones |
| 21 | GET | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/regions/{id}` | Árbol de provincias y distritos de una región |
| 22 | GET | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/sku` | Búsqueda de productos |
| 23 | POST | `https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/schedules/simulator/simple` | Simular la fecha de entrega de una venta |

Son **18 rutas distintas**; cuatro de ellas se usan con dos métodos (lectura y escritura),
de ahí las 23 operaciones del listado.

---

## Catálogos compartidos

Los usan varios módulos a la vez, casi siempre para traducir un código visible
(`20026`, `1130`) al id interno que exige el resto de la API (`5dd808...`).

### 1. Oficinas

```
GET https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/offices
```

**Para qué sirve:** es el catálogo de oficinas y el endpoint más reutilizado del
proyecto. El mismo recurso devuelve almacenes u operadores logísticos según el flag que
se le mande.

**Parámetros:**

| Parámetro | Para qué |
| --- | --- |
| `q` | Búsqueda incremental por código o nombre |
| `id` | Filtra por id interno |
| `isStoreOffice=true` | Devuelve solo almacenes / tiendas |
| `isOPLOffice=true` | Devuelve solo operadores logísticos |

**Lo usan:** picking, despacho, reportes de CD, OPL, transferencia entre sucursales y
simulación — los seis módulos del proyecto.

### 2. Detalle de una oficina

```
GET https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/offices/{id}
```

**Para qué sirve:** traer una oficina concreta por su id interno, cuando ya se sabe cuál
es y no hace falta buscar en el catálogo.

**Lo usa:** simulación, para resolver el almacén de origen y el punto de entrega.

### 3. Tipos de servicio

```
GET https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/services
```

**Para qué sirve:** traduce el id interno de un servicio a su código visible (`S`, `ST`,
`SG`...). Se pide una sola vez por request y se arma un mapa en memoria.

**Lo usan:** picking y el reporte de CDs.

### 4. Catálogos genéricos

```
GET https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/catalogs?q={identificador}&takeFirst=1
```

**Para qué sirve:** catálogo genérico parametrizable. El identificador decide qué lista
devuelve.

| Identificador | Qué devuelve | Quién lo usa |
| --- | --- | --- |
| `channel_sales` | Canales de venta (POS, TVI...) | OPL |
| `stock_source_types` | Orígenes de stock (bodega, proveedor, tienda) | Activación masiva |

### 5. Métodos de entrega

```
GET https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/delivery
```

**Para qué sirve:** lista los métodos de entrega (`RT`, `DP`, `V`...) con los tipos de
servicio que cuelgan de cada uno. Ojo: devuelve un array plano, sin el envoltorio
`{ count, rows }` que usan los demás catálogos.

**Lo usan:** activación masiva y simulación.

---

## Agendas de picking

### 6. Agendas de un almacén

```
GET https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/schedules/picking?warehouse={warehouseId}
```

**Para qué sirve:** lista las agendas de picking de un almacén, con su tipo, unidad de
medida y los `capacityId` asociados. Es el paso previo obligatorio: el `capacityId` que
devuelve es el `scheduleId` que piden los dos endpoints siguientes.

**Lo usan:** picking y el reporte de CDs.

### 7. Leer capacidades de picking

```
GET https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/capacities/picking/{scheduleId}?from={DD-MM-YYYY}
```

**Para qué sirve:** devuelve el detalle día a día de una agenda (asignado, ocupado,
activo) desde la fecha indicada. Si la agenda existe pero no tiene capacidades cargadas
responde 404, y el backend lo interpreta como "sin datos", no como un error.

**Lo usan:** picking y el reporte de CDs (este último en lotes de 6 llamadas simultáneas).

### 8. Guardar capacidad de picking

```
PUT https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/capacities/picking/{scheduleId}
```

**Para qué sirve:** actualiza un día de la agenda. No acepta cambios parciales: exige el
bloque `schedules` completo (país, oficina, tipo de agenda, tipo de servicio y unidad de
medida), así que el backend lo reconstruye consultando `/offices`, `/services` y
`/schedules/picking` antes de escribir. El cliente solo aporta `assigned` y `active`.

**Lo usa:** picking.

---

## Agendas de despacho

### 9. Zonas de un operador logístico

```
GET https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/mainzones?courier={officeId}
```

**Para qué sirve:** zonas de cobertura de un OPL. Primer eslabón de la cascada
operador → zona → agenda.

**Lo usan:** despacho y OPL.

### 10. Agendas de una zona

```
GET https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/mainschedules?mainZone={zoneId}
```

**Para qué sirve:** agendas de despacho de una zona. Una zona puede tener más de una.

**Lo usan:** despacho y OPL.

### 11. Configuración base de la agenda

```
GET https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/capacities/base?id={mainScheduleId}
```

**Para qué sirve:** datos generales de la agenda — tipos de servicio, unidad de medida y
vigencia. Hace falta tanto para mostrar la cabecera como para armar el PUT, porque la
escritura exige una entrada por cada tipo de servicio de la agenda.

**Lo usa:** despacho.

### 12. Leer capacidades de despacho

```
GET https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/capacities/schedule?id={mainScheduleId}&date={DD-MM-YYYY}
```

**Para qué sirve:** detalle día a día de la agenda de despacho. A diferencia de picking,
aquí la fecha va en `DD-MM-YYYY` tanto al leer como al escribir, y `assigned` viaja como
texto.

**Lo usa:** despacho.

### 13. Guardar capacidad de despacho

```
PUT https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/capacities/schedule?id={mainScheduleId}
```

**Para qué sirve:** actualiza un día de la agenda. Igual que en picking, exige el bloque
`schedules` completo — pero aquí con **una entrada por cada tipo de servicio** de la
agenda, no solo el que se está viendo. Por eso siempre se relee `/capacities/base` antes.

**Lo usa:** despacho.

---

## Tipos de servicio por OPL

### 14. Servicios de una agenda

```
POST https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/services/listFullTypeOfServices?active=true
```

**Para qué sirve:** devuelve los servicios configurados en la agenda de un OPL, con sus
horas de corte, canales de venta y banderas. Es una lectura, pero usa POST porque el
filtro (`courier`, `mainZone`, `mainSchedule`) viaja en el body.

**Lo usa:** OPL — tanto para mostrar la lista como para releer el estado antes de guardar.

### 15. Guardar un servicio

```
PUT https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/services/saveTypeOfOPLService/{idServicio}
```

**Para qué sirve:** guarda un servicio de la agenda. Exige de vuelta muchos campos que el
cliente nunca vio (código, etiqueta, canales, ids internos) e incluso residuos del
frontend original de Ripley (`activator`, `tableData`, `validityRender`...), así que el
backend los reconstruye desde el estado actual y solo reemplaza lo que el usuario editó.

**Lo usa:** OPL.

---

## Activación masiva de tipos de servicio

### 16. Consultar agendas

```
POST https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/mainroutes/schedules/state
```

**Para qué sirve:** busca todas las agendas que coinciden con un método de entrega, un
tipo de servicio y uno o más orígenes de stock. También es una lectura por POST: el
filtro va en el body, armado previamente contra `/delivery` y `/catalogs`.

**Lo usa:** activación masiva.

### 17. Actualizar agendas en bloque

```
POST https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/mainroutes/update/state
```

**Para qué sirve:** activa o desactiva varias agendas de una sola vez. El body incluye un
campo `type` con el valor `app/TypeOfServiceActivation/SAVE_REQUEST`, que es el nombre de
una acción de Redux del frontend original de Ripley; se replica tal cual por si la API lo
valida. Devuelve el resultado crudo de Mongo (`matchedCount`, `modifiedCount`).

**Lo usa:** activación masiva.

---

## Transferencia entre sucursales

### 18. Leer relaciones de un almacén

```
GET https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/officerelationship/by-warehouse?id={warehouseId}&kind=
```

**Para qué sirve:** devuelve un único documento con **todas** las relaciones de
transferencia del almacén origen (destinos, días habilitados, períodos). No usa el
envoltorio `{ count, rows }`. El parámetro `kind` se manda vacío.

**Lo usa:** transferencia entre sucursales.

### 19. Guardar una relación

```
PUT https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/officerelationship/by-warehouse?id={warehouseId}
```

**Para qué sirve:** guarda una relación a la vez. Exige campos que no vienen en la lectura
(`stockOfficeId`, `relationshipType` y `canTransferValue`, el espejo numérico de
`canTransfer`), así que el backend los completa. Responde con el documento entero ya
actualizado.

**Lo usa:** transferencia entre sucursales.

---

## Simulación de entregas

### 20. Regiones

```
GET https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/regions
```

**Para qué sirve:** lista plana de departamentos/regiones, para poblar el primer selector
geográfico.

### 21. Detalle de una región

```
GET https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/regions/{id}
```

**Para qué sirve:** devuelve el árbol completo de la región — provincias y sus distritos —
en una sola llamada. Es una respuesta grande, por eso el backend no la reenvía cruda: la
recorta según lo que pida el frontend. El objeto completo sí viaja dentro del payload del
simulador, que lo exige entero.

### 22. Búsqueda de SKU

```
GET https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/sku?q={codigo}&isStoreProduct=true
```

**Para qué sirve:** busca productos por código. Se usa dos veces: para el autocompletado
del formulario y, al simular, para resolver el bloque `type` de cada producto (si es de
tienda, de carga o de marketplace), que el simulador exige.

### 23. Simulador

```
POST https://api-pe.ripley.com/retail/supply/logistic/configuration/v1/schedules/simulator/simple
```

**Para qué sirve:** ejecuta la simulación y devuelve, por cada tipo de servicio, las
opciones de entrega con su fecha, hora de corte, agenda, zona y el detalle paso a paso del
cálculo. La respuesta viene muy anidada y el backend la aplana antes de entregarla.

**Lo usa:** simulación.

---

## Notas transversales

- **Formato de fechas:** Ripley usa `DD-MM-YYYY` en las capacidades (query y body) y
  `DD/MM/YYYY` en el simulador. El backend convierte desde ISO en
  `src/common/ripley/utils/date.util.ts`.
- **Lecturas por POST:** `listFullTypeOfServices` y `mainroutes/schedules/state` son
  consultas, pero usan POST porque el filtro viaja en el body.
- **404 como "sin datos":** en `/capacities/picking/{scheduleId}` un 404 significa que la
  agenda no tiene capacidades cargadas, no que algo falló. El backend lo distingue con
  `RipleyApiError` para que el reporte de CDs no lo cuente como error.
- **Nunca se confía en el cliente para los campos internos:** todos los endpoints de
  escritura exigen el objeto completo, así que el backend siempre relee el estado actual y
  solo reemplaza los campos que el usuario editó.
