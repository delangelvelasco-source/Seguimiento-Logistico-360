import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Edit3, Eye, MessageCircle, RefreshCw, Search, Send, X, XCircle, UserCheck, MapPin, Megaphone, ListChecks, Clock3, FileText, LockKeyhole, Unlock } from "lucide-react";
import { supabase } from "./lib/supabase";

const fields={operador_nombre:"Operador",linea_transporte:"Línea",tracto_placas:"Tracto",caja_placas:"Caja",pallets:"Pallets"};
const ACTIVE_STATES=["en_caseta","validando","espera_turno","rampa_asignada","en_operacion","documentacion"];
const stateLabel={en_caseta:"En caseta",validando:"Validación",espera_turno:"Espera de turno",rampa_asignada:"Rampa asignada",en_operacion:"En operación",documentacion:"Documentación",liberada:"Liberada"};


export default function Dispatch({warehouseId}){
 const [units,setUnits]=useState([]);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [query,setQuery]=useState("");
 const [editing,setEditing]=useState(null);
 const [draft,setDraft]=useState({});
 const [reason,setReason]=useState("");
 const [evidence,setEvidence]=useState(null),[ramps,setRamps]=useState([]),[saving,setSaving]=useState(""),[statusOpen,setStatusOpen]=useState(null),[docModal,setDocModal]=useState(null),[sealModal,setSealModal]=useState(null);

 async function load(){
  if(!warehouseId)return;
  setLoading(true);setError("");
  const [r,rr]=await Promise.all([supabase.from("unidades").select("id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,estado,ubicacion_tipo,operacion_tipo,cita_at,cita_confirmada,sin_cita,dispatch_registro_at,csr_confirmacion_at,csr_usuario_id,rampa_id,operacion_inicio_at,operacion_fin_at,desentrampe_at,salida_autorizada,salida_autorizada_at,pallets,numero_sellos,updated_at,created_at").eq("almacen_id",warehouseId).in("estado",ACTIVE_STATES).order("created_at",{ascending:false}).limit(50),supabase.from("rampas").select("id,nombre,codigo,estado,activa").eq("almacen_id",warehouseId).eq("activa",true).eq("estado","operativa").order("nombre")]);
  if(r.error)setError(r.error.message);else setUnits(r.data||[]); if(rr.error)setError(prev=>prev||rr.error.message);else setRamps(rr.data||[]);
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

 async function logMovement(u,estadoNuevo,tipo,notas,extra={}){
  const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
  const r=await supabase.from("unidades").update({...extra,estado:estadoNuevo,updated_at:now}).eq("id",u.id);
  if(r.error){setError(r.error.message);return false}
  await supabase.from("movimientos").insert({unidad_id:u.id,usuario_id:user?.id,tipo,estado_anterior:u.estado,estado_nuevo:estadoNuevo,notas,ocurrido_at:now});
  await load();setMessage(notas);return true;
 }
 async function validateArrival(u){
  const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
  return logMovement(u,"validando","dispatch_arribo_validado","Arribo validado por Dispatch.",{dispatch_registro_at:u.dispatch_registro_at||now,dispatch_usuario_id:user?.id||null});
 }
 async function confirmCSR(u){
  const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
  return logMovement(u,"espera_turno","csr_confirmado","Confirmación CSR registrada. Unidad en espera de turno.",{csr_confirmacion_at:now,csr_usuario_id:user?.id||null});
 }
 async function assignRamp(u,rampId){
  if(!rampId)return;
  const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
  if(units.some(x=>x.id!==u.id&&x.rampa_id===rampId&&["rampa_asignada","en_operacion"].includes(x.estado))){setError("Esa rampa ya está ocupada.");return}
  await logMovement(u,"rampa_asignada","rampa_asignada","Rampa asignada: "+(ramps.find(r=>r.id===rampId)?.nombre||"rampa"),{rampa_id:rampId,ubicacion_tipo:"rampa",ubicacion_at:now,ubicacion_por:user?.id||null});
 }
 async function callToRamp(u){
  if(!u.rampa_id){setError("Primero asigna una rampa.");return}
  await logMovement(u,"rampa_asignada","unidad_llamada_rampa","Unidad llamada / enviada a rampa.");
 }
 async function changeStatus(u,estado){
  setStatusOpen(null); if(estado===u.estado)return;
  await logMovement(u,estado,"estatus_operativo","Estatus operativo cambiado a "+(stateLabel[estado]||estado)+".");
 }
 async function registerDocument(u){
  const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
  const ref=window.prompt("Referencia o documento recibido:",u.folio_cita||"");
  if(ref===null)return;
  const notes=window.prompt("Observaciones de documentación:","Documentación revisada por Dispatch.");
  if(notes===null)return;
  const q=await supabase.from("documentos").insert({unidad_id:u.id,usuario_id:user?.id||null,tipo:"dispatch",referencia:ref.trim()||null,validado:true,notas:notes.trim()||null,validated_at:now});
  if(q.error){setError(q.error.message);return}
  await logMovement(u,"documentacion","documentacion_validada","Documentación validada.");
 }
 async function registerSeal(u){
  const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
  const physical=window.prompt("Número de sello físico:");
  if(physical===null)return;
  if(!physical.trim()){setError("Captura el número de sello.");return}
  const documented=window.prompt("Número de sello documentado (opcional):","");
  const q=await supabase.from("sellos_unidad").insert({unidad_id:u.id,numero_fisico:physical.trim().toUpperCase(),numero_documentado:documented?.trim().toUpperCase()||null,origen:"dispatch",resultado:"pendiente",colocado_por:user?.id||null,colocado_at:now,created_by:user?.id||null});
  if(q.error){setError(q.error.message);return}
  await supabase.from("unidades").update({numero_sellos:(u.numero_sellos||0)+1,updated_at:now}).eq("id",u.id);
  setMessage("Sellado registrado: "+physical.trim().toUpperCase());await load();
 }
 async function authorizeRelease(u){
  const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
  const q=await supabase.from("unidades").update({estado:"liberada",salida_autorizada:true,salida_autorizada_at:now,salida_autorizada_por:user?.id||null,updated_at:now}).eq("id",u.id);
  if(q.error){setError(q.error.message);return}
  await supabase.from("movimientos").insert({unidad_id:u.id,usuario_id:user?.id,tipo:"unidad_liberada",estado_anterior:u.estado,estado_nuevo:"liberada",notas:"Unidad liberada por Dispatch.",ocurrido_at:now});
  setMessage("Unidad liberada: "+u.folio);await load();
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
  const raw=String(u.estado||"").toLowerCase().replace(/_/g," ");
  let estatus="En proceso",detalle="La unidad continúa dentro del flujo operativo.";
  if(raw.includes("caseta")||raw.includes("llegada")){estatus="Registro en caseta";detalle="La unidad fue registrada y se encuentra en proceso de validación.";}
  else if(raw.includes("espera")||raw.includes("turno")){estatus="Espera de turno";detalle="La unidad permanece en espera de que se le asigne turno/rampa.";}
  else if(raw.includes("rampa")){estatus="En rampa";detalle="La unidad ya fue asignada a una rampa y continúa con su operación.";}
  else if(raw.includes("cargando")){estatus="Cargando";detalle="La unidad se encuentra en proceso de carga.";}
  else if(raw.includes("descargando")){estatus="Descargando";detalle="La unidad se encuentra en proceso de descarga.";}
  else if(raw.includes("liberad")||raw.includes("salida")||raw.includes("cerrad")){estatus="Liberada";detalle="La operación fue concluida y la unidad se encuentra liberada.";}
  else if(raw.includes("valid")){estatus="Validación";detalle="La unidad está siendo validada por Dispatch.";}
  const text=`🏭 *ALMACÉN LAS TORRES*
📲 *OP360 · SEGUIMIENTO DE UNIDAD*

Hola 👋 Te compartimos una actualización de tu unidad:

━━━━━━━━━━━━━━━━━━
🎫 *Folio:* ${u.folio||"—"}
👤 *Operador:* ${u.operador_nombre||"—"}
🚚 *Transporte:* ${u.linea_transporte||"—"}
🚛 *Tracto:* ${u.tracto_placas||"—"}
📦 *Caja:* ${u.caja_placas||"—"}
🔄 *Operación:* ${u.operacion_tipo||"—"}
━━━━━━━━━━━━━━━━━━

📍 *Ubicación:* Almacén Las Torres
🟡 *Estatus actual:* ${estatus}

💬 ${detalle}

⏱️ Te compartiremos cualquier cambio importante en el estatus de la unidad.

_Almacén Las Torres · OP360_`;
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
  <div className="panel-title"><div><ClipboardCheck size={19}/><strong>Dispatch · Control operativo</strong></div><button className="secondary-btn" onClick={load} disabled={loading}><RefreshCw size={15}/>Actualizar</button></div>
  <p className="section-copy">Gestiona cada unidad desde su arribo hasta rampa, documentación, sellado y liberación.</p>
  {error&&<div className="notice error"><strong>Error</strong><span>{error}</span></div>}
  {message&&<div className="notice success"><CheckCircle2 size={17}/><strong>{message}</strong></div>}
  <div className="dispatch-toolbar"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar folio, operador, línea o placa"/></div>
  {loading?<div className="empty">Cargando unidades…</div>:filtered.length?<div className="dispatch-list">{filtered.map(u=><div className="dispatch-card" key={u.id}>
   <div className="dispatch-head"><div><strong>{u.folio||"Sin folio"}</strong><span>{u.operacion_tipo||"Operación"} · {u.ubicacion_tipo||"—"}</span></div><span className="tag">{stateLabel[u.estado]||u.estado}</span></div>
   {editing?.id===u.id?<div className="dispatch-edit">{Object.keys(fields).map(k=><label key={k}>{fields[k]}<input value={draft[k]??""} onChange={e=>setDraft({...draft,[k]:e.target.value})}/></label>)}<label className="full">Motivo<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motivo de corrección"/></label><div className="button-row"><button className="secondary-btn" onClick={()=>setEditing(null)}><XCircle size={15}/>Cancelar</button><button className="login-btn compact" onClick={save}><CheckCircle2 size={15}/>Guardar</button></div></div>:<><div className="dispatch-data"><span><b>Operador</b>{u.operador_nombre||"—"}</span><span><b>Línea</b>{u.linea_transporte||"—"}</span><span><b>Tracto</b>{u.tracto_placas||"—"}</span><span><b>Caja</b>{u.caja_placas||"—"}</span><span><b>Pallets</b>{u.pallets??"—"}</span></div><div className="button-row">
<button className="secondary-btn" onClick={()=>{setEditing(u);setDraft({...u});setReason("")}}><Edit3 size={15}/>✏️ Editar datos</button>
<button className="secondary-btn" onClick={()=>verEvidencia(u)}><Eye size={15}/>📷 Ver evidencia</button>
<button className="secondary-btn" onClick={()=>whatsapp(u)}><MessageCircle size={15}/>💬 WhatsApp</button>
{u.estado==="en_caseta"&&<button className="login-btn compact" onClick={()=>validateArrival(u)}><CheckCircle2 size={15}/>✅ Validar arribo</button>}
{u.estado==="validando"&&<button className="login-btn compact" onClick={()=>confirmCSR(u)}><UserCheck size={15}/>👤 Confirmación CSR</button>}
{u.estado==="espera_turno"&&<label className="dispatch-action-select"><MapPin size={15}/><span>🅿️ Asignar rampa</span><select value={u.rampa_id||""} onChange={e=>assignRamp(u,e.target.value)} disabled={saving===u.id}><option value="">Seleccionar…</option>{ramps.map(r=><option key={r.id} value={r.id}>{r.nombre||r.codigo}</option>)}</select></label>}
{u.estado==="rampa_asignada"&&<button className="login-btn compact" onClick={()=>callToRamp(u)}><Megaphone size={15}/>📢 Llamar / enviar a rampa</button>}
{["rampa_asignada","en_operacion"].includes(u.estado)&&<button className="secondary-btn" onClick={()=>setStatusOpen(statusOpen===u.id?null:u.id)}><ListChecks size={15}/>🔄 Cambiar estatus</button>}
{u.estado==="en_operacion"&&<span className="operation-live"><Clock3 size={15}/>⏱️ {duration(u.operacion_inicio_at,u.operacion_fin_at)}</span>}
{u.estado==="documentacion"&&<><button className="secondary-btn" onClick={()=>registerDocument(u)}><FileText size={15}/>📃 Documentación</button><button className="secondary-btn" onClick={()=>registerSeal(u)}><LockKeyhole size={15}/>🔐 Sellado</button><button className="login-btn compact" onClick={()=>authorizeRelease(u)}><Unlock size={15}/>✅ Liberar unidad</button></>}
</div>
{statusOpen===u.id&&<div className="dispatch-status-menu"><strong>🔄 Estatus operativo</strong>{["espera_turno","rampa_asignada","en_operacion","documentacion"].map(s=><button key={s} type="button" onClick={()=>changeStatus(u,s)} disabled={u.estado===s}>{stateLabel[s]}</button>)}</div>}</>}
  </div>)}</div>:<div className="empty">No hay unidades pendientes de Dispatch.</div>}
 </div>{evidence&&<EvidenceModal data={evidence} close={()=>setEvidence(null)}/>}</section>;
}

function EvidenceModal({data,close}){
 return <div className="evidence-modal-backdrop" role="dialog" aria-modal="true" onClick={close}><div className="evidence-modal-card" onClick={e=>e.stopPropagation()}><div className="evidence-modal-head"><div><span className="evidence-modal-kicker">OP360 · CONTROL DE ACCESO</span><strong>Prueba de llegada</strong><small>{data.access?.folio||data.unit?.folio||"Unidad"}</small></div><button type="button" className="evidence-modal-close" onClick={close} aria-label="Cerrar"><X size={20}/></button></div><div className="evidence-modal-summary"><div><b>Operador</b><span>{data.access?.nombre||data.unit?.operador_nombre||"—"}</span></div><div><b>Empresa</b><span>{data.access?.empresa||data.unit?.linea_transporte||"—"}</span></div><div><b>Tracto</b><span>{data.access?.tracto_placas||data.unit?.tracto_placas||"—"}</span></div><div><b>Caja</b><span>{data.access?.caja_placas||data.unit?.caja_placas||"—"}</span></div></div><div className="evidence-photo-grid">{["placa","identificacion"].map(tipo=>{const p=data.photos?.find(x=>x.tipo===tipo);return <div className="evidence-photo-card" key={tipo}><div className="evidence-photo-title"><span>{tipo==="placa"?"📷":"🪪"}</span><div><strong>{tipo==="placa"?"Placa":"ID / INE"}</strong><small>{p?.signedUrl?"Fotografía disponible":"Sin fotografía"}</small></div></div>{p?.signedUrl?<img src={p.signedUrl} alt={tipo==="placa"?"Fotografía de placa":"Fotografía de identificación"} className="evidence-modal-image"/>:<div className="evidence-no-photo">No hay fotografía de {tipo==="placa"?"placa":"identificación"}.</div>}</div>})}</div></div></div>;
}

function duration(start,end){const ms=Math.max(0,(end?new Date(end):new Date())-new Date(start));const total=Math.floor(ms/60000),h=Math.floor(total/60),m=total%60;return h?h+"h "+String(m).padStart(2,"0")+"m":m+" min"}
