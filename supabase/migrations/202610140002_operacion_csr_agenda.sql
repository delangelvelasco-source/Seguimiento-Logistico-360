-- OP360: agenda personal y control mixto para Operación CSR.
-- No sustituye la agenda operativa existente de public.citas.
-- warehouse_id puede ser NULL para ubicaciones aún no dadas de alta (p. ej. MTY-I / Nexxus);
-- location_code conserva el código provisional sin crear un almacén ficticio.

create table if not exists public.operacion_csr_agenda (
  id uuid primary key default gen_random_uuid(),
  csr_usuario_id uuid not null references public.usuarios(id) on delete cascade,
  warehouse_id uuid null references public.almacenes(id) on delete set null,
  location_code text not null,
  location_name text not null,
  cliente text not null,
  tipo_operacion text not null default 'recibo'
    check (tipo_operacion in ('recibo','embarque','visita','seguimiento','tarea')),
  folio text null,
  referencia text null,
  tracto_placas text null,
  caja_placas text null,
  fecha_programada date not null,
  hora_programada time null,
  hora_llegada_manual timestamptz null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','confirmada','llegada_reportada','caseta_confirmada','completada','cancelada')),
  fuente_llegada text not null default 'manual'
    check (fuente_llegada in ('manual','caseta','mixta')),
  cita_id uuid null references public.citas(id) on delete set null,
  unidad_id uuid null references public.unidades(id) on delete set null,
  notas text null,
  recordatorio_en timestamptz null,
  recurrencia text not null default 'ninguna'
    check (recurrencia in ('ninguna','diaria','semanal','mensual')),
  completada_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists operacion_csr_agenda_usuario_fecha_idx
  on public.operacion_csr_agenda (csr_usuario_id, fecha_programada, hora_programada);

create index if not exists operacion_csr_agenda_almacen_fecha_idx
  on public.operacion_csr_agenda (warehouse_id, fecha_programada);

create index if not exists operacion_csr_agenda_folio_idx
  on public.operacion_csr_agenda (folio) where folio is not null;

alter table public.operacion_csr_agenda enable row level security;

drop policy if exists operacion_csr_agenda_select on public.operacion_csr_agenda;
create policy operacion_csr_agenda_select
on public.operacion_csr_agenda for select to authenticated
using (
  csr_usuario_id = auth.uid()
  or (select private.es_admin_global())
  or (
    warehouse_id is not null
    and (select private.es_admin_almacen(warehouse_id))
  )
);

drop policy if exists operacion_csr_agenda_insert on public.operacion_csr_agenda;
create policy operacion_csr_agenda_insert
on public.operacion_csr_agenda for insert to authenticated
with check (
  csr_usuario_id = auth.uid()
  and exists (
    select 1 from public.usuarios u
    where u.id = auth.uid() and u.activo = true and u.rol = 'csr'
  )
  and (
    warehouse_id is null
    or private.usuario_en_almacen(warehouse_id)
  )
);

drop policy if exists operacion_csr_agenda_update on public.operacion_csr_agenda;
create policy operacion_csr_agenda_update
on public.operacion_csr_agenda for update to authenticated
using (
  csr_usuario_id = auth.uid()
  or (select private.es_admin_global())
)
with check (
  csr_usuario_id = auth.uid()
  or (select private.es_admin_global())
);

drop policy if exists operacion_csr_agenda_delete on public.operacion_csr_agenda;
create policy operacion_csr_agenda_delete
on public.operacion_csr_agenda for delete to authenticated
using (
  csr_usuario_id = auth.uid()
  or (select private.es_admin_global())
);

comment on table public.operacion_csr_agenda is
  'Agenda personal de Operación CSR con llegadas manuales y vinculación opcional con citas/unidades confirmadas por Caseta.';
comment on column public.operacion_csr_agenda.location_code is
  'Código de ubicación operativo; admite código provisional cuando el almacén todavía no existe en el catálogo oficial.';
