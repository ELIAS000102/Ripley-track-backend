# Agente de IA en n8n

Cómo conectar un agente de n8n al backend para que responda preguntas sobre la capacidad
de las agendas de picking y despacho.

## Cómo encaja

El agente **no tiene credenciales propias**. Cada persona inicia sesión con su cuenta, y
n8n reenvía *ese mismo token* al backend. Así, cada consulta queda atribuida a quien
preguntó y hereda sus permisos, en vez de esconderse tras una cuenta de servicio genérica.

```
Usuario  →  inicia sesión en el backend  →  accessToken
         →  pregunta al agente, enviando su token
                    ↓
n8n (AI Agent)  →  herramienta HTTP
                    ↓
Backend  GET /agente/capacidad
         Authorization: Bearer <token del usuario>
         X-Origen: agente
                    ↓
         Valida el token, identifica al usuario,
         registra la consulta marcada como "agente"
```

## Qué puede y qué no puede hacer

El agente tiene **permiso explícito** sobre una lista cerrada de endpoints de consulta.
Todo lo demás le responde `403`, aunque el token del usuario tenga permisos de sobra:

```
GET  /agendas/picking/buscar    con X-Origen: agente  → 200
PUT  /agendas/picking           con X-Origen: agente  → 403
GET  /simulacion/regiones       con X-Origen: agente  → 403
```

La lista es **cerrada por defecto**: un endpoint nuevo nace bloqueado para el agente hasta
que alguien lo marque con `@PermitidoAgente()`. Así, si mañana se añade una operación de
escritura y nadie se acuerda del agente, queda protegida igual.

Endpoints permitidos hoy:

| Endpoint | Para qué |
| --- | --- |
| `GET /agendas/picking/oficinas` | Listar almacenes |
| `GET /agendas/picking/agendas` | Ver qué servicios tiene un almacén |
| `GET /agendas/picking/buscar` | Capacidades de picking |
| `GET /agendas/despacho/oficinas` | Listar operadores logísticos |
| `GET /agendas/despacho/zonas` | Zonas de un operador |
| `GET /agendas/despacho/agendas` | Agendas de una zona |
| `GET /agendas/despacho/buscar` | Capacidades de despacho |
| `GET /agente/capacidad` | Capacidades resueltas en una sola llamada |

> Esto acota al agente, no a una persona: quien tenga el token puede omitir la cabecera,
> pero entonces ya podría usar el panel igualmente. El objetivo es contener al agente si se
> le cuelan instrucciones en un dato que lea o si se configura mal una herramienta.

## Importante: acotar siempre los días

Ripley devuelve la agenda **completa** —más de mil días, hasta 2028— aunque se le pase una
fecha de inicio. Sin acotar, una sola consulta ahoga al modelo:

| Llamada | Días | Tokens aprox. |
| --- | --- | --- |
| `/agendas/picking/buscar` sin `dias` | 1.402 | ~26.800 |
| `/agendas/picking/buscar?dias=7` | 7 | ~173 |

**Configura siempre `dias` en las herramientas del agente.** Es opcional en la API por
compatibilidad, pero para un modelo de lenguaje es obligatorio en la práctica.

## Las herramientas

### Opción A: las rutas normales (recomendada para picking)

Resuelven el caso típico en una sola llamada. Para
*"muéstrame la capacidad de picking de la 20021 para la RT"*:

```
GET /agendas/picking/buscar?officeCode=20021&typeOfService=RT&dias=7
```

Y si el usuario no sabe qué servicios hay, el agente lo descubre antes:

```
GET /agendas/picking/agendas?officeCode=20021
→ RT, DT, SS, RE
```

### Opción B: el endpoint consolidado (recomendado para despacho)

En despacho, las rutas normales obligan a encadenar tres llamadas pasando identificadores
opacos (operador → zona → agenda → capacidades), que es donde más se equivoca un modelo.
Este endpoint hace esa cadena por dentro:

```
GET http://localhost:3000/agente/capacidad
```

| Parámetro | Obligatorio | Descripción |
| --- | --- | --- |
| `tipo` | Sí | `picking` o `despacho` |
| `codigo` | Sí | Almacén (`20026`) en picking, operador logístico (`1130`) en despacho |
| `servicio` | No | Filtra por tipo de servicio en picking: `S`, `ST`, `SD`, `RC`, `AT`… |
| `zona` | No | Filtra por nombre de zona en despacho; admite coincidencia parcial |
| `desde` | No | Fecha inicial `YYYY-MM-DD`. Por defecto, hoy en la zona horaria del país |
| `dias` | No | Cuántos días devolver, 1 a 30. Por defecto 7 |
| `pais` | No | `PE` o `CL`. Por defecto `PE` |

