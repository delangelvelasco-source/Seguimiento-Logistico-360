-- OP360: asignación múltiple de almacenes por usuario
-- Preparación segura: conserva usuarios.almacen_id como almacén principal/compatibilidad.
-- No activa Nexxus ni crea almacenes ficticios; las asignaciones requieren almacenes existentes.

create table if not exists public.usuario_almacenes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  almacen_id uuid not null references public.almacenes(id) on delete cascade,
  asignado_por uuid null references public.usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (usuario_id, almacen_id)
);

create index if not exists usuario_almacenes_usuario_id_idx
  on public.usuario_almacenes (usuario_id);

create index if not exists usuario_almacenes_almacen_id_idx
  on public.usuario_almacenes (almacen_id);

alter table public.usuario_almacenes enable row level security;

-- Migración idempotente: las asignaciones principales existentes pasan a ser
-- asignaciones iniciales, sin borrar ni modificar usuarios.almacen_id.
insert into public.usuario_almacenes (usuario_id, almacen_id)
select u.id, u.almacen_id
from public.usuarios u
join public.almacenes a on a.id = u.almacen_id
where u.almacen_id is not null
on conflict (usuario_id, almacen_id) do nothing;

comment on table public.usuario_almacenes is
  'Almacenes autorizados por usuario OP360. usuarios.almacen_id se conserva por compatibilidad como almacén principal.';
