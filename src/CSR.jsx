import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CalendarPlus, CheckCircle2, ClipboardCheck, FileCheck2, RefreshCw, Search, Send, XCircle } from "lucide-react";
import { supabase } from "./lib/supabase";

export default function CSR({warehouseId}){
 const [units,setUnits]=useState([]),[appointments,setAppointments]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[query,setQuery]=useState(""),[operation,setOperation]=useState("recibo"),[selectedSlot,setSelectedSlot]=useState(""),[selectedAppointment,setSelectedAppointment]=useState(null),[appointmentForm,setAppointmentForm]=useState({operador:"",linea:"",contacto:"",tracto:"",placaTracto:"",caja:"",placaCaja:"",referencia:"",cuentaCliente:""});
 const [practice,setPractice]=useState({cliente:"WABCO",operacion:"recibo",fecha:new Date().toISOString().slice(0,10),hora:"10:00",unidades:"1",pallets:"0",referencia:"REF-WABCO-45821"});
 const [practiceAppointment,setPracticeAppointment]=useState(null),[qrData,setQrData]=useState("");
 const [practiceMsg,setPracticeMsg]=useState("");
 async function load(){if(!warehouseId)return;setLoading(true);setError("");const select="id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,estado,operacion_tipo,cita_at,cita_confirmada,sin_cita,dispatch_registro_at,csr_confirmacion_at,operacion_360_id";const pending=supabase.from("unidades").select(select).eq("almacen_id",warehouseId).eq("estado","validando").order("dispatch_registro_at",{ascending:false}).limit(50);const now=new Date();const day=(now.getDay()+6)%7;const weekStart=new Date(now);weekStart.setHours(0,0,0,0);weekStart.setDate(now.getDate()-day);const weekEnd=new Date(weekStart);weekEnd.setDate(weekStart.getDate()+7);const agenda=supabase.from("citas").select("id,folio,tipo_operacion,fecha,hora_inicio,hora_fin,referencia,cuenta_cliente,estado,unidades_solicitadas,cita_datos_precarga(*)").eq("almacen_id",warehouseId).gte("fecha",weekStart.toISOString().slice(0,10)).lt("fecha",weekEnd.toISOString().slice(0,10)).order("fecha",{ascending:true}).order("hora_inicio",{ascending:true}).limit(200);const [{data,error},{data:agendaData,error:agendaError}]=await Promise.all([pending,agenda]);if(error)setError(error.message);else setUnits(data||[]);if(!agendaError)setAppointments((agendaData||[]).map(a=>({...a,precarga:Array.isArray(a.cita_datos_precarga)?a.cita_datos_precarga[0]:a.cita_datos_precarga})));setLoading(false)}
 useEffect(()=>{load();const timer=setInterval(load,15000);return()=>clearInterval(timer)},[warehouseId]);

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
 const filtered=units.filter(u=>(u.operacion_tipo||"recibo")===operation&&[u.folio,u.operador_nombre,u.linea_transporte,u.tracto_placas].join(" ").toLowerCase().includes(query.toLowerCase()));
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
 return <section id="csr" className="users-section"><div className="panel"><div className="csr-hero-banner"><div className="csr-hero-copy"><div className="csr-hero-brand"><span className="csr-hero-logo">360</span><div><strong>ALMACÉN 360</strong><small>CONTROL · VISIBILIDAD · EFICIENCIA</small></div></div><div className="eyebrow">CSR · PROGRAMACIÓN DE CITAS</div><h2 className="csr-hero-title">DE TU OPERACIÓN</h2><p>Programa Recibos y Embarques en tiempo real y comparte el folio directamente con Caseta.</p><div className="csr-hero-tags"><button className={operation==="recibo"?"active":""} onClick={()=>setOperation("recibo")}>📥 RECIBOS</button><button className={operation==="embarque"?"active":""} onClick={()=>setOperation("embarque")}>📤 EMBARQUES</button><span>🟢 DISPONIBLE</span><span>⚫ OCUPADO</span></div></div><button className="secondary-btn csr-hero-refresh" onClick={load}><RefreshCw size={15}/>Actualizar</button></div>
 <div id="csr-calendar" className="csr-operation-switch"><button className={operation==="recibo"?"active":""} onClick={()=>setOperation("recibo")}>📥 Recibos</button><button className={operation==="embarque"?"active":""} onClick={()=>setOperation("embarque")}>📤 Embarques</button></div>
 {error&&<div className="notice error"><strong>Error</strong><span>{error}</span></div>}<WeeklyCalendar appointments={appointments} operation={operation} onSlot={(slot,appointment)=>{setSelectedSlot(slot);setSelectedAppointment(appointment||null);setAppointmentForm({operador:appointment?.precarga?.operador_nombre||"",linea:appointment?.precarga?.linea_transporte||"",contacto:appointment?.precarga?.contacto||"",tracto:appointment?.precarga?.tracto_numero||"",placaTracto:appointment?.precarga?.tracto_placas||"",caja:appointment?.precarga?.caja_numero||"",placaCaja:appointment?.precarga?.caja_placas||"",referencia:appointment?.referencia||appointment?.precarga?.observaciones||"",cuentaCliente:appointment?.cuenta_cliente||""})}}/>
 {selectedSlot&&<div className="csr-scheduler">
  <div><strong>{selectedAppointment?"Modificar cita":"Programar cita"} · {operation==="recibo"?"Recibo":"Embarque"}</strong><button type="button" className="secondary-btn" onClick={()=>setSelectedSlot("")}>Cerrar</button></div>
  <p>{new Date(selectedSlot).toLocaleString("es-MX",{weekday:"long",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</p>
  <div className="csr-form-section">
   <div className="csr-form-grid">
    <label>Operación<select value={operation} onChange={e=>setOperation(e.target.value)}><option value="recibo">Recibo</option><option value="embarque">Embarque</option></select></label><label>Cuenta o cliente <span>(opcional · solo Dispatch)</span><input placeholder="Cuenta / cliente" value={appointmentForm.cuentaCliente} onChange={e=>setAppointmentForm({...appointmentForm,cuentaCliente:e.target.value})}/></label><label>Línea de transporte<input autoComplete="organization" placeholder="Empresa transportista" value={appointmentForm.linea} onChange={e=>setAppointmentForm({...appointmentForm,linea:e.target.value})}/></label>
    <label>Número de caja<input autoCapitalize="characters" placeholder="Ej. R344" value={appointmentForm.caja} onChange={e=>setAppointmentForm({...appointmentForm,caja:e.target.value})}/></label>
    <label>Placa de caja<input autoCapitalize="characters" placeholder="ABC-123-X" value={appointmentForm.placaCaja} onChange={e=>setAppointmentForm({...appointmentForm,placaCaja:e.target.value.toUpperCase()})}/></label>
    <label>Operador <span>(opcional)</span><input autoComplete="name" placeholder="Nombre y apellidos" value={appointmentForm.operador} onChange={e=>setAppointmentForm({...appointmentForm,operador:e.target.value})}/></label>
    <label>Contacto <span>(opcional)</span><input type="tel" inputMode="tel" placeholder="Teléfono" value={appointmentForm.contacto} onChange={e=>setAppointmentForm({...appointmentForm,contacto:e.target.value})}/></label>
    <label>Referencia <span>(opcional)</span><input placeholder="Referencia del cliente" value={appointmentForm.referencia} onChange={e=>setAppointmentForm({...appointmentForm,referencia:e.target.value})}/></label>
    <label>Placa de tracto <span>(opcional)</span><input autoCapitalize="characters" placeholder="ABC-123-X" value={appointmentForm.placaTracto} onChange={e=>setAppointmentForm({...appointmentForm,placaTracto:e.target.value.toUpperCase()})}/></label>
    <label>Número de tracto <span>(opcional)</span><input inputMode="numeric" placeholder="Número económico" value={appointmentForm.tracto} onChange={e=>setAppointmentForm({...appointmentForm,tracto:e.target.value})}/></label>
   </div>
  </div>
  <div className="csr-action-row"><button type="button" className="secondary-btn" disabled={!appointmentForm.linea.trim()||(!appointmentForm.placaTracto.trim()&&!appointmentForm.placaCaja.trim())} onClick={()=>{const d=new Date(selectedSlot);const texto=selectedAppointment?.folio||"CITA";navigator.clipboard?.writeText(texto);setMessage("Cita copiada.");}}>Copiar cita</button><button className="login-btn" disabled={!appointmentForm.linea.trim()||(!appointmentForm.placaTracto.trim()&&!appointmentForm.placaCaja.trim())} onClick={async()=>{
    setError("");setMessage("");const {data:{user}}=await supabase.auth.getUser();if(!user?.id){setError("No se encontró la sesión del usuario CSR. Cierra sesión e inicia nuevamente.");return}const d=new Date(selectedSlot);const fecha=d.toISOString().slice(0,10);const hora=d.toTimeString().slice(0,5);let folio=selectedAppointment?.folio||"";if(!selectedAppointment){const fr=await supabase.rpc("generar_folio_cita",{p_fecha:fecha});if(fr.error){setError("No se pudo generar el folio: "+fr.error.message);return}folio=fr.data;}
    let cita,e,pe;
    if(selectedAppointment){const r=await supabase.from("citas").update({tipo_operacion:operation,fecha,hora_inicio:hora,hora_fin:(()=>{const fin=new Date(d);fin.setMinutes(fin.getMinutes()+30);return fin.toTimeString().slice(0,5)})(),referencia:appointmentForm.referencia||null,cuenta_cliente:appointmentForm.cuentaCliente||null,csr_usuario_id:user.id,updated_at:new Date().toISOString()}).eq("id",selectedAppointment.id).select("id,folio,tipo_operacion,fecha,hora_inicio,hora_fin,referencia,estado,unidades_solicitadas").single();cita=r.data;e=r.error;}else{const r=await supabase.from("citas").insert({almacen_id:warehouseId,csr_usuario_id:user.id,folio,tipo_operacion:operation,fecha,hora_inicio:hora,hora_fin:(d.getHours()+1).toString().padStart(2,"0")+":00",referencia:appointmentForm.referencia||null,cuenta_cliente:appointmentForm.cuentaCliente||null,estado:"borrador",unidades_solicitadas:1}).select("id,folio,tipo_operacion,fecha,hora_inicio,hora_fin,referencia,estado,unidades_solicitadas").single();cita=r.data;e=r.error;}
    if(e){setError("No se pudo guardar la cita: "+e.message);return}
    const precarga={linea_transporte:appointmentForm.linea,operador_nombre:appointmentForm.operador||null,contacto:appointmentForm.contacto||null,tracto_numero:appointmentForm.tracto||null,tracto_placas:appointmentForm.placaTracto||null,caja_numero:appointmentForm.caja||null,caja_placas:appointmentForm.placaCaja||null,observaciones:appointmentForm.referencia||null};
    const pr=selectedAppointment?await supabase.from("cita_datos_precarga").update(precarga).eq("cita_id",selectedAppointment.id):await supabase.from("cita_datos_precarga").insert({...precarga,cita_id:cita.id});pe=pr.error;
    if(pe){setError("La cita se guardó, pero no se pudo actualizar la información para Caseta: "+pe.message);return}
    setMessage(selectedAppointment?`Cita actualizada · Folio ${cita?.folio||selectedAppointment.folio}. Caseta verá la información actualizada.`:`Cita programada · Folio ${cita?.folio||folio}. La información quedó disponible para Caseta al ingresar el folio.`);const citaTexto=cita?.folio||folio;navigator.clipboard?.writeText(citaTexto).catch(()=>{});setSelectedSlot("");setSelectedAppointment(null);setAppointmentForm({operador:"",linea:"",contacto:"",tracto:"",placaTracto:"",caja:"",placaCaja:"",referencia:"",cuentaCliente:""});await load();
  }}>Registrar cita</button></div>
 </div>}{message&&<div className="notice success"><CheckCircle2 size={17}/><strong>{message}</strong></div>}<div className="dispatch-toolbar"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar unidad, operador, línea o placa"/></div>{loading?<div className="empty">Cargando validaciones…</div>:filtered.length?<div className="dispatch-list">{filtered.map(u=><div className="dispatch-card" key={u.id}><div className="dispatch-head"><div><strong>{u.folio}</strong><span>{u.operacion_tipo||"Operación"} · {u.cita_confirmada?"Cita confirmada":"Sin cita"}</span></div><span className="tag">{u.estado}</span></div><div className="dispatch-data"><span><b>Operador</b>{u.operador_nombre}</span><span><b>Línea</b>{u.linea_transporte}</span><span><b>Tracto</b>{u.tracto_placas}</span><span><b>Referencia</b>Disponible en operación</span></div><div className="button-row"><button className="secondary-btn" onClick={()=>flag(u)}><XCircle size={15}/>Requiere revisión</button><button className="login-btn compact" onClick={()=>confirm(u)}><CheckCircle2 size={15}/>Validar y pasar a Operación</button></div></div>)}</div>:<div className="empty">No hay unidades pendientes de CSR.</div>}</div></section>
}

function WeeklyCalendar({appointments=[],operation="recibo",onSlot}){\n const CSR_BUILD_VERSION="2026-09-30-142";const [selectedDay,setSelectedDay]=useState("");
 const now=new Date(); const start=new Date(now); const offset=(now.getDay()+6)%7; start.setDate(now.getDate()-offset); start.setHours(0,0,0,0);
 const labels=["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
 const sameDay=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
 const slots=[]; for(let d=0;d<7;d++){const hours=d<5?Array.from({length:10},(_,i)=>8+i):d===5?[8,9,10]:[];hours.forEach(h=>{for(let w=1;w<=2;w++){const dt=new Date(start);dt.setDate(start.getDate()+d);dt.setHours(h,w===1?0:30,0,0);slots.push({dt,w})}})}
 const visible=appointments.filter(a=>(a.tipo_operacion||"recibo")===operation);
 return <div className="csr-week-calendar">
  <div className="csr-calendar-head"><div><strong>Calendario semanal · {operation==="recibo"?"Recibos":"Embarques"}</strong><span>2 ventanas por hora · actualización automática</span></div><span className="tag">{visible.length} cita(s)</span></div>
  <div className="csr-calendar-grid">{labels.map((label,i)=>{const day=new Date(start);day.setDate(start.getDate()+i);const daySlots=slots.filter(s=>sameDay(s.dt,day));return <div className={"csr-day"+(sameDay(day,now)?" today":"")} key={label}>
   <div className="csr-day-head"><b>{label}</b><strong>{day.getDate()}</strong></div>
   <div className="csr-day-list">{daySlots.length?daySlots.map(s=>{const booked=visible.find(a=>a.fecha&&a.hora_inicio&&new Date(a.fecha+"T"+String(a.hora_inicio).slice(0,5)).getTime()===s.dt.getTime());return <button type="button" className={"csr-slot "+(booked?"busy":"free")} onClick={()=>{setSelectedDay(day.toISOString().slice(0,10));onSlot?.(s.dt.toISOString(),booked)}}><strong>{String(s.dt.getHours()).padStart(2,"0")}:{String(s.dt.getMinutes()).padStart(2,"0")}</strong><span>Ventana {s.w}</span>{booked?<small>Modificar · {booked.folio}</small>:<small>Disponible</small>}</button>}):<small className="csr-empty-day">Sin operación</small>}</div>
  </div>})}</div>
 </div>
}
