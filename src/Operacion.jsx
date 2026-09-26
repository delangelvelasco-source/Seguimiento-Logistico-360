import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Play, RefreshCw, Search, SquareCheckBig, TimerReset, Wrench } from "lucide-react";
import { supabase } from "./lib/supabase";

const ACTIVE_STATES = ["espera_turno","rampa_asignada","en_operacion"];

export default function Operacion({warehouseId}) {
  const [units,setUnits]=useState([]),[ramps,setRamps]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[query,setQuery]=useState(""),[saving,setSaving]=useState("");

  async function load() {
    if (!warehouseId) return;
    setLoading(true); setError("");
    const [u,r] = await Promise.all([
      supabase.from("unidades").select("id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,estado,operacion_tipo,cita_confirmada,sin_cita,rampa_id,ubicacion_tipo,ubicacion_at,operacion_inicio_at,operacion_fin_at,desentrampe_at,created_at,operacion_360_id").eq("almacen_id",warehouseId).in("estado",ACTIVE_STATES).order("created_at",{ascending:false}).limit(50),
      supabase.from("rampas").select("id,nombre,codigo,estado,activa,motivo").eq("almacen_id",warehouseId).eq("activa",true).eq("estado","operativa").order("nombre")
    ]);
    if(u.error) setError(u.error.message); else setUnits(u.data||[]);
    if(r.error) setError(prev=>prev || r.error.message); else setRamps(r.data||[]);
    setLoading(false);
  }
  useEffect(()=>{load()},[warehouseId]);

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
    <p className="section-copy">Asigna únicamente rampas operativas, inicia el proceso y registra el desentrampe. Las rampas bloqueadas no aparecen para nuevas asignaciones.</p>
    {error&&<div className="notice error"><strong>Error</strong><span>{error}</span></div>}
    {message&&<div className="notice success"><CheckCircle2 size={17}/><strong>{message}</strong></div>}
    <div className="operation-summary"><div><span>Rampas operativas</span><strong>{ramps.length}</strong></div><div><span>Rampas ocupadas</span><strong>{[...occupiedRampIds].filter(id=>ramps.some(r=>r.id===id)).length}</strong></div><div><span>Unidades en operación</span><strong>{units.filter(u=>u.estado==="en_operacion").length}</strong></div></div>
    <div className="dispatch-toolbar"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar unidad, operador, línea o placa"/></div>
    {loading?<div className="empty">Cargando Operación…</div>:filtered.length?<div className="dispatch-list">{filtered.map(u=><OperationCard key={u.id} u={u} ramps={ramps} occupiedRampIds={occupiedRampIds} saving={saving===u.id} onAssign={assignRamp} onStart={startOperation} onFinish={finishOperation}/>)}</div>:<div className="empty">No hay unidades listas para Operación.</div>}
  </div></section>
}

function OperationCard({u,ramps,occupiedRampIds,saving,onAssign,onStart,onFinish}) {
  const elapsed=u.operacion_inicio_at?duration(u.operacion_inicio_at,u.operacion_fin_at):"—";
  return <div className="operation-card"><div className="dispatch-head"><div><strong>{u.folio}</strong><span>{u.operacion_tipo||"Operación"} · {u.cita_confirmada?"Cita confirmada":"Sin cita"}</span></div><span className="tag">{u.estado}</span></div>
    <div className="dispatch-data"><span><b>Operador</b>{u.operador_nombre}</span><span><b>Línea</b>{u.linea_transporte}</span><span><b>Tracto</b>{u.tracto_placas}</span><span><b>Ubicación</b>{u.ubicacion_tipo||"patio"}</span></div>
    <div className="operation-controls"><label>Rampa<select value={u.rampa_id||""} onChange={e=>onAssign(u,e.target.value)} disabled={saving||u.estado==="en_operacion"}><option value="">Seleccionar rampa…</option>{ramps.map(r=><option key={r.id} value={r.id} disabled={occupiedRampIds.has(r.id)&&r.id!==u.rampa_id}>{r.nombre||r.codigo}{occupiedRampIds.has(r.id)&&r.id!==u.rampa_id?" · Ocupada":""}</option>)}</select></label><div className="operation-timer"><Clock3 size={17}/><div><span>Tiempo de operación</span><strong>{elapsed}</strong></div></div></div>
    <div className="button-row">{u.estado==="rampa_asignada"&&<button className="login-btn compact" onClick={()=>onStart(u)} disabled={saving}><Play size={15}/>{saving?"Guardando…":"Iniciar operación"}</button>}{u.estado==="en_operacion"&&<button className="login-btn compact" onClick={()=>onFinish(u)} disabled={saving}><SquareCheckBig size={15}/>{saving?"Guardando…":"Registrar desentrampe"}</button>}{u.estado==="en_operacion"&&<span className="operation-live"><TimerReset size={15}/>Proceso en curso</span>}</div>
  </div>
}

function duration(start,end){const ms=Math.max(0,(end?new Date(end):new Date())-new Date(start)),total=Math.floor(ms/60000),h=Math.floor(total/60),m=total%60;return h?h+"h "+String(m).padStart(2,"0")+"m":m+" min"}
