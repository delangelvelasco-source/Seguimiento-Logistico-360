import { useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, Camera, CheckCircle2, ClipboardCheck, Clock3, FileCheck2, Flag, RotateCcw, ShieldCheck, Truck, UserCheck, Wrench, CalendarDays } from "lucide-react";

const CLIENTS={
  wabco:{name:"WABCO",requiresAppointment:true,csr:true,sidRid:true,operation:"recibo"},
  sinCita:{name:"Cliente sin cita",requiresAppointment:false,csr:false,sidRid:false,operation:"recibo"},
  opcional:{name:"Cliente con cita opcional",requiresAppointment:"opcional",csr:true,sidRid:true,operation:"embarque"}
};

const BASE={
  folio:"PRA-260926-001",cliente:"WABCO",operacion:"recibo",linea:"Transportes del Norte",
  operador:"Carlos Hernández",tracto:"ABC-128-X",caja:"TR-4587",cita:"",
  referencia:"REF-WABCO-45821",sid:"SID-78452",rid:"RID-99104",rampa:"R07",sello:"MX-884321"
};

const ALL_STEPS=[
 {id:"caseta",role:"Caseta",title:"Ingreso y validación",icon:Truck},
 {id:"dispatch",role:"Dispatch",title:"Cita y transporte",icon:ClipboardCheck},
 {id:"csr",role:"CSR",title:"Validación documental",icon:UserCheck},
 {id:"operacion",role:"Operación",title:"Rampa y proceso",icon:Wrench},
 {id:"documentacion",role:"Documentación",title:"Revisión documental",icon:FileCheck2},
 {id:"guardia",role:"Guardia",title:"Salida y liberación",icon:ShieldCheck}
];

function makeFlow(cfg){
  return ALL_STEPS.filter(s=>{
    if(s.id==="csr"&&!cfg.csr)return false;
    return true;
  });
}

