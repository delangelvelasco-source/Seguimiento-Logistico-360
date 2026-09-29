import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, ClipboardCheck, LogIn, RefreshCw, Truck, User, Building2, IdCard, ClipboardList, Clock, BarChart3 } from "lucide-react";
import { supabase } from "./lib/supabase";
import { createWorker } from "tesseract.js";

export default function Caseta({ warehouseId }) {
  const [form,setForm]=useState({operador_nombre:"",linea_transporte:"",tracto_placas:"",caja_placas:"",folio_cita:"",operacion_tipo:"recibo",referencia:""});
  const [loading,setLoading]=useState(false), [error,setError]=useState(""), [message,setMessage]=useState("");
  const [recent,setRecent]=useState([]);
  const [scannerOpen,setScannerOpen]=useState(false);
  const [scannerError,setScannerError]=useState("");
  const videoRef=useRef(null);
  const streamRef=useRef(null);
  const cameraInputRef=useRef(null);
  const idInputRef=useRef(null);
  const [capturedPhoto,setCapturedPhoto]=useState("");
  const [capturedId,setCapturedId]=useState("");
  const [ocrLoading,setOcrLoading]=useState(false);
  const [refreshLoading,setRefreshLoading]=useState(false);
  const [ocrText,setOcrText]=useState("");

  async function load(showMessage=false){
    if(!warehouseId){
      if(showMessage)setMessage("No hay un almacén activo seleccionado.");
      return;
    }
    if(showMessage)setRefreshLoading(true);
    const {data,error}=await supabase.from("unidades").select("id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,estado,ubicacion_tipo,created_at").eq("almacen_id",warehouseId).order("created_at",{ascending:false}).limit(12);
    if(error){
      if(showMessage)setMessage("No se pudo actualizar la lista de ingresos: "+error.message);
    }else{
      setRecent(data||[]);
      if(showMessage)setMessage("Ingresos actualizados correctamente.");
    }
    if(showMessage)setRefreshLoading(false);
  }
  useEffect(()=>{if(warehouseId)load()},[warehouseId]);

  function abrirScanner(){ cameraInputRef.current?.click(); }
  function abrirCamaraId(){ idInputRef.current?.click(); }

  async function ocrImagen(file, tipo){
    const reader=new FileReader();
    return await new Promise((resolve,reject)=>{
      reader.onload=async()=>{
        const image=String(reader.result||"");
        try{
          const img=await new Promise((ok,bad)=>{
            const el=new Image();
            el.onload=()=>ok(el);
            el.onerror=()=>bad(new Error("No se pudo preparar la imagen."));
            el.src=image;
          });
          const width=img.naturalWidth||img.width;
          const height=img.naturalHeight||img.height;
          const scale=Math.min(3,Math.max(1,2400/Math.max(width,1)));
          const base=document.createElement("canvas");
          base.width=Math.round(width*scale);
          base.height=Math.round(height*scale);
          const bctx=base.getContext("2d");
          if(!bctx)throw new Error("No se pudo preparar el OCR.");
          bctx.imageSmoothingEnabled=true;
          bctx.imageSmoothingQuality="high";
          bctx.drawImage(img,0,0,base.width,base.height);

          const canvases=[base];
          if(tipo==="id"){
            const right=document.createElement("canvas");
            right.width=Math.round(base.width*.58);
            right.height=base.height;
            right.getContext("2d").drawImage(base,Math.round(base.width*.42),0,right.width,right.height,0,0,right.width,right.height);
            canvases.push(right);
            const upper=document.createElement("canvas");
            upper.width=right.width;
            upper.height=Math.round(right.height*.72);
            upper.getContext("2d").drawImage(right,0,0,right.width,upper.height,0,0,right.width,upper.height);
            canvases.push(upper);
          }else{
            const center=document.createElement("canvas");
            center.width=Math.round(base.width*.72);
            center.height=Math.round(base.height*.45);
            center.getContext("2d").drawImage(base,Math.round(base.width*.14),Math.round(base.height*.25),center.width,center.height,0,0,center.width,center.height);
            canvases.push(center);
          }

          const worker=await createWorker("spa");
          const passes=[];
          try{
            for(const canvas of canvases){
              for(const mode of ["6","11"]){
                await worker.setParameters({tessedit_pageseg_mode:mode,preserve_interword_spaces:"1",user_defined_dpi:"300"});
                const result=await worker.recognize(canvas);
                passes.push({text:result?.data?.text||"",confidence:Number(result?.data?.confidence||0)});
              }
            }
          }finally{
            await worker.terminate();
          }
          resolve({image,passes});
        }catch(err){reject(err);}
      };
      reader.onerror=()=>reject(new Error("No se pudo leer la imagen."));
      reader.readAsDataURL(file);
    });
  }

  function limpiarOCR(value=""){
    return value.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9\\s-]/g," ").replace(/\\s+/g," ").trim();
  }

  function extraerNombre(text){
    const lines=text.split(/\\r?\\n+/).map(l=>limpiarOCR(l)).filter(Boolean);
    const stop=/^(DOMICILIO|CLAVE DE ELECTOR|CURP|FECHA DE NACIMIENTO|SECCIÓN|VIGENCIA|AÑO DE REGISTRO|SEXO)\\b/i;
    const label=/^(NOMBRE(?:S)?|NOMBRE\\(S\\)|APELLIDO(?: PATERNO| MATERNO|S)?|PATERNO|MATERNO)\\b[:.\\-]?\\s*(.*)$/i;
    const bad=/^(NOMBRE|NOMBRES|APELLIDO|APELLIDOS|PATERNO|MATERNO)$/i;
    const word=/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ-]{2,22}$/;
    const candidatos=[];
    for(let i=0;i<lines.length;i++){
      const m=lines[i].match(label);
      if(!m)continue;
      const parts=[];
      const inline=limpiarOCR(m[2]||"");
      if(inline&&!bad.test(inline)&&inline.split(/\\s+/).length>=2)parts.push(...inline.split(/\\s+/));
      for(let j=1;j<=5;j++){
        const next=limpiarOCR(lines[i+j]||"");
        if(!next||stop.test(next))break;
        const words=next.split(/\\s+/).filter(Boolean);
        if(words.length>3||words.some(w=>!word.test(w)))break;
        parts.push(...words);
      }
      if(parts.length>=2&&parts.length<=6)candidatos.push(parts.join(" "));
    }
    return [...new Set(candidatos.map(x=>x.toUpperCase()))].sort((a,b)=>{
      const aw=a.split(" ").length,bw=b.split(" ").length;
      return bw-aw||b.length-a.length;
    })[0]||"";
  }
  function extraerPlaca(text){
    const lines=text.split(/\\r?\\n+/).map(l=>limpiarOCR(l).toUpperCase()).filter(Boolean);
    const candidates=[];
    for(const line of lines){
      const compact=line.replace(/[^A-Z0-9]/g,"");
      if(compact.length>=5&&compact.length<=8)candidates.push(compact);
      const groups=line.match(/[A-Z0-9]{2,4}(?:[- ]?[A-Z0-9]{2,4})/g)||[];
      for(const g of groups){
        const v=g.replace(/[^A-Z0-9]/g,"");
        if(v.length>=5&&v.length<=8)candidates.push(v);
      }
    }
    const unique=[...new Set(candidates)];
    const filtered=unique.filter(v=>!/^\\d{6,8}$/.test(v)&&!/(MEX|INE|CURP|VIGENCIA|NACIMIENTO|REGISTRO)/.test(v));
    return filtered.sort((a,b)=>b.length-a.length)[0]||"";
  }

  function recibirFotoId(e){
    const file=e.target.files?.[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{
      setCapturedId(String(reader.result||""));
      setOcrText("");
      setMessage("Identificación capturada como evidencia. Captura el nombre del operador manualmente.");
    };
    reader.readAsDataURL(file);
    e.target.value="";
  }

  function recibirFoto(e){
    const file=e.target.files?.[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>setCapturedPhoto(String(reader.result||""));
    reader.readAsDataURL(file);
    setMessage("Foto de placa capturada como evidencia. Captura la placa manualmente.");
    e.target.value="";
  }

  async function registrar(e){
    e.preventDefault();setLoading(true);setError("");setMessage("");
    const user=(await supabase.auth.getUser()).data.user;
    const folio=form.folio_cita.trim() || "CAS-"+Date.now().toString().slice(-8);
    const {data:unit,error:unitError}=await supabase.from("unidades").insert({
      folio,operador_nombre:form.operador_nombre.trim(),linea_transporte:form.linea_transporte.trim(),tracto_placas:form.tracto_placas.trim().toUpperCase(),caja_placas:form.caja_placas.trim().toUpperCase()||null,estado:"en_caseta",almacen_id:warehouseId,caseta_usuario_id:user?.id||null,operacion_tipo:form.operacion_tipo,ubicacion_tipo:"caseta"
    }).select("id").single();
    if(unitError){setError(unitError.message);setLoading(false);return}
    const {data:op,error:opError}=await supabase.from("operaciones_360").insert({
      folio, tipo_operacion:form.operacion_tipo, movimiento:form.operacion_tipo, almacen_id:warehouseId, referencia_cliente:form.referencia.trim()||null, estado_general:"en_caseta", unidad_id:unit.id, creado_por:user?.id||null
    }).select("id").single();
    if(opError){await supabase.from("unidades").delete().eq("id",unit.id);setError(opError.message);setLoading(false);return}
    await supabase.from("unidades").update({operacion_360_id:op.data.id,ubicacion_tipo:"caseta",updated_at:new Date().toISOString()}).eq("id",unit.id);
    const patio=await supabase.rpc("registrar_ingreso_caseta_patios",{p_unidad_id:unit.id,p_observaciones:"Ingreso registrado en Caseta"});
    if(patio.error){setError(patio.error.message);setLoading(false);return}
    setMessage("Ingreso registrado. La unidad quedó en patio y visible para Dispatch.");
    setForm({operador_nombre:"",linea_transporte:"",tracto_placas:"",caja_placas:"",folio_cita:"",operacion_tipo:"recibo",referencia:""});
    await load();setLoading(false);
  }

  return <section id="caseta" className="caseta-page caseta-exact">
    <div className="caseta-hero">
      <div className="caseta-brand-block">
        <div className="caseta-brand-icon"><Truck size={28}/></div>
        <div><strong>Seguimiento<br/><span>Logístico 360°</span></strong></div>
      </div>
      <div className="caseta-hero-divider"/>
      <div className="caseta-hero-title">
        <div className="eyebrow">CONTROL DE ACCESO</div>
        <h2>Caseta</h2>
        <p>Registro de ingreso de unidades</p>
      </div>
      <div className="caseta-hero-status">
        <div className="caseta-active"><span className="dot"/> Caseta activa</div>
        <strong>MTY-II | Las Torres</strong>
      </div>
      <div className="caseta-clock">10:00</div>
    </div>

    <div className="caseta-steps">
      <div className="caseta-step-item active"><span>1</span><strong>Datos de la unidad</strong></div>
      <div className="caseta-step-line"/>
      <div className="caseta-step-item"><span>2</span><strong>Evidencia fotográfica</strong></div>
      <div className="caseta-step-line"/>
      <div className="caseta-step-item"><span>3</span><strong>Registrar ingreso</strong></div>
    </div>

    <div className="caseta-exact-grid">
      <div className="caseta-white-card">
        <div className="exact-card-title">
          <div className="exact-icon"><Truck size={22}/></div>
          <div><h3>1. DATOS DE LA UNIDAD</h3><p>Captura la información del operador y la unidad.</p></div>
        </div>

        <form className="caseta-exact-form" onSubmit={registrar}>
          <label>Nombre del operador
            <div className="exact-input"><User size={18}/><input required value={form.operador_nombre} onChange={e=>setForm({...form,operador_nombre:e.target.value})} placeholder="Nombre y apellidos"/></div>
          </label>
          <label>Línea de transporte
            <div className="exact-input"><Building2 size={18}/><input required value={form.linea_transporte} onChange={e=>setForm({...form,linea_transporte:e.target.value})} placeholder="Empresa transportista"/></div>
          </label>
          <div className="exact-two">
            <label>Placa tracto
              <div className="exact-input"><Truck size={18}/><input required value={form.tracto_placas} onChange={e=>setForm({...form,tracto_placas:e.target.value.toUpperCase()})} placeholder="ABC-123-X"/></div>
            </label>
            <label>Placa caja <span>(opcional)</span>
              <div className="exact-input"><Truck size={18}/><input value={form.caja_placas} onChange={e=>setForm({...form,caja_placas:e.target.value.toUpperCase()})} placeholder="ABC-123-X"/></div>
            </label>
          </div>
          <div className="exact-two">
            <label>Tipo de operación
              <div className="exact-input"><ClipboardList size={18}/><select value={form.operacion_tipo} onChange={e=>setForm({...form,operacion_tipo:e.target.value})}><option value="recibo">Recibo</option><option value="embarque">Embarque</option></select></div>
            </label>
            <label>Referencia del cliente <span>(opcional)</span>
              <div className="exact-input"><ClipboardList size={18}/><input value={form.referencia} onChange={e=>setForm({...form,referencia:e.target.value})} placeholder="Ej. OC, Proyecto, etc."/></div>
            </label>
          </div>
          <input value={form.folio_cita} onChange={e=>setForm({...form,folio_cita:e.target.value})} placeholder="" className="hidden-input"/>
          {error&&<div className="notice error"><strong>No se pudo registrar</strong><span>{error}</span></div>}
          {message&&<div className="notice success"><CheckCircle2 size={17}/><strong>{message}</strong></div>}
          <button className="caseta-exact-submit" disabled={loading}><Truck size={22}/>{loading?"Registrando ingreso…":"Registrar ingreso a Caseta"}<span>→</span></button>
        </form>
      </div>

      <div className="caseta-white-card">
        <div className="exact-card-title">
          <div className="exact-icon"><Camera size={22}/></div>
          <div><h3>2. EVIDENCIA FOTOGRÁFICA</h3><p>Las fotos se guardan solo como evidencia.</p></div>
        </div>
        <div className="exact-evidence-grid">
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={recibirFoto} style={{display:"none"}}/>
          <input ref={idInputRef} type="file" accept="image/*" capture="environment" onChange={recibirFotoId} style={{display:"none"}}/>
          <button type="button" className="exact-evidence" onClick={abrirScanner}>
            <span className="exact-evidence-icon"><ClipboardList size={25}/></span>
            <strong>Foto de placa</strong><small>Toca para abrir la cámara</small>
            {capturedPhoto?<img src={capturedPhoto} alt="Evidencia de placa"/>:<div className="exact-photo-placeholder">PLACA</div>}
            {capturedPhoto&&<span className="photo-ok">✓</span>}
          </button>
          <button type="button" className="exact-evidence" onClick={abrirCamaraId}>
            <span className="exact-evidence-icon"><IdCard size={25}/></span>
            <strong>Foto de identificación</strong><small>Toca para abrir la cámara</small>
            {capturedId?<img src={capturedId} alt="Evidencia de identificación"/>:<div className="exact-photo-placeholder id-placeholder">ID</div>}
            {capturedId&&<span className="photo-ok">✓</span>}
          </button>
        </div>
        <div className="evidence-note"><Camera size={15}/> Las fotografías son evidencia; los datos se capturan manualmente.</div>
      </div>
    </div>

    <div className="caseta-recent-exact">
      <div className="recent-exact-head">
        <div><div className="exact-icon"><Clock size={22}/></div><div><h3>Ingresos recientes</h3><p>Últimos registros en esta caseta.</p></div></div>
        <div className="recent-exact-actions"><span>{recent.length} registros</span><button type="button" className="secondary-btn" onClick={()=>load(true)} disabled={refreshLoading}><RefreshCw size={15}/>{refreshLoading?"Actualizando…":"Actualizar"}</button></div>
      </div>
      {recent.length?<div className="exact-table-wrap"><table className="exact-table"><thead><tr><th>Folio</th><th>Fecha y hora</th><th>Operador</th><th>Transportista</th><th>Placa tracto</th><th>Tipo</th><th>Estado</th></tr></thead><tbody>{recent.map(u=><tr key={u.id}><td><strong>{u.folio}</strong></td><td>{new Date(u.created_at).toLocaleString("es-MX",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})}</td><td>{u.operador_nombre||"—"}</td><td>{u.linea_transporte||"—"}</td><td><strong>{u.tracto_placas||"—"}</strong></td><td><span className="exact-pill">{u.estado==="en_caseta"?"Recibo":u.estado||"Registrado"}</span></td><td><span className="exact-status"><span/> Registrado</span></td></tr>)}</tbody></table></div>:<div className="exact-empty"><ClipboardCheck size={24}/><strong>Sin ingresos todavía</strong><span>Los registros aparecerán aquí después de confirmar una unidad.</span></div>}
    </div>

    <div className="caseta-bottom-nav">
      <div className="bottom-nav-active"><Building2 size={22}/><span>Caseta</span></div>
      <div><Truck size={22}/><span>Dispatch</span></div>
      <div><ClipboardList size={22}/><span>Operación</span></div>
      <div><User size={22}/><span>CSR</span></div>
      <div><BarChart3 size={22}/><span>Reportes</span></div>
      <div className="bottom-brand">Seguimiento<br/><strong>Logístico 360°</strong></div>
    </div>
  </section>
}