Cabeceras:

| Cabecera | Valor |
| --- | --- |
| `Authorization` | `Bearer {{ token del usuario }}` |
| `X-Origen` | `agente` |

### Qué devuelve

```json
{
  "tipo": "picking",
  "pais": "PE",
  "oficina": "20026",
  "desde": "2026-09-16",
  "agendas": [
    {
      "agenda": "Agenda Picking ST - 20026",
      "servicio": "ST",
      "unidad": "Unidades",
      "dias": [
        { "fecha": "2026-09-16", "activo": true, "asignado": 1688,
          "ocupado": 1078, "disponible": 610, "uso": 64 }
      ]
    }
  ],
  "sinDatos": []
}
```

Tres decisiones pensadas para que un modelo no se equivoque:

- **`disponible` y `uso` vienen calculados.** Los modelos de lenguaje fallan haciendo
  aritmética; mejor dárselo resuelto que pedirle que reste y divida.
- **Las fechas van en `YYYY-MM-DD`**, no en el `DD-MM-YYYY` que usa Ripley por dentro.
- **`sinDatos` lista las agendas que no se pudieron consultar.** Si algo falla, el agente
  lo puede decir en vez de inventarse un número.

## Montarlo en n8n

### 1. Nodo AI Agent

Añade un **AI Agent** con el modelo que prefieras y su credencial.

### 2. Herramientas HTTP Request

Con tres basta para cubrir la conversación típica. Todas comparten las cabeceras:

- `Authorization` → `Bearer {{ $json.token }}` (el token del usuario)
- `X-Origen` → `agente`

Si n8n corre en Docker y el backend en tu máquina, la URL no es `localhost:3000` sino
`http://host.docker.internal:3000`.

**Herramienta 1 — servicios de un almacén**

- **URL:** `http://localhost:3000/agendas/picking/agendas`
- **Query:** `officeCode`, `pais`

```
Lista las agendas de picking de un almacén y qué tipo de servicio maneja cada una
(RT, DT, ST, SS...). Úsala cuando no sepas qué servicios tiene un almacén o el
usuario no especifique cuál quiere.
- officeCode: código del almacén, ej. 20021. Obligatorio.
- pais: "PE" o "CL". Por defecto PE.
```

**Herramienta 2 — capacidad de picking**

- **URL:** `http://localhost:3000/agendas/picking/buscar`
- **Query:** `officeCode`, `typeOfService`, `from`, `dias`, `pais`

```
Consulta la capacidad de picking de un almacén para un tipo de servicio: cuántas
unidades hay asignadas, cuántas ocupadas y si el día está activo.

- officeCode: código del almacén, ej. 20021. Obligatorio.
- typeOfService: código del servicio, ej. RT, DT, ST. Obligatorio. Si no lo sabes,
  búscalo antes con la herramienta de agendas.
- from: fecha inicial en formato DD-MM-YYYY. Si no se indica, empieza desde el
  principio de la agenda, así que conviene indicarla siempre.
- dias: cuántos días traer. Usa 7 salvo que pidan otra cosa. SIEMPRE envíalo.
- pais: "PE" o "CL". Por defecto PE.
```

**Herramienta 3 — capacidad de despacho**

- **URL:** `http://localhost:3000/agente/capacidad`
- **Query:** `tipo`, `codigo`, `zona`, `desde`, `dias`, `pais`

```
Consulta la capacidad de despacho de un operador logístico. Devuelve todas sus
zonas y agendas con los días, ya calculado cuánto queda disponible y el porcentaje
de uso.

- tipo: usa siempre "despacho" con esta herramienta.
- codigo: código del operador logístico, ej. 1130. Obligatorio.
- zona: opcional, para filtrar por nombre de zona (admite coincidencia parcial).
- desde: opcional, fecha YYYY-MM-DD. Si no se indica, hoy.
- dias: cuántos días traer (1-30). Por defecto 7.
- pais: "PE" o "CL". Por defecto PE.
```

