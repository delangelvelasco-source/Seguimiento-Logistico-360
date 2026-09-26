import { useEffect, useState } from "react";
import { CheckCircle2, FileCheck2, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { supabase } from "./lib/supabase";

export default function Documentacion({warehouseId}) {
  const [units,setUnits]=useState([]),[docs,setDocs]=useState({}),[loading,setLoading]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[query,setQuery]=useState(""),[saving,setSaving]=useState("");

  async function load(){
    if(!warehouseId)return;
    setLoading(true);setError("");
    const {data,error}=await supabase.from("unidades").select("id,folio,operador_nombre,linea_transporte,tracto_placas,estado,operacion_tipo,desentrampe_at,operacion_360_id").eq("almacen_id",warehouseId).eq("estado","documentacion").order("desentrampe_at",{ascending:false}).limit(50);
    if(error){setError(error.message);setLoading(false);return}
    setUnits(data||[]);
    if(data?.length){
      const {data:ds,error:de}=await supabase.from("documentos").select("id,unidad_id,tipo,referencia,validado,notas,validated_at").in("unidad_id",data.map(x=>x.id));
      if(de)setError(de.message);else{
        const grouped={};(ds||[]).forEach(d=>(grouped[d.unidad_id] ||= []).push(d));setDocs(grouped);
      }
    } else setDocs({});
    setLoading(false);
  }
  useEffect(()=>{load()},[warehouseId]);
  const filtered=units.filter(u=>[u.folio,u.operador_nombre,u.linea_transporte,u.tracto_placas].join(" ").toLowerCase().includes(query.toLowerCase()));

  async function validate(u){
    setSaving(u.id);setError("");setMessage("");
    const user=(await supabase.auth.getUser()).data.user,now=new Date().toISOString();
    const existing=docs[u.id]||[];
    const invalid=existing.filter(d=>!d.validado);
    if(invalid.length){setError("Hay documentos pendientes de validación para esta unidad.");setSaving("");return}
    const {error:e}=await supabase.from("unidades").update({estado:"liberada",updated_at:now}).eq("id",u.id);
    if(e){setError(e.message);setSaving("");return}
    await supabase.from("movimientos").insert({unidad_id:u.id,usuario_id:user?.id,tipo:"documentacion_validada",estado_anterior:u.estado,estado_nuevo:"liberada",notas:"Documentación validada; unidad lista para Guardia",ocurrido_at:now});
    if(u.operacion_360_id)await supabase.from("operaciones_360").update({estado_general:"documentacion_validada",updated_at:now}).eq("id",u.operacion_360_id);
    setMessage("Documentación validada. La unidad queda disponible para Guardia.");await load();setSaving("");
  }

  async function addDocument(u){
    const user=(await supabase.auth.getUser()).data.user;
    const tipo=window.prompt("Tipo de documento","Carta porte / remisión");
    if(!tipo)return;
    const referencia=window.prompt("Referencia o folio del documento",""); 
    const {error}=await supabase.from("documentos").insert({unidad_id:u.id,usuario_id:user?.id,tipo,referencia:referencia||null,validado:false});
    if(error)setError(error.message);else{setMessage("Documento agregado como pendiente de validación.");await load()}
  }

  async function toggleDoc(d){
    const {error}=await supabase.from("documentos").update({validado:!d.validado,validated_at:!d.validado?new Date().toISOString():null}).eq("id",d.id);
    if(error)setError(error.message);else await load();
  }

  return <section id="documentacion" className="users-section"><div className="panel">
    <div className="panel-title"><div><FileCheck2 size={19}/><strong>Documentación · Validación</strong></div><button className="secondary-btn" onClick={load} disabled={loading}><RefreshCw size={15}/>Actualizar</button></div>
    <p className="section-copy">Valida los documentos que acompañan la operación. No se libera una unidad con documentación pendiente.</p>
    {error&&<div className="notice error"><strong>Error</strong><span>{error}</span></div>}{message&&<div className="notice success"><CheckCircle2 size={17}/><strong>{message}</strong></div>}
    <div className="dispatch-toolbar"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar unidad, operador, línea o placa"/></div>
    {loading?<div className="empty">Cargando documentación…</div>:filtered.length?<div className="dispatch-list">{filtered.map(u=>{
      const list=docs[u.id]||[],pending=list.filter(d=>!d.validado).length;
      return <div className="dispatch-card" key={u.id}><div className="dispatch-head"><div><strong>{u.folio}</strong><span>{u.operacion_tipo||"Operación"} · Desentrampe registrado</span></div><span className="tag">{pending?"Pendiente":"Sin pendientes"}</span></div>
        <div className="dispatch-data"><span><b>Operador</b>{u.operador_nombre}</span><span><b>Línea</b>{u.linea_transporte}</span><span><b>Tracto</b>{u.tracto_placas}</span><span><b>Documentos</b>{list.length} · {pending} pendientes</span></div>
        <div className="doc-list">{list.map(d=><div className="doc-row" key={d.id}><span><b>{d.tipo}</b>{d.referencia||"Sin referencia"}</span><button className={d.validado?"state-btn active":"state-btn inactive"} onClick={()=>toggleDoc(d)}>{d.validado?<><CheckCircle2 size={14}/>Validado</>:<><ShieldAlert size={14}/>Pendiente</>}</button></div>)}</div>
        <div className="button-row"><button className="secondary-btn" onClick={()=>addDocument(u)}>Agregar documento</button><button className="login-btn compact" onClick={()=>validate(u)} disabled={saving===u.id || pending>0}>{saving===u.id?"Guardando…":"Validar y pasar a Guardia"}</button></div>
      </div>
    })}</div>:<div className="empty">No hay unidades pendientes de Documentación.</div>}
  </div></section>
}