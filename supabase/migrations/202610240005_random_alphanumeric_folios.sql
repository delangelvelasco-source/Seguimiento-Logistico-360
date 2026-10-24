CREATE TABLE IF NOT EXISTS public.folios_codigos_emitidos (
  codigo text PRIMARY KEY,
  tipo text NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.folios_codigos_emitidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.folios_codigos_emitidos FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.folio_consecutivo_corto(p_tipo text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo text := lower(coalesce(p_tipo, 'otro'));
  v_prefijo text;
  v_alfabeto constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_codigo text;
  v_intento integer;
  v_i integer;
BEGIN
  v_prefijo := CASE v_tipo
    WHEN 'cita' THEN 'C'
    WHEN 'unidad' THEN 'T'
    WHEN 'visitante' THEN 'V'
    WHEN 'proveedor' THEN 'P'
    WHEN 'personal_interno' THEN 'I'
    WHEN 'eventual' THEN 'E'
    ELSE 'O'
  END;

  FOR v_intento IN 1..100 LOOP
    v_codigo := v_prefijo || '-';
    FOR v_i IN 1..4 LOOP
      v_codigo := v_codigo || substr(v_alfabeto, floor(random() * length(v_alfabeto))::integer + 1, 1);
    END LOOP;

    BEGIN
      INSERT INTO public.folios_codigos_emitidos(codigo, tipo)
      VALUES (v_codigo, v_tipo);
      RETURN v_codigo;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;

  RAISE EXCEPTION 'No fue posible generar un folio único después de 100 intentos';
END;
$$;

REVOKE ALL ON FUNCTION public.folio_consecutivo_corto(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.folio_consecutivo_corto(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.generar_folio_caseta(p_tipo text DEFAULT 'otro')
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN public.folio_consecutivo_corto(p_tipo);
END;
$$;

CREATE OR REPLACE FUNCTION public.generar_folio_cita(p_fecha date DEFAULT CURRENT_DATE)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN public.folio_consecutivo_corto('cita');
END;
$$;