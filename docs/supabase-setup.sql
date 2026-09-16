-- ============================================================================
-- Registro de cambios — Ripley Track Backend
--
-- Ejecutar en el SQL Editor de Supabase.
-- Crea la tabla donde el backend guarda las operaciones que modifican datos en
-- Ripley y los inicios de sesión: quién, qué endpoint, qué datos envió, cómo
-- estaba antes, cómo quedó después y a qué hora.
--
-- Las consultas NO se registran: son la mayoría del tráfico y llenaban la tabla
-- sin aportar nada.
--
-- Si la tabla ya existe de una versión anterior, salta al bloque "Migración".
-- ============================================================================

create table if not exists public.registro_uso (
  id            bigint generated always as identity primary key,

  -- Quién: viene del token de Supabase Auth que validó el guard.
  -- Queda en null si el endpoint era público (por ejemplo, un login fallido).
  usuario_id    uuid references auth.users (id) on delete set null,
  usuario_email text,

  -- Rol que tenía al hacer la operación. Es una copia a propósito: si la persona
  -- cambia de rol, el historial debe seguir diciendo con qué permisos actuó.
  usuario_rol   text,

  -- Qué se hizo: "picking.actualizar", "auth.login"…
  accion        text        not null default '',

  -- Por dónde entró: 'agente' si vino del agente de IA, 'directo' si no.
  -- Lo declara el cliente por cabecera, así que sirve para trazar, no para autorizar.
  origen        text        not null default 'directo',

  -- Qué se consumió
  metodo        text        not null,
  endpoint      text        not null,

  -- Datos ingresados: query, params de ruta y body.
  -- El backend censura contraseñas y tokens antes de escribir aquí.
  datos         jsonb       not null default '{}'::jsonb,

  -- El cambio en sí: cómo estaban los campos editables y cómo quedaron.
  -- Van en null en los inicios de sesión, que no modifican nada.
  datos_antes   jsonb,
  datos_despues jsonb,

  -- Cómo resultó
  estado        integer     not null,
  exitoso       boolean     not null,
  error         text,
  duracion_ms   integer     not null,

  -- Desde dónde
  ip            text,
  user_agent    text,

  -- Cuándo
  creado_en     timestamptz not null default now()
);

-- Índices para las consultas típicas del registro:
-- "qué hizo este usuario", "quién tocó este endpoint", "qué falló".
create index if not exists registro_uso_creado_en_idx
  on public.registro_uso (creado_en desc);

create index if not exists registro_uso_usuario_idx
  on public.registro_uso (usuario_id, creado_en desc);

create index if not exists registro_uso_endpoint_idx
  on public.registro_uso (endpoint, creado_en desc);

create index if not exists registro_uso_fallidos_idx
  on public.registro_uso (creado_en desc)
  where exitoso = false;

-- ============================================================================
-- Migración: si la tabla ya existía sin las columnas del historial de cambios,
-- basta con ejecutar esto (es idempotente, se puede correr varias veces).
-- ============================================================================

alter table public.registro_uso
  add column if not exists accion        text not null default '',
  add column if not exists datos_antes   jsonb,
  add column if not exists datos_despues jsonb,
  add column if not exists usuario_rol   text,
  add column if not exists origen        text not null default 'directo';

create index if not exists registro_uso_accion_idx
  on public.registro_uso (accion, creado_en desc);

-- ============================================================================
-- Seguridad
--
-- RLS activo y SIN políticas: nadie puede leer ni escribir con la anon key.
-- El backend escribe con la service role key, que se salta RLS por diseño.
-- Para consultar el registro, usar el SQL Editor o el panel de Supabase.
-- ============================================================================

alter table public.registro_uso enable row level security;

-- Si más adelante quieres que cada usuario vea su propio historial desde un
-- frontend con la anon key, descomenta esta política:
--
-- create policy "cada usuario ve su propio registro"
--   on public.registro_uso for select
--   using (auth.uid() = usuario_id);

-- ============================================================================
-- Consultas útiles
-- ============================================================================

-- Uso por usuario en los últimos 7 días
--
-- select usuario_email, count(*) as peticiones, max(creado_en) as ultima
-- from public.registro_uso
-- where creado_en > now() - interval '7 days'
-- group by usuario_email
-- order by peticiones desc;

-- Endpoints más consumidos
--
-- select endpoint, metodo, count(*) as veces
-- from public.registro_uso
-- group by endpoint, metodo
-- order by veces desc;

-- Historial de cambios: quién cambió qué, con qué rol, y de qué valor a qué valor
--
-- select creado_en, usuario_email, usuario_rol, accion, datos_antes, datos_despues
-- from public.registro_uso
-- where accion not in ('auth.login', 'auth.registro')
-- order by creado_en desc
-- limit 100;

