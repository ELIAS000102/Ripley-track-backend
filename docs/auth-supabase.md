# Autenticación y registro de uso con Supabase

El backend usa **Supabase Auth** para autenticar y **Supabase Postgres** para guardar
quién consume cada endpoint. Desde que esto está activo, **todos los endpoints exigen una
sesión válida**; el único público es `/auth/login` (y `/auth/refresh`, que necesita su
propio token de refresco).

## Cómo funciona

```
1. El cliente manda email + password  →  POST /auth/login
2. El backend se lo pasa a Supabase Auth
3. Supabase devuelve accessToken + refreshToken
4. El cliente guarda los tokens
5. En cada llamada manda:  Authorization: Bearer <accessToken>
6. El guard valida ese token contra Supabase y resuelve el usuario
7. El interceptor escribe la petición en la tabla registro_uso
```

El backend **no guarda contraseñas ni sesiones**: delega todo en Supabase y se limita a
validar el token que le llega. Por eso puede consumirlo cualquier frontend, tanto uno que
use estos endpoints como uno que se autentique por su cuenta con `supabase-js`: el guard
valida el mismo token en ambos casos.

## Puesta en marcha

### 1. Crear la tabla del registro

En el **SQL Editor** de Supabase, ejecutar [`supabase-setup.sql`](supabase-setup.sql).
Crea la tabla `registro_uso`, sus índices y deja RLS activo sin políticas: nadie llega a
esa tabla con la anon key, solo el backend con la service role key.

### 2. Configurar las claves

En **Project Settings → API** de Supabase están los tres valores. Se copian al `.env`:

```
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
SUPABASE_TABLA_AUDITORIA=registro_uso
```

> La **service role key** se salta todas las políticas de seguridad: va solo en el `.env`
> del servidor y nunca en un frontend ni en el repositorio.

Si falta alguna de las tres, el servidor **no arranca** y dice cuál falta. Es a propósito:
levantar la API sin poder autenticar a nadie sería peor que no levantarla.

### 3. Crear los usuarios

En **Authentication → Users → Add user**. Conviene marcar *Auto Confirm User* para que
puedan entrar sin verificar el correo.

Para asignar un rol, en *User Metadata* del usuario:

```json
{ "rol": "admin" }
```

El backend lo lee y lo devuelve en `/auth/me`, pero **todavía no restringe nada por rol**:
hoy cualquier usuario autenticado puede usar cualquier endpoint.

## Roles y perfiles

Cada usuario de Supabase Auth tiene una fila en la tabla `profiles` con sus datos no
sensibles: `nombre`, `apellido`, `rol` y `tienda`. Es lo que alimenta la pantalla de perfil
de cualquier frontend.

**El rol vive solo en `profiles`**, no en el token. Duplicarlo en los metadatos del usuario
acabaría con dos fuentes de verdad desincronizadas, así que el guard resuelve únicamente
`id` y `email`, y el rol se lee de la tabla cuando hace falta.

Quien se registra recibe el rol `user`. **Los cambios de rol se hacen por SQL**, nunca
desde la API:

```sql
update public.profiles set rol = 'admin' where id = (
  select id from auth.users where email = 'persona@ripley.com.pe'
);
```

Hoy el rol es informativo: **cualquier usuario autenticado puede usar cualquier endpoint**.
Todavía no hay un guard que restrinja por rol.

## Endpoints de sesión

### Registrar una cuenta

```
POST http://localhost:3000/auth/registro
```

```json
{
  "email": "persona@ripley.com.pe",
  "password": "MiClaveSegura123",
  "nombre": "Ana",
  "apellido": "López",
  "tienda": "20026"
}
```

Todos los campos son obligatorios menos `tienda`. La contraseña necesita al menos 8
caracteres, y nombre y apellido al menos 2.

Devuelve `201` con la misma forma que el login (sesión + perfil), así que el usuario queda
conectado de inmediato. Si el proyecto de Supabase exige confirmar el correo, en vez de la
sesión devuelve:

