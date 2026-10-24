import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Play, RefreshCw, Search, SquareCheckBig, TimerReset, Wrench } from "lucide-react";
import { supabase } from "./lib/supabase";

const ACTIVE_STATES = ["espera_turno","rampa_asignada","en_operacion"];

export default function Operacion({warehouseId}) {
  const [units,setUnits]=useState([]),[ramps,setRamps]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[query,setQuery]=useState(""),[saving,setSaving]=useState("");
  const [requests,setRequests]=useState([]),[showRequest,setShowRequest]=useState(false),[requestBusy,setRequestBusy]=useState(false);
  const [requestForm,setRequestForm]=useState(()=>({fecha:localDate(),hora:"18:00",tipo_operacion:"recibo",motivo:""}));

  async function load() {
    if (!warehouseId) return;
    setLoading(true); setError("");
    const [u,r,req] = await Promise.all([
      supabase.from("unidades").select("id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,estado,operacion_tipo,cita_confirmada,sin_cita,rampa_id,ubicacion_tipo,ubicacion_at,operacion_inicio_at,operacion_fin_at,desentrampe_at,dispatch_registro_at,csr_confirmacion_at,created_at,pallets,operacion_360_id").eq("almacen_id",warehouseId).in("estado",ACTIVE_STATES).not("dispatch_registro_at","is",null).not("csr_confirmacion_at","is",null).order("created_at",{ascending:false}).limit(50),
      supabase.from("rampas").select("id,nombre,codigo,estado,activa,motivo").eq("almacen_id",warehouseId).eq("activa",true).eq("estado","operativa").order("nombre"),
      supabase.from("solicitudes_citas_adicionales").select("id,fecha,hora_inicio,tipo_operacion,motivo,estado,solicitado_at,respuesta").eq("almacen_id",warehouseId).order("solicitado_at",{ascending:false}).limit(100)
    ]);
    if(u.error) setError(u.error.message); else setUnits(u.data||[]);
    if(r.error) setError(prev=>prev || r.error.message); else setRamps(r.data||[]);
    if(req.error) setError(prev=>prev || ("No se pudieron cargar las solicitudes adicionales: "+req.error.message)); else setRequests(req.data||[]);
    setLoading(false);
  }
  useEffect(()=>{
  load();
  if(!warehouseId)return;
  const channel=supabase.channel("operacion-live-"+warehouseId)
    .on("postgres_changes",{event:"*",schema:"public",table:"unidades",filter:"almacen_id=eq."+warehouseId},()=>load())
    .on("postgres_changes",{event:"*",schema:"public",table:"rampas",filter:"almacen_id=eq."+warehouseId},()=>load())
    .subscribe();
  const timer=setInterval(load,15000);
  return()=>{clearInterval(timer);supabase.removeChannel(channel)};
},[warehouseId]);

  async function submitAdditionalRequest(e) {
    e.preventDefault(); setError(""); setMessage("");
    if(!requestForm.motivo.trim()){setError("Indica el motivo de la solicitud.");return}
    const user=(await supabase.auth.getUser()).data.user;
    if(!user?.id){setError("No hay una sesión activa.");return}
    setRequestBusy(true);
    const result=await supabase.from("solicitudes_citas_adicionales").insert({
      almacen_id:warehouseId,fecha:requestForm.fecha,hora_inicio:requestForm.hora+":00",
      tipo_operacion:requestForm.tipo_operacion,motivo:requestForm.motivo.trim(),
      estado:"pendiente",solicitado_por:user.id
    }).select("id").single();
    if(result.error){setError("No se pudo registrar la solicitud. Verifica que esté aplicada la migración de solicitudes adicionales. "+result.error.message);setRequestBusy(false);return}
    setMessage("Solicitud de cita adicional enviada para autorización.");
    setShowRequest(false);setRequestForm({fecha:localDate(),hora:"18:00",tipo_operacion:"recibo",motivo:""});
    await load();setRequestBusy(false);
  }
  async function reviewRequest(request, decision) {
    setError("");setMessage("");
    const answer=window.prompt(decision==="autorizada"?"Comentario de autorización (opcional):":"Motivo del rechazo:");
    if(answer===null)return;
    if(decision==="rechazada"&&!answer.trim()){setError("Indica el motivo del rechazo.");return}
    const user=(await supabase.auth.getUser()).data.user;
    const now=new Date().toISOString();
    const result=await supabase.from("solicitudes_citas_adicionales").update({
      estado:decision,revisado_por:user?.id||null,revisado_at:now,respuesta:answer.trim()||null
    }).eq("id",request.id).eq("estado","pendiente");
    if(result.error){setError("No se pudo actualizar la solicitud: "+result.error.message);return}
    setMessage(decision==="autorizada"?"Solicitud autorizada. La cita todavía debe registrarse en el calendario correspondiente.":"Solicitud rechazada.");
    await load();
  }
  const filtered = useMemo(()=>units.filter(u => [u.folio,u.operador_nombre,u.linea_transporte,u.tracto_placas,u.caja_placas].join(" ").toLowerCase().includes(query.toLowerCase())),[units,query]);
  const occupiedRampIds = useMemo(()=>new Set(units.filter(u=>ACTIVE_STATES.includes(u.estado) && u.rampa_id).map(u=>u.rampa_id)),[units]);

  async function assignRamp(u,rampId) {
    if(!rampId)return;
    setSaving(u.id);setError("");setMessage("");
    if(occupiedRampIds.has(rampId)&&u.rampa_id!==rampId){setError("Esa rampa ya está ocupada por otra unidad activa.");setSaving("");return}
    const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
    const {error:e}=await supabase.from("unidades").update({rampa_id:rampId,ubicacion_tipo:"rampa",ubicacion_at:now,ubicacion_por:user?.id||null,estado:"rampa_asignada",updated_at:now}).eq("id",u.id);
    if(e){setError(e.message);setSaving("");return}
    await supabase.from("movimientos").insert({unidad_id:u.id,usuario_id:user?.id,tipo:"rampa_asignada",estado_anterior:u.estado,estado_nuevo:"rampa_asignada",notas:"Rampa asignada por Operación",ocurrido_at:now});
    if(u.operacion_360_id)await supabase.from("operaciones_360").update({estado_general:"rampa_asignada",updated_at:now}).eq("id",u.operacion_360_id);
    setMessage("Rampa asignada a "+u.folio+".");await load();setSaving("");
  }

  async function startOperation(u) {
    if(!u.rampa_id){setError("Primero asigna una rampa operativa.");return}
    setSaving(u.id);setError("");setMessage("");
    const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
    const {error:e}=await supabase.from("unidades").update({estado:"en_operacion",operacion_usuario_id:user?.id||null,operacion_inicio_at:now,updated_at:now}).eq("id",u.id);
    if(e){setError(e.message);setSaving("");return}
    await supabase.from("movimientos").insert({unidad_id:u.id,usuario_id:user?.id,tipo:"inicio_operacion",estado_anterior:u.estado,estado_nuevo:"en_operacion",notas:"Inicio de proceso operativo",ocurrido_at:now});
    if(u.operacion_360_id)await supabase.from("operaciones_360").update({estado_general:"en_operacion",updated_at:now}).eq("id",u.operacion_360_id);
    setMessage("Operación iniciada para "+u.folio+".");await load();setSaving("");
  }

  async function finishOperation(u) {
    setSaving(u.id);setError("");setMessage("");
    const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
    const {error:e}=await supabase.from("unidades").update({operacion_fin_at:now,desentrampe_at:now,estado:"documentacion",ubicacion_tipo:"patio",ubicacion_at:now,ubicacion_por:user?.id||null,updated_at:now}).eq("id",u.id);
    if(e){setError(e.message);setSaving("");return}
    await supabase.from("movimientos").insert({unidad_id:u.id,usuario_id:user?.id,tipo:"desentrampe",estado_anterior:u.estado,estado_nuevo:"documentacion",notas:"Proceso terminado y unidad desentramada",ocurrido_at:now});
    if(u.operacion_360_id)await supabase.from("operaciones_360").update({estado_general:"desentrampe",updated_at:now}).eq("id",u.operacion_360_id);
    setMessage("Desentrampe registrado para "+u.folio+". Pasa a Documentación.");await load();setSaving("");
  }

  return <section id="operacion" className="users-section"><div className="panel">
    <div className="panel-title"><div><Wrench size={19}/><strong>Operación · Rampa y proceso</strong></div><button className="secondary-btn" onClick={load} disabled={loading}><RefreshCw size={15}/>Actualizar</button></div>
    <p className="section-copy">Aquí aparecen únicamente las unidades del almacén que Dispatch ya validó y que CSR confirmó. Después puedes asignar rampa, iniciar el proceso y registrar el desentrampe.</p>
    <div className="panel" style={{marginBottom:16}}><div className="panel-title"><div><Clock3 size={18}/><strong>Solicitudes de cita adicional</strong></div><button type="button" className="login-btn compact" onClick={()=>{setError("");setMessage("");setShowRequest(true)}}>＋ Solicitar cita adicional</button></div><p className="section-copy">Solicita una ventana fuera del horario habitual. La solicitud queda pendiente y no reserva el horario hasta que sea autorizada y registrada.</p>
    {showRequest&&<form className="dispatch-edit" onSubmit={submitAdditionalRequest}><label>Fecha solicitada<input required type="date" min={localDate()} value={requestForm.fecha} onChange={e=>setRequestForm({...requestForm,fecha:e.target.value})}/></label><label>Hora solicitada<input required type="time" value={requestForm.hora} onChange={e=>setRequestForm({...requestForm,hora:e.target.value})}/></label><label>Tipo de operación<select value={requestForm.tipo_operacion} onChange={e=>setRequestForm({...requestForm,tipo_operacion:e.target.value})}><option value="recibo">Recibo</option><option value="embarque">Embarque</option></select></label><label className="full">Motivo de la solicitud<textarea required rows="3" value={requestForm.motivo} onChange={e=>setRequestForm({...requestForm,motivo:e.target.value})} placeholder="Explica por qué se requiere una ventana adicional"/></label><div className="button-row"><button type="button" className="secondary-btn" onClick={()=>setShowRequest(false)} disabled={requestBusy}>Cancelar</button><button type="submit" className="login-btn compact" disabled={requestBusy}>{requestBusy?"Enviando…":"Enviar a autorización"}</button></div></form>}
    {requests.length?<div className="dispatch-list">{requests.map(req=><article className="dispatch-card" key={req.id}><div className="dispatch-head"><div><strong>{req.fecha} · {String(req.hora_inicio||"").slice(0,5)}</strong><span>{req.tipo_operacion==="embarque"?"Embarque":"Recibo"} · Solicitud adicional</span></div><span className={"tag "+req.estado}>{req.estado==="pendiente"?"Pendiente":req.estado==="autorizada"?"Autorizada":"Rechazada"}</span></div><p>{req.motivo}</p>{req.respuesta&&<p><b>Respuesta:</b> {req.respuesta}</p>}{req.estado==="pendiente"&&<div className="button-row"><button type="button" className="login-btn compact" onClick={()=>reviewRequest(req,"autorizada")}>✓ Autorizar solicitud</button><button type="button" className="secondary-btn" onClick={()=>reviewRequest(req,"rechazada")}>✕ Rechazar</button></div>}</article>)}</div>:<div className="empty">No hay solicitudes de cita adicional.</div>}</div>
    {error&&<div className="notice error"><strong>Error</strong><span>{error}</span></div>}
    {message&&<div className="notice success"><CheckCircle2 size={17}/><strong>{message}</strong></div>}
    <div className="operation-summary"><div><span>Rampas operativas</span><strong>{ramps.length}</strong></div><div><span>Rampas ocupadas</span><strong>{[...occupiedRampIds].filter(id=>ramps.some(r=>r.id===id)).length}</strong></div><div><span>Unidades en operación</span><strong>{units.filter(u=>u.estado==="en_operacion").length}</strong></div></div>
    <div className="dispatch-toolbar"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar unidad, operador, línea o placa"/></div>
    {loading?<div className="empty">Cargando Operación…</div>:filtered.length?<div className="dispatch-list">{filtered.map(u=><OperationCard key={u.id} u={u} ramps={ramps} occupiedRampIds={occupiedRampIds} saving={saving===u.id} onAssign={assignRamp} onStart={startOperation} onFinish={finishOperation}/>)}</div>:<div className="empty">No hay unidades con validación de Dispatch y confirmación de CSR pendientes de operación.</div>}
  </div></section>
}

