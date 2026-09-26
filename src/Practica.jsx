import { useEffect, useState } from "react";
import { Activity, ArrowRight, CheckCircle2, ClipboardCheck, Clock3, FileCheck2, Flag, RotateCcw, ShieldCheck, Truck, UserCheck, Wrench } from "lucide-react";

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

  function start(){
    setData({...INITIAL,status:"en_curso",step:0,events:[]});
    setStartedAt(Date.now());
    setElapsed(0);
    setMessage("Simulación iniciada. Trabaja la operación perfil por perfil.");
  }

  function action(){
    if(data.status==="pendiente"){start();return}
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

  function reset(){setData(INITIAL);setStartedAt(null);setElapsed(0);setMessage("Listo para iniciar una operación de práctica.");}

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
          {data.status!=="pendiente"&&data.status!=="finalizada"&&<><div className="practice-role"><div className="practice-role-icon"><current.icon size={22}/></div><div><strong>{current.role}</strong><span>{current.title}</span></div></div><div className="practice-data-grid"><div><small>Operador</small><b>{data.operador}</b></div><div><small>Línea</small><b>{data.linea}</b></div><div><small>Cita</small><b>{data.cita}</b></div><div><small>Referencia</small><b>{data.referencia}</b></div><div><small>SID / RID</small><b>{data.sid} / {data.rid}</b></div><div><small>Rampa</small><b>{data.rampa}</b></div></div></>}
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
