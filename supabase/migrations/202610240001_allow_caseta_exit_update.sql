-- Permitir que el rol caseta registre el cierre físico de una unidad liberada.
drop policy if exists unidades_update_guardia_salida on public.unidades;
create policy unidades_update_guardia_salida
on public.unidades
for update
to authenticated
using (
  (select es_rol(array['caseta','guardia','supervisor','admin','admin_global','admin_almacen']))
)
with check (
  (select es_rol(array['caseta','guardia','supervisor','admin','admin_global','admin_almacen']))
);
