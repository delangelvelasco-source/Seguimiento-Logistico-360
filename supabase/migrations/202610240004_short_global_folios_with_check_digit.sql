-- Folios cortos: prefijo + cuatro dígitos consecutivos + dígito verificador.
-- El consecutivo es global por tipo y no se reinicia cada día.
-- El dígito verificador detecta errores de captura; la existencia se valida contra la BD.
create table if not exists public.folio_global_contadores (
  tipo text primary key,
  consecutivo bigint not null default 0 check (consecutivo >= 0)
);

insert into public.folio_global_contadores(tipo,consecutivo)
values ('cita',0),('unidad',0),('visitante',0),('proveedor',0),('otro',0),('personal_interno',0),('eventual',0)
on conflict(tipo) do nothing;

do $$
declare r record; v_max bigint;
begin
  for r in select tipo,prefijo from (values
    ('cita','C'),('unidad','T'),('visitante','V'),('proveedor','P'),
    ('otro','O'),('personal_interno','I'),('eventual','E')
  ) as x(tipo,prefijo)
  loop
    select coalesce(max(substring(folio from 3 for 4)::bigint),0)
      into v_max
    from (
      select folio from public.citas where folio ~ ('^'||r.prefijo||'-[0-9]{5}$')
      union all
      select folio from public.unidades where folio ~ ('^'||r.prefijo||'-[0-9]{5}$')
      union all
      select folio from public.accesos_caseta where folio ~ ('^'||r.prefijo||'-[0-9]{5}$')
    ) f;
    update public.folio_global_contadores
      set consecutivo=greatest(consecutivo,v_max)
      where tipo=r.tipo;
  end loop;
end $$;

create or replace function public.folio_consecutivo_corto(p_tipo text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_tipo text := lower(coalesce(p_tipo,''));
  v_prefix text;
  v_seq bigint;
  v_base text;
  v_check integer;
begin
  v_prefix := case v_tipo
    when 'cita' then 'C'
    when 'unidad' then 'T'
    when 'visitante' then 'V'
    when 'proveedor' then 'P'
    when 'otro' then 'O'
    when 'personal_interno' then 'I'
    when 'eventual' then 'E'
    else null
  end;
  if v_prefix is null then raise exception 'Tipo de folio no válido: %',v_tipo; end if;
  insert into public.folio_global_contadores(tipo,consecutivo) values(v_tipo,1)
  on conflict(tipo) do update set consecutivo=public.folio_global_contadores.consecutivo+1
  returning consecutivo into v_seq;
  if v_seq > 9999 then raise exception 'Se agotaron los folios cortos para el tipo %',v_tipo; end if;
  v_base := lpad(v_seq::text,4,'0');
  v_check := mod(
    substring(v_base,1,1)::integer+
    substring(v_base,2,1)::integer+
    substring(v_base,3,1)::integer+
    substring(v_base,4,1)::integer,10);
  return v_prefix||'-'||v_base||v_check::text;
end;
$$;

create or replace function public.generar_folio_caseta(p_tipo text)
returns text language plpgsql security definer set search_path = ''
as $$
begin
  return public.folio_consecutivo_corto(lower(coalesce(p_tipo,'')));
end;
$$;

create or replace function public.generar_folio_cita(p_fecha date default current_date)
returns text language plpgsql security definer set search_path = ''
as $$
begin
  return public.folio_consecutivo_corto('cita');
end;
$$;