export default function Practica(){
 const [clientKey,setClientKey]=useState("wabco");
 const cfg=CLIENTS[clientKey];
 const [data,setData]=useState({...BASE,cliente:cfg.name,operacion:cfg.operation,status:"pendiente",step:0,events:[],appointmentMode:cfg.requiresAppointment===false?"sin_cita":"con_cita",plateStatus:"pendiente",arrival:false,dispatchDecision:null,csrValidated:false,rampAssigned:false,operationStarted:false,operationFinished:false,docsValidated:false,sealVerified:false,exitAuthorized:false});
 const [startedAt,setStartedAt]=useState(null),[elapsed,setElapsed]=useState(0),[message,setMessage]=useState("Selecciona un cliente y comienza la simulación.");
 const [plate,setPlate]=useState(""),[cameraOpen,setCameraOpen]=useState(false),[cameraError,setCameraError]=useState("");
 const videoRef=useRef(null),streamRef=useRef(null);
 const flow=makeFlow(cfg),current=flow[Math.min(data.step,flow.length-1)];
 const progress=data.status==="finalizada"?100:Math.round((data.step/flow.length)*100);

 useEffect(()=>{if(!startedAt)return;const id=setInterval(()=>setElapsed(Math.floor((Date.now()-startedAt)/1000)),1000);return()=>clearInterval(id)},[startedAt]);
 useEffect(()=>()=>streamRef.current?.getTracks().forEach(t=>t.stop()),[]);

 function addEvent(role,text){setData(d=>({...d,events:[...d.events,{at:new Date().toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit",second:"2-digit"}),role,text}]}))}
 function changeClient(k){
  const c=CLIENTS[k];closeCamera();setClientKey(k);setData({...BASE,cliente:c.name,operacion:c.operation,status:"pendiente",step:0,events:[],appointmentMode:c.requiresAppointment===false?"sin_cita":"con_cita",plateStatus:"pendiente",arrival:false,dispatchDecision:null,csrValidated:false,rampAssigned:false,operationStarted:false,operationFinished:false,docsValidated:false,sealVerified:false,exitAuthorized:false});setPlate("");setStartedAt(null);setElapsed(0);setMessage("Cliente cambiado. El flujo se adapta automáticamente a sus reglas.");
 }
 function start(){setData(d=>({...d,status:"en_curso"}));setStartedAt(Date.now());setMessage("Simulación iniciada. Ejecuta cada acción cuando corresponda.")}
 function reset(){changeClient(clientKey)}
 async function openCamera(){setCameraError("");try{const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});streamRef.current=s;setCameraOpen(true);setTimeout(()=>{if(videoRef.current){videoRef.current.srcObject=s;videoRef.current.play().catch(()=>{})}},0)}catch{setCameraError("No se pudo abrir la cámara. Revisa el permiso del navegador.")}}
 function closeCamera(){streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;setCameraOpen(false)}
 function scanPlate(){setPlate(data.tracto);setData(d=>({...d,plateStatus:"coincide"}));addEvent("Caseta","Placa capturada: "+data.tracto+" · coincide");setMessage("🟢 Placa validada. Ya puedes registrar el arribo.");closeCamera()}
 function registerArrival(){
  if(data.plateStatus!=="coincide"){setMessage("Primero valida la placa.");return}
  setData(d=>({...d,arrival:true,step:1}));addEvent("Caseta",data.appointmentMode==="con_cita"?"Arribo registrado con cita.":"Arribo registrado sin cita.");setMessage("Caseta completada. Dispatch toma la unidad.");
 }
 function dispatch(decision){
  if(!data.arrival)return;setData(d=>({...d,dispatchDecision:decision,step:cfg.csr?2:1}));addEvent("Dispatch",decision==="con_cita"?"Cita confirmada y transporte validado.":"Atención sin cita confirmada.");setMessage(cfg.csr?"Unidad enviada a CSR.":"Unidad enviada directamente a Operación.");
 }
 function validateCsr(){setData(d=>({...d,csrValidated:true,step:3}));addEvent("CSR","SID/RID y requisitos validados.");setMessage("CSR validó la operación. Operación puede asignar rampa.")}
 function assignRamp(){setData(d=>({...d,rampAssigned:true}));addEvent("Operación","Rampa "+data.rampa+" asignada.");setMessage("Rampa asignada. Ahora inicia operación.")}
 function startOperation(){if(!data.rampAssigned){setMessage("Asigna una rampa primero.");return}setData(d=>({...d,operationStarted:true}));addEvent("Operación","Proceso iniciado en "+data.rampa+".");setMessage("Operación en curso.")}
 function finishOperation(){if(!data.operationStarted){setMessage("Inicia la operación primero.");return}setData(d=>({...d,operationFinished:true,step:4}));addEvent("Operación","Desentrampe registrado.");setMessage("Operación terminada. Documentación toma el turno.")}
 function validateDocs(){setData(d=>({...d,docsValidated:true,step:5}));addEvent("Documentación","Documentos revisados y completos.");setMessage("Documentación validada. Guardia puede revisar salida.")}
 function verifySeal(){setData(d=>({...d,sealVerified:true}));addEvent("Guardia","Sello físico "+data.sello+" coincide.");setMessage("Sello validado. Salida disponible.")}
 function authorizeExit(){if(!data.sealVerified){setMessage("Verifica el sello primero.");return}setData(d=>({...d,exitAuthorized:true}));addEvent("Guardia","Salida autorizada.");setMessage("Salida autorizada. Ejecuta salida física para finalizar.")}
 function exit(){if(!data.exitAuthorized){setMessage("Autoriza la salida primero.");return}setData(d=>({...d,status:"finalizada",step:flow.length}));addEvent("Guardia","Salida física registrada. Operación finalizada.");setMessage("✅ Flujo completo finalizado correctamente.")}
 function actionForCurrent(){
  if(data.step===0)return registerArrival();
  if(current?.id==="dispatch")return dispatch(data.appointmentMode==="con_cita"?"con_cita":"sin_cita");
  if(current?.id==="csr")return validateCsr();
  if(current?.id==="operacion")return finishOperation();
  if(current?.id==="documentacion")return validateDocs();
  if(current?.id==="guardia")return exit();
 }

 const minutes=Math.floor(elapsed/60),seconds=String(elapsed%60).padStart(2,"0");

 return <section id="practica" className="practice-section">
  <div className="practice-panel">
   <div className="practice-head">
    <div><p className="eyebrow">MODO PRÁCTICA · BOTONES ACTIVOS</p><h2>Simulación operativa ejecutable</h2><p>Las acciones se ejecutan inmediatamente en una operación ficticia. No modifican datos reales de Supabase.</p></div>
    <div className="practice-actions"><span className="practice-badge"><Activity size={14}/>SIMULACIÓN</span><button className="secondary-btn" onClick={reset}><RotateCcw size={15}/>Reiniciar</button></div>
   </div>

   <div className="practice-client-selector">
    <div><b>1. Selecciona cliente / flujo</b><span>Las reglas determinan si CSR y cita participan.</span></div>
    <div className="client-buttons">{Object.entries(CLIENTS).map(([k,c])=><button type="button" key={k} className={clientKey===k?"client-choice active":"client-choice"} onClick={()=>changeClient(k)}>{c.name}<small>{c.requiresAppointment===true?"Cita requerida":c.requiresAppointment==="opcional"?"Cita opcional":"Sin cita"}</small></button>)}</div>
   </div>

   <div className="practice-scenario">
    <div><span>Cliente</span><strong>{data.cliente}</strong></div><div><span>Operación</span><strong>{data.operacion.toUpperCase()}</strong></div><div><span>Unidad</span><strong>{data.tracto} / {data.caja}</strong></div><div><span>Regla cita</span><strong>{cfg.requiresAppointment===true?"REQUERIDA":cfg.requiresAppointment==="opcional"?"OPCIONAL":"NO APLICA"}</strong></div><div><span>Tiempo</span><strong>{minutes}:{seconds}</strong></div>
   </div>

   <div className="practice-progress"><div><span>Avance operativo</span><strong>{progress}%</strong></div><div className="practice-progress-bar"><span style={{width:progress+"%"}}/></div></div>

   <div className="practice-flow">{flow.map((s,i)=>{const Icon=s.icon,done=i<data.step||(data.status==="finalizada"&&i===flow.length-1),cur=i===data.step&&data.status!=="finalizada";return <div key={s.id} className={"practice-step "+(done?"done ":"")+(cur?"current":"")}><div className="practice-step-icon"><Icon size={18}/></div><div><b>{i+1}. {s.role}</b><span>{s.title}</span></div>{done&&<CheckCircle2 size={17}/>}</div>})}</div>

   <div className="practice-workspace">
    <div className="practice-card">
     <div className="practice-card-title"><div><Flag size={17}/><strong>{data.status==="finalizada"?"Operación finalizada":current?.role}</strong></div><span>{data.status==="pendiente"?"Pendiente":data.status==="finalizada"?"Completada":"Perfil activo"}</span></div>

     {data.status==="pendiente"&&<><p className="practice-copy">La práctica inicia como una unidad real. Primero entra a Caseta y se valida la placa.</p><button className="login-btn practice-main-btn" onClick={start}>Iniciar operación de práctica <ArrowRight size={17}/></button></>}

     {data.status==="en_curso"&&data.step===0&&<div className="practice-action-area">
      <div className="practice-input-card"><label>Atención de la unidad<select value={data.appointmentMode} onChange={e=>setData(d=>({...d,appointmentMode:e.target.value}))}><option value="sin_cita">Sin cita</option><option value="con_cita">Con cita</option></select></label>{data.appointmentMode==="con_cita"&&<label className="mt-2">Folio de cita<input value={data.cita} onChange={e=>setData(d=>({...d,cita:e.target.value.toUpperCase()}))} placeholder="Folio generado por CSR"/></label>}<span>{data.appointmentMode==="con_cita"?"El folio lo genera CSR y Caseta lo captura al arribo.":"La unidad puede ingresar sin cita."}</span></div>
      <div className="practice-scanner"><div className="practice-scanner-head"><div><b>Escáner de placas</b><span>Cámara móvil · validación inmediata</span></div><span className={"scan-status "+data.plateStatus}>{data.plateStatus==="coincide"?"🟢 Coincide":"⚪ Pendiente"}</span></div>{cameraOpen?<div className="camera-box"><video ref={videoRef} playsInline muted/><button type="button" className="login-btn" onClick={scanPlate}><Camera size={16}/>Capturar placa</button><button type="button" className="secondary-btn" onClick={closeCamera}>Cerrar cámara</button></div>:<button type="button" className="secondary-btn scan-open-btn" onClick={openCamera}><Camera size={17}/>Abrir escáner de cámara</button>}<div className="expected-plate">Esperada: <strong>{data.tracto}</strong></div>{cameraError&&<small className="scan-error">{cameraError}</small>}</div>
      <button className="login-btn practice-main-btn" onClick={registerArrival}><Truck size={17}/>Registrar arribo en Caseta <ArrowRight size={17}/></button>
     </div>}

     {data.status==="en_curso"&&current?.id==="dispatch"&&<div className="practice-action-area"><div className="practice-role"><div className="practice-role-icon"><ClipboardCheck size={22}/></div><div><strong>Dispatch</strong><span>Determina cita / sin cita y valida transporte.</span></div></div><div className="practice-action-grid"><button className="login-btn" onClick={()=>dispatch("con_cita")}>Confirmar cita</button><button className="secondary-btn" onClick={()=>dispatch("sin_cita")}>Registrar sin cita</button></div></div>}

     {data.status==="en_curso"&&current?.id==="csr"&&<div className="practice-action-area"><div className="practice-role"><div className="practice-role-icon"><CalendarDays size={22}/></div><div><strong>CSR</strong><span>Valida SID/RID, requisitos y datos.</span></div></div><div className="practice-data-grid"><div><small>Folio</small><b>{data.cita||"Sin cita"}</b></div><div><small>SID / RID</small><b>{data.sid} / {data.rid}</b></div><div><small>Referencia</small><b>{data.referencia}</b></div></div><button className="login-btn practice-main-btn" onClick={validateCsr}><CheckCircle2 size={17}/>Validar CSR y pasar a Operación</button></div>}

     {data.status==="en_curso"&&current?.id==="operacion"&&<div className="practice-action-area"><div className="practice-role"><div className="practice-role-icon"><Wrench size={22}/></div><div><strong>Operación</strong><span>Ejecuta rampa y proceso físico.</span></div></div><div className="practice-data-grid"><div><small>Rampa</small><b>{data.rampa}</b></div><div><small>Estado</small><b>{data.operationStarted?"En operación":data.rampAssigned?"Rampa asignada":"Pendiente"}</b></div></div><div className="practice-action-grid">{!data.rampAssigned&&<button className="login-btn" onClick={assignRamp}>Asignar {data.rampa}</button>}{data.rampAssigned&&!data.operationStarted&&<button className="login-btn" onClick={startOperation}>Iniciar operación</button>}{data.operationStarted&&!data.operationFinished&&<button className="login-btn" onClick={finishOperation}>Desentrampar / terminar</button>}</div></div>}

     {data.status==="en_curso"&&current?.id==="documentacion"&&<div className="practice-action-area"><div className="practice-role"><div className="practice-role-icon"><FileCheck2 size={22}/></div><div><strong>Documentación</strong><span>Revisa y valida el expediente.</span></div></div><div className="practice-data-grid">{["Carta porte","Cita / atención","SID / RID","Factura"].map(x=><div key={x}><small>Documento</small><b>✓ {x}</b></div>)}</div><button className="login-btn practice-main-btn" onClick={validateDocs}><CheckCircle2 size={17}/>Validar documentación</button></div>}

     {data.status==="en_curso"&&current?.id==="guardia"&&<div className="practice-action-area"><div className="practice-role"><div className="practice-role-icon"><ShieldCheck size={22}/></div><div><strong>Guardia</strong><span>Verifica sello, autoriza y registra salida física.</span></div></div><div className="practice-data-grid"><div><small>Sello</small><b>{data.sello}</b></div><div><small>Validación</small><b>{data.sealVerified?"✓ Coincide":"Pendiente"}</b></div><div><small>Salida</small><b>{data.exitAuthorized?"Autorizada":"Bloqueada"}</b></div></div><div className="practice-action-grid">{!data.sealVerified&&<button className="login-btn" onClick={verifySeal}>Verificar sello</button>}{data.sealVerified&&!data.exitAuthorized&&<button className="login-btn" onClick={authorizeExit}>Autorizar salida</button>}{data.exitAuthorized&&<button className="login-btn" onClick={exit}>Registrar salida física</button>}</div></div>}

     {message&&<div className="practice-message" aria-live="polite">{message}</div>}
    </div>

    <div className="practice-card"><div className="practice-card-title"><div><Clock3 size={17}/><strong>Bitácora de práctica</strong></div><span>{data.events.length} eventos</span></div>{data.events.length?<div className="practice-events">{data.events.slice().reverse().map((e,i)=><div key={i}><div><b>{e.role}</b><span>{e.at}</span></div><p>{e.text}</p></div>)}</div>:<div className="empty">Los eventos aparecerán al ejecutar botones.</div>}<div className="practice-rule"><ShieldCheck size={16}/><span><strong>Práctica segura:</strong> nada de aquí modifica una operación real.</span></div></div>
   </div>
  </div>
 </section>
}
