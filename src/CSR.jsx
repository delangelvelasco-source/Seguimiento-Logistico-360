import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CalendarPlus, CheckCircle2, ClipboardCheck, FileCheck2, RefreshCw, Search, Send, XCircle, Eye, X } from "lucide-react";
import { supabase } from "./lib/supabase";

export default function CSR({warehouseId}){
 const [units,setUnits]=useState([]),[appointments,setAppointments]=useState([]),[csrUserId,setCsrUserId]=useState(""),[loading,setLoading]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[query,setQuery]=useState(""),[operation,setOperation]=useState("recibo"),[selectedSlot,setSelectedSlot]=useState(""),[selectedAppointment,setSelectedAppointment]=useState(null),[appointmentForm,setAppointmentForm]=useState({operador:"",linea:"",contacto:"",tracto:"",placaTracto:"",caja:"",placaCaja:"",referencia:"",cuentaCliente:"",pallets:""});
 const [practice,setPractice]=useState({cliente:"WABCO",operacion:"recibo",fecha:new Date().toISOString().slice(0,10),hora:"10:00",unidades:"1",pallets:"0",referencia:"REF-WABCO-45821"});
 const [practiceAppointment,setPracticeAppointment]=useState(null),[qrData,setQrData]=useState("");
 const [practiceMsg,setPracticeMsg]=useState(""),[evidenceModal,setEvidenceModal]=useState(null),[evidenceLoading,setEvidenceLoading]=useState(false) ,[selectedEvidence,setSelectedEvidence]=useState(null);
 async function load(){if(!warehouseId)return;setLoading(true);const {data:{user}}=await supabase.auth.getUser();setCsrUserId(user?.id||"");setError("");const select="id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,estado,operacion_tipo,cita_at,cita_confirmada,sin_cita,dispatch_registro_at,csr_confirmacion_at,operacion_360_id";const pending=supabase.from("unidades").select(select).eq("almacen_id",warehouseId).eq("estado","validando").order("dispatch_registro_at",{ascending:false}).limit(50);const now=new Date();const day=(now.getDay()+6)%7;const weekStart=new Date(now);weekStart.setHours(0,0,0,0);weekStart.setDate(now.getDate()-day);const weekEnd=new Date(weekStart);weekEnd.setDate(weekStart.getDate()+7);const agenda=supabase.from("citas").select("id,folio,csr_usuario_id,tipo_operacion,fecha,hora_inicio,hora_fin,referencia,cuenta_cliente,estado,unidades_solicitadas,pallets,cita_datos_precarga(*)").eq("almacen_id",warehouseId).gte("fecha",weekStart.toISOString().slice(0,10)).lt("fecha",weekEnd.toISOString().slice(0,10)).order("fecha",{ascending:true}).order("hora_inicio",{ascending:true}).limit(200);const [{data,error},{data:agendaData,error:agendaError}]=await Promise.all([pending,agenda]);if(error)setError(error.message);else setUnits(data||[]);if(!agendaError)setAppointments((agendaData||[]).map(a=>({...a,precarga:Array.isArray(a.cita_datos_precarga)?a.cita_datos_precarga[0]:a.cita_datos_precarga})));setLoading(false)}
 useEffect(()=>{
  load();
  if(!warehouseId)return;
  const channel=supabase.channel("csr-live-"+warehouseId)
    .on("postgres_changes",{event:"*",schema:"public",table:"unidades",filter:"almacen_id=eq."+warehouseId},()=>load())
    .on("postgres_changes",{event:"*",schema:"public",table:"citas",filter:"almacen_id=eq."+warehouseId},()=>load())
    .on("postgres_changes",{event:"*",schema:"public",table:"cita_datos_precarga",filter:"almacen_id=eq."+warehouseId},()=>load())
    .subscribe();
  const timer=setInterval(load,15000);
  return()=>{clearInterval(timer);supabase.removeChannel(channel)};
},[warehouseId]);

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
 async function deleteAppointment(appointment){
  if(!appointment?.id||appointment.csr_usuario_id!==csrUserId)return;
  setError("");setMessage("");
  const {data:arribo,error:arriboError}=await supabase.from("accesos_caseta")
    .select("id,folio,entrada_at,estado,nombre,tracto_placas,caja_placas")
    .eq("almacen_id",warehouseId).eq("folio",appointment.folio).eq("tipo_acceso","unidad")
    .order("entrada_at",{ascending:false}).limit(1).maybeSingle();
  if(arriboError){setError("No se pudo comprobar el ingreso de la cita: "+arriboError.message);return;}
  if(arribo){
    setMessage("⚠️ La cita "+appointment.folio+" ya tiene registro de ingreso en Caseta. No se puede eliminar; se conserva como historial.");
    return;
  }
  if(!window.confirm("¿Eliminar la cita "+appointment.folio+"?"))return;
  const {data:ops,error:opsError}=await supabase.from("operaciones_360").select("id,unidad_id").eq("cita_id",appointment.id);
  if(opsError){setError("No se pudo comprobar la operación asociada: "+opsError.message);return}
  if(ops?.length){
    const unitIds=ops.map(o=>o.unidad_id).filter(Boolean);
    if(unitIds.length){
      const {data:linked,error:linkedError}=await supabase.from("unidades").select("id,estado").in("id",unitIds);
      if(linkedError){setError("No se pudo comprobar el estado de la unidad: "+linkedError.message);return}
      const active=(linked||[]).filter(u=>!["cancelada","salida","liberada"].includes(u.estado));
      if(active.length){setMessage("⚠️ La cita ya está ligada a una operación activa y no se puede eliminar.");return}
      const {error:detachError}=await supabase.from("unidades").update({operacion_360_id:null}).in("id",unitIds);
      if(detachError){setError("No se pudo desvincular la operación: "+detachError.message);return}
    }
    const {error:opDeleteError}=await supabase.from("operaciones_360").delete().eq("cita_id",appointment.id);
    if(opDeleteError){setError("No se pudo eliminar la operación asociada: "+opDeleteError.message);return}
  }
  const r=await supabase.from("citas").delete().eq("id",appointment.id).eq("csr_usuario_id",csrUserId).select("id").maybeSingle();
  if(r.error){setError("No se pudo eliminar la cita: "+r.error.message);return}
  if(!r.data){setError("La cita no se eliminó. Verifica que la sesión CSR sea la propietaria de la cita.");return}
  setSelectedSlot("");setSelectedAppointment(null);setAppointmentForm({operador:"",linea:"",contacto:"",tracto:"",placaTracto:"",caja:"",placaCaja:"",referencia:"",cuentaCliente:"",pallets:""}); setMessage("Cita "+appointment.folio+" eliminada.");await load(); } async function verRegistroCaseta(u){
  if(!u?.id&&!u?.folio)return;
  setEvidenceLoading(true);setError("");
  try{
    const {data:acceso,error:accesoError}=await supabase.from("accesos_caseta").select("id,folio,nombre,empresa,tracto_placas,caja_placas,entrada_at,salida_at,estado,operacion_tipo").eq(u?.id?"unidad_id":"folio",u?.id?u.id:u.folio).eq("almacen_id",warehouseId).order("entrada_at",{ascending:false}).limit(1).maybeSingle();
    if(accesoError)throw accesoError;
    if(!acceso){setMessage("No se encontró un registro de Caseta para esta unidad.");return;}
    const {data:evidencias,error:evidenciaError}=await supabase.from("evidencias_caseta").select("id,tipo,storage_path,created_at").eq("acceso_id",acceso.id).order("created_at",{ascending:false});
    if(evidenciaError)throw evidenciaError;
    const paths=(evidencias||[]).map(e=>e.storage_path).filter(Boolean);
    let signed=[];
    if(paths.length){
      const {data:urls,error:urlError}=await supabase.storage.from("evidencias-caseta").createSignedUrls(paths,3600);
      if(urlError)throw urlError;
      signed=(urls||[]).map((x,i)=>({...evidencias[i],signedUrl:x?.signedUrl||""}));
    }
    setSelectedEvidence(null);setEvidenceModal({unidad:u,acceso,photos:signed});
  }catch(err){setError("No se pudo consultar la evidencia de Caseta: "+(err?.message||"error desconocido"));}
  finally{setEvidenceLoading(false);}
 }
 async function flag(u){
  setError("");const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
  const {error}=await supabase.from("unidades").update({estado:"incidencia",updated_at:now}).eq("id",u.id);
  if(error){setError(error.message);return}
  await supabase.from("movimientos").insert({unidad_id:u.id,usuario_id:user?.id,tipo:"csr_requiere_revision",estado_anterior:u.estado,estado_nuevo:"incidencia",notas:"CSR requiere aclaración antes de continuar",ocurrido_at:now});
  setMessage("Unidad marcada para revisión.");await load();
 }
 async function solicitarVentanaExtra(form){
  const user=(await supabase.auth.getUser()).data.user;
  if(!user?.id){setError("No se encontró la sesión del usuario CSR.");return false;}
  const inicio=new Date(form.fecha+"T"+form.hora);
  const fin=new Date(inicio);fin.setMinutes(fin.getMinutes()+30);
  const {error}=await supabase.from("solicitudes_ventanas").insert({
    almacen_id:warehouseId,csr_usuario_id:user.id,tipo_operacion:operation,fecha:form.fecha,
    hora_inicio:form.hora,hora_fin:fin.toTimeString().slice(0,5),
    unidades_solicitadas:Number(form.unidades)||1,motivo:form.motivo,referencia:form.referencia||null,
    observaciones:form.observaciones||null
  });
  if(error){setError("No se pudo enviar la solicitud: "+error.message);return false;}
  setMessage("Solicitud de ventana adicional enviada para autorización.");
  return true;
 }
 return <section id="csr" className="users-section"><div className="panel"><div className="csr-hero-banner"><div className="csr-hero-copy"><div className="csr-hero-brand"><span className="csr-hero-logo">360</span><div><strong>ALMACÉN 360</strong><small>CONTROL · VISIBILIDAD · EFICIENCIA</small></div></div><div className="eyebrow">CSR · PROGRAMACIÓN DE CITAS</div><p>Programa Recibos y Embarques en tiempo real y comparte el folio directamente con Caseta.</p><div className="csr-hero-tags"><button className={operation==="recibo"?"active":""} onClick={()=>setOperation("recibo")}>📥 RECIBOS</button><button className={operation==="embarque"?"active":""} onClick={()=>setOperation("embarque")}>📤 EMBARQUES</button><span>🟢 DISPONIBLE</span><span>⚫ OCUPADO</span></div></div><button className="secondary-btn csr-hero-refresh" onClick={load}><RefreshCw size={15}/>Actualizar</button></div>
 <div id="csr-calendar" className="csr-operation-switch"><button className={operation==="recibo"?"active":""} onClick={()=>setOperation("recibo")}>📥 Recibos</button><button className={operation==="embarque"?"active":""} onClick={()=>setOperation("embarque")}>📤 Embarques</button></div>
 {error&&<div className="notice error"><strong>Error</strong><span>{error}</span></div>}<WeeklyCalendar appointments={appointments} operation={operation} csrUserId={csrUserId} onDelete={deleteAppointment} onViewEvidence={verRegistroCaseta} onAdditionalWindow={solicitarVentanaExtra} onSlot={(slot,appointment)=>{setSelectedSlot(slot);setSelectedAppointment(appointment||null);setAppointmentForm({operador:appointment?.precarga?.operador_nombre||"",linea:appointment?.precarga?.linea_transporte||"",contacto:appointment?.precarga?.contacto||"",tracto:appointment?.precarga?.tracto_numero||"",placaTracto:appointment?.precarga?.tracto_placas||"",caja:appointment?.precarga?.caja_numero||"",placaCaja:appointment?.precarga?.caja_placas||"",referencia:appointment?.referencia||appointment?.precarga?.observaciones||"",cuentaCliente:appointment?.cuenta_cliente||"",pallets:appointment?.pallets??""})}}/>
 {selectedSlot&&<div className="csr-scheduler">
  <div><strong>{selectedAppointment?"Modificar cita":"Programar cita"} · {operation==="recibo"?"Recibo":"Embarque"}</strong><button type="button" className="secondary-btn" onClick={()=>setSelectedSlot("")}>Cerrar</button></div>
  <p>{new Date(selectedSlot).toLocaleString("es-MX",{weekday:"long",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</p>
  <div className="csr-form-section">
   <div className="csr-form-grid">
    <label>Operación<select value={operation} onChange={e=>setOperation(e.target.value)}><option value="recibo">Recibo</option><option value="embarque">Embarque</option></select></label><label>Cuenta o cliente <span>(opcional · solo Dispatch)</span><input placeholder="Cuenta / cliente" value={appointmentForm.cuentaCliente} onChange={e=>setAppointmentForm({...appointmentForm,cuentaCliente:e.target.value})}/></label><label>Línea de transporte<input autoComplete="organization" placeholder="Empresa transportista" value={appointmentForm.linea} onChange={e=>setAppointmentForm({...appointmentForm,linea:e.target.value})}/></label>
    <label className="csr-pallet-field">Pallets <span>(requerido)</span><input required type="number" min="0" step="1" inputMode="numeric" placeholder="Ej. 20" aria-label="Cantidad de pallets" value={appointmentForm.pallets} onChange={e=>setAppointmentForm({...appointmentForm,pallets:e.target.value})}/><small className="csr-pallet-note">Cantidad de pallets de la cita</small></label>
    <label>Número de caja<input autoCapitalize="characters" placeholder="Ej. R344" value={appointmentForm.caja} onChange={e=>setAppointmentForm({...appointmentForm,caja:e.target.value})}/></label>
    <label>Placa de caja<input autoCapitalize="characters" placeholder="ABC-123-X" value={appointmentForm.placaCaja} onChange={e=>setAppointmentForm({...appointmentForm,placaCaja:e.target.value.toUpperCase()})}/></label>
    <label>Operador <span>(opcional)</span><input autoComplete="name" placeholder="Nombre y apellidos" value={appointmentForm.operador} onChange={e=>setAppointmentForm({...appointmentForm,operador:e.target.value})}/></label>
    <label>Contacto <span>(opcional)</span><input type="tel" inputMode="tel" placeholder="Teléfono" value={appointmentForm.contacto} onChange={e=>setAppointmentForm({...appointmentForm,contacto:e.target.value})}/></label>
    <label>Referencia <span>(opcional)</span><input placeholder="Referencia del cliente" value={appointmentForm.referencia} onChange={e=>setAppointmentForm({...appointmentForm,referencia:e.target.value})}/></label>
    <label>Placa de tracto <span>(opcional)</span><input autoCapitalize="characters" placeholder="ABC-123-X" value={appointmentForm.placaTracto} onChange={e=>setAppointmentForm({...appointmentForm,placaTracto:e.target.value.toUpperCase()})}/></label>
    <label>Número de tracto <span>(opcional)</span><input inputMode="numeric" placeholder="Número económico" value={appointmentForm.tracto} onChange={e=>setAppointmentForm({...appointmentForm,tracto:e.target.value})}/></label>
   </div>
  </div>
  <div className="csr-action-row"><button type="button" className="secondary-btn" disabled={!appointmentForm.linea.trim()||appointmentForm.pallets===""||Number(appointmentForm.pallets)<0||(!appointmentForm.placaTracto.trim()&&!appointmentForm.placaCaja.trim())} onClick={()=>{const d=new Date(selectedSlot);const texto=selectedAppointment?.folio||"CITA";navigator.clipboard?.writeText(texto);setMessage("Cita copiada.");}}>Copiar cita</button><button className="login-btn" disabled={!appointmentForm.linea.trim()||appointmentForm.pallets===""||Number(appointmentForm.pallets)<0||(!appointmentForm.placaTracto.trim()&&!appointmentForm.placaCaja.trim())} onClick={async()=>{
    setError("");setMessage("");const {data:{user}}=await supabase.auth.getUser();if(!user?.id){setError("No se encontró la sesión del usuario CSR. Cierra sesión e inicia nuevamente.");return}const d=new Date(selectedSlot);const fecha=d.toISOString().slice(0,10);const hora=d.toTimeString().slice(0,5);let folio=selectedAppointment?.folio||"";if(!selectedAppointment){const fr=await supabase.rpc("generar_folio_cita",{p_fecha:fecha});if(fr.error){setError("No se pudo generar el folio: "+fr.error.message);return}folio=fr.data;}
    let cita,e,pe;
    if(selectedAppointment){const r=await supabase.from("citas").update({tipo_operacion:operation,fecha,hora_inicio:hora,hora_fin:(()=>{const fin=new Date(d);fin.setMinutes(fin.getMinutes()+30);return fin.toTimeString().slice(0,5)})(),referencia:appointmentForm.referencia||null,cuenta_cliente:appointmentForm.cuentaCliente||null,pallets:appointmentForm.pallets===""?null:Number(appointmentForm.pallets),csr_usuario_id:user.id,updated_at:new Date().toISOString()}).eq("id",selectedAppointment.id).select("id,folio,tipo_operacion,fecha,hora_inicio,hora_fin,referencia,cuenta_cliente,estado,unidades_solicitadas,pallets").single();cita=r.data;e=r.error;}else{const r=await supabase.from("citas").insert({almacen_id:warehouseId,csr_usuario_id:user.id,folio,tipo_operacion:operation,fecha,hora_inicio:hora,hora_fin:(()=>{const fin=new Date(d);fin.setMinutes(fin.getMinutes()+30);return fin.toTimeString().slice(0,5)})(),referencia:appointmentForm.referencia||null,cuenta_cliente:appointmentForm.cuentaCliente||null,pallets:appointmentForm.pallets===""?null:Number(appointmentForm.pallets),estado:"borrador",unidades_solicitadas:1}).select("id,folio,tipo_operacion,fecha,hora_inicio,hora_fin,referencia,cuenta_cliente,estado,unidades_solicitadas,pallets").single();cita=r.data;e=r.error;}
    if(e){setError("No se pudo guardar la cita: "+e.message);return}
    const precarga={linea_transporte:appointmentForm.linea,operador_nombre:appointmentForm.operador||null,contacto:appointmentForm.contacto||null,tracto_numero:appointmentForm.tracto||null,tracto_placas:appointmentForm.placaTracto||null,caja_numero:appointmentForm.caja||null,caja_placas:appointmentForm.placaCaja||null,observaciones:appointmentForm.referencia||null};
    const pr=await supabase.from("cita_datos_precarga").upsert({...precarga,cita_id:cita.id,actualizado_por:user.id},{onConflict:"cita_id"});pe=pr.error;
    if(pe){setError("La cita se guardó, pero no se pudo actualizar la información para Caseta: "+pe.message);return}
    setMessage(selectedAppointment?`Cita actualizada · Folio ${cita?.folio||selectedAppointment.folio}. Caseta verá la información actualizada.`:`Cita programada · Folio ${cita?.folio||folio}. La información quedó disponible para Caseta al ingresar el folio.`);const citaTexto=cita?.folio||folio;navigator.clipboard?.writeText(citaTexto).catch(()=>{});setSelectedSlot("");setSelectedAppointment(null);setAppointmentForm({operador:"",linea:"",contacto:"",tracto:"",placaTracto:"",caja:"",placaCaja:"",referencia:"",cuentaCliente:"",pallets:""});await load();
  }}>Registrar cita</button></div>
 </div><EvidenceModal evidenceModal={evidenceModal} selectedEvidence={selectedEvidence} setSelectedEvidence={setSelectedEvidence} setEvidenceModal={setEvidenceModal}/>
}

function EvidenceModal({evidenceModal,selectedEvidence,setSelectedEvidence,setEvidenceModal}){
 if(!evidenceModal)return null;
 const access=evidenceModal.acceso||{},unit=evidenceModal.unidad||{};
 const pick=tipo=>evidenceModal.photos?.find(p=>p.tipo===tipo);
 const photo=selectedEvidence?pick(selectedEvidence):null;
 return <div className="csr-evidence-modal" role="dialog" aria-modal="true"><div className="csr-evidence-card">
  <div className="csr-evidence-head"><div><strong>Prueba de llegada</strong><span>{access.folio||unit.folio||"Unidad"}</span></div><button type="button" className="csr-evidence-close" onClick={()=>setEvidenceModal(null)} aria-label="Cerrar"><X size={20}/></button></div>
  <div className="csr-evidence-summary"><div><b>Operador</b><span>{access.nombre||unit.operador_nombre||"—"}</span></div><div><b>Empresa</b><span>{access.empresa||unit.linea_transporte||"—"}</span></div><div><b>Placa tracto</b><span>{access.tracto_placas||unit.tracto_placas||"—"}</span></div><div><b>Placa caja</b><span>{access.caja_placas||unit.caja_placas||"—"}</span></div></div>
  <div className="csr-evidence-actions">{["placa","identificacion"].map(tipo=><button type="button" className={"csr-evidence-choice"+(selectedEvidence===tipo?" active":"")} onClick={()=>setSelectedEvidence(tipo)} key={tipo}><span>{tipo==="placa"?"📷":"🪪"}</span><div><strong>{tipo==="placa"?"Placa":"ID / INE"}</strong><small>{pick(tipo)?.signedUrl?"Ver evidencia fotográfica":"Sin fotografía"}</small></div><Eye size={16}/></button>)}</div>
  {selectedEvidence&&<div className="csr-evidence-viewer"><div className="csr-evidence-photo-title">{selectedEvidence==="placa"?"Evidencia de placa":"Evidencia de ID / INE"}</div>{photo?.signedUrl?<img src={photo.signedUrl} alt={selectedEvidence==="placa"?"Evidencia de placa":"Evidencia de identificación"}/>:<div className="csr-evidence-empty">No hay fotografía guardada.</div>}</div>}
 </div></div>;
}
function AdditionalWindowMenu({initial,operation,onClose,onSubmit}){
 const [form,setForm]=useState(initial);
 return <div className="csr-window-modal" role="dialog" aria-modal="true"><div className="csr-window-card"><div className="csr-window-head"><div><span>SOLICITUD</span><strong>Ventana adicional</strong><small>{operation==="recibo"?"Recibo":"Embarque"} · Requiere autorización</small></div><button type="button" className="csr-evidence-close" onClick={onClose}><X size={20}/></button></div><div className="csr-window-grid"><label>Fecha<input type="date" value={form.fecha} onChange={e=>setForm({...form,fecha:e.target.value})}/></label><label>Hora solicitada<input type="time" value={form.hora} onChange={e=>setForm({...form,hora:e.target.value})}/></label><label>Unidades<input type="number" min="1" value={form.unidades} onChange={e=>setForm({...form,unidades:e.target.value})}/></label><label>Motivo <span>requerido</span><input value={form.motivo} placeholder="Ej. incremento de operación" onChange={e=>setForm({...form,motivo:e.target.value})}/></label><label>Referencia <span>opcional</span><input value={form.referencia} placeholder="Cliente / embarque / recibo" onChange={e=>setForm({...form,referencia:e.target.value})}/></label><label className="full">Observaciones <span>opcional</span><textarea value={form.observaciones} placeholder="Información adicional para autorización" onChange={e=>setForm({...form,observaciones:e.target.value})}/></label></div><div className="csr-window-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button type="button" className="login-btn" disabled={!form.fecha||!form.hora||!form.motivo.trim()} onClick={()=>onSubmit(form)}>Enviar solicitud</button></div></div></div>
}

function WeeklyCalendar({appointments=[],operation="recibo",csrUserId="",onSlot,onAdditionalWindow,onDelete,onViewEvidence}){
 const CSR_BUILD_VERSION="2026-09-30-148";
 const now=new Date();
 const start=new Date(now);
 const offset=(now.getDay()+6)%7;
 start.setDate(now.getDate()-offset);start.setHours(0,0,0,0);
 const todayKey=now.toISOString().slice(0,10);
 const [selectedDay,setSelectedDay]=useState(todayKey); const [windowRequest,setWindowRequest]=useState(null); const [reprogrammingAppointment,setReprogrammingAppointment]=useState(null);
 const labels=["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
 const sameDay=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
 const days=labels.map((label,i)=>{const day=new Date(start);day.setDate(start.getDate()+i);return {label,day,key:day.toISOString().slice(0,10)}});
 const slots=[];
 for(let d=0;d<7;d++){
   const hours=d<5?Array.from({length:11},(_,i)=>8+i):d===5?[8,9,10]:[];
   hours.forEach(h=>{for(let w=1;w<=2;w++){const dt=new Date(start);dt.setDate(start.getDate()+d);dt.setHours(h,w===1?0:30,0,0);slots.push({dt,w})}});
 }
 const visible=appointments.filter(a=>(a.tipo_operacion||"recibo")===operation);
 const selected=days.find(d=>d.key===selectedDay)||days[0];
 const selectedSlots=slots.filter(s=>sameDay(s.dt,selected.day));
 return <div className="csr-week-calendar">
  <div className="csr-calendar-head">
   <div><strong>Agenda de {operation==="recibo"?"Recibos":"Embarques"}</strong><span>Selecciona un día para ver sus ventanas disponibles</span></div>
   <span className="tag">{visible.length} cita(s)</span>
  </div>
  <div className="csr-date-rail">
   {days.map(({label,day,key})=>{
    const dayCount=visible.filter(a=>a.fecha===key).length;
    const active=selectedDay===key;
    return <button type="button" className={"csr-date-card"+(active?" selected":"")+(sameDay(day,now)?" today":"")} onClick={()=>setSelectedDay(key)} key={key}>
      <span>{label}</span><strong>{day.getDate()}</strong><small>{dayCount?dayCount+" cita(s)":day.getDay()===0?"Sin operación":day.getDay()===6?"6 ventanas":"22 ventanas"}</small>
    </button>
   })}
  </div>
  <div className="csr-agenda-panel">
   <div className="csr-agenda-head">
    <div><span>HORARIOS DEL DÍA</span><strong>{selected.label} {selected.day.getDate()} · {selected.day.toLocaleDateString("es-MX",{month:"long"})}</strong></div>
    <div className="csr-agenda-legend"><i className="free-dot"/> Disponible <i className="busy-dot"/> Ocupado</div>
   </div>
   {reprogrammingAppointment&&<div className="csr-reprogram-banner">Reprogramando <strong>{reprogrammingAppointment.folio}</strong>: selecciona una ventana disponible para conservar el mismo folio.</div>}
   <div className="csr-agenda-grid">
    {selectedSlots.length?selectedSlots.map(s=>{
      const booked=visible.find(a=>a.fecha&&a.hora_inicio&&new Date(a.fecha+"T"+String(a.hora_inicio).slice(0,5)).getTime()===s.dt.getTime());
      return <button type="button" className={"csr-agenda-slot "+(booked?"busy":"free")} onClick={()=>{setSelectedDay(selected.key);if(reprogrammingAppointment&&!booked){onSlot?.(s.dt.toISOString(),reprogrammingAppointment);setReprogrammingAppointment(null);}else{onSlot?.(s.dt.toISOString(),booked)}}} key={s.dt.toISOString()}>
       <strong>{String(s.dt.getHours()).padStart(2,"0")}:{String(s.dt.getMinutes()).padStart(2,"0")}</strong>
       <span>Ventana {s.w}</span>
       <small>{booked?"Modificar · "+booked.folio:"Disponible"}</small>{booked&&<small className="csr-pallet-summary">Pallets: {booked.pallets ?? 0}</small>}{booked&&booked.csr_usuario_id===csrUserId&&<><span className="csr-reprogram-hint" onClick={e=>{e.stopPropagation();setReprogrammingAppointment(booked);setSelectedDay(selected.key)}}>Reprogramar</span><span className="csr-evidence-hint" onClick={e=>{e.stopPropagation();onViewEvidence?.(booked)}}>Ver evidencia</span><span className="csr-delete-hint" onClick={e=>{e.stopPropagation();onDelete?.(booked)}}>Eliminar</span></>}
      </button>
    }):<div className="csr-agenda-empty">Este día no tiene operación programada.</div>}
   </div>
   <button type="button" className="secondary-btn csr-extra-window-btn" onClick={()=>setWindowRequest({fecha:selectedDay,hora:"18:00",motivo:"",referencia:"",observaciones:"",unidades:1})}>
    + Solicitar ventana adicional
   </button>
   {windowRequest&&<AdditionalWindowMenu initial={windowRequest} operation={operation} onClose={()=>setWindowRequest(null)} onSubmit={form=>onAdditionalWindow?.(form)}/>} 
  </div>
 </div>
}