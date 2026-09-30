import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Box, CheckCircle2, Clock3, MapPin, RefreshCw, ShieldCheck, Truck, Wrench } from "lucide-react";
import { supabase } from "./lib/supabase";

const ACTIVE_STATES=["en_caseta","validando","espera_turno","rampa_asignada","en_operacion","documentacion","liberada"];
const STAGE_LABEL={en_caseta:"Caseta",validando:"Dispatch / CSR",espera_turno:"Espera turno",rampa_asignada:"Rampa asignada",en_operacion:"Operación",documentacion:"Documentación",liberada:"Lista para Guardia"};
const STAGE_ORDER=["en_caseta","validando","espera_turno","rampa_asignada","en_operacion","documentacion","liberada"];

export default function TorreControl({warehouseId,onLogout}){
  const [units,setUnits]=useState([]),[ramps,setRamps]=useState([]),[patio,setPatio]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(""),[now,setNow]=useState(Date.now()),[lastUpdate,setLastUpdate]=useState(null);
  async function load(){
    if(!warehouseId)return;
    setLoading(true);setError("");
    const [u,r,c]=await Promise.all([
      supabase.rpc("listar_unidades_monitor",{p_almacen_id:warehouseId}),
      supabase.rpc("listar_rampas_monitor",{p_almacen_id:warehouseId}),
      supabase.rpc("listar_patio_monitor",{p_almacen_id:warehouseId})
    ]);
    if(u.error)setError(u.error.message);else setUnits(u.data||[]);
    if(r.error)setError(prev=>prev||r.error.message);else setRamps(r.data||[]);
    if(c.error)setError(prev=>prev||c.error.message);else setPatio(c.data?.[0]||null);
    setLastUpdate(new Date());setLoading(false);
  }
  useEffect(()=>{
    if(!warehouseId||!supabase)return;
    load();
    const refresh=setInterval(load,5000);
    const tick=setInterval(()=>setNow(Date.now()),1000);
    let channel=null;
    const startRealtime=async()=>{
      try{
        const {data:{session}}=await supabase.auth.getSession();
        if(session?.access_token)await supabase.realtime.setAuth(session.access_token);
      }catch{}
      channel=supabase.channel("monitor-almacen-"+warehouseId)
        .on("postgres_changes",{event:"*",schema:"public",table:"unidades",filter:"almacen_id=eq."+warehouseId},()=>load())
        .on("postgres_changes",{event:"*",schema:"public",table:"rampas",filter:"almacen_id=eq."+warehouseId},()=>load())
        .on("postgres_changes",{event:"*",schema:"public",table:"accesos_caseta",filter:"almacen_id=eq."+warehouseId},()=>load())
        .subscribe();
    };
    startRealtime();
    const onVisibility=()=>{if(document.visibilityState==="visible")load()};
    window.addEventListener("focus",load);
    document.addEventListener("visibilitychange",onVisibility);
    return()=>{
      clearInterval(refresh);clearInterval(tick);
      window.removeEventListener("focus",load);
      document.removeEventListener("visibilitychange",onVisibility);
      if(channel)supabase.removeChannel(channel);
    };
  },[warehouseId]);
  const stats=useMemo(()=>({
    total:units.length,
    patio:units.filter(u=>["patio","cajon"].includes(u.ubicacion_tipo)).length,
    rampa:units.filter(u=>u.ubicacion_tipo==="rampa"||u.rampa_id).length,
    operacion:units.filter(u=>u.estado==="en_operacion").length,
    documentacion:units.filter(u=>u.estado==="documentacion").length,
    guardia:units.filter(u=>u.estado==="liberada").length
  }),[units]);
  const risk=useMemo(()=>{const out={green:0,yellow:0,orange:0,red:0};units.forEach(u=>{out[sla(u,now).level]++});return out},[units,now]);
  const bottlenecks=useMemo(()=>STAGE_ORDER.map(s=>({s,count:units.filter(u=>u.estado===s).length})).filter(x=>x.count),[units]);
  const operationalRamps=ramps.filter(r=>r.activa&&r.estado==="operativa"),occupied=new Set(units.map(u=>u.rampa_id).filter(Boolean));
  const patioCapacity=Number(patio?.capacidad_maxima||20), patioOccupancy=Number(patio?.ocupacion??stats.patio), patioPct=Math.min(100,Math.round(patioOccupancy/patioCapacity*100));
  return <section id="torre" className="users-section">
    <div className="panel torre-panel">
      <div className="panel-title"><div><Activity size={19}/><strong>Torre de Control · Las Torres</strong></div><div style={{display:"flex",gap:8}}><button className="secondary-btn" onClick={load} disabled={loading}><RefreshCw size={15}/>{loading?"Actualizando…":"Actualizar"}</button>{onLogout&&<button className="secondary-btn" onClick={onLogout}>Cerrar sesión</button>}</div></div>
      <p className="section-copy">Vista operativa del flujo completo. El tiempo global se mide desde el registro en Caseta; el tiempo de operación desde el inicio en rampa. Actualización automática en tiempo real, con respaldo de consulta cada 5 segundos.</p>
      {error&&<div className="notice error"><strong>Error de consulta</strong><span>{error}</span></div>}
      <div className="tower-kpis">
        <Kpi icon={<Truck/>} label="Unidades activas" value={stats.total}/>
        <Kpi icon={<MapPin/>} label="En patio" value={stats.patio+"/"+patioCapacity}/>
        <Kpi icon={<Wrench/>} label="En operación" value={stats.operacion}/>
        <Kpi icon={<ShieldCheck/>} label="Listas para Guardia" value={stats.guardia}/>
      </div>
      <div className="tower-grid">
        <div className="tower-card"><div className="tower-card-title"><span>Riesgo SLA global</span><small>Máximo 120 min</small></div><div className="sla-grid"><SlaBox label="0–90 min" value={risk.green} level="green"/><SlaBox label="90–105 min" value={risk.yellow} level="yellow"/><SlaBox label="105–120 min" value={risk.orange} level="orange"/><SlaBox label="Más de 120 min" value={risk.red} level="red"/></div></div>
        <div className="tower-card"><div className="tower-card-title"><span>Patio</span><small>{patioPct}% ocupado</small></div><div className="capacity-bar"><span style={{width:patioPct+"%"}}/></div><div className="capacity-meta"><strong>{patioOccupancy} / {patioCapacity}</strong><span>{patioPct>=100?"Capacidad máxima alcanzada":patioPct>=90?"Alerta 90%":patioPct>=80?"Alerta 80%":"Capacidad disponible"}</span></div></div>
      </div>
      <div className="tower-grid">
        <div className="tower-card"><div className="tower-card-title"><span>Rampas</span><small>{operationalRamps.length} operativas · {ramps.filter(r=>r.activa&&r.estado!=="operativa").length} bloqueadas</small></div><div className="ramp-mini-grid">{ramps.map(r=><div key={r.id} className={"ramp-mini "+(r.estado==="operativa"?"ready":"blocked")}><strong>{r.codigo||r.nombre}</strong><span>{r.estado==="operativa"?(occupied.has(r.id)?"Ocupada":"Libre"):"Bloqueada"}</span></div>)}</div></div>
        <div className="tower-card"><div className="tower-card-title"><span>Posibles cuellos de botella</span><small>Unidades por etapa</small></div><div className="bottleneck-list">{bottlenecks.length?bottlenecks.map(x=><div key={x.s}><span>{STAGE_LABEL[x.s]}</span><strong>{x.count}</strong></div>):<div className="empty">Sin unidades activas.</div>}</div></div>
      </div>
      <div className="tower-card units-board"><div className="tower-card-title"><span>Unidades en seguimiento</span><small>{lastUpdate?"Actualizado "+lastUpdate.toLocaleTimeString("es-MX"):"—"}</small></div>
        {units.length?<div className="tower-table-wrap"><table className="tower-table"><thead><tr><th>Unidad</th><th>Etapa</th><th>Ubicación</th><th>Rampa</th><th>Tiempo global</th><th>Operación</th><th>SLA</th></tr></thead><tbody>{units.map(u=>{const s=sla(u,now);return <tr key={u.id}><td><strong>{u.folio}</strong><span>{u.operacion_tipo||"Operación"} · {u.linea_transporte||"Sin línea"}</span></td><td><span className="stage-pill">{STAGE_LABEL[u.estado]||u.estado}</span></td><td>{u.ubicacion_tipo||"—"}</td><td>{ramps.find(r=>r.id===u.rampa_id)?.codigo||"—"}</td><td>{formatMinutes(s.globalMin)}</td><td>{u.operacion_inicio_at?formatMinutes(s.operationMin):"—"}</td><td><span className={"sla-badge "+s.level}>{s.label}</span></td></tr>})}</tbody></table></div>:<div className="empty">No hay unidades activas en seguimiento.</div>}
      </div>
    </div>
  </section>
}
function Kpi({icon,label,value}){return <div className="tower-kpi"><div>{icon}</div><span>{label}</span><strong>{value}</strong></div>}
function SlaBox({label,value,level}){return <div className={"sla-box "+level}><span>{label}</span><strong>{value}</strong></div>}
function sla(u,now){const start=new Date(u.created_at||Date.now()).getTime(),globalMin=Math.max(0,(now-start)/60000),opStart=u.operacion_inicio_at?new Date(u.operacion_inicio_at).getTime():null,opEnd=u.operacion_fin_at?new Date(u.operacion_fin_at).getTime():null,operationMin=opStart?Math.max(0,((opEnd||now)-opStart)/60000):0;let level="green",label="En tiempo";if(globalMin>120){level="red";label="> 120 min"}else if(globalMin>105){level="orange";label="105–120 min"}else if(globalMin>90){level="yellow";label="90–105 min"}return {level,label,globalMin,operationMin}}
function formatMinutes(v){const n=Math.floor(v);return n<60?n+" min":Math.floor(n/60)+"h "+String(n%60).padStart(2,"0")+"m"}
