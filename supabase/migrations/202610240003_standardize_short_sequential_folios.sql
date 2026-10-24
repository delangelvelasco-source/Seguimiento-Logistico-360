-- Standardize newly generated folios as PREFIX-YYMMDD-NNN.
-- Existing records are intentionally left unchanged.
create or replace function public.generar_folio_caseta(p_tipo text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo text := lower(coalesce(p_tipo,''));
  v_prefix text;
  v_periodo text := to_char(clock_timestamp(),'YYMMDD');
  v_seq bigint;
begin
  v_prefix := case v_tipo
    when 'unidad' then 'T'
    when 'visitante' then 'V'
    when 'proveedor' then 'P'
    when 'otro' then 'O'
    when 'personal_interno' then 'I'
    when 'eventual' then 'E'
    else 'O'
  end;
  insert into public.caseta_folio_contadores(periodo,tipo,consecutivo)
  values(v_periodo,v_tipo,1)
  on conflict(periodo,tipo) do update
    set consecutivo=public.caseta_folio_contadores.consecutivo+1
  returning consecutivo into v_seq;
  return v_prefix||'-'||v_periodo||'-'||lpad(v_seq::text,3,'0');
end;
$$;

create or replace function public.generar_folio_cita(p_fecha date default current_date)
returns text
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  n integer;
begin
  insert into public.cita_folio_contadores(fecha,consecutivo)
  values(p_fecha,1)
  on conflict(fecha) do update
    set consecutivo=public.cita_folio_contadores.consecutivo+1
  returning consecutivo into n;
  return 'C-'||to_char(p_fecha,'YYMMDD')||'-'||lpad(n::text,3,'0');
end;
$$;
