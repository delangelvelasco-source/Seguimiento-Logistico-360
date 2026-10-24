CREATE OR REPLACE FUNCTION public.generar_folio_unidad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- La base de datos siempre asigna el folio, incluso si un cliente antiguo manda uno.
  NEW.folio := public.generar_folio_caseta('unidad');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generar_folio_cita_fija()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Un folio enviado por el navegador no puede reemplazar el folio oficial.
  IF TG_OP = 'INSERT' THEN
    NEW.folio := public.generar_folio_cita(coalesce(NEW.fecha, CURRENT_DATE));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.forzar_folio_acceso_caseta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Los accesos de unidad comparten el folio de unidades; los demás se generan aquí.
  IF lower(coalesce(NEW.tipo_acceso, '')) <> 'unidad' THEN
    NEW.folio := public.generar_folio_caseta(NEW.tipo_acceso);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.forzar_folio_acceso_caseta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_folio_acceso_caseta_alfanumerico ON public.accesos_caseta;
CREATE TRIGGER trg_folio_acceso_caseta_alfanumerico
BEFORE INSERT ON public.accesos_caseta
FOR EACH ROW EXECUTE FUNCTION public.forzar_folio_acceso_caseta();