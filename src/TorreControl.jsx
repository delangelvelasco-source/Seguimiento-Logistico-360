import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, Bell, CalendarDays, CheckCircle2, ChevronDown, Clock3, Eye, Filter, History, LayoutDashboard, LogOut, MapPin, RefreshCw, Truck, Warehouse, Wrench } from "lucide-react";
import { supabase } from "./lib/supabase";

const STAGE_LABEL={en_caseta:"Caseta",validando:"Validando",espera_turno:"En espera",rampa_asignada:"Posicionamiento",en_operacion:"Operación",documentacion:"Documentación",liberada:"Lista para Guardia"};
const STAGE_ORDER=["en_caseta","validando","espera_turno","rampa_asignada","en_operacion","documentacion","liberada"];

export default function TorreControl({warehouseId,onLogout}){
  const [units,setUnits]=useState([]),[ramps,setRamps]=useState([]),[patio,setPatio]=useState(null);
  const [loading,setLoading]=useState(false),[error,setError]=useState(""),[now,setNow]=useState(Date.now()),[lastUpdate,setLastUpdate]=useState(null),[tab,setTab]=useState("proceso"),[query,setQuery]=useState("");
  const loadSeq=useRef(0);

  async function load(){
    if(!warehouseId)return;
    const seq=++loadSeq.current;
    setLoading(true);setError("");
    const [u,r,c]=await Promise.all([
      supabase.rpc("listar_unidades_monitor",{p_almacen_id:warehouseId}),
      supabase.rpc("listar_rampas_monitor",{p_almacen_id:warehouseId}),
      supabase.rpc("listar_patio_monitor",{p_almacen_id:warehouseId})
    ]);
    if(seq!==loadSeq.current)return;
    if(u.error)setError(u.error.message);else setUnits((u.data||[]).filter(isVisibleUnit));
    if(r.error)setError(prev=>prev||r.error.message);else setRamps(r.data||[]);
    if(c.error)setError(prev=>prev||c.error.message);else setPatio(c.data?.[0]||null);
    setLastUpdate(new Date());setLoading(false);
  }

  useEffect(()=>{
    if(!warehouseId||!supabase)return;
    load();
    const refresh=setInterval(load,3000),tick=setInterval(()=>setNow(Date.now()),1000);
    let channel=null;
    const start=async()=>{
      try{const {data:{session}}=await supabase.auth.getSession();if(session?.access_token)await supabase.realtime.setAuth(session.access_token)}catch{}
      channel=supabase.channel("monitor-almacen-"+warehouseId)
        .on("postgres_changes",{event:"*",schema:"public",table:"unidades",filter:"almacen_id=eq."+warehouseId},load)
        .on("postgres_changes",{event:"*",schema:"public",table:"rampas",filter:"almacen_id=eq."+warehouseId},load)
        .on("postgres_changes",{event:"*",schema:"public",table:"accesos_caseta",filter:"almacen_id=eq."+warehouseId},load)
        .subscribe();
    };
    start();
    const vis=()=>document.visibilityState==="visible"&&load();
    window.addEventListener("focus",load);document.addEventListener("visibilitychange",vis);
    return()=>{clearInterval(refresh);clearInterval(tick);window.removeEventListener("focus",load);document.removeEventListener("visibilitychange",vis);if(channel)supabase.removeChannel(channel)};
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
  const filtered=useMemo(()=>units.filter(u=>[u.folio,u.linea_transporte,u.placas_tracto,u.placas_caja].filter(Boolean).join(" ").toLowerCase().includes(query.toLowerCase())),[units,query]);
  const risk=useMemo(()=>{const o={green:0,yellow:0,orange:0,red:0};activeUnits.forEach(u=>o[sla(u,now).level]++);return o},[units,now]);
  const upcoming=todayUnits.slice().sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).slice(0,5);
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
              <div className="warehouse-building">{Array.from({length:Math.max(ramps.length,10)},(_,i)=>{const r=ramps[i];const state=r?.estado==="operativa"?(occupied.has(r.id)?"busy":"free"):"blocked";return <div className={"dock "+state} key={r?.id||i}><b>{r?.codigo||"R"+String(i+1).padStart(2,"0")}</b><div className="dock-door"/><div className="dock-truck">{state==="blocked"?"":state==="busy"?"▰":"▱"}</div></div>})}</div>
            </div>
          </section>

          <section className="warehouse-status">
            <div className="status-head"><strong>Estado del Almacén</strong><span>Rampas totales <b>{ramps.length}</b></span></div>
            <div className="capacity-ring"><div><strong>{ramps.length?Math.round(operational.length/ramps.length*100):0}%</strong><span>Capacidad<br/>de operación</span></div><em>Operación Normal</em></div>
            <div className="status-list"><div>En uso <b>{occupied.size}</b></div><div>Disponibles <b>{Math.max(0,operational.length-occupied.size)}</b></div><div>Bloqueadas <b>{ramps.filter(r=>r.activa&&r.estado!=="operativa").length}</b></div></div>
            <div className="avg-time"><strong>Tiempo promedio</strong><div><span>◷ Espera en patio<b>18 min</b></span><span>▣ Descarga<b>42 min</b></span><span>▣ Carga<b>38 min</b></span><span>▣ Salida<b>15 min</b></span></div></div>
          </section>
        </div>

        <div className="monitor-toolbar">
          <div className="monitor-tabs">
            <button className={tab==="proceso"?"active":""} onClick={()=>setTab("proceso")}>Unidades en Proceso ({stats.operacion})</button>
            <button className={tab==="patio"?"active":""} onClick={()=>setTab("patio")}>En Patio ({stats.patio})</button>
            <button className={tab==="citas"?"active":""} onClick={()=>setTab("citas")}>Citas Próximas ({upcoming.length})</button>
            <button className={tab==="completadas"?"active":""} onClick={()=>setTab("completadas")}>Completadas ({stats.completed})</button>
            <button className={tab==="retrasadas"?"active":""} onClick={()=>setTab("retrasadas")}>Retrasadas ({stats.delayed})</button>
          </div>
          <div className="monitor-search"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar unidad, folio o transportista…"/><Filter size={17}/></div>
        </div>

        {error&&<div className="monitor-error">{error}</div>}
        <div className="monitor-lower-grid">
          <section className="units-table-card">
            <div className="table-title"><strong>{tab==="patio"?"Unidades en Patio":tab==="completadas"?"Unidades Completadas":tab==="retrasadas"?"Unidades Retrasadas":"Unidades en Proceso"}</strong><button onClick={load} disabled={loading}><RefreshCw size={15}/>{loading?"Actualizando":"Actualizar"}</button></div>
            <div className="monitor-table-wrap"><table className="monitor-table"><thead><tr><th>Folio</th><th>Tipo</th><th>Transportista</th><th>Unidad</th><th>Rampa</th><th>Estatus</th><th>Hora llegada</th><th>Tiempo</th><th>Acciones</th></tr></thead><tbody>{filtered.filter(u=>tab==="patio"?["patio","cajon"].includes(u.ubicacion_tipo):tab==="completadas"?u.estado==="liberada":tab==="retrasadas"?sla(u,now).level==="red":true).map(u=>{const s=sla(u,now);return <tr key={u.id}><td><strong>{u.folio}</strong></td><td><span className="type-pill">{u.operacion_tipo||"Recepción"}</span></td><td>{u.linea_transporte||"—"}</td><td>{u.placas_tracto||"—"} / {u.placas_caja||"—"}</td><td><span className="ramp-pill">{ramps.find(r=>r.id===u.rampa_id)?.codigo||"—"}</span></td><td><span className={"status-pill "+s.level}>{STAGE_LABEL[u.estado]||u.estado}</span></td><td>{new Date(u.created_at).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})}</td><td><b className={s.level}>{formatMinutes(s.globalMin)}</b></td><td><Eye size={17}/></td></tr>})}</tbody></table>{!filtered.length&&<div className="monitor-empty">No hay unidades para mostrar.</div>}</div>
          </section>
          <aside className="monitor-sidecards">
            <SideList title="Próximas Citas" action="Ver todas" items={upcoming.map(u=>({time:new Date(u.created_at).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"}),title:u.operacion_tipo||"Recepción",sub:u.linea_transporte||"—"}))}/>
            <SideList title="Últimos Movimientos" items={movements.map(u=>({time:new Date(u.created_at).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"}),title:STAGE_LABEL[u.estado]||"Movimiento",sub:u.folio}))}/>
          </aside>
        </div>
      </main>
    </div>
  </section>;
}

function MiniKpi({icon,label,value,note,tone}){return <div className={"mini-kpi "+tone}><div className="mini-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>}
function SideList({title,action,items}){return <div className="side-list"><div className="side-list-head"><strong>{title}</strong>{action&&<span>{action}</span>}</div>{items.map((x,i)=><div className="side-row" key={i}><b>{x.time}</b><span>{x.title}<small>{x.sub}</small></span></div>)}</div>}
function sla(u,now){const start=new Date(u.created_at||Date.now()).getTime(),min=Math.max(0,(now-start)/60000);let level="green";if(min>120)level="red";else if(min>105)level="orange";else if(min>90)level="yellow";return {level,globalMin:min}}
function formatMinutes(v){const n=Math.floor(v);return n<60?n+" min":Math.floor(n/60)+" h "+String(n%60).padStart(2,"0")+" min"}

function isToday(value){if(!value)return false;return dateKey(value)===dateKey(Date.now())}
function dateKey(value){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Monterrey",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value))}
// El monitor operativo trabaja por jornada: al cambiar el día se ocultan
// todas las unidades de jornadas anteriores, sin borrar sus registros.
function isVisibleUnit(u){return isToday(u.created_at)}
