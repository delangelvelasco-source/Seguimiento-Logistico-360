import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CalendarPlus, CheckCircle2, ClipboardCheck, FileCheck2, RefreshCw, Search, Send, XCircle } from "lucide-react";
import { supabase } from "./lib/supabase";

export default function CSR({warehouseId}){
 const [units,setUnits]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[query,setQuery]=useState("");
 const [practice,setPractice]=useState({cliente:"WABCO",operacion:"recibo",fecha:new Date().toISOString().slice(0,10),hora:"10:00",unidades:"1",pallets:"0",referencia:"REF-WABCO-45821"});
 const [practiceAppointment,setPracticeAppointment]=useState(null),[qrData,setQrData]=useState("");
 const [practiceMsg,setPracticeMsg]=useState("");
 async function load(){if(!warehouseId)return;setLoading(true);const {data,error}=await supabase.from("unidades").select("id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,estado,operacion_tipo,cita_at,cita_confirmada,sin_cita,dispatch_registro_at,csr_confirmacion_at,operacion_360_id").eq("almacen_id",warehouseId).eq("estado","validando").order("dispatch_registro_at",{ascending:false}).limit(50);if(error)setError(error.message);else setUnits(data||[]);setLoading(false)}
 useEffect(()=>{load();try{const saved=localStorage.getItem("seguimiento360_practice_cita");if(saved)setPracticeAppointment(JSON.parse(saved))}catch{}},[warehouseId]);

 function generarCitaPractica(){
  const stamp=new Date();
  const key=String(stamp.getTime()).slice(-6);
  const folio="CIT-"+stamp.toISOString().slice(0,10).replaceAll("-","")+ "-"+key;
  const cita={folio,cliente:practice.cliente,operacion:practice.operacion,fecha:practice.fecha,hora:practice.hora,unidades:Number(practice.unidades)||1,pallets:Number(practice.pallets)||0,referencia:practice.referencia,created_at:stamp.toISOString()};
  localStorage.setItem("seguimiento360_practice_cita",JSON.stringify(cita));
  setPracticeAppointment(cita);
  QRCode.toDataURL(JSON.stringify({tipo:"cita360",folio:cita.folio,almacen_id:warehouseId}),{width:280,margin:2,errorCorrectionLevel:"M"}).then(setQrData).catch(()=>setQrData(""));
  setPracticeMsg("Cita de práctica generada. Ahora puedes llevar este folio al simulador de Caseta.");
 }
 const filtered=units.filter(u=>[u.folio,u.operador_nombre,u.linea_transporte,u.tracto_placas].join(" ").toLowerCase().includes(query.toLowerCase()));
 async function confirm(u){
  setError("");const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
  const {error}=await supabase.from("unidades").update({csr_confirmacion_at:now,csr_usuario_id:user?.id||null,estado_identificacion:"cuadrada",estado:"espera_turno",updated_at:now}).eq("id",u.id);
  if(error){setError(error.message);return}
  await supabase.from("movimientos").insert({unidad_id:u.id,usuario_id:user?.id,tipo:"csr_validacion",estado_anterior:u.estado,estado_nuevo:"espera_turno",notas:u.cita_confirmada?"CSR validó cita y datos":"CSR validó atención sin cita",ocurrido_at:now});
  setMessage("Validación CSR completada. La unidad queda en espera de asignación por Operación.");await load();
 }
 async function flag(u){
  setError("");const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
  const {error}=await supabase.from("unidades").update({estado:"incidencia",updated_at:now}).eq("id",u.id);
  if(error){setError(error.message);return}
  await supabase.from("movimientos").insert({unidad_id:u.id,usuario_id:user?.id,tipo:"csr_requiere_revision",estado_anterior:u.estado,estado_nuevo:"incidencia",notas:"CSR requiere aclaración antes de continuar",ocurrido_at:now});
  setMessage("Unidad marcada para revisión.");await load();
 }
 return <section id="csr" className="users-section"><div className="panel"><div className="panel-title"><div><FileCheck2 size={19}/><strong>CSR · Validación</strong></div><button className="secondary-btn" onClick={load}><RefreshCw size={15}/>Actualizar</button></div><p className="section-copy">CSR valida cita, referencias y requisitos sin volver a capturar lo que ya existe.</p>
 <div className="practice-appointment-card">
  <div className="practice-appointment-head"><div><CalendarPlus size={18}/><div><strong>CSR · Separar cita — Modo práctica</strong><span>Genera una cita ficticia para después ingresarla en el simulador de Caseta.</span></div></div><span className="tag">NO REAL</span></div>
  <div className="practice-appointment-grid">
   <label>Cliente<input value={practice.cliente} onChange={e=>setPractice({...practice,cliente:e.target.value})}/></label>
   <label>Operación<select value={practice.operacion} onChange={e=>setPractice({...practice,operacion:e.target.value})}><option value="recibo">Recibo</option><option value="embarque">Embarque</option></select></label>
   <label>Fecha<input type="date" value={practice.fecha} onChange={e=>setPractice({...practice,fecha:e.target.value})}/></label>
   <label>Horario<select value={practice.hora} onChange={e=>setPractice({...practice,hora:e.target.value})}><option>08:00</option><option>09:00</option><option>10:00</option><option>11:00</option><option>12:00</option><option>13:00</option><option>14:00</option><option>15:00</option><option>16:00</option><option>17:00</option><option>18:00</option></select></label>
   <label>Unidades<input type="number" min="1" value={practice.unidades} onChange={e=>setPractice({...practice,unidades:e.target.value})}/></label>
   <label>Pallets<input type="number" min="0" value={practice.pallets} onChange={e=>setPractice({...practice,pallets:e.target.value})}/></label>
   <label className="practice-wide">Referencia<input value={practice.referencia} onChange={e=>setPractice({...practice,referencia:e.target.value.toUpperCase()})}/></label>
  </div>
  <button className="login-btn compact" type="button" onClick={generarCitaPractica}><CalendarPlus size={16}/>Separar cita y generar folio</button>
  {practiceMsg&&<div className="notice success"><CheckCircle2 size={16}/><strong>{practiceMsg}</strong></div>}
  {practiceAppointment&&<div className="practice-generated-cita"><span>Folio generado</span><strong>{practiceAppointment.folio}</strong><small>{practiceAppointment.cliente} · {practiceAppointment.operacion} · {practiceAppointment.fecha} · {practiceAppointment.hora} · {practiceAppointment.unidades} unidad(es)</small>{qrData&&<div className="cita-qr-wrap"><img src={qrData} alt={"QR "+practiceAppointment.folio}/><small>Escanea este QR en Caseta para cargar la cita.</small></div>}</div>}
 </div>{error&&<div className="notice error"><strong>Error</strong><span>{error}</span></div>}{message&&<div className="notice success"><CheckCircle2 size={17}/><strong>{message}</strong></div>}<div className="dispatch-toolbar"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar unidad, operador, línea o placa"/></div>{loading?<div className="empty">Cargando validaciones…</div>:filtered.length?<div className="dispatch-list">{filtered.map(u=><div className="dispatch-card" key={u.id}><div className="dispatch-head"><div><strong>{u.folio}</strong><span>{u.operacion_tipo||"Operación"} · {u.cita_confirmada?"Cita confirmada":"Sin cita"}</span></div><span className="tag">{u.estado}</span></div><div className="dispatch-data"><span><b>Operador</b>{u.operador_nombre}</span><span><b>Línea</b>{u.linea_transporte}</span><span><b>Tracto</b>{u.tracto_placas}</span><span><b>Referencia</b>Disponible en operación</span></div><div className="button-row"><button className="secondary-btn" onClick={()=>flag(u)}><XCircle size={15}/>Requiere revisión</button><button className="login-btn compact" onClick={()=>confirm(u)}><CheckCircle2 size={15}/>Validar y pasar a Operación</button></div></div>)}</div>:<div className="empty">No hay unidades pendientes de CSR.</div>}</div></section>
}