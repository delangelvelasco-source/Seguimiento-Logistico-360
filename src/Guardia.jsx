import { useEffect, useState } from "react";
import { CheckCircle2, LockKeyhole, RefreshCw, Search, ShieldCheck, Unlock } from "lucide-react";
import { supabase } from "./lib/supabase";

export default function Guardia({warehouseId}) {
 const [units,setUnits]=useState([]),[seals,setSeals]=useState({}),[loading,setLoading]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[query,setQuery]=useState(""),[saving,setSaving]=useState("");
 async function load(){
  if(!warehouseId)return;setLoading(true);setError("");
  const {data,error}=await supabase.from("unidades").select("id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,estado,salida_autorizada,salida_bloqueada,salida_bloqueo_motivo,operacion_360_id").eq("almacen_id",warehouseId).eq("estado","liberada").order("updated_at",{ascending:false}).limit(50);
  if(error){setError(error.message);setLoading(false);return}setUnits(data||[]);
  if(data?.length){const {data:ss,error:se}=await supabase.from("sellos_unidad").select("id,unidad_id,numero_documentado,numero_fisico,resultado,requiere_revision,verificado_at,observaciones").in("unidad_id",data.map(x=>x.id));if(se)setError(se.message);else{const g={};(ss||[]).forEach(s=>(g[s.unidad_id] ||= []).push(s));setSeals(g)}}else setSeals({});
  setLoading(false);
 }
 useEffect(()=>{load()},[warehouseId]);
 const filtered=units.filter(u=>[u.folio,u.operador_nombre,u.linea_transporte,u.tracto_placas,u.caja_placas].join(" ").toLowerCase().includes(query.toLowerCase()));
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
   <div className="button-row"><button className="secondary-btn" onClick={()=>reviewSeal(u)}><LockKeyhole size={15}/>Verificar sellos</button><button className="secondary-btn" onClick={()=>block(u)}><LockKeyhole size={15}/>Bloquear salida</button><button className="login-btn compact" onClick={()=>authorize(u)} disabled={!ok||saving===u.id}><Unlock size={15}/>{saving===u.id?"Guardando…":"Autorizar salida"}</button></div>
  </div>})}</div>:<div className="empty">No hay unidades listas para Guardia.</div>}
 </div></section>
}