```json
{ "mensaje": "Cuenta creada. Revisa tu correo para confirmarla antes de iniciar sesión." }
```

Si el correo ya está registrado responde `409`.

> **El registro es público**: cualquiera que alcance la URL puede crear una cuenta y, con
> ella, consultar y modificar datos de Ripley. Para cerrarlo, basta con rechazar en
> `AuthService.registrar` los correos fuera del dominio de la empresa, o exigir sesión de
> administrador en el endpoint.

El rol nunca se toma del body: lo fija el backend en `user`. Si se aceptara del cliente,
cualquiera se registraría como administrador.

### Iniciar sesión

```
POST http://localhost:3000/auth/login
```

```json
{ "email": "usuario@ripley.com", "password": "la-contraseña" }
```

Respuesta:

```json
{
  "usuario": { "id": "uuid", "email": "usuario@ripley.com", "rol": "admin" },
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "xxxxx",
  "expiraEn": 1789000000,
  "tipoToken": "bearer"
}
```

Si las credenciales no sirven responde `401 Credenciales inválidas`, sin distinguir entre
"ese correo no existe" y "la contraseña está mal": decirlo permitiría averiguar qué
correos están dados de alta.

### Renovar el token

```
POST http://localhost:3000/auth/refresh
```

```json
{ "refreshToken": "xxxxx" }
```

El `accessToken` dura una hora por defecto. Cuando una llamada responda `401`, el cliente
debe renovar con este endpoint y reintentar; si el refresh también falla, toca volver a
pedir credenciales.

### Cerrar sesión

```
POST http://localhost:3000/auth/logout
Authorization: Bearer <accessToken>
```

Invalida la sesión en Supabase, así que el token deja de servir de inmediato.

### Saber quién soy

```
GET http://localhost:3000/auth/me
Authorization: Bearer <accessToken>
```

Devuelve `{ id, email, rol }`. Sirve para que el frontend muestre el usuario conectado y
para comprobar si el token sigue vivo.

## Consumir la API autenticado

Cualquier llamada a los endpoints de Ripley necesita el header:

```bash
curl http://localhost:3000/agendas/picking/oficinas?pais=PE \
  -H "Authorization: Bearer eyJhbGciOi..."
```

Sin el header, o con un token vencido:

```json
{ "statusCode": 401, "error": "Unauthorized", "message": "Sesión inválida o expirada" }
```

Ejemplo mínimo desde un frontend:

```js
const { accessToken } = await fetch('http://localhost:3000/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
}).then((r) => r.json());

const oficinas = await fetch('http://localhost:3000/agendas/picking/oficinas?pais=PE', {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then((r) => r.json());
```

## El registro de cambios

**No se registran las consultas.** Solo se guardan las operaciones que modifican datos en
Ripley y los inicios de sesión. Las consultas son la enorme mayoría del tráfico —abrir el
panel dispara media docena de catálogos— y llenaban la tabla sin aportar nada.

Lo que sí queda registrado son estas seis acciones:

| `accion` | Operación |
| --- | --- |
| `auth.login` | Inicio de sesión (con o sin éxito) |
| `auth.registro` | Alta de una cuenta nueva |
| `perfil.actualizar` | `PUT /auth/me` |
| `agente.consultarCapacidad` | Consulta del agente de IA (ver [agente-n8n.md](agente-n8n.md)) |
| `picking.actualizar` | `PUT /agendas/picking` |
| `despacho.actualizar` | `PUT /agendas/despacho` |
| `opl.actualizarServicio` | `PUT /configuracion/tipo-servicio/opl/servicios/{id}` |
| `oplMasivo.actualizar` | `POST /configuracion/tipo-servicio/opl-masivo/actualizar` |
| `transferencia.actualizarRelacion` | `PUT /configuracion/transferencia-sucursales/relaciones` |

