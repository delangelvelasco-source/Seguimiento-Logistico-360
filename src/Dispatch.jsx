import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Edit3, RefreshCw, Search, Send, XCircle } from "lucide-react";
import { supabase } from "./lib/supabase";

const labels={operador_nombre:"Operador",linea_transporte:"Línea",tracto_placas:"Tracto",caja_placas:"Caja"};

export default function Dispatch({warehouseId}){
 const [units,setUnits]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const [query,setQuery]=useState(""),[editing,setEditing]=useState(null),[draft,setDraft]=useState({}),[reason,setReason]=useState("");
 async function load(){
  if(!warehouseId)return; setLoading(true);setError("");
  const {data,error}=await supabase.from("unidades").select("id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,estado,ubicacion_tipo,operacion_tipo,cita_at,cita_confirmada,sin_cita,dispatch_registro_at").eq("almacen_id",warehouseId).in("estado",["en_caseta","validando"]).order("created_at",{ascending:false}).limit(50);
  if(error)setError(error.message); else setUnits(data||[]); setLoading(false);
 }
 useEffect(()=>{load()},[warehouseId]);
 const filtered=units.filter(u=>[u.folio,u.operador_nombre,u.linea_transporte,u.tracto_placas,u.caja_placas||""].join(" ").toLowerCase().includes(query.toLowerCase()));
 async function saveCorrections(unit){
  setError(""); const user=(await supabase.auth.getUser()).data.user;
  const changes={};
  for(const k of Object.keys(labels)) if((draft[k]||"")!==(unit[k]||"")) changes[k]=draft[k]?.trim().toUpperCase()||null;
  if(!Object.keys(changes).length){setEditing(null);return}
  for(const k of Object.keys(changes)){const {error:e}=await supabase.from("unidades_cambios_auditoria").insert({unidad_id:unit.id,campo:k,valor_anterior:unit[k]||null,valor_nuevo:changes[k]||null,motivo:reason.trim()||"Corrección/validación en Dispatch",cambiado_por:user?.id||null});if(e){setError(e.message);return}}
  const {error}=await supabase.from("unidades").update({...changes,estado_identificacion:"requiere_dispatch",updated_at:new Date().toISOString()}).eq("id",unit.id);
  if(error){setError(error.message);return}
  setMessage("Corrección guardada y auditada.");setEditing(null);setReason("");await load();
 }
 async function decision(unit,kind){
  setError("");setMessage(""); const user=(await supabase.auth.getUser()).data.user; const now=new Date().toISOString();
  const patch=kind==="cita"?{cita_confirmada:true,sin_cita:false}:{cita_confirmada:false,sin_cita:true};
  patch.estado="validando";patch.dispatch_registro_at=now;patch.dispatch_usuario_id=user?.id||null;
  const {error}=await supabase.from("unidades").update(patch).eq("id",unit.id);
  if(error){setError(error.message);return}
  const {error:merr}=await supabase.from("movimientos").insert({unidad_id:unit.id,usuario_id:user?.id,tipo:kind==="cita"?"dispatch_cita_confirmada":"dispatch_sin_cita",estado_anterior:unit.estado,estado_nuevo:"validando",notas:kind==="cita"?"Cita confirmada por Dispatch":"Atención sin cita registrada",ocurrido_at:now});
  if(merr){setError(merr.message);return}
  setMessage(kind==="cita"?"Cita confirmada. Lista para CSR.":"Sin cita registrado. Lista para CSR.");await load();
 }
 async function sendOperation(unit){
  setError(""); const user=(await supabase.auth.getUser()).data.user; const now=new Date().toISOString();
  const {error}=await supabase.from("unidades").update({estado:"validando",dispatch_registro_at:unit.dispatch_registro_at||now,dispatch_usuario_id:user?.id||null}).eq("id",unit.id);
  if(error){setError(error.message);return}
  await supabase.from("movimientos").insert({unidad_id:unit.id,usuario_id:user?.id,tipo:"dispatch_a_operacion",estado_anterior:unit.estado,estado_nuevo:"validando",notas:"Enviada a la siguiente etapa",ocurrido_at:now});
  setMessage("Unidad enviada a la siguiente etapa.");await load();
 }
 return <section id="dispatch" className="users-section"><div className="panel"><div className="panel-title"><div><ClipboardCheck size={19}/><strong>Dispatch · Validación de llegada</strong></div><button className="secondary-btn" onClick={load} disabled={loading}><RefreshCw size={15}/>Actualizar</button></div><p className="section-copy">Dispatch decide cita/sin cita y actúa como segundo filtro. Cada corrección queda auditada.</p>{error&&<div className="notice error"><strong>Error</strong><span>{error}</span></div>}{message&&<div className="notice success"><CheckCircle2 size={17}/><strong>{message}</strong></div>}<div className="dispatch-toolbar"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar folio, operador, línea o placa"/></div>{loading?<div className="empty">Cargando unidades…</div>:filtered.length?<div className="dispatch-list">{filtered.map(u=><div className="dispatch-card" key={u.id}><div className="dispatch-head"><div><strong>{u.folio}</strong><span>{u.operacion_tipo||"Operación"} · {u.ubicacion_tipo}</span></div><span className="tag">{u.estado}</span></div>{editing===u.id?<div className="dispatch-edit">{Object.keys(labels).map(k=><label key={k}>{labels[k]}<input value={draft[k]||""} onChange={e=>setDraft({...draft,[k]:e.target.value})}/></label>)}<label className="full">Motivo de corrección<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Ej. documento, transportista o placa"/></label><div className="button-row"><button className="secondary-btn" onClick={()=>setEditing(null)}><XCircle size={15}/>Cancelar</button><button className="login-btn compact" onClick={()=>saveCorrections(u)}><CheckCircle2 size={15}/>Guardar corrección</button></div></div>:<><div className="dispatch-data"><span><b>Operador</b>{u.operador_nombre}</span><span><b>Línea</b>{u.linea_transporte}</span><span><b>Tracto</b>{u.tracto_placas}</span><span><b>Caja</b>{u.caja_placas||"—"}</span></div><div className="button-row"><button className="secondary-btn" onClick={()=>{setEditing(u.id);setDraft({...u});setReason("")}}><Edit3 size={15}/>Corregir / validar</button><button className="secondary-btn" onClick={()=>decision(u,"cita")}><CheckCircle2 size={15}/>Confirmar cita</button><button className="secondary-btn" onClick={()=>decision(u,"sin_cita")}><XCircle size={15}/>Sin cita</button><button className="login-btn compact" onClick={()=>sendOperation(u)}><Send size={15}/>Enviar a Operación</button></div></>}</div>)}</div>:<div className="empty">No hay unidades pendientes de Dispatch.</div>}</div></section>
}