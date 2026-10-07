import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Edit3, Eye, RefreshCw, Search, Send, X, XCircle } from "lucide-react";
import { supabase } from "./lib/supabase";

const labels={operador_nombre:"Operador",linea_transporte:"Línea",tracto_placas:"Tracto",caja_placas:"Caja",pallets:"Pallets"};

export default function Dispatch({warehouseId}){
 const [units,setUnits]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const [query,setQuery]=useState(""),[editing,setEditing]=useState(null),[draft,setDraft]=useState({}),[reason,setReason]=useState(""),[evidenceModal,setEvidenceModal]=useState(null),[selectedEvidence,setSelectedEvidence]=useState(null),[evidenceLoading,setEvidenceLoading]=useState(false);
 async function load(){
  if(!warehouseId)return; setLoading(true);setError("");
  const {data,error}=await supabase.from("unidades").select("id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,estado,ubicacion_tipo,operacion_tipo,cita_at,cita_confirmada,sin_cita,dispatch_registro_at,pallets").eq("almacen_id",warehouseId).in("estado",["en_caseta","validando"]).order("created_at",{ascending:false}).limit(50);
  if(error)setError(error.message); else setUnits(data||[]); setLoading(false);
 }
 useEffect(()=>{
  load();
  if(!warehouseId)return;
  const channel=supabase.channel("dispatch-live-"+warehouseId)
    .on("postgres_changes",{event:"*",schema:"public",table:"unidades",filter:"almacen_id=eq."+warehouseId},()=>load())
    .on("postgres_changes",{event:"*",schema:"public",table:"accesos_caseta",filter:"almacen_id=eq."+warehouseId},()=>load())
    .subscribe();
  const timer=setInterval(load,15000);
  return()=>{clearInterval(timer);supabase.removeChannel(channel)};
},[warehouseId]);
 const filtered=units.filter(u=>[u.folio,u.operador_nombre,u.linea_transporte,u.tracto_placas,u.caja_placas||""].join(" ").toLowerCase().includes(query.toLowerCase()));
 async function verPruebaLlegada(u){
  if(!u?.id)return;
  setEvidenceLoading(true);setError("");
  try{
    const {data:acceso,error:ae}=await supabase.from("accesos_caseta")
      .select("id,folio,nombre,empresa,tracto_placas,caja_placas,entrada_at,salida_at,estado,operacion_tipo")
      .eq("unidad_id",u.id).eq("almacen_id",warehouseId).order("entrada_at",{ascending:false}).limit(1).maybeSingle();
    if(ae)throw ae;
    if(!acceso){setError("No se encontró la prueba de llegada de esta unidad.");return;}
    let {data:evidencias,error:ee}=await supabase.from("evidencias_caseta")
      .select("id,tipo,storage_path,created_at").eq("acceso_id",acceso.id).order("created_at",{ascending:false});
    if(ee)throw ee;
    // Las evidencias pueden haber sido tomadas por Guardia/Caseta y quedar
    // relacionadas al acceso o directamente a la unidad. Dispatch debe poder
    // ver ambas rutas para no perder las fotografías.
    if((evidencias||[]).length===0 && u.id){
      const fallback=await supabase.from("evidencias_caseta")
        .select("id,tipo,storage_path,created_at").eq("unidad_id",u.id).order("created_at",{ascending:false});
      if(fallback.error)throw fallback.error;
      evidencias=fallback.data||[];
    }
    const paths=(evidencias||[]).map(e=>e.storage_path).filter(Boolean);
    let photos=[];
    if(paths.length){
      const {data:urls,error:ue}=await supabase.storage.from("evidencias-caseta").createSignedUrls(paths,3600);
      if(ue)throw ue;
      photos=(urls||[]).map((x,i)=>({...evidencias[i],signedUrl:x?.signedUrl||""}));
    }
    setSelectedEvidence(null);setEvidenceModal({unidad:u,acceso,photos});
  }catch(err){setError("No se pudo consultar la prueba de llegada: "+(err?.message||"error desconocido"));}
  finally{setEvidenceLoading(false);}
 }
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
 return <section id="dispatch" className="users-section"><div className="panel"><div className="panel-title"><div><ClipboardCheck size={19}/><strong>Dispatch · Validación de llegada</strong></div><button className="secondary-btn" onClick={load} disabled={loading}><RefreshCw size={15}/>Actualizar</button></div><p className="section-copy">Dispatch decide cita/sin cita y actúa como segundo filtro. Cada corrección queda auditada.</p>{error&&<div className="notice error"><strong>Error</strong><span>{error}</span></div>}{message&&<div className="notice success"><CheckCircle2 size={17}/><strong>{message}</strong></div>}<div className="dispatch-toolbar"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar folio, operador, línea o placa"/></div>{loading?<div className="empty">Cargando unidades…</div>:filtered.length?<div className="dispatch-list">{filtered.map(u=><div className="dispatch-card" key={u.id}><div className="dispatch-head"><div><strong>{u.folio}</strong><span>{u.operacion_tipo||"Operación"} · {u.ubicacion_tipo}</span></div><span className="tag">{u.estado}</span></div>{editing===u.id?<div className="dispatch-edit">{Object.keys(labels).map(k=><label key={k}>{labels[k]}<input value={draft[k]||""} onChange={e=>setDraft({...draft,[k]:e.target.value})}/></label>)}<label className="full">Motivo de corrección<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Ej. documento, transportista o placa"/></label><div className="button-row"><button className="secondary-btn" onClick={()=>setEditing(null)}><XCircle size={15}/>Cancelar</button><button className="login-btn compact" onClick={()=>saveCorrections(u)}><CheckCircle2 size={15}/>Guardar corrección</button></div></div>:<><div className="dispatch-data"><span><b>Operador</b>{u.operador_nombre}</span><span><b>Línea</b>{u.linea_transporte}</span><span><b>Tracto</b>{u.tracto_placas}</span><span><b>Caja</b>{u.caja_placas||"—"}</span><span><b>Pallets</b>{u.pallets ?? "—"}</span></div><div className="button-row"><button className="secondary-btn" onClick={()=>verPruebaLlegada(u)} disabled={evidenceLoading}><Eye size={15}/>Fotos / evidencia</button><button className="secondary-btn" onClick={()=>{setEditing(u.id);setDraft({...u});setReason("")}}><Edit3 size={15}/>Corregir / validar</button><button className="secondary-btn" onClick={()=>decision(u,"cita")}><CheckCircle2 size={15}/>Confirmar cita</button><button className="secondary-btn" onClick={()=>decision(u,"sin_cita")}><XCircle size={15}/>Sin cita</button><button className="login-btn compact" onClick={()=>sendOperation(u)}><Send size={15}/>Enviar a Operación</button></div></>}</div>)}</div>:<div className="empty">No hay unidades pendientes de Dispatch.</div>}</div>{evidenceModal&&<div className="csr-evidence-modal" role="dialog" aria-modal="true"><div className="csr-evidence-card"><div className="csr-evidence-head"><div><strong>Prueba de llegada</strong><span>{evidenceModal.acceso?.folio||evidenceModal.unidad?.folio||"Unidad"}</span></div><button type="button" className="csr-evidence-close" onClick={()=>setEvidenceModal(null)} aria-label="Cerrar"><X size={20}/></button></div><div className="csr-evidence-summary"><div><b>Operador</b><span>{evidenceModal.acceso?.nombre||evidenceModal.unidad?.operador_nombre||"—"}</span></div><div><b>Empresa</b><span>{evidenceModal.acceso?.empresa||evidenceModal.unidad?.linea_transporte||"—"}</span></div><div><b>Placa tracto</b><span>{evidenceModal.acceso?.tracto_placas||evidenceModal.unidad?.tracto_placas||"—"}</span></div><div><b>Placa caja</b><span>{evidenceModal.acceso?.caja_placas||evidenceModal.unidad?.caja_placas||"—"}</span></div></div><div className="csr-evidence-actions">{["placa","identificacion"].map(tipo=>{const photo=evidenceModal.photos?.find(p=>p.tipo===tipo);return <button type="button" className={"csr-evidence-choice"+(selectedEvidence===tipo?" active":"")} onClick={()=>setSelectedEvidence(tipo)} key={tipo}><span>{tipo==="placa"?"📷":"🪪"}</span><div><strong>{tipo==="placa"?"Placa":"ID / INE"}</strong><small>{photo?.signedUrl?"Ver evidencia fotográfica":"Sin fotografía"}</small></div><Eye size={16}/></button>})}</div>{selectedEvidence&&<div className="csr-evidence-viewer"><div className="csr-evidence-photo-title">{selectedEvidence==="placa"?"Evidencia de placa":"Evidencia de ID / INE"}</div>{(()=>{const photo=evidenceModal.photos?.find(p=>p.tipo===selectedEvidence);return photo?.signedUrl?<img src={photo.signedUrl} alt={selectedEvidence==="placa"?"Evidencia de placa":"Evidencia de identificación"}/>:<div className="csr-evidence-empty">No hay fotografía guardada.</div>})()}</div></div></div>} </section>
}