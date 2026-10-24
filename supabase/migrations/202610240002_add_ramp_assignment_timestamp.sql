alter table public.unidades
  add column if not exists rampa_asignada_at timestamptz;