Se marcan a mano con el decorador `@Auditar('nombre')` en el controller, en vez de
deducirlas del método HTTP. Es a propósito: en esta API hay tres POST que en realidad solo
consultan (`opl/servicios`, `opl-masivo/consultar` y `simulacion/simular`), y registrarlos
ahogaría el historial.

### Qué guarda cada fila

| Columna | Contenido |
| --- | --- |
| `usuario_id`, `usuario_email` | Quién lo hizo |
| `usuario_rol` | Con qué rol lo hizo, tal como estaba en ese momento |
| `origen` | `agente` si vino del agente de IA, `directo` si vino del panel |
| `accion` | Nombre de la operación, de la tabla de arriba |
| `metodo`, `endpoint` | `PUT`, `POST`… y la ruta |
| `datos` | Lo que envió el cliente: `query`, `params` y `body` |
| `datos_antes` | **Cómo estaban los campos editables antes del cambio** |
| `datos_despues` | **Cómo quedaron** |
| `estado`, `exitoso`, `error` | Cómo terminó |
| `duracion_ms` | Cuánto tardó |
| `ip`, `user_agent` | Desde dónde |
| `creado_en` | Hora del registro |

`datos_antes` y `datos_despues` son lo que convierte esto en un historial de cambios de
verdad. Por ejemplo, para un `picking.actualizar`:

```json
// datos_antes
{ "scheduleId": "643d…", "day": "2026-09-16T00:00:00.000Z", "assigned": 300, "active": true, "occupied": 120 }

// datos_despues
{ "scheduleId": "643d…", "day": "2026-09-16T00:00:00.000Z", "assigned": 500, "active": true }
```

Se guardan solo los campos editables, no el objeto completo que devuelve Ripley: es lo que
interesa para rendir cuentas y mantiene las filas pequeñas. En los logins van en `null`,
porque no modifican nada.

Cómo se obtiene el "antes": todos los services de escritura ya releían el estado actual
antes de guardar (ver el patrón en el README), así que solo tuvieron que reportarlo. Lo
hacen con `ContextoAuditoria`, que usa `AsyncLocalStorage` para que el dato viaje del
service al interceptor sin pasar el request de mano en mano.

### Cosas a tener en cuenta

- **Las contraseñas y los tokens se censuran** antes de guardar. Cualquier campo cuyo
  nombre contenga `password`, `token`, `secret`, `authorization` o `apikey` se guarda como
  `[CENSURADO]`, así que un `POST /auth/login` queda registrado pero sin la contraseña.
- **Auditar nunca rompe una petición.** La escritura va por detrás de la respuesta y, si
  falla, solo se anota en el log del servidor.
- **Los intentos de login fallidos sí quedan registrados**, con `exitoso = false`. En esos
  casos `usuario_id` va en `null` porque las credenciales nunca se validaron; en los logins
  correctos sí queda identificado quién entró.
- **Las peticiones con token inválido no se registran**, porque el guard las rechaza antes
  de llegar al interceptor.
- **El rol se guarda como copia, no como referencia.** Si mañana cambias el rol de alguien,
  las filas antiguas siguen mostrando con qué permisos actuó entonces, que es justo lo que
  se le pide a un registro de auditoría.

Consultas útiles sobre la tabla (quién usa más, qué endpoints, quién cambió qué) están al
final de [`supabase-setup.sql`](supabase-setup.sql).

## Mantenimiento

Al registrarse solo cambios y logins, la tabla crece despacio. Aun así, si algún día
quieres podarla:

```sql
delete from public.registro_uso where creado_en < now() - interval '365 days';
```

## Posibles mejoras

- **Restringir por rol:** el rol ya viaja en el token, falta un guard que exija, por
  ejemplo, `rol = 'admin'` para los endpoints de escritura.
- **Menos latencia:** hoy cada petición valida el token contra Supabase, lo que cuesta una
  llamada de red. Se puede cachear en memoria unos segundos, a cambio de que un `logout`
  tarde ese tiempo en surtir efecto.
