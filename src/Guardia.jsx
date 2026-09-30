import { useEffect, useState } from "react";
import { CheckCircle2, Eye, LockKeyhole, RefreshCw, Search, ShieldCheck, Unlock, X } from "lucide-react";
import { supabase } from "./lib/supabase";

export default function Guardia({warehouseId}) {
 const [units,setUnits]=useState([]),[seals,setSeals]=useState({}),[loading,setLoading]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[query,setQuery]=useState(""),[saving,setSaving]=useState(""),[evidenceModal,setEvidenceModal]=useState(null),[selectedEvidence,setSelectedEvidence]=useState(null);
 async function load(){
  if(!warehouseId)return;setLoading(true);setError("");
  const {data,error}=await supabase.from("unidades").select("id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,estado,salida_autorizada,salida_bloqueada,salida_bloqueo_motivo,operacion_360_id").eq("almacen_id",warehouseId).eq("estado","liberada").order("updated_at",{ascending:false}).limit(50);
  if(error){setError(error.message);setLoading(false);return}setUnits(data||[]);
  if(data?.length){const {data:ss,error:se}=await supabase.from("sellos_unidad").select("id,unidad_id,numero_documentado,numero_fisico,resultado,requiere_revision,verificado_at,observaciones").in("unidad_id",data.map(x=>x.id));if(se)setError(se.message);else{const g={};(ss||[]).forEach(s=>(g[s.unidad_id] ||= []).push(s));setSeals(g)}}else setSeals({});
  setLoading(false);
 }
 useEffect(()=>{
  load();
  if(!warehouseId)return;
  const channel=supabase.channel("guardia-live-"+warehouseId)
    .on("postgres_changes",{event:"*",schema:"public",table:"unidades",filter:"almacen_id=eq."+warehouseId},()=>load())
    .on("postgres_changes",{event:"*",schema:"public",table:"sellos_unidad"},()=>load())
    .subscribe();
  const timer=setInterval(load,15000);
  return()=>{clearInterval(timer);supabase.removeChannel(channel)};
},[warehouseId]);
 const filtered=units.filter(u=>[u.folio,u.operador_nombre,u.linea_transporte,u.tracto_placas,u.caja_placas].join(" ").toLowerCase().includes(query.toLowerCase()));
 async function verPruebaLlegada(u){
  setError("");
  try{
    const {data:acceso,error:ae}=await supabase.from("accesos_caseta").select("id,folio,nombre,empresa,tracto_placas,caja_placas,entrada_at,salida_at,estado,operacion_tipo").eq("unidad_id",u.id).eq("almacen_id",warehouseId).order("entrada_at",{ascending:false}).limit(1).maybeSingle();
    if(ae)throw ae;
    if(!acceso){setError("No se encontró la prueba de llegada de esta unidad.");return;}
    const {data:evidencias,error:ee}=await supabase.from("evidencias_caseta").select("id,tipo,storage_path,created_at").eq("acceso_id",acceso.id).order("created_at",{ascending:false});
    if(ee)throw ee;
    const paths=(evidencias||[]).map(e=>e.storage_path).filter(Boolean);
    let photos=[];
    if(paths.length){
      const {data:urls,error:ue}=await supabase.storage.from("evidencias-caseta").createSignedUrls(paths,3600);
      if(ue)throw ue;
      photos=(urls||[]).map((x,i)=>({...evidencias[i],signedUrl:x?.signedUrl||""}));
    }
    setSelectedEvidence(null);setEvidenceModal({acceso,unidad:u,photos});
  }catch(err){setError("No se pudo consultar la prueba de llegada: "+(err?.message||"error desconocido"));}
 }
 async function reviewSeal(u){
  const list=seals[u.id]||[];if(!list.length){setError("No hay sello registrado para esta unidad. Debe revisarse antes de autorizar salida.");return}
  const mismatch=list.some(s=>s.requiere_revision||s.resultado!=="coincide"||!s.verificado_at);
  if(mismatch){setError("La revisión de sellos está pendiente o presenta diferencia. La salida permanece bloqueada.");return}
  setMessage("Sellos verificados. La unidad puede pasar a autorización de salida.");
 }
 async function authorize(u){
  setSaving(u.id);setError("");setMessage("");
  const list=seals[u.id]||[];if(!list.length||list.some(s=>s.requiere_revision||s.resultado!=="coincide"||!s.verificado_at)){setError("No se puede autorizar: sello pendiente, no coincidente o sin verificación física.");setSaving("");return}
  const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
  const {error:e}=await supabase.from("unidades").update({salida_autorizada:true,salida_autorizada_at:now,salida_autorizada_por:user?.id||null,salida_bloqueada:false,salida_bloqueo_motivo:null,updated_at:now}).eq("id",u.id);
  if(e){setError(e.message);setSaving("");return}
  await supabase.from("movimientos").insert({unidad_id:u.id,usuario_id:user?.id,tipo:"salida_autorizada",estado_anterior:u.estado,estado_nuevo:"liberada",notas:"Guardia autorizó salida después de validar sellos",ocurrido_at:now});
  setMessage("Salida autorizada para "+u.folio+".");await load();setSaving("");
 }
 async function exitUnit(u){
  if(!u.salida_autorizada){setError("Primero autoriza la salida.");return}
  setSaving(u.id);setError("");setMessage("");
  const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
  const {error:e}=await supabase.from("unidades").update({ubicacion_tipo:"fuera",ubicacion_at:now,ubicacion_por:user?.id||null,salida_caseta_at:now,guardia_salida_usuario_id:user?.id||null,updated_at:now}).eq("id",u.id);
  if(e){setError(e.message);setSaving("");return}
  await supabase.from("movimientos").insert({unidad_id:u.id,usuario_id:user?.id,tipo:"salida_fisica",estado_anterior:u.estado,estado_nuevo:"liberada",notas:"Salida física registrada por Guardia",ocurrido_at:now});
  if(u.operacion_360_id)await supabase.from("operaciones_360").update({estado_general:"finalizada",updated_at:now}).eq("id",u.operacion_360_id);
  setMessage("Salida física registrada para "+u.folio+".");await load();setSaving("");
 }
 async function block(u){
  const motivo=window.prompt("Motivo del bloqueo de salida","Diferencia de sello / documento");
  if(!motivo)return;
  const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
  const {error}=await supabase.from("unidades").update({salida_bloqueada:true,salida_bloqueo_motivo:motivo,salida_autorizada:false,updated_at:now}).eq("id",u.id);
  if(error){setError(error.message);return}
  await supabase.from("movimientos").insert({unidad_id:u.id,usuario_id:user?.id,tipo:"salida_bloqueada",estado_anterior:u.estado,estado_nuevo:u.estado,notas:motivo,ocurrido_at:now});setMessage("Salida bloqueada. La unidad no puede salir.");await load();
 }
 return <section id="guardia" className="users-section"><div className="panel">
  <div className="panel-title"><div><ShieldCheck size={19}/><strong>Guardia · Liberación y salida</strong></div><button className="secondary-btn" onClick={load} disabled={loading}><RefreshCw size={15}/>Actualizar</button></div>
  <p className="section-copy">Guardia es el último filtro físico. Sin sello coincidente y verificado, la salida no puede autorizarse.</p>
  {error&&<div className="notice error"><strong>Salida bloqueada</strong><span>{error}</span></div>}{message&&<div className="notice success"><CheckCircle2 size={17}/><strong>{message}</strong></div>}
  <div className="dispatch-toolbar"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar unidad, operador, línea o placa"/></div>
  {loading?<div className="empty">Cargando Guardia…</div>:filtered.length?<div className="dispatch-list">{filtered.map(u=>{const list=seals[u.id]||[],ok=list.length>0&&list.every(s=>s.resultado==="coincide"&&!s.requiere_revision&&s.verificado_at);return <div className="dispatch-card" key={u.id}>
   <div className="dispatch-head"><div><strong>{u.folio}</strong><span>{u.operacion_tipo||"Operación"} · Documentación validada</span></div><span className={ok?"tag":"tag"}>{ok?"Sello verificado":"Revisión pendiente"}</span></div>
   <div className="dispatch-data"><span><b>Operador</b>{u.operador_nombre}</span><span><b>Tracto</b>{u.tracto_placas}</span><span><b>Caja</b>{u.caja_placas||"—"}</span><span><b>Sellos</b>{list.length}</span></div>
   <div className="button-row"><button className="secondary-btn" onClick={()=>verPruebaLlegada(u)}><Eye size={15}/>Prueba de llegada</button><button className="secondary-btn" onClick={()=>reviewSeal(u)}><LockKeyhole size={15}/>Verificar sellos</button><button className="secondary-btn" onClick={()=>block(u)}><LockKeyhole size={15}/>Bloquear salida</button><button className="login-btn compact" onClick={()=>authorize(u)} disabled={!ok||u.salida_autorizada||saving===u.id}><Unlock size={15}/>{u.salida_autorizada?"Salida autorizada":"Autorizar salida"}</button>{u.salida_autorizada&&<button className="secondary-btn" onClick={()=>exitUnit(u)} disabled={saving===u.id}><CheckCircle2 size={15}/>Registrar salida física</button>}</div>
  </div>})}</div>:<div className="empty">No hay unidades listas para Guardia.</div>}
 </div>{evidenceModal&&<div className="csr-evidence-modal" role="dialog" aria-modal="true"><div className="csr-evidence-card"><div className="csr-evidence-head"><div><strong>Prueba de llegada</strong><span>{evidenceModal.acceso?.folio||evidenceModal.unidad?.folio||"Unidad"}</span></div><button type="button" className="csr-evidence-close" onClick={()=>setEvidenceModal(null)} aria-label="Cerrar"><X size={20}/></button></div><div className="csr-evidence-summary"><div><b>Operador</b><span>{evidenceModal.acceso?.nombre||evidenceModal.unidad?.operador_nombre||"—"}</span></div><div><b>Empresa</b><span>{evidenceModal.acceso?.empresa||evidenceModal.unidad?.linea_transporte||"—"}</span></div><div><b>Placa tracto</b><span>{evidenceModal.acceso?.tracto_placas||evidenceModal.unidad?.tracto_placas||"—"}</span></div><div><b>Placa caja</b><span>{evidenceModal.acceso?.caja_placas||evidenceModal.unidad?.caja_placas||"—"}</span></div></div><div className="csr-evidence-actions">{["placa","identificacion"].map(tipo=>{const photo=evidenceModal.photos?.find(p=>p.tipo===tipo);return <button type="button" className={"csr-evidence-choice"+(selectedEvidence===tipo?" active":"")} onClick={()=>setSelectedEvidence(tipo)} key={tipo}><span>{tipo==="placa"?"📷":"🪪"}</span><div><strong>{tipo==="placa"?"Placa":"ID / INE"}</strong><small>{photo?.signedUrl?"Ver evidencia fotográfica":"Sin fotografía"}</small></div><Eye size={16}/></button>})}</div>{selectedEvidence&&<div className="csr-evidence-viewer"><div className="csr-evidence-photo-title">{selectedEvidence==="placa"?"Evidencia de placa":"Evidencia de ID / INE"}</div>{(()=>{const photo=evidenceModal.photos?.find(p=>p.tipo===selectedEvidence);return photo?.signedUrl?<img src={photo.signedUrl} alt={selectedEvidence==="placa"?"Evidencia de placa":"Evidencia de identificación"}/>:<div className="csr-evidence-empty">No hay fotografía guardada.</div>})()}</div>}</div></div>} </section>
}