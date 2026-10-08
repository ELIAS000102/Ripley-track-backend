# Ripley Track Backend

API NestJS que actúa como capa intermedia hacia las APIs corporativas de Ripley, para Perú y
Chile. Da servicio a un panel web y a una agente de IA que conversa por chat.

Cubre cinco áreas de la operación logística:

- **Agendas de picking, despacho, recepción y transferencia** — la capacidad de cada día:
  cuánto hay asignado, cuánto se lleva ocupado y si el día acepta pedidos. Lo que un almacén
  puede preparar, lo que un operador puede repartir, lo que una oficina puede recibir y lo
  que una sucursal de stock puede transferir a un clúster de destino.
- **Reporte de centros de distribución** — el uso de capacidad de todos los CDs, por jornada
  y por día.
- **Reporte ST** — las tiendas abastecidas desde un CD, por grupos: la capacidad de su
  recepción y de la transferencia que llega a ellas, día por día, unidas por la malla valle.
- **Configuración de tipos de servicio** — qué servicios tiene cada operador logístico, con
  sus horas de corte, y la activación o desactivación en bloque.
- **Transferencias entre sucursales** — qué días se puede mover stock entre dos almacenes y
  cuántos días tarda.
- **Simulación de entregas** — cuándo llegaría un pedido, antes de venderlo.
- **Mallas lead time** — la matriz de valle que pasa la operación en Excel: se carga con una
  plantilla, se guarda por versiones y da, por tienda, qué día se transfiere, recepciona y
  despacha lo vendido cada día de la semana.

**Los datos de negocio no se guardan aquí.** Cada petición los lee en vivo de Ripley. En
Supabase solo vive lo que es del backend: las cuentas y sus perfiles, el historial de
cambios, las conversaciones con la agente, el token corporativo de cada usuario, cifrado,
las matrices de valle, que no vienen de Ripley sino de un Excel, y los grupos de tiendas del
reporte ST.

## Quién lo usa

**Un panel web**: una página HTML de un solo archivo, sin instalación, con una pestaña por
área y el chat de la agente.

**Silvana**, la agente de IA: un flujo de n8n que conversa con los usuarios y consulta el
backend en su nombre, con la sesión de quien pregunta. Por defecto solo puede consultar; un
interruptor en el chat la pasa a modo editor y entonces puede ajustar capacidades, con
confirmación previa y un permiso que se apaga solo.

## Seguridad

- **Todo exige sesión** salvo iniciarla y renovarla.
- **El token corporativo de Ripley no sale del backend.** Cada usuario guarda el suyo
  cifrado; ninguna ruta lo devuelve, ni siquiera a su dueño.
- **Lo que la agente puede tocar es una lista cerrada.** Lo que no está explícitamente
  permitido, está prohibido.
- **Todo cambio queda registrado** con quién lo hizo, cómo estaban los datos antes y cómo
  quedaron. Las consultas no se registran.

## Requisitos

- Node.js 22+
- Acceso a la API corporativa de Ripley (URL base y token por país)
- Un proyecto de Supabase

## Puesta en marcha

Copia `.env.example` y quítale el sufijo `.example` al nombre. Complétalo con la URL base y
las rutas de la API de Ripley de cada país, más las tres claves de Supabase; cada variable
está documentada ahí mismo, con comentarios. El token corporativo no va en el entorno: lo
guarda cada usuario desde el panel.

Antes del primer arranque hay que crear las tablas en Supabase ejecutando el script SQL de
instalación en su editor de consultas.

```bash
npm install
npm run start:dev
```

El servidor arranca en `http://localhost:3000` por defecto. Abre el panel en el navegador
para usarlo.

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run start:dev` | Servidor en modo watch |
| `npm run build` | Compila el proyecto |
| `npm run start:prod` | Servidor con el código ya compilado |
| `npm run lint` | Linter sobre el código |
| `npm run format` | Formatea el código |
| `npm test` | Los tests, en `test/` |

## Documentación

La documentación detallada —la estructura del proyecto, todas las rutas con ejemplos, el
montaje del flujo de la agente, la autenticación y el ciclo de vida del token— se mantiene
fuera del repositorio, junto al panel y al script de instalación de Supabase. Pídesela a
quien te dé acceso al proyecto.
