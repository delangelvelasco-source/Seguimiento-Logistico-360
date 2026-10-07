import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { supabase } from "./lib/supabase";

export default function CSR({warehouseId}){
 const [units,setUnits]=useState([]);
 const [appointments,setAppointments]=useState([]);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [operation,setOperation]=useState("recibo");
 const [form,setForm]=useState({fecha:new Date().toISOString().slice(0,10),hora:"10:00",linea:"",operador:"",tracto:"",placaTracto:"",caja:"",placaCaja:"",referencia:"",pallets:""});
 async function load(){
  if(!warehouseId)return;
  setLoading(true);setError("");
  const u=await supabase.from("unidades").select("id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,estado,operacion_tipo,cita_confirmada,sin_cita,pallets").eq("almacen_id",warehouseId).eq("estado","validando").order("dispatch_registro_at",{ascending:false}).limit(50);
  const a=await supabase.from("citas").select("id,folio,tipo_operacion,fecha,hora_inicio,referencia,cuenta_cliente,pallets,estado").eq("almacen_id",warehouseId).gte("fecha",new Date().toISOString().slice(0,10)).order("fecha").order("hora_inicio").limit(100);
  if(u.error)setError(u.error.message);else setUnits(u.data||[]);
  if(!a.error)setAppointments(a.data||[]);
  setLoading(false);
 }
 useEffect(()=>{load();},[warehouseId]);
 async function confirm(u){
  const user=(await supabase.auth.getUser()).data.user;
  const now=new Date().toISOString();
  const r=await supabase.from("unidades").update({csr_confirmacion_at:now,csr_usuario_id:user?.id||null,estado_identificacion:"cuadrada",estado:"espera_turno",updated_at:now}).eq("id",u.id);
  if(r.error){setError(r.error.message);return;}
  setMessage("Validación CSR completada. Unidad enviada a espera de turno.");
  await load();
 }
 async function flag(u){
  const r=await supabase.from("unidades").update({estado:"incidencia",updated_at:new Date().toISOString()}).eq("id",u.id);
  if(r.error){setError(r.error.message);return;}
  setMessage("Unidad marcada para revisión.");await load();
 }
 async function crearCita(){
  setError("");setMessage("");
  if(!form.linea.trim()||form.pallets===""){setError("Captura línea de transporte y pallets.");return;}
  const user=(await supabase.auth.getUser()).data.user;
  if(!user?.id){setError("No hay sesión CSR.");return;}
  const fr=await supabase.rpc("generar_folio_cita",{p_fecha:form.fecha});
  if(fr.error){setError("No se pudo generar el folio: "+fr.error.message);return;}
  const folio=fr.data;
  const fin=new Date(form.fecha+"T"+form.hora);fin.setMinutes(fin.getMinutes()+30);
  const r=await supabase.from("citas").insert({almacen_id:warehouseId,csr_usuario_id:user.id,folio,tipo_operacion:operation,fecha:form.fecha,hora_inicio:form.hora,hora_fin:fin.toTimeString().slice(0,5),referencia:form.referencia||null,pallets:Number(form.pallets),estado:"borrador",unidades_solicitadas:1}).select("id,folio").single();
  if(r.error){setError(r.error.message);return;}
  const p=await supabase.from("cita_datos_precarga").upsert({cita_id:r.data.id,linea_transporte:form.linea,operador_nombre:form.operador||null,tracto_numero:form.tracto||null,tracto_placas:form.placaTracto||null,caja_numero:form.caja||null,caja_placas:form.placaCaja||null,observaciones:form.referencia||null,actualizado_por:user.id},{onConflict:"cita_id"});
  if(p.error){setError("Cita creada, pero faltó precarga: "+p.error.message);return;}
  setMessage("Cita creada: "+r.data.folio);setForm({...form,linea:"",operador:"",tracto:"",placaTracto:"",caja:"",placaCaja:"",referencia:"",pallets:""});await load();
 }
 return <section id="csr" className="users-section"><div className="panel">
  <div className="panel-title"><div><strong>CSR · Programación de citas</strong></div><button className="secondary-btn" onClick={load} disabled={loading}><RefreshCw size={15}/>Actualizar</button></div>
  {error&&<div className="notice error"><strong>Error</strong><span>{error}</span></div>}
  {message&&<div className="notice success"><CheckCircle2 size={17}/><strong>{message}</strong></div>}
  <div className="csr-operation-switch"><button className={operation==="recibo"?"active":""} onClick={()=>setOperation("recibo")}>📥 Recibos</button><button className={operation==="embarque"?"active":""} onClick={()=>setOperation("embarque")}>📤 Embarques</button></div>
  <div className="csr-scheduler"><h3>Programar cita · {operation==="recibo"?"Recibo":"Embarque"}</h3><div className="csr-form-grid">
   <label>Fecha<input type="date" value={form.fecha} onChange={e=>setForm({...form,fecha:e.target.value})}/></label>
   <label>Hora<input type="time" value={form.hora} onChange={e=>setForm({...form,hora:e.target.value})}/></label>
   <label>Línea de transporte<input value={form.linea} onChange={e=>setForm({...form,linea:e.target.value})}/></label>
   <label>Pallets<input type="number" min="0" value={form.pallets} onChange={e=>setForm({...form,pallets:e.target.value})}/></label>
   <label>Operador<input value={form.operador} onChange={e=>setForm({...form,operador:e.target.value})}/></label>
   <label>Placa tracto<input value={form.placaTracto} onChange={e=>setForm({...form,placaTracto:e.target.value.toUpperCase()})}/></label>
   <label>Placa caja<input value={form.placaCaja} onChange={e=>setForm({...form,placaCaja:e.target.value.toUpperCase()})}/></label>
   <label>Referencia<input value={form.referencia} onChange={e=>setForm({...form,referencia:e.target.value})}/></label>
  </div><button className="login-btn" onClick={crearCita}>Registrar cita</button></div>
  <div className="panel"><div className="panel-title"><strong>Unidades pendientes de validación</strong></div>{loading?<div className="empty">Cargando…</div>:units.length?units.map(u=><div className="dispatch-card" key={u.id}><div className="dispatch-head"><strong>{u.folio}</strong><span className="tag">{u.estado}</span></div><div className="dispatch-data"><span><b>Operador</b>{u.operador_nombre||"—"}</span><span><b>Línea</b>{u.linea_transporte||"—"}</span><span><b>Tracto</b>{u.tracto_placas||"—"}</span><span><b>Caja</b>{u.caja_placas||"—"}</span></div><div className="button-row"><button className="login-btn compact" onClick={()=>confirm(u)}><CheckCircle2 size={15}/>Validar</button><button className="secondary-btn" onClick={()=>flag(u)}><XCircle size={15}/>Revisión</button></div></div>):<div className="empty">No hay unidades pendientes.</div>}</div>
  <div className="panel"><div className="panel-title"><strong>Próximas citas</strong></div>{appointments.length?appointments.map(a=><div className="traffic-list" key={a.id}><div><b>{a.folio}</b><span>{a.fecha} · {String(a.hora_inicio||"").slice(0,5)} · {a.tipo_operacion}</span><em>{a.pallets??0} pallets</em></div></div>):<div className="empty">No hay citas próximas.</div>}</div>
 </div></section>;
}
