import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Edit3, Eye, MessageCircle, RefreshCw, Send, X, XCircle } from "lucide-react";
import { supabase } from "./lib/supabase";

const fields={operador_nombre:"Operador",linea_transporte:"Línea",tracto_placas:"Tracto",caja_placas:"Caja",pallets:"Pallets"};

export default function Dispatch({warehouseId}){
 const [units,setUnits]=useState([]);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [query,setQuery]=useState("");
 const [editing,setEditing]=useState(null);
 const [draft,setDraft]=useState({});
 const [reason,setReason]=useState("");
 const [evidence,setEvidence]=useState(null);

 async function load(){
  if(!warehouseId)return;
  setLoading(true);setError("");
  const r=await supabase.from("unidades").select("id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,estado,ubicacion_tipo,operacion_tipo,cita_at,cita_confirmada,sin_cita,dispatch_registro_at,pallets").eq("almacen_id",warehouseId).in("estado",["en_caseta","validando"]).order("created_at",{ascending:false}).limit(50);
  if(r.error)setError(r.error.message);else setUnits(r.data||[]);
  setLoading(false);
 }
 useEffect(()=>{load();if(!warehouseId)return;const ch=supabase.channel("dispatch-"+warehouseId).on("postgres_changes",{event:"*",schema:"public",table:"unidades",filter:"almacen_id=eq."+warehouseId},load).subscribe();const t=setInterval(load,15000);return()=>{clearInterval(t);supabase.removeChannel(ch)}},[warehouseId]);

 const filtered=units.filter(u=>[u.folio,u.operador_nombre,u.linea_transporte,u.tracto_placas,u.caja_placas].join(" ").toLowerCase().includes(query.toLowerCase()));

 async function decision(u,type){
  const user=(await supabase.auth.getUser()).data.user;const now=new Date().toISOString();
  const patch=type==="cita"?{cita_confirmada:true,sin_cita:false}:{cita_confirmada:false,sin_cita:true};
  patch.estado="validando";patch.dispatch_registro_at=now;patch.dispatch_usuario_id=user?.id||null;
  const r=await supabase.from("unidades").update(patch).eq("id",u.id);
  if(r.error){setError(r.error.message);return}
  setMessage(type==="cita"?"Cita confirmada. Lista para CSR.":"Sin cita registrado. Lista para CSR.");await load();
 }

 async function sendOperation(u){
  const user=(await supabase.auth.getUser()).data.user;const now=new Date().toISOString();
  const r=await supabase.from("unidades").update({estado:"validando",dispatch_registro_at:u.dispatch_registro_at||now,dispatch_usuario_id:user?.id||null}).eq("id",u.id);
  if(r.error){setError(r.error.message);return}
  setMessage("Unidad enviada a Operación.");await load();
 }

 async function save(){
  if(!editing)return;
  const changes={};
  Object.keys(fields).forEach(k=>{if((draft[k]||"")!==(editing[k]||""))changes[k]=draft[k]?.trim().toUpperCase()||null});
  if(!Object.keys(changes).length){setEditing(null);return}
  const r=await supabase.from("unidades").update({...changes,estado_identificacion:"requiere_dispatch",updated_at:new Date().toISOString()}).eq("id",editing.id);
  if(r.error){setError(r.error.message);return}
  setMessage("Corrección guardada"+(reason.trim()?" y auditada.":"."));setEditing(null);setReason("");await load();
 }

 function whatsapp(u){
  const text="🚛 OP360 · DISPATCH\n\nFolio: "+(u.folio||"—")+"\nOperador: "+(u.operador_nombre||"—")+"\nLínea: "+(u.linea_transporte||"—")+"\nTracto: "+(u.tracto_placas||"—")+"\nCaja: "+(u.caja_placas||"—")+"\nEstatus: "+(u.estado||"—");
  window.location.href="https://wa.me/?text="+encodeURIComponent(text);
 }

 async function verEvidencia(u){
  setError("");
  const a=await supabase.from("accesos_caseta").select("id,folio,nombre,empresa,tracto_placas,caja_placas,entrada_at").eq("unidad_id",u.id).eq("almacen_id",warehouseId).order("entrada_at",{ascending:false}).limit(1).maybeSingle();
  if(a.error){setError(a.error.message);return}
  if(!a.data){setError("No se encontró el registro de llegada.");return}
  const e=await supabase.from("evidencias_caseta").select("id,tipo,storage_path,created_at").eq("acceso_id",a.data.id).order("created_at",{ascending:false});
  if(e.error){setError(e.error.message);return}
  const paths=(e.data||[]).map(x=>x.storage_path).filter(Boolean);
  let photos=[];
  if(paths.length){const p=await supabase.storage.from("evidencias-caseta").createSignedUrls(paths,3600);if(p.error){setError(p.error.message);return}photos=(p.data||[]).map((x,i)=>({...e.data[i],signedUrl:x.signedUrl||""}))}
  setEvidence({unit:u,access:a.data,photos});
 }

 return <section id="dispatch" className="users-section"><div className="panel">
  <div className="panel-title"><div><ClipboardCheck size={19}/><strong>Dispatch · Validación de llegada</strong></div><button className="secondary-btn" onClick={load} disabled={loading}><RefreshCw size={15}/>Actualizar</button></div>
  <p className="section-copy">Dispatch valida la llegada y decide cita o atención sin cita.</p>
  {error&&<div className="notice error"><strong>Error</strong><span>{error}</span></div>}
  {message&&<div className="notice success"><CheckCircle2 size={17}/><strong>{message}</strong></div>}
  <div className="dispatch-toolbar"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar folio, operador, línea o placa"/></div>
  {loading?<div className="empty">Cargando unidades…</div>:filtered.length?<div className="dispatch-list">{filtered.map(u=><div className="dispatch-card" key={u.id}>
   <div className="dispatch-head"><div><strong>{u.folio||"Sin folio"}</strong><span>{u.operacion_tipo||"Operación"} · {u.ubicacion_tipo||"—"}</span></div><span className="tag">{u.estado}</span></div>
   {editing?.id===u.id?<div className="dispatch-edit">{Object.keys(fields).map(k=><label key={k}>{fields[k]}<input value={draft[k]??""} onChange={e=>setDraft({...draft,[k]:e.target.value})}/></label>)}<label className="full">Motivo<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motivo de corrección"/></label><div className="button-row"><button className="secondary-btn" onClick={()=>setEditing(null)}><XCircle size={15}/>Cancelar</button><button className="login-btn compact" onClick={save}><CheckCircle2 size={15}/>Guardar</button></div></div>:<><div className="dispatch-data"><span><b>Operador</b>{u.operador_nombre||"—"}</span><span><b>Línea</b>{u.linea_transporte||"—"}</span><span><b>Tracto</b>{u.tracto_placas||"—"}</span><span><b>Caja</b>{u.caja_placas||"—"}</span><span><b>Pallets</b>{u.pallets??"—"}</span></div><div className="button-row"><button className="login-btn compact" onClick={()=>verEvidencia(u)}><Eye size={15}/>📷 Evidencia</button><button className="secondary-btn" onClick={()=>{setEditing(u);setDraft({...u});setReason("")}}><Edit3 size={15}/>Corregir</button><button className="secondary-btn" onClick={()=>decision(u,"cita")}><CheckCircle2 size={15}/>Confirmar cita</button><button className="secondary-btn" onClick={()=>decision(u,"sin_cita")}><XCircle size={15}/>Sin cita</button><button className="secondary-btn" onClick={()=>whatsapp(u)}><MessageCircle size={15}/>WhatsApp</button><button className="login-btn compact" onClick={()=>sendOperation(u)}><Send size={15}/>Enviar a Operación</button></div></>}
  </div>)}</div>:<div className="empty">No hay unidades pendientes de Dispatch.</div>}
 </div>{evidence&&<EvidenceModal data={evidence} close={()=>setEvidence(null)}/>}</section>;
}

function EvidenceModal({data,close}){
 return <div className="csr-evidence-modal" role="dialog" aria-modal="true"><div className="csr-evidence-card"><div className="csr-evidence-head"><div><strong>Prueba de llegada</strong><span>{data.access?.folio||data.unit?.folio||"Unidad"}</span></div><button type="button" className="csr-evidence-close" onClick={close}><X size={20}/></button></div><div className="csr-evidence-summary"><div><b>Operador</b><span>{data.access?.nombre||data.unit?.operador_nombre||"—"}</span></div><div><b>Empresa</b><span>{data.access?.empresa||data.unit?.linea_transporte||"—"}</span></div><div><b>Tracto</b><span>{data.access?.tracto_placas||"—"}</span></div><div><b>Caja</b><span>{data.access?.caja_placas||"—"}</span></div></div><div className="csr-evidence-actions">{["placa","identificacion"].map(tipo=>{const p=data.photos?.find(x=>x.tipo===tipo);return <div className="csr-evidence-choice" key={tipo}><span>{tipo==="placa"?"📷":"🪪"}</span><div><strong>{tipo==="placa"?"Placa":"ID / INE"}</strong><small>{p?.signedUrl?"Fotografía disponible":"Sin fotografía"}</small></div></div>})}</div></div></div>;
}