function OperationCard({u,ramps,occupiedRampIds,saving,onAssign,onStart,onFinish}) {
  const elapsed=u.operacion_inicio_at?duration(u.operacion_inicio_at,u.operacion_fin_at):"—";
  return <div className="operation-card"><div className="dispatch-head"><div><strong>{u.folio}</strong><span>{u.operacion_tipo||"Operación"} · {u.cita_confirmada?"Cita confirmada":"Sin cita"}</span><div className="button-row" style={{marginTop:8}}><span className="tag" style={{background:"#e8f7ee",color:"#17663a"}}>✓ Dispatch validado</span><span className="tag" style={{background:"#e8f0ff",color:"#214f9b"}}>✓ CSR confirmado</span></div></div><span className="tag">{u.estado}</span></div>
    <div className="dispatch-data"><span><b>Operador</b>{u.operador_nombre}</span><span><b>Línea</b>{u.linea_transporte}</span><span><b>Tracto</b>{u.tracto_placas}</span><span><b>Ubicación</b>{u.ubicacion_tipo||"patio"}</span><span><b>Pallets</b>{u.pallets ?? "—"}</span></div>
    <div className="operation-controls"><label>Rampa<select value={u.rampa_id||""} onChange={e=>onAssign(u,e.target.value)} disabled={saving||u.estado==="en_operacion"}><option value="">Seleccionar rampa…</option>{ramps.map(r=><option key={r.id} value={r.id} disabled={occupiedRampIds.has(r.id)&&r.id!==u.rampa_id}>{r.nombre||r.codigo}{occupiedRampIds.has(r.id)&&r.id!==u.rampa_id?" · Ocupada":""}</option>)}</select></label><div className="operation-timer"><Clock3 size={17}/><div><span>Tiempo de operación</span><strong>{elapsed}</strong></div></div></div>
    <div className="button-row">{u.estado==="rampa_asignada"&&<button className="login-btn compact" onClick={()=>onStart(u)} disabled={saving}><Play size={15}/>{saving?"Guardando…":"Iniciar operación"}</button>}{u.estado==="en_operacion"&&<button className="login-btn compact" onClick={()=>onFinish(u)} disabled={saving}><SquareCheckBig size={15}/>{saving?"Guardando…":"Registrar desentrampe"}</button>}{u.estado==="en_operacion"&&<span className="operation-live"><TimerReset size={15}/>Proceso en curso</span>}</div>
  </div>
}

function localDate(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function duration(start,end){const ms=Math.max(0,(end?new Date(end):new Date())-new Date(start)),total=Math.floor(ms/60000),h=Math.floor(total/60),m=total%60;return h?h+"h "+String(m).padStart(2,"0")+"m":m+" min"}