> Ojo con los formatos de fecha: las rutas de `/agendas` usan `DD-MM-YYYY` y
> `/agente/capacidad` usa `YYYY-MM-DD`. Está así porque las primeras son las de siempre y
> no se podían cambiar sin romper el panel. Déjalo escrito en la descripción de cada
> herramienta, que es lo que el modelo lee.

### Probarlo desde `prueba.html`

El panel tiene una pestaña **Agente** con un chat que llama al webhook. Manda:

```json
{
  "pregunta": "¿Cuánta capacidad de picking queda en la 20021 para la RT?",
  "token": "eyJhbGciOi...",
  "sessionId": "uuid-de-la-conversación",
  "usuario_email": "jhuamanim8@ripley.com.pe"
}
```

y espera `{ "respuesta": "..." }`.

La URL del webhook se edita en el propio panel y se recuerda en el navegador, así que
puedes cambiar entre la de prueba y la de producción sin tocar el archivo.

> **Ojo con `/webhook-test/`**: es la URL de *pruebas* de n8n. Solo responde mientras
> tengas el editor abierto con "Test workflow" activo, y se apaga tras una ejecución. Si el
> chat responde `404`, casi siempre es eso. Al activar el workflow de forma permanente, la
> URL pasa a ser `/webhook/agente-chat`.

El botón **Limpiar chat** genera un `sessionId` nuevo, así que el agente deja de recordar
lo anterior: útil para probar de cero.

### 3. Cómo llega el token

El token del usuario tiene que entrar al flujo. Si el disparador es un **Webhook**, el
frontend lo manda junto con la pregunta:

```json
{ "pregunta": "¿Cuánta capacidad queda mañana en picking del CD 20026?",
  "token": "eyJhbGciOi..." }
```

y en la herramienta se referencia con `{{ $json.token }}`.

El `accessToken` **dura una hora**. Quien llame al flujo debe mandar uno vigente: si el
backend responde `401`, hay que renovarlo con `POST /auth/refresh` y reintentar.

### 4. Prompt de sistema sugerido

```
Eres un asistente que responde preguntas sobre la capacidad de las agendas de
Ripley (picking y despacho) en Perú y Chile.

Usa siempre las herramientas para obtener los datos. Nunca inventes cifras ni las
estimes: si una herramienta no devuelve el dato, o aparece en "sinDatos", dilo.

Cómo elegir la herramienta:
- Capacidad de picking de un almacén → herramienta de capacidad de picking.
- Si no sabes qué servicio quiere el usuario, lista antes las agendas del almacén
  y pregúntale o elige la que corresponda.
- Capacidad de despacho de un operador logístico → herramienta de despacho.

Pide siempre 7 días salvo que el usuario indique otro rango. Nunca consultes sin
acotar los días.

Al responder:
- Da las cifras concretas: asignado, ocupado, disponible y porcentaje de uso.
- Menciona la agenda y la fecha a la que corresponde cada cifra.
- Si un día está inactivo (activo/active en false), avísalo: no es lo mismo que
  estar al 0% de uso.
- Si el usuario no dice el país, asume PE. Si no dice la fecha, empieza hoy.

Solo puedes consultar. No puedes modificar capacidades ni ninguna otra
configuración, y el backend te lo impedirá aunque lo intentes. Si te lo piden,
explica que ese cambio se hace desde el panel.
```

## Qué queda registrado

Cada consulta del agente escribe una fila en `registro_uso` con:

- `usuario_email` y `usuario_rol` → **quién preguntó**, no el agente
- `origen` = `agente` → que se hizo conversando, no desde el panel
- `accion` = `agente.consultarCapacidad`
- `datos` → los parámetros con los que el modelo llamó a la herramienta

Para ver qué se le pregunta al agente:

```sql
select creado_en, usuario_email, usuario_rol, datos->'query' as consulta
from public.registro_uso
where origen = 'agente'
order by creado_en desc;
```

> `X-Origen` la declara el cliente, así que sirve para trazar, no para autorizar. Alguien
> podría mentir sobre el origen, pero seguiría identificado por su token.

## Cuando llegue la edición supervisada

Cuando el agente deba poder cambiar capacidades, lo razonable es:

1. Un endpoint nuevo bajo `/agente` que **proponga** el cambio y devuelva el antes y el
   después, sin escribir nada.
2. Que una persona confirme esa propuesta desde el panel.
3. Que la escritura real siga pasando por los endpoints de siempre, con su auditoría.

Así el modelo nunca escribe por su cuenta, y el registro de uso muestra quién aprobó cada
cambio además de quién lo propuso.
