import { useEffect, useState } from "react";
import { Camera, CheckCircle2, ClipboardCheck, LogIn, RefreshCw, Search, Truck } from "lucide-react";
import { supabase } from "./lib/supabase";

export default function Caseta({ warehouseId }) {
  const [form,setForm]=useState({operador_nombre:"",linea_transporte:"",tracto_placas:"",caja_placas:"",folio_cita:"",operacion_tipo:"recibo",referencia:""});
  const [loading,setLoading]=useState(false), [error,setError]=useState(""), [message,setMessage]=useState("");
  const [recent,setRecent]=useState([]);

  async function load(){
    const {data,error}=await supabase.from("unidades").select("id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,estado,ubicacion_tipo,created_at").eq("almacen_id",warehouseId).order("created_at",{ascending:false}).limit(12);
    if(!error)setRecent(data||[]);
  }
  useEffect(()=>{if(warehouseId)load()},[warehouseId]);

  async function registrar(e){
    e.preventDefault();setLoading(true);setError("");setMessage("");
    const user=(await supabase.auth.getUser()).data.user;
    const folio=form.folio_cita.trim() || "CAS-"+Date.now().toString().slice(-8);
    const {data:unit,error:unitError}=await supabase.from("unidades").insert({
      folio,operador_nombre:form.operador_nombre.trim(),linea_transporte:form.linea_transporte.trim(),tracto_placas:form.tracto_placas.trim().toUpperCase(),caja_placas:form.caja_placas.trim().toUpperCase()||null,estado:"en_caseta",almacen_id:warehouseId,caseta_usuario_id:user?.id||null,operacion_tipo:form.operacion_tipo,ubicacion_tipo:"caseta"
    }).select("id").single();
    if(unitError){setError(unitError.message);setLoading(false);return}
    const {data:op,error:opError}=await supabase.from("operaciones_360").insert({
      folio, tipo_operacion:form.operacion_tipo, movimiento:form.operacion_tipo, almacen_id:warehouseId, referencia_cliente:form.referencia.trim()||null, estado_general:"en_caseta", unidad_id:unit.id, creado_por:user?.id||null
    }).select("id").single();
    if(opError){await supabase.from("unidades").delete().eq("id",unit.id);setError(opError.message);setLoading(false);return}
    await supabase.from("unidades").update({operacion_360_id:op.data.id,ubicacion_tipo:"caseta",updated_at:new Date().toISOString()}).eq("id",unit.id);
    const patio=await supabase.rpc("registrar_ingreso_caseta_patios",{p_unidad_id:unit.id,p_observaciones:"Ingreso registrado en Caseta"});
    if(patio.error){setError(patio.error.message);setLoading(false);return}
    setMessage("Ingreso registrado. La unidad quedó en patio y visible para Dispatch.");
    setForm({operador_nombre:"",linea_transporte:"",tracto_placas:"",caja_placas:"",folio_cita:"",operacion_tipo:"recibo",referencia:""});
    await load();setLoading(false);
  }

  return <section id="caseta" className="users-section">
    <div className="panel">
      <div className="panel-title"><div><LogIn size={19}/><strong>Caseta · Registro de ingreso</strong></div><button className="secondary-btn" onClick={load}><RefreshCw size={15}/>Actualizar</button></div>
      <p className="section-copy">Captura mínima. La información continuará enriqueciéndose en Dispatch, CSR y Operación; no se vuelve a capturar.</p>
      <form className="caseta-form" onSubmit={registrar}>
        <label>Operador<input required value={form.operador_nombre} onChange={e=>setForm({...form,operador_nombre:e.target.value})} placeholder="Nombre y apellidos"/></label>
        <label>Línea de transporte<input required value={form.linea_transporte} onChange={e=>setForm({...form,linea_transporte:e.target.value})} placeholder="Empresa transportista"/></label>
        <label>Placa tracto<input required value={form.tracto_placas} onChange={e=>setForm({...form,tracto_placas:e.target.value})} placeholder="ABC-123-X"/></label>
        <label>Placa caja<input value={form.caja_placas} onChange={e=>setForm({...form,caja_placas:e.target.value})} placeholder="Opcional"/></label>
        <label>Folio de cita<input value={form.folio_cita} onChange={e=>setForm({...form,folio_cita:e.target.value})} placeholder="Opcional"/></label>
        <label>Tipo de operación<select value={form.operacion_tipo} onChange={e=>setForm({...form,operacion_tipo:e.target.value})}><option value="recibo">Recibo</option><option value="embarque">Embarque</option></select></label>
        <label>Referencia del cliente<input value={form.referencia} onChange={e=>setForm({...form,referencia:e.target.value})} placeholder="Opcional"/></label>
        <div className="scan-placeholder"><Camera size={22}/><div><strong>Escaneo de placa / identificación</strong><span>Preparado para cámara móvil + OCR. No sustituye la validación física.</span></div></div>
        {error&&<div className="notice error"><strong>No se pudo registrar</strong><span>{error}</span></div>}
        {message&&<div className="notice success"><CheckCircle2 size={17}/><strong>{message}</strong></div>}
        <button className="login-btn" disabled={loading}><Truck size={17}/>{loading?"Registrando…":"Registrar ingreso a Caseta"}</button>
      </form>
    </div>
    <div className="panel">
      <div className="panel-title"><div><ClipboardCheck size={19}/><strong>Ingresos recientes</strong></div><span className="tag">{recent.length}</span></div>
      {recent.length?<div className="caseta-list">{recent.map(u=><div className="caseta-row" key={u.id}><div><strong>{u.folio}</strong><span>{u.linea_transporte} · {u.operador_nombre}</span></div><div><b>{u.tracto_placas}</b><small>{u.ubicacion_tipo} · {u.estado}</small></div></div>)}</div>:<div className="empty">No hay ingresos registrados.</div>}
    </div>
  </section>
}
