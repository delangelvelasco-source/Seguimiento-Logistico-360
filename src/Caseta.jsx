import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, ClipboardCheck, LogIn, RefreshCw, Search, Truck } from "lucide-react";
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

  function abrirScanner(){ setScannerError(""); cameraInputRef.current?.click(); }
  function abrirCamaraId(){ idInputRef.current?.click(); }
  async function recibirFotoId(e){
    const file=e.target.files?.[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=async()=>{
      const image=String(reader.result||"");
      setCapturedId(image);
      setOcrText("");
      setOcrLoading(true);
      setMessage("Identificación capturada. Preparando lectura…");
      let worker=null;
      try{
        const img=await new Promise((resolve,reject)=>{
          const el=new Image();
          el.onload=()=>resolve(el);
          el.onerror=()=>reject(new Error("No se pudo preparar la imagen."));
          el.src=image;
        });

        const width=img.naturalWidth||img.width;
        const height=img.naturalHeight||img.height;
        const scale=Math.min(2.5,Math.max(1,2400/Math.max(width,1)));
        const canvas=document.createElement("canvas");
        canvas.width=Math.round(width*scale);
        canvas.height=Math.round(height*scale);
        const ctx=canvas.getContext("2d");
        if(!ctx)throw new Error("No se pudo preparar el OCR.");
        ctx.imageSmoothingEnabled=true;
        ctx.imageSmoothingQuality="high";
        ctx.drawImage(img,0,0,canvas.width,canvas.height);

        worker=await createWorker("spa");
        await worker.setParameters({
          preserve_interword_spaces:"1",
          user_defined_dpi:"300"
        });

        const passes=[];
        for(const mode of ["6","11"]){
          await worker.setParameters({tessedit_pageseg_mode:mode});
          const result=await worker.recognize(canvas);
          passes.push({
            text:result?.data?.text||"",
            confidence:Number(result?.data?.confidence||0)
          });
        }

        const text=passes
          .sort((a,b)=>b.confidence-a.confidence)
          .map(x=>x.text)
          .filter(Boolean)
          .join("\n\n---\n\n");
        setOcrText(text);

        const clean=(value="")=>value
          .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s-]/g," ")
          .replace(/\s+/g," ")
          .trim();

        const lines=text
          .split(/\r?\n+/)
          .map(clean)
          .filter(Boolean);

        const label=/^(NOMBRE(?:S)?|NOMBRE\(S\)|APELLIDO(?: PATERNO| MATERNO|S)?|PATERNO|MATERNO)\b[:.\-]?\s*(.*)$/i;
        const labels=["NOMBRE","NOMBRES","NOMBRE(S)","APELLIDO","APELLIDOS","APELLIDO PATERNO","APELLIDO MATERNO","PATERNO","MATERNO"];

        const plausible=(value)=>{
          const v=clean(value);
          if(!v || labels.includes(v.toUpperCase()))return false;
          const words=v.split(" ").filter(Boolean);
          if(words.length<2 || words.length>6)return false;
          if(words.some(w=>w.length<2 || w.length>20))return false;
          return words.every(w=>/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ-]+$/.test(w));
        };

        const values=[];
        for(let i=0;i<lines.length;i++){
          const match=lines[i].match(label);
          if(!match)continue;
          const inline=clean(match[2]||"");
          if(plausible(inline)){
            values.push(inline);
            continue;
          }
          for(let j=1;j<=2;j++){
            const next=clean(lines[i+j]||"");
            if(plausible(next)){
              values.push(next);
              break;
            }
          }
        }

        const uniqueValues=[...new Set(values.map(v=>v.toUpperCase()))];
        const name=uniqueValues.join(" ").replace(/\s+/g," ").trim();
        const bestConfidence=Math.max(...passes.map(x=>x.confidence),0);

        if(name && bestConfidence>=35){
          setForm(f=>({...f,operador_nombre:name}));
          setMessage("Nombre detectado automáticamente. Verifica que coincida con la identificación antes de registrar.");
        }else{
          setMessage("La identificación fue leída, pero el nombre no tiene suficiente claridad para autocompletarlo. Captura la identificación más cerca y de frente.");
        }
      }catch(err){
        setMessage("La foto quedó capturada, pero no fue posible leer el nombre automáticamente. Captúralo manualmente.");
      }finally{
        if(worker)await worker.terminate();
        setOcrLoading(false);
      }
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
    setMessage("Foto capturada. Verifica la placa visualmente antes de registrar el ingreso.");
    e.target.value="";
  }
  useEffect(()=>{
    if(!scannerOpen)return;
    let cancelled=false;
    (async()=>{
      try{
        if(!navigator.mediaDevices?.getUserMedia) throw new Error("La cámara no está disponible en este navegador.");
        const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},audio:false});
        if(cancelled){stream.getTracks().forEach(t=>t.stop());return;}
        streamRef.current=stream;
        if(videoRef.current){videoRef.current.srcObject=stream; await videoRef.current.play();}
      }catch(err){if(!cancelled)setScannerError(err?.message||"No se pudo abrir la cámara.");}
    })();
    return()=>{cancelled=true; streamRef.current?.getTracks?.().forEach(t=>t.stop()); streamRef.current=null;};
  },[scannerOpen]);

  function cerrarScanner(){
    streamRef.current?.getTracks?.().forEach(t=>t.stop());
    streamRef.current=null;
    setScannerOpen(false);
  }
  function capturarScanner(){
    const video=videoRef.current;
    if(!video||!video.videoWidth){setScannerError("Espera a que la cámara esté lista.");return;}
    const canvas=document.createElement("canvas");
    canvas.width=video.videoWidth; canvas.height=video.videoHeight;
    canvas.getContext("2d").drawImage(video,0,0,canvas.width,canvas.height);
    // La imagen queda disponible para validación visual; OCR de placa se incorpora en la siguiente fase.
    canvas.toDataURL("image/jpeg",0.9);
    setForm(f=>({...f,referencia:f.referencia||"CAPTURA-CAMARA"}));
    cerrarScanner();
    setMessage("Captura realizada. Verifica visualmente la placa y confirma los datos antes de registrar el ingreso.");
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

  return <section id="caseta" className="users-section">
    <div className="panel">
      <div className="panel-title"><div><LogIn size={19}/><strong>Caseta · Registro de ingreso</strong></div><button type="button" className="secondary-btn" onClick={()=>load(true)} disabled={refreshLoading}><RefreshCw size={15} className={refreshLoading?"spin":""}/>{refreshLoading?"Actualizando…":"Actualizar"}</button></div>
      <p className="section-copy">Captura mínima. La información continuará enriqueciéndose en Dispatch, CSR y Operación; no se vuelve a capturar.</p>
      <form className="caseta-form" onSubmit={registrar}>
        <label>Operador<input required value={form.operador_nombre} onChange={e=>setForm({...form,operador_nombre:e.target.value})} placeholder="Nombre y apellidos"/></label>
        <label>Línea de transporte<input required value={form.linea_transporte} onChange={e=>setForm({...form,linea_transporte:e.target.value})} placeholder="Empresa transportista"/></label>
        <label>Placa tracto<input required value={form.tracto_placas} onChange={e=>setForm({...form,tracto_placas:e.target.value})} placeholder="ABC-123-X"/></label>
        <label>Placa caja<input value={form.caja_placas} onChange={e=>setForm({...form,caja_placas:e.target.value})} placeholder="Opcional"/></label>
        <label>Folio de cita<input value={form.folio_cita} onChange={e=>setForm({...form,folio_cita:e.target.value})} placeholder="Opcional"/></label>
        <label>Tipo de operación<select value={form.operacion_tipo} onChange={e=>setForm({...form,operacion_tipo:e.target.value})}><option value="recibo">Recibo</option><option value="embarque">Embarque</option></select></label>
        <label>Referencia del cliente<input value={form.referencia} onChange={e=>setForm({...form,referencia:e.target.value})} placeholder="Opcional"/></label>
        <div style={{display:"grid",gap:10}}><input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={recibirFoto} style={{display:"none"}}/><input ref={idInputRef} type="file" accept="image/*" capture="environment" onChange={recibirFotoId} style={{display:"none"}}/><button type="button" onClick={abrirScanner} style={{width:"100%",minHeight:82,display:"flex",alignItems:"center",gap:14,padding:"16px 18px",borderRadius:18,border:"1px solid rgba(96,165,250,.45)",background:"linear-gradient(135deg,rgba(37,99,235,.22),rgba(124,58,237,.26))",color:"#fff",cursor:"pointer",boxShadow:"0 10px 30px rgba(37,99,235,.12)"}}><span style={{width:48,height:48,borderRadius:14,display:"grid",placeItems:"center",background:"rgba(255,255,255,.12)",flex:"0 0 auto"}}><Camera size={25}/></span><span style={{display:"grid",gap:3,textAlign:"left",flex:1}}><strong style={{fontSize:16}}>Tomar foto de placa</strong><small style={{color:"#cbd5e1"}}>Toca para abrir directamente la cámara trasera</small></span><b style={{fontSize:14}}>📷</b></button><button type="button" onClick={abrirCamaraId} style={{width:"100%",minHeight:76,display:"flex",alignItems:"center",gap:14,padding:"14px 18px",borderRadius:18,border:"1px solid rgba(45,212,191,.35)",background:"rgba(15,118,110,.16)",color:"#fff",cursor:"pointer"}}><span style={{width:46,height:46,borderRadius:14,display:"grid",placeItems:"center",background:"rgba(45,212,191,.12)",flex:"0 0 auto"}}><Camera size={23}/></span><span style={{display:"grid",gap:3,textAlign:"left",flex:1}}><strong style={{fontSize:16}}>Tomar foto de identificación</strong><small style={{color:"#cbd5e1"}}>Captura la identificación del operador</small></span><b>📷</b></button>{capturedPhoto&&<div style={{display:"flex",alignItems:"center",gap:12,padding:10,borderRadius:14,background:"rgba(15,23,42,.75)",border:"1px solid rgba(148,163,184,.22)"}}><img src={capturedPhoto} alt="Evidencia capturada" style={{width:78,height:58,objectFit:"cover",borderRadius:10}}/><div style={{display:"grid",gap:3}}><strong style={{color:"#fff"}}>Foto capturada</strong><small style={{color:"#94a3b8"}}>Verifica la placa y captura el dato en el campo correspondiente.</small></div></div>}{ocrLoading&&<div className="notice" style={{marginTop:8}}><strong>🔎 Leyendo identificación…</strong><span>Procesando el nombre en el dispositivo.</span></div>}{ocrText&&!ocrLoading&&<div style={{padding:10,borderRadius:12,background:"rgba(15,23,42,.7)",color:"#cbd5e1",fontSize:12,whiteSpace:"pre-wrap",maxHeight:90,overflow:"auto"}}><strong>Texto detectado</strong><br/>{ocrText}</div>}{capturedId&&<div style={{display:"flex",alignItems:"center",gap:12,padding:10,borderRadius:14,background:"rgba(15,23,42,.75)",border:"1px solid rgba(45,212,191,.25)"}}><img src={capturedId} alt="Identificación capturada" style={{width:78,height:58,objectFit:"cover",borderRadius:10}}/><div style={{display:"grid",gap:3}}><strong style={{color:"#fff"}}>Identificación capturada</strong><small style={{color:"#94a3b8"}}>Verifica los datos del operador antes de registrar.</small></div></div>}</div>
        {error&&<div className="notice error"><strong>No se pudo registrar</strong><span>{error}</span></div>}
        {message&&<div className="notice success"><CheckCircle2 size={17}/><strong>{message}</strong></div>}
        <button className="login-btn" disabled={loading}><Truck size={17}/>{loading?"Registrando…":"Registrar ingreso a Caseta"}</button>
      </form>
    </div>
    <div className="panel">
      <div className="panel-title"><div><ClipboardCheck size={19}/><strong>Ingresos recientes</strong></div><span className="tag">{recent.length}</span></div>
      {recent.length?<div className="caseta-list">{recent.map(u=><div className="caseta-row" key={u.id}><div><strong>{u.folio}</strong><span>{u.linea_transporte} · {u.operador_nombre}</span></div><div><b>{u.tracto_placas}</b><small>{u.ubicacion_tipo} · {u.estado}</small></div></div>)}</div>:<div className="empty">No hay ingresos registrados.</div>}
    </div>
  </section>
}
