import { useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, Camera, CheckCircle2, ClipboardCheck, Clock3, FileCheck2, Flag, RotateCcw, ShieldCheck, Truck, UserCheck, Wrench } from "lucide-react";

const STEPS=[
  {id:"caseta",role:"Caseta",title:"Ingreso y validación",icon:Truck,color:"blue",state:"en_caseta"},
  {id:"dispatch",role:"Dispatch",title:"Cita y transporte",icon:ClipboardCheck,color:"violet",state:"validando"},
  {id:"csr",role:"CSR",title:"Validación documental",icon:UserCheck,color:"cyan",state:"validando"},
  {id:"operacion",role:"Operación",title:"Rampa y proceso",icon:Wrench,color:"amber",state:"en_operacion"},
  {id:"documentacion",role:"Documentación",title:"Revisión documental",icon:FileCheck2,color:"green",state:"documentacion"},
  {id:"guardia",role:"Guardia",title:"Salida y liberación",icon:ShieldCheck,color:"emerald",state:"liberada"}
];

const INITIAL={
  status:"pendiente",
  step:0,
  folio:"PRA-260926-001",
  cliente:"WABCO",
  operacion:"RECIBO",
  linea:"Transportes del Norte",
  operador:"Carlos Hernández",
  tracto:"ABC-128-X",
  caja:"TR-4587",
  cita:"CIT-260926-014",
  referencia:"REF-WABCO-45821",
  sid:"SID-78452",
  rid:"RID-99104",
  rampa:"R07",
  sello:"MX-884321",
  documents:["Carta porte","Cita","SID/RID","Factura"],
  events:[]
};

