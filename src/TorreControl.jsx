import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, Bell, CalendarDays, CheckCircle2, ChevronDown, Clock3, Eye, Filter, History, LayoutDashboard, LogOut, MapPin, RefreshCw, Truck, Warehouse, Wrench } from "lucide-react";
import { supabase } from "./lib/supabase";

const STAGE_LABEL={en_caseta:"Caseta",validando:"Validando",espera_turno:"En espera",rampa_asignada:"Posicionamiento",en_operacion:"Operación",documentacion:"Documentación",liberada:"Lista para Guardia"};
const STAGE_ORDER=["en_caseta","validando","espera_turno","rampa_asignada","en_operacion","documentacion","liberada"];

export default function TorreControl({warehouseId,onLogout}){
  const [units,setUnits]=useState([]),[ramps,setRamps]=useState([]),[patio,setPatio]=useState(null),[citas,setCitas]=useState([]),[alertasCita,setAlertasCita]=useState([]);
  const [loading,setLoading]=useState(false),[error,setError]=useState(""),[now,setNow]=useState(Date.now()),[lastUpdate,setLastUpdate]=useState(null),[tab,setTab]=useState("proceso"),[query,setQuery]=useState("");
  const loadSeq=useRef(0);

  async function load(){
    if(!warehouseId)return;
    const seq=++loadSeq.current;
    setLoading(true);setError("");
    const [u,r,c,p,a]=await Promise.all([
      supabase.rpc("listar_unidades_monitor",{p_almacen_id:warehouseId}),
      supabase.rpc("listar_rampas_monitor",{p_almacen_id:warehouseId}),
      supabase.rpc("listar_patio_monitor",{p_almacen_id:warehouseId}),
      supabase.from("citas").select("id,folio,tipo_operacion,fecha,hora_inicio,hora_fin,estado,pallets,cita_datos_precarga(linea_transporte,operador_nombre,tracto_numero,tracto_placas,caja_numero,caja_placas)").eq("almacen_id",warehouseId).eq("fecha",new Intl.DateTimeFormat("en-CA",{timeZone:"America/Monterrey",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())).not("estado","in","(cancelada,cerrada)").order("hora_inicio",{ascending:true}),
      supabase.rpc("listar_alertas_citas_monitor",{p_almacen_id:warehouseId})
    ]);
    if(seq!==loadSeq.current)return;
    if(u.error)setError(u.error.message);else setUnits((u.data||[]).filter(isVisibleUnit));
    if(r.error)setError(prev=>prev||r.error.message);else setRamps(r.data||[]);
    if(c.error)setError(prev=>prev||c.error.message);else setPatio(c.data?.[0]||null);
    if(p.error)setError(prev=>prev||p.error.message);else setCitas((p.data||[]).map(x=>({...x,precarga:Array.isArray(x.cita_datos_precarga)?(x.cita_datos_precarga[0]||null):(x.cita_datos_precarga||null)})));
    if(a.error)setError(prev=>prev||a.error.message);else setAlertasCita(a.data||[]);
    setLastUpdate(new Date());setLoading(false);
  }

  useEffect(()=>{
    if(!warehouseId||!supabase)return;
    load();
    const refresh=setInterval(load,3000),tick=setInterval(()=>setNow(Date.now()),1000);
    const alertRefresh=setInterval(async()=>{
      try{
        const {data}=await supabase.rpc("listar_alertas_citas_monitor",{p_almacen_id:warehouseId});
        if(Array.isArray(data))setAlertasCita(data);
      }catch{}
    },1000);
    let channel=null;
    const start=async()=>{
      try{const {data:{session}}=await supabase.auth.getSession();if(session?.access_token)await supabase.realtime.setAuth(session.access_token)}catch{}
      channel=supabase.channel("monitor-almacen-"+warehouseId)
        .on("postgres_changes",{event:"*",schema:"public",table:"unidades",filter:"almacen_id=eq."+warehouseId},load)
        .on("postgres_changes",{event:"*",schema:"public",table:"rampas",filter:"almacen_id=eq."+warehouseId},load)
        .on("postgres_changes",{event:"*",schema:"public",table:"accesos_caseta",filter:"almacen_id=eq."+warehouseId},load)
        .on("postgres_changes",{event:"*",schema:"public",table:"citas",filter:"almacen_id=eq."+warehouseId},load)
        .on("postgres_changes",{event:"*",schema:"public",table:"operaciones_360",filter:"almacen_id=eq."+warehouseId},load)
        .subscribe();
    };
    start();
    const vis=()=>document.visibilityState==="visible"&&load();
    window.addEventListener("focus",load);document.addEventListener("visibilitychange",vis);
    return()=>{clearInterval(refresh);clearInterval(tick);clearInterval(alertRefresh);window.removeEventListener("focus",load);document.removeEventListener("visibilitychange",vis);if(channel)supabase.removeChannel(channel)};
  },[warehouseId]);

  const todayUnits=useMemo(()=>units.filter(u=>isToday(u.created_at)),[units]);
  const activeUnits=useMemo(()=>units.filter(u=>!u.salida_caseta_at),[units]);
  const stats=useMemo(()=>({
    total:todayUnits.length,
    patio:activeUnits.filter(u=>["patio","cajon"].includes(u.ubicacion_tipo)).length,
    operacion:activeUnits.filter(u=>u.estado==="en_operacion").length,
    completed:todayUnits.filter(u=>u.estado==="liberada").length,
    delayed:activeUnits.filter(u=>sla(u,now).level==="red").length
  }),[todayUnits,activeUnits,now]);

  const capacity=Number(patio?.capacidad_maxima||20),occupancy=Number(patio?.ocupacion??stats.patio),pct=Math.min(100,Math.round(occupancy/capacity*100));
  const operational=ramps.filter(r=>r.activa&&r.estado==="operativa"),occupied=new Set(units.map(u=>u.rampa_id).filter(Boolean));
  const filtered=useMemo(()=>units.filter(u=>[u.folio,u.linea_transporte,u.tracto_placas,u.caja_placas].filter(Boolean).join(" ").toLowerCase().includes(query.toLowerCase())),[units,query]);
  const risk=useMemo(()=>{const o={green:0,yellow:0,orange:0,red:0};activeUnits.forEach(u=>o[sla(u,now).level]++);return o},[units,now]);
  const upcoming=useMemo(()=>{
    return citas
      .sort((a,b)=>String(a.hora_inicio||"").localeCompare(String(b.hora_inicio||"")))
      .slice(0,8);
  },[citas,now]);

  const citaStatus=(c)=>{
    const inicio=String(c?.hora_inicio||"").slice(0,5);
    if(!inicio)return {late:false,minutes:0,label:""};
    const [h,m]=inicio.split(":").map(Number);
    const parts=new Intl.DateTimeFormat("en-US",{
      timeZone:"America/Monterrey",hour:"2-digit",minute:"2-digit",hour12:false
    }).formatToParts(new Date(now));
    const nh=Number(parts.find(x=>x.type==="hour")?.value||0);
    const nm=Number(parts.find(x=>x.type==="minute")?.value||0);
    const minutes=Math.max(0,(nh*60+nm)-(h*60+m));
    return minutes>0
      ? {late:true,minutes,label:"Retraso +"+minutes+" min"}
      : {late:false,minutes:0,label:"A tiempo"};
  };

  const citasRetrasadas=useMemo(
    ()=>upcoming.filter(c=>citaStatus(c).late),
    [upcoming,now]
  );
  const movements=units.filter(isVisibleUnit).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,5);

  return <section id="torre" className="monitor-dashboard">
    <header className="monitor-header">
      <div className="monitor-brand"><div className="monitor-logo">360</div><div><strong>Seguimiento Logístico 360°</strong><span>TORRE DE CONTROL</span></div></div>
      <div className="monitor-live"><i/> Actualización en tiempo real <small>{lastUpdate?"· "+lastUpdate.toLocaleTimeString("es-MX"):""}</small></div>
      <div className="monitor-header-right"><div className="monitor-time">{new Date(now).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})}<small>{new Date(now).toLocaleDateString("es-MX",{weekday:"short",day:"2-digit",month:"short",year:"numeric"})}</small></div><Bell size={22}/><div className="monitor-user"><div className="monitor-avatar">M</div><div><strong>Monitor MTYII</strong><span>Las Torres</span></div><ChevronDown size={17}/></div>{onLogout&&<button className="monitor-logout" onClick={onLogout} title="Cerrar sesión"><LogOut size={16}/><span>Cerrar sesión</span></button>}</div>
    </header>

    <div className="monitor-body">
      <aside className="monitor-sidebar">
        <nav>
          <button className="monitor-nav active"><LayoutDashboard/>Vista General</button>
          <button className="monitor-nav" onClick={()=>setTab("movimientos")}><History/>Movimientos</button>
          <button className="monitor-nav" onClick={()=>setTab("citas")}><CalendarDays/>Citas del Día</button>
          <button className="monitor-nav" onClick={()=>setTab("patio")}><Truck/>Unidades en Patio</button>
          <button className="monitor-nav" onClick={()=>setTab("historial")}><History/>Historial</button>
          <button className="monitor-nav" onClick={()=>setTab("reportes")}><Warehouse/>Reportes</button>
        </nav>
        <div className="monitor-sidebar-footer"><span>Almacén</span><strong>Las Torres</strong><small>MTY II | Escobedo, N.L.</small><button onClick={onLogout}><LogOut size={15}/>Cerrar sesión</button></div>
      </aside>

      <main className="monitor-content">
        <div className="monitor-kpis">
          <MiniKpi icon={<Truck/>} label="Total Unidades Hoy" value={stats.total} note="↑ 12%" tone="blue"/>
          <MiniKpi icon={<Clock3/>} label="En Patio" value={stats.patio} note={stats.patio?"En espera":"Libre"} tone="green"/>
          <MiniKpi icon={<Truck/>} label="En Operación" value={stats.operacion} note="Cargando / Descargando" tone="blue"/>
          <MiniKpi icon={<CheckCircle2/>} label="Completadas" value={stats.completed} note="Hoy" tone="green"/>
          <MiniKpi icon={<AlertTriangle/>} label="Retrasadas" value={stats.delayed} note="> 30 min" tone="red"/>
        </div>

        <div className="monitor-main-grid">
          <section className="ramps-hero">
            <div className="ramps-title"><strong>Rampas MTY-II · Las Torres</strong><div><span className="legend green"/>Disponible <span className="legend blue"/>En uso <span className="legend gray"/>Bloqueada</div></div>
            <div className="warehouse-visual">
              <div className="warehouse-sky"><span>LAS TORRES · MTY II</span></div>
              <div className="warehouse-building">{Array.from({length:Math.max(ramps.length,19)},(_,i)=>{const r=ramps[i];const state=r?.estado==="operativa"?(occupied.has(r.id)?"busy":"free"):"blocked";return <div className={"dock "+state} key={r?.id||"visual-"+i}><b>{String(i+1).padStart(2,"0")}</b><div className="dock-door"/><div className="dock-truck">{state==="blocked"?"":state==="busy"?"▰":"▱"}</div></div>})}</div>
            </div>
          </section>

          <section className="warehouse-status">
            <div className="status-head"><strong>Estado del Almacén</strong><span>Rampas totales <b>{ramps.length}</b></span></div>
            <div className="capacity-summary">
              <div className="capacity-ring"><div style={{background:`radial-gradient(circle,#0d1926 56%,transparent 57%),conic-gradient(#28d889 0 ${ramps.length?Math.round(operational.length/ramps.length*100):0}%,#1e2b3c ${ramps.length?Math.round(operational.length/ramps.length*100):0}% 100%)`}}><strong>{ramps.length?Math.round(operational.length/ramps.length*100):0}%</strong><span>Capacidad<br/>operativa</span></div></div>
              <div className="capacity-side"><em>Operación Normal</em><span>Capacidad disponible</span><b>{Math.max(0,operational.length-occupied.size)} rampas libres</b></div>
            </div>
            <div className="status-list"><div><span>En uso</span><b>{occupied.size}</b></div><div><span>Disponibles</span><b>{Math.max(0,operational.length-occupied.size)}</b></div><div><span>Bloqueadas</span><b>{ramps.filter(r=>r.activa&&r.estado!=="operativa").length}</b></div></div>
            <div className="avg-time"><strong>Tiempo promedio</strong><div><span>◷ Espera en patio<b>0 min</b></span><span>▣ Descarga<b>0 min</b></span><span>▣ Carga<b>0 min</b></span><span>▣ Salida<b>0 min</b></span></div></div>
          </section>
        </div>

        {alertasCita.length>0&&<div className="monitor-arrival-alert monitor-arrival-alert-top" role="alert">
          <div className="monitor-arrival-alert-icon"><AlertTriangle size={24}/></div>
          <div className="monitor-arrival-alert-body">
            <strong>🚨 ARRIBO FUERA DE CITA</strong>
            <span>{alertasCita.length===1?"Unidad detectada fuera de su cita programada.":alertasCita.length+" unidades detectadas fuera de cita."}</span>
            <div className="monitor-arrival-alert-items">{alertasCita.slice(0,4).map(a=><b key={a.unidad_id}>{a.folio} · {a.tipo_alerta==="sin_cita"?"SIN CITA":"FUERA DE CITA "+(a.minutos_diferencia>0?"+":"")+a.minutos_diferencia+" MIN"}</b>)}</div>
          </div>
        </div>}

        <div className="monitor-toolbar">
          <div className="monitor-tabs">
            <button className={tab==="proceso"?"active":""} onClick={()=>setTab("proceso")}>Unidades en Proceso ({stats.operacion})</button>
            <button className={tab==="patio"?"active":""} onClick={()=>setTab("patio")}>En Patio ({stats.patio})</button>
            <button className={tab==="citas"?"active":""} onClick={()=>setTab("citas")}>Citas Próximas ({upcoming.length})</button>
            <button className={tab==="completadas"?"active":""} onClick={()=>setTab("completadas")}>Completadas ({stats.completed})</button>
            <button className={tab==="retrasadas"?"active":""} onClick={()=>setTab("retrasadas")}>Retrasadas ({stats.delayed+citasRetrasadas.length})</button>
          </div>
          <div className="monitor-search"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar unidad, folio o transportista…"/><Filter size={17}/></div>
        </div>

        {error&&<div className="monitor-error">{error}</div>}        {alertasCita.length>0&&<div className="monitor-arrival-alert" role="alert">
          <div className="monitor-arrival-alert-icon"><AlertTriangle size={24}/></div>
          <div className="monitor-arrival-alert-body">
            <strong>🚨 ALERTA DE ARRIBO FUERA DE CITA</strong>
            <span>{alertasCita.length===1?"Una unidad llegó fuera de su cita o sin cita programada.":alertasCita.length+" unidades llegaron fuera de cita o sin cita programada."}</span>
            <div className="monitor-arrival-alert-items">{alertasCita.slice(0,4).map(a=><b key={a.unidad_id}>{a.folio} · {a.tipo_alerta==="sin_cita"?"SIN CITA":"FUERA DE CITA "+(a.minutos_diferencia>0?"+":"")+a.minutos_diferencia+" MIN"} · {a.linea_transporte||"—"}</b>)}</div>
          </div>
        </div>}

        {citasRetrasadas.length>0&&<div className="monitor-appointment-alert" role="alert">
          <div className="monitor-appointment-alert-icon"><AlertTriangle size={22}/></div>
          <div><strong>ALERTA DE RETRASO</strong><span>{citasRetrasadas.length===1?"Hay 1 cita que ya superó su hora programada.":"Hay "+citasRetrasadas.length+" citas que ya superaron su hora programada."}</span></div>
          <div className="monitor-appointment-alert-list">{citasRetrasadas.slice(0,3).map(c=>{const s=citaStatus(c);return <b key={c.id}>{c.folio} · {String(c.hora_inicio||"").slice(0,5)} · +{s.minutes} min</b>})}</div>
        </div>}

        <div className="monitor-lower-grid">
          <section className="units-table-card">
            <div className="table-title"><strong>{tab==="patio"?"Unidades en Patio":tab==="completadas"?"Unidades Completadas":tab==="retrasadas"?"Unidades Retrasadas":"Unidades en Proceso"}</strong><button onClick={load} disabled={loading}><RefreshCw size={15}/>{loading?"Actualizando":"Actualizar"}</button></div>
            <div className="monitor-table-wrap"><table className="monitor-table"><thead><tr><th>Hora llegada</th><th>Transportista</th><th>Unidad</th><th>Operación</th><th>Pallets</th><th>Rampa</th><th>Estatus</th><th>Tiempo</th><th>Acciones</th></tr></thead><tbody>{filtered.filter(u=>tab==="patio"?["patio","cajon"].includes(u.ubicacion_tipo):tab==="completadas"?u.estado==="liberada":tab==="retrasadas"?sla(u,now).level==="red":true).map(u=>{const s=sla(u,now);return <tr key={u.id}><td>{new Date(u.created_at).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})}</td><td>{u.linea_transporte||"—"}</td><td>{u.tracto_placas||"—"} / {u.caja_placas||"—"}</td><td><span className="type-pill">{u.operacion_tipo||"Recepción"}</span></td><td><strong>{u.pallets ?? "—"}</strong></td><td><span className="ramp-pill">{ramps.find(r=>r.id===u.rampa_id)?.codigo||"—"}</span></td><td><span className={"status-pill "+s.level}>{STAGE_LABEL[u.estado]||u.estado}</span></td><td><b className={s.level}>{formatMinutes(s.globalMin)}</b></td><td><Eye size={17}/></td></tr>})}</tbody></table>{!filtered.length&&<div className="monitor-empty">No hay unidades para mostrar.</div>}</div>
          </section>
          <aside className="monitor-sidecards">
            <SideList title="Próximas Citas" action="Ver todas" items={upcoming.map(c=>{
              const s=citaStatus(c);
              return {
                time:String(c.hora_inicio||"").slice(0,5),
                title:(c.tipo_operacion==="embarque"?"Embarque":"Recibo")+(s.late?" · "+s.label:""),
                sub:(c.precarga?.linea_transporte||"Línea pendiente")+" · "+c.folio,
                late:s.late,
                delay:s.minutes
              };
            })}/>
            <SideList title="Últimos Movimientos" items={movements.map(u=>({time:new Date(u.created_at).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"}),title:STAGE_LABEL[u.estado]||"Movimiento",sub:u.folio}))}/>
          </aside>
        </div>
      </main>
    </div>
  </section>;
}

function MiniKpi({icon,label,value,note,tone}){return <div className={"mini-kpi "+tone}><div className="mini-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>}
function SideList({title,action,items}){return <div className="side-list"><div className="side-list-head"><strong>{title}</strong>{action&&<span>{action}</span>}</div>{items.map((x,i)=><div className={"side-row "+(x.late?"late":"")} key={i}><b>{x.time}</b><span>{x.title}{x.late&&<em className="appointment-delay">RETRASO +{x.delay} MIN</em>}<small>{x.sub}</small></span></div>)}</div>}
function sla(u,now){const start=new Date(u.created_at||Date.now()).getTime(),min=Math.max(0,(now-start)/60000);let level="green";if(min>120)level="red";else if(min>105)level="orange";else if(min>90)level="yellow";return {level,globalMin:min}}
function formatMinutes(v){const n=Math.floor(v);return n<60?n+" min":Math.floor(n/60)+" h "+String(n%60).padStart(2,"0")+" min"}

function isToday(value){if(!value)return false;return dateKey(value)===dateKey(Date.now())}
function dateKey(value){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Monterrey",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value))}
// El monitor operativo trabaja por jornada: al cambiar el día se ocultan
// todas las unidades de jornadas anteriores, sin borrar sus registros.
function isVisibleUnit(u){return isToday(u.created_at)}
