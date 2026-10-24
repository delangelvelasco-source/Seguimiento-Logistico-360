-- Solicitudes de citas adicionales para autorización por Operación.
create table if not exists public.solicitudes_citas_adicionales (
  id uuid primary key default gen_random_uuid(),
  almacen_id uuid not null references public.almacenes(id) on delete cascade,
  fecha date not null,
  hora_inicio time not null,
  tipo_operacion text not null check (tipo_operacion in ('recibo','embarque')),
  motivo text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','autorizada','rechazada')),
  solicitado_por uuid references auth.users(id) on delete set null,
  solicitado_at timestamptz not null default now(),
  revisado_por uuid references auth.users(id) on delete set null,
  revisado_at timestamptz,
  respuesta text,
  created_at timestamptz not null default now()
);
create index if not exists solicitudes_citas_adicionales_almacen_estado_fecha_idx
  on public.solicitudes_citas_adicionales (almacen_id, estado, fecha, hora_inicio);
alter table public.solicitudes_citas_adicionales enable row level security;
drop policy if exists "Authenticated users can view additional appointment requests" on public.solicitudes_citas_adicionales;
create policy "Authenticated users can view additional appointment requests"
  on public.solicitudes_citas_adicionales for select to authenticated using (true);
drop policy if exists "Authenticated users can submit additional appointment requests" on public.solicitudes_citas_adicionales;
create policy "Authenticated users can submit additional appointment requests"
  on public.solicitudes_citas_adicionales for insert to authenticated with check (auth.uid() = solicitado_por);
drop policy if exists "Authenticated users can review additional appointment requests" on public.solicitudes_citas_adicionales;
create policy "Authenticated users can review additional appointment requests"
  on public.solicitudes_citas_adicionales for update to authenticated using (true) with check (true);