-- Qué hizo cada rol
--
-- select usuario_rol, accion, count(*) as veces
-- from public.registro_uso
-- group by usuario_rol, accion
-- order by veces desc;

-- Qué se le está preguntando al agente de IA, y quién
--
-- select creado_en, usuario_email, usuario_rol, datos->'query' as consulta
-- from public.registro_uso
-- where origen = 'agente'
-- order by creado_en desc
-- limit 50;

-- Cambios hechos conversando con el agente frente a los hechos desde el panel
--
-- select origen, accion, count(*) as veces
-- from public.registro_uso
-- group by origen, accion
-- order by veces desc;

-- Cambios de capacidad, con el antes y el después en columnas aparte
--
-- select creado_en, usuario_email,
--        datos_antes->>'assigned'   as asignado_antes,
--        datos_despues->>'assigned' as asignado_despues,
--        datos_antes->>'day'        as dia
-- from public.registro_uso
-- where accion = 'picking.actualizar' and exitoso
-- order by creado_en desc;

-- Inicios de sesión, incluidos los intentos fallidos
--
-- select creado_en, usuario_email, exitoso, error, ip
-- from public.registro_uso
-- where accion = 'auth.login'
-- order by creado_en desc;

-- ============================================================================
-- Limpieza (opcional)
--
-- La tabla crece con cada petición. Para no acumular indefinidamente, se puede
-- borrar lo más viejo de vez en cuando:
--
-- delete from public.registro_uso where creado_en < now() - interval '90 days';
-- ============================================================================


-- ============================================================================
-- PERFILES DE USUARIO — public.profiles
--
-- Complementa a Supabase Auth con los datos no sensibles que muestra el
-- frontend: nombre, apellido, rol y tienda.
-- ============================================================================

create table if not exists public.profiles (
  id             uuid references auth.users (id) on delete cascade primary key,
  nombre         text,
  apellido       text,
  -- 'user' es el rol mínimo, el mismo que asigna el backend al registrar.
  -- Con otro valor, los usuarios creados desde el panel de Supabase saldrían
  -- con un rol distinto a los creados por la API.
  rol            text default 'user',
  tienda         text,
  actualizado_en timestamptz default now()
);

-- Si la tabla ya existía con otro rol por defecto, alinearlo:
alter table public.profiles alter column rol set default 'user';

-- ============================================================================
-- Seguridad
--
-- RLS activo: con la anon key, cada usuario solo alcanza su propia fila.
-- El backend usa la service role key (que se salta RLS) y filtra siempre por
-- el id que resolvió del token, nunca por uno que venga del cliente.
--
-- Ojo: no hay política de UPDATE sobre `rol` porque la política de abajo
-- permite actualizar la fila entera. Mientras el frontend hable solo con el
-- backend da igual —el backend nunca escribe el rol—, pero si algún día un
-- cliente usa la anon key directamente, conviene restringir las columnas.
-- ============================================================================

alter table public.profiles enable row level security;

drop policy if exists "Los usuarios ven su propio perfil" on public.profiles;
drop policy if exists "Los usuarios actualizan su propio perfil" on public.profiles;

create policy "Los usuarios ven su propio perfil"
  on public.profiles for select
  using ( (select auth.uid()) = id );

create policy "Los usuarios actualizan su propio perfil"
  on public.profiles for update
  using ( (select auth.uid()) = id );

-- ============================================================================
-- Trigger: crea el perfil en cuanto nace el usuario en auth.users
--
-- Copia nombre y apellido de los metadatos del registro. El rol y la tienda
-- los completa el backend justo después, con un upsert.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, nombre, apellido)
  values (
    new.id,
    new.raw_user_meta_data->>'nombre',
    new.raw_user_meta_data->>'apellido'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================================
-- Usuarios que ya existían antes de crear la tabla
--
-- El trigger solo dispara con usuarios nuevos, así que a los anteriores hay
-- que crearles el perfil a mano:
--
-- insert into public.profiles (id, nombre, apellido, rol)
-- select u.id,
--        u.raw_user_meta_data->>'nombre',
--        u.raw_user_meta_data->>'apellido',
--        'user'
-- from auth.users u
-- left join public.profiles p on p.id = u.id
-- where p.id is null;
-- ============================================================================

-- ============================================================================
-- Cambiar el rol de alguien
--
-- Los roles NO se editan desde la API a propósito: si el endpoint de perfil
-- los aceptara, cualquiera se ascendería a sí mismo. Se hacen por SQL:
--
-- update public.profiles set rol = 'admin'
-- where id = (select id from auth.users where email = 'persona@ripley.com.pe');
-- ============================================================================