export default function Practica(){
  const [data,setData]=useState(INITIAL);
  const [startedAt,setStartedAt]=useState(null);
  const [elapsed,setElapsed]=useState(0);
  const [message,setMessage]=useState("Listo para iniciar una operación de práctica.");
  const [citaFolio,setCitaFolio]=useState("");
  const [citaMode,setCitaMode]=useState("sin_cita");
  const [plate,setPlate]=useState("");
  const [plateStatus,setPlateStatus]=useState("pendiente");
  const [cameraOpen,setCameraOpen]=useState(false);
  const [cameraError,setCameraError]=useState("");
  const videoRef=useRef(null);
  const streamRef=useRef(null);
  const active=data.step;
  const current=STEPS[Math.min(active,STEPS.length-1)];

  useEffect(()=>{
    if(!startedAt)return;
    const id=setInterval(()=>setElapsed(Math.floor((Date.now()-startedAt)/1000)),1000);
    return()=>clearInterval(id);
  },[startedAt]);

  function addEvent(text,role){
    setData(d=>({...d,events:[...d.events,{at:new Date().toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit",second:"2-digit"}),role,text},]}));
  }

  async function openCamera(){
    setCameraError("");
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
      streamRef.current=stream;
      setCameraOpen(true);
      setTimeout(()=>{if(videoRef.current){videoRef.current.srcObject=stream;videoRef.current.play().catch(()=>{});}},0);
    }catch(e){setCameraError("No fue posible acceder a la cámara. Revisa el permiso de cámara del navegador.");}
  }
  function closeCamera(){streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;setCameraOpen(false);}
  function capturePlate(){
    const video=videoRef.current;
    if(!video || video.readyState<2){setCameraError("Espera a que la cámara esté lista.");return;}
    // En modo práctica la lectura se valida contra la placa esperada del escenario.
    setPlate(data.tracto.toUpperCase());
    setPlateStatus("coincide");
    addEvent("Placa capturada y validada: "+data.tracto.toUpperCase(),"Caseta");
    setMessage("🟢 Placa coincide con el transporte esperado. Evidencia capturada en práctica.");
    closeCamera();
  }
  function validatePlate(value){
    const v=value.trim().toUpperCase();setPlate(v);
    if(!v){setPlateStatus("pendiente");return;}
    setPlateStatus(v===data.tracto.toUpperCase()?"coincide":"no_coincide");
  }
  function start(){
    setData({...INITIAL,status:"en_curso",step:0,events:[]});
    setCitaFolio("");setCitaMode("sin_cita");setPlate("");setPlateStatus("pendiente");closeCamera();
    setStartedAt(Date.now());
    setElapsed(0);
    setMessage("Simulación iniciada. Trabaja la operación perfil por perfil.");
  }

  function action(){
    if(data.status==="pendiente"){start();return}
    if(data.step===0 && (!citaFolio.trim() || plateStatus!=="coincide")){
      setMessage("Para pasar Caseta debes ingresar el folio de cita y obtener una placa coincidente.");
      return;
    }
    if(data.status==="finalizada"){return}
    const s=STEPS[data.step];
    const actions={
      caseta:["Arribo registrado en Caseta.","Placas y operador validados contra evidencia."],
      dispatch:["Cita confirmada y transporte validado.","Unidad enviada a CSR."],
      csr:["SID/RID y requisitos validados.","Unidad liberada para asignación de rampa."],
      operacion:["Rampa R07 asignada.","Operación iniciada y desentrampe registrado."],
      documentacion:["Documentación revisada y completa.","Unidad liberada para Guardia."],
      guardia:["Sellos físicos coinciden con documentos.","Salida autorizada y unidad finalizada."]
    };
    addEvent(actions[s.id][0],s.role);
    setTimeout(()=>addEvent(actions[s.id][1],s.role),120);
    if(data.step===STEPS.length-1){
      setData(d=>({...d,status:"finalizada",step:STEPS.length}));
      setMessage("Operación de práctica finalizada correctamente.");
    }else{
      setData(d=>({...d,step:d.step+1}));
      setMessage("Transferencia realizada. El siguiente perfil toma la operación.");
    }
  }

  function reset(){setData(INITIAL);setCitaFolio("");setCitaMode("sin_cita");setPlate("");setPlateStatus("pendiente");closeCamera();setStartedAt(null);setElapsed(0);setMessage("Listo para iniciar una operación de práctica.");}

  const minutes=Math.floor(elapsed/60),seconds=String(elapsed%60).padStart(2,"0");
  const progress=data.status==="finalizada"?100:Math.round((data.step/STEPS.length)*100);

  return <section id="practica" className="practice-section">
    <div className="practice-panel">
      <div className="practice-head">
        <div><p className="eyebrow">MODO PRÁCTICA</p><h2>Simulación real de flujo operativo</h2><p>Una operación ficticia recorre todos los perfiles sin escribir ni alterar datos reales de Supabase.</p></div>
        <div className="practice-actions"><span className="practice-badge"><Activity size={14}/>SIMULACIÓN</span><button className="secondary-btn" onClick={reset}><RotateCcw size={15}/>Reiniciar</button></div>
      </div>

      <div className="practice-scenario">
        <div><span>Folio</span><strong>{data.folio}</strong></div>
        <div><span>Cliente</span><strong>{data.cliente}</strong></div>
        <div><span>Operación</span><strong>{data.operacion}</strong></div>
        <div><span>Unidad</span><strong>{data.tracto} / {data.caja}</strong></div>
        <div><span>Tiempo</span><strong>{minutes}:{seconds}</strong></div>
      </div>

      <div className="practice-progress"><div><span>Avance operativo</span><strong>{progress}%</strong></div><div className="practice-progress-bar"><span style={{width:progress+"%"}}/></div></div>

      <div className="practice-flow">
        {STEPS.map((s,i)=>{const Icon=s.icon;const done=i<data.step||(data.status==="finalizada"&&i===STEPS.length-1);const current=i===data.step&&data.status!=="finalizada";return <div key={s.id} className={"practice-step "+(done?"done ":"")+(current?"current":"")}><div className="practice-step-icon"><Icon size={18}/></div><div><b>{i+1}. {s.role}</b><span>{s.title}</span></div>{done&&<CheckCircle2 size={17}/>}</div>})}
      </div>

      <div className="practice-workspace">
        <div className="practice-card">
          <div className="practice-card-title"><div><Flag size={17}/><strong>{data.status==="finalizada"?"Operación finalizada":current.role}</strong></div><span>{data.status==="pendiente"?"Pendiente":data.status==="finalizada"?"Completada":"Perfil activo"}</span></div>
          {data.status==="pendiente"&&<p className="practice-copy">Inicia una operación ficticia para probar el recorrido completo como si cada área estuviera tomando el turno.</p>}
          {data.status!=="pendiente"&&data.status!=="finalizada"&&<><div className="practice-caseta-tools">{data.step===0&&<><div className="practice-input-card"><label>Atención de la unidad<select value={citaMode} onChange={e=>setCitaMode(e.target.value)}><option value="sin_cita">Sin cita</option><option value="con_cita">Con cita</option></select></label>{citaMode==="con_cita"&&<><input value={citaFolio} onChange={e=>setCitaFolio(e.target.value.toUpperCase())} placeholder="Ingresa el folio generado por CSR"/><div className="practice-cita-actions"><button type="button" className="secondary-btn" onClick={()=>{try{const saved=localStorage.getItem("seguimiento360_practice_cita");if(saved){const cita=JSON.parse(saved);setCitaFolio(cita.folio||"");setMessage("Folio de cita generado por CSR cargado en el simulador.");}}catch{}}}>Cargar última cita CSR</button></div></> }<span>{citaMode==="con_cita"?"El folio proviene de CSR y se captura aquí al llegar la unidad.":"La unidad puede presentarse sin cita; continúa por la ruta de excepción correspondiente."}</span></div><div className="practice-scanner"><div className="practice-scanner-head"><div><b>Escáner de placas</b><span>Cámara móvil · validación contra transporte esperado</span></div><span className={"scan-status "+plateStatus}>{plateStatus==="coincide"?"🟢 Coincide":plateStatus==="no_coincide"?"🔴 No coincide":"⚪ Pendiente"}</span></div>{cameraOpen?<div className="camera-box"><video ref={videoRef} playsInline muted/><button type="button" className="login-btn" onClick={capturePlate}><Camera size={16}/>Capturar y validar placa</button><button type="button" className="secondary-btn" onClick={closeCamera}>Cerrar cámara</button></div>:<div className="scanner-actions"><button type="button" className="secondary-btn" onClick={openCamera}><Camera size={17}/>Abrir cámara</button><label className="plate-manual">Lectura / corrección<input value={plate} onChange={e=>validatePlate(e.target.value)} placeholder="ABC-128-X"/></label></div>}{cameraError&&<small className="scan-error">{cameraError}</small>}<div className="expected-plate">Esperada: <strong>{data.tracto}</strong>{plate&&<> · Detectada: <strong>{plate}</strong></>}</div></div></>}<div className="practice-role"><div className="practice-role-icon"><current.icon size={22}/></div><div><strong>{current.role}</strong><span>{current.title}</span></div></div><div className="practice-data-grid"><div><small>Operador</small><b>{data.operador}</b></div><div><small>Línea</small><b>{data.linea}</b></div><div><small>Cita</small><b>{data.cita}</b></div><div><small>Referencia</small><b>{data.referencia}</b></div><div><small>SID / RID</small><b>{data.sid} / {data.rid}</b></div><div><small>Rampa</small><b>{data.rampa}</b></div></div></>}
          {data.status==="finalizada"&&<div className="practice-success"><CheckCircle2 size={28}/><div><strong>Flujo completo validado</strong><span>Caseta → Dispatch → CSR → Operación → Documentación → Guardia</span></div></div>}
          <div className="practice-message">{message}</div>
          <button className="login-btn practice-main-btn" onClick={action} disabled={data.status==="finalizada"}>{data.status==="pendiente"?"Iniciar simulación":data.status==="finalizada"?"Simulación terminada":"Ejecutar paso de "+current.role}<ArrowRight size={17}/></button>
        </div>

        <div className="practice-card">
          <div className="practice-card-title"><div><Clock3 size={17}/><strong>Bitácora de práctica</strong></div><span>{data.events.length} eventos</span></div>
          {data.events.length?<div className="practice-events">{data.events.slice().reverse().map((e,i)=><div key={i}><div><b>{e.role}</b><span>{e.at}</span></div><p>{e.text}</p></div>)}</div>:<div className="empty">Los eventos de cada perfil aparecerán aquí.</div>}
          <div className="practice-rule"><ShieldCheck size={16}/><span><strong>Regla de prueba:</strong> ningún evento modifica la operación real.</span></div>
        </div>
      </div>
    </div>
  </section>
}
