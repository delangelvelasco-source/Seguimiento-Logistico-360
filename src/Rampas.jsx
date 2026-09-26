import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, Wrench, CheckCircle2, Ban } from "lucide-react";
import { supabase } from "./lib/supabase";

const ESTADOS = [
  ["operativa","Operativa"],
  ["fuera_servicio","Fuera de servicio"],
  ["mantenimiento","Mantenimiento"],
  ["no_disponible","No disponible"],
];

export default function Rampas({ warehouseId, canEdit }) {
  const [rampas,setRampas]=useState([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState("");
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");

  async function load(){
    if(!warehouseId)return;
    setLoading(true);setError("");
    const {data,error}=await supabase.from("rampas").select("id,codigo,nombre,activa,estado,motivo,updated_at").eq("almacen_id",warehouseId).order("codigo");
    if(error)setError(error.message); else setRampas(data||[]);
    setLoading(false);
  }
  useEffect(()=>{load()},[warehouseId]);
  const operativas=useMemo(()=>rampas.filter(r=>r.estado==="operativa"&&r.activa).length,[rampas]);

  async function save(r){
    setSaving(r.id);setError("");setMessage("");
    const user=(await supabase.auth.getUser()).data.user;
    const {data,error}=await supabase.from("rampas").update({estado:r.estado,activa:r.estado==="operativa",motivo:r.motivo||null,updated_at:new Date().toISOString(),updated_by:user?.id||null}).eq("id",r.id).select("id,codigo,nombre,activa,estado,motivo,updated_at").single();
    if(error)setError(error.message); else { setRampas(prev=>prev.map(x=>x.id===r.id?data:x)); setMessage(r.nombre+" actualizada."); }
    setSaving("");
  }

  return <section id="rampas" className="users-section">
    <div className="panel">
      <div className="panel-title"><div><Wrench size={19}/><strong>Administración de rampas · Las Torres</strong></div><button className="secondary-btn" onClick={load} disabled={loading}><RefreshCw size={15}/>Actualizar</button></div>
      <p className="section-copy">Las 19 rampas están registradas individualmente. Solo las marcadas como <strong>Operativa</strong> quedan disponibles para asignación.</p>
      <div className="ramp-summary"><div><span>Total</span><strong>{rampas.length}</strong></div><div><span>Operativas</span><strong>{operativas}</strong></div><div><span>No disponibles</span><strong>{rampas.length-operativas}</strong></div></div>
      {error&&<div className="notice error"><strong>Error</strong><span>{error}</span></div>}
      {message&&<div className="notice success"><strong>{message}</strong></div>}
      {loading?<div className="empty">Cargando rampas…</div>:<div className="ramp-grid">{rampas.map(r=><div className="ramp-card" key={r.id}>
        <div className="ramp-head"><div><strong>{r.nombre}</strong><span>{r.codigo}</span></div>{r.estado==="operativa"?<CheckCircle2 size={20}/>:r.estado==="mantenimiento"?<Wrench size={20}/>:<Ban size={20}/>}</div>
        <label>Estado<select value={r.estado} disabled={!canEdit||saving===r.id} onChange={e=>setRampas(prev=>prev.map(x=>x.id===r.id?{...x,estado:e.target.value}:x))}>{ESTADOS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label>Motivo / observación<input value={r.motivo||""} disabled={!canEdit||saving===r.id} onChange={e=>setRampas(prev=>prev.map(x=>x.id===r.id?{...x,motivo:e.target.value}:x))} placeholder="Ej. mantenimiento, daño, cierre…"/></label>
        {canEdit&&<button className="save-btn ramp-save" disabled={saving===r.id} onClick={()=>save(r)}><Save size={14}/>{saving===r.id?"Guardando…":"Guardar"}</button>}
      </div>)}</div>}
    </div>
  </section>
}
