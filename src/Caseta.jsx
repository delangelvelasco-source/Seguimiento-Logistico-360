import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, ClipboardCheck, RefreshCw, Truck, User, Building2, IdCard, ClipboardList, Clock, BarChart3, Search, ScanLine, X } from "lucide-react";
import { supabase } from "./lib/supabase";
import { createWorker } from "tesseract.js";

export default function Caseta({ warehouseId }) {
  const [accessType,setAccessType]=useState("unidad");
  const [accessForm,setAccessForm]=useState({nombre:"",empresa:"",persona_visita:"",motivo:"",area_destino:"",telefono:"",tracto_numero:"",tracto_placas:"",caja_numero:"",caja_placas:"",folio_cita:"",operacion_tipo:"recibo",referencia:""});
  const form=accessForm;
  const setForm=setAccessForm;
  const [loading,setLoading]=useState(false), [error,setError]=useState(""), [message,setMessage]=useState("");
  const [recent,setRecent]=useState([]);
  const videoRef=useRef(null);
  const streamRef=useRef(null);
  const cameraInputRef=useRef(null);
  const idInputRef=useRef(null);
  const [capturedPhoto,setCapturedPhoto]=useState("");
  const [capturedId,setCapturedId]=useState("");
  const [ocrLoading,setOcrLoading]=useState(false);
  const [refreshLoading,setRefreshLoading]=useState(false);
  const [ocrText,setOcrText]=useState("");
  const [citaLoading,setCitaLoading]=useState(false);
  const [scannerOpen,setScannerOpen]=useState(false);
  const [scannerError,setScannerError]=useState("");
  const [scanner,setScanner]=useState(null);
  const [citaEncontrada,setCitaEncontrada]=useState(null);

  async function load(showMessage=false){
    if(!warehouseId){
      if(showMessage)setMessage("No hay un almacén activo seleccionado.");
      return;
    }
    if(showMessage)setRefreshLoading(true);
    const {data,error}=await supabase.from("accesos_caseta").select("id,folio,tipo_acceso,nombre,empresa,persona_visita,tracto_placas,operacion_tipo,estado,entrada_at").eq("almacen_id",warehouseId).order("entrada_at",{ascending:false}).limit(12);
    if(error){
      if(showMessage)setMessage("No se pudo actualizar la lista de ingresos: "+error.message);
    }else{
      setRecent(data||[]);
      if(showMessage)setMessage("Ingresos actualizados correctamente.");
    }
    if(showMessage)setRefreshLoading(false);
  }
  useEffect(()=>{if(warehouseId)load()},[warehouseId]);

  function abrirScannerPlaca(){ cameraInputRef.current?.click(); }
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

  async function abrirScanner(){
    setScannerError("");
    setScannerOpen(true);
    setTimeout(async()=>{
      try{
        const mod=await import("html5-qrcode");
        const reader=new mod.Html5Qrcode("caseta-qr-reader");
        setScanner(reader);
        await reader.start({facingMode:{exact:"environment"}},{fps:10,qrbox:{width:240,height:240}},async(decoded)=>{
          let folio=decoded;
          try{const parsed=JSON.parse(decoded);if(parsed?.tipo==="cita360")folio=parsed.folio||"";}catch{}
          if(!folio){setScannerError("El QR no contiene un folio de cita válido.");return;}
          setForm(prev=>({...prev,folio_cita:folio}));
          try{await reader.stop();await reader.clear();}catch{}
          setScanner(null);setScannerOpen(false);
          buscarCita(folio);
        },()=>{});
      }catch(err){setScannerError("No se pudo abrir la cámara. Revisa el permiso de cámara y vuelve a intentar.");}
    },120);
  }
  async function cerrarScanner(){
    try{if(scanner){await scanner.stop();await scanner.clear();}}catch{}
    setScanner(null);setScannerOpen(false);
  }

  async function buscarCita(valor=form.folio_cita){
    if(accessType!=="unidad")return;
    const folio=String(valor||"").trim();
    setCitaEncontrada(null);
    if(!folio)return;
    setCitaLoading(true);setMessage("");setError("");
    try{
      const {data:cita,error:citaError}=await supabase.from("citas").select("id,folio,tipo_operacion,fecha,hora_inicio,hora_fin,referencia,estado,unidades_solicitadas").eq("almacen_id",warehouseId).eq("folio",folio).maybeSingle();
      if(citaError)throw citaError;
      if(cita){
        const {data:precarga}=await supabase.from("cita_datos_precarga").select("linea_transporte,operador_nombre,contacto,tracto_numero,tracto_placas,caja_numero,caja_placas,observaciones").eq("cita_id",cita.id).maybeSingle();
        setForm(prev=>({...prev,
          folio_cita:cita.folio||folio,
          nombre:precarga?.operador_nombre||prev.nombre,
          empresa:precarga?.linea_transporte||prev.empresa,
          tracto_placas:precarga?.tracto_placas||prev.tracto_placas,
          caja_placas:precarga?.caja_placas||prev.caja_placas,
          operacion_tipo:cita.tipo_operacion||prev.operacion_tipo,
          referencia:cita.referencia||prev.referencia
        }));
        setCitaEncontrada({...cita,...precarga});
        setMessage("Cita encontrada. Los datos disponibles se cargaron automáticamente; puedes corregirlos si es necesario.");
      }else{
        try{
          const saved=localStorage.getItem("seguimiento360_practice_cita");
          const practica=saved?JSON.parse(saved):null;
          if(practica?.folio===folio){
            setForm(prev=>({...prev,folio_cita:practica.folio,operacion_tipo:practica.operacion||prev.operacion_tipo,referencia:practica.referencia||prev.referencia}));
            setCitaEncontrada({folio:practica.folio,fecha:practica.fecha,hora_inicio:practica.hora,estado:"práctica",referencia:practica.referencia});
            setMessage("Cita de práctica encontrada. Datos disponibles cargados.");
          }else{
            setMessage("No se encontró una cita con ese folio. Puedes continuar sin cita o capturar los datos manualmente.");
          }
        }catch{
          setMessage("No se encontró una cita con ese folio. Puedes continuar sin cita o capturar los datos manualmente.");
        }
      }
    }catch(err){
      setError("No se pudo consultar la cita: "+(err?.message||"error desconocido"));
    }finally{setCitaLoading(false);}
  }

  async function registrar(e){
    e.preventDefault();setLoading(true);setError("");setMessage("");
    const user=(await supabase.auth.getUser()).data.user;
    const prefix=accessType==="unidad"?"C":accessType==="visitante"?"V":"P";
    const folioAcceso=form.folio_cita.trim() || prefix+"-"+Date.now().toString().slice(-6);

    if(accessType!=="unidad"){
      const {error}=await supabase.from("accesos_caseta").insert({
        folio:folioAcceso,almacen_id:warehouseId,tipo_acceso:accessType,nombre:form.nombre.trim(),empresa:form.empresa.trim()||null,
        persona_visita:form.persona_visita.trim()||null,motivo:form.motivo.trim()||null,area_destino:form.area_destino.trim()||null,
        telefono:form.telefono.trim()||null,entrada_at:new Date().toISOString(),estado:"dentro",observaciones:form.referencia.trim()||null,
        registrado_por:user?.id||null
      });
      if(error){setError(error.message);setLoading(false);return}
      setMessage(accessType==="visitante"?"Visitante registrado. Acceso abierto.":"Proveedor registrado. Acceso abierto.");
      setAccessForm({nombre:"",empresa:"",persona_visita:"",motivo:"",area_destino:"",telefono:"",tracto_numero:"",tracto_placas:"",caja_numero:"",caja_placas:"",folio_cita:"",operacion_tipo:"recibo",referencia:""});
      await load();setLoading(false);return;
    }

    const {data:resultado,error:registroError}=await supabase.rpc("registrar_ingreso_caseta_completo",{
      p_almacen_id:warehouseId,
      p_folio_cita:form.folio_cita.trim()||null,
      p_nombre:form.nombre.trim(),
      p_linea:form.empresa.trim(),
      p_tracto_numero:form.tracto_numero.trim()||null,
      p_tracto_placas:form.tracto_placas.trim().toUpperCase(),
      p_caja_numero:form.caja_numero.trim()||null,
      p_caja_placas:form.caja_placas.trim().toUpperCase()||null,
      p_operacion_tipo:form.operacion_tipo,
      p_referencia:form.referencia.trim()||null,
      p_cita_id:citaEncontrada?.id||null
    });
    if(registroError){
      setError(registroError.message||"No se pudo registrar el ingreso.");
      setLoading(false);
      return;
    }
    if(!resultado?.ok){
      setError("No se pudo confirmar el registro.");
      setLoading(false);
      return;
    }
    setMessage("Ingreso registrado. El acceso quedó visible para Caseta y Dispatch.");
    setAccessForm({nombre:"",empresa:"",persona_visita:"",motivo:"",area_destino:"",telefono:"",tracto_numero:"",tracto_placas:"",caja_numero:"",caja_placas:"",folio_cita:"",operacion_tipo:"recibo",referencia:""});
    await load();setLoading(false);
  }

  return <section id="caseta" className="caseta-page caseta-exact">
    <div className="caseta-hero">
      <div className="caseta-brand-block"><div className="caseta-brand-icon"><Truck size={28}/></div><div><strong>Seguimiento<br/><span>Logístico 360°</span></strong></div></div>
      <div className="caseta-hero-divider"/>
      <div className="caseta-hero-title"><div className="eyebrow">CONTROL DE ACCESO</div><h2>Caseta</h2><p>Registro de unidades, visitantes y proveedores</p></div>
      <div className="caseta-hero-status"><div className="caseta-active"><span className="dot"/> Caseta activa</div><strong>MTY-II | Las Torres</strong></div>
      <div className="caseta-clock">10:00</div>
    </div>

    <div className="access-selector">
      <button type="button" className={accessType==="unidad"?"access-type active unit": "access-type unit"} onClick={()=>setAccessType("unidad")}><Truck size={22}/><span><b>Unidad</b><small>Transportista</small></span></button>
      <button type="button" className={accessType==="visitante"?"access-type active visitor": "access-type visitor"} onClick={()=>setAccessType("visitante")}><User size={22}/><span><b>Visitante</b><small>Acceso personal</small></span></button>
      <button type="button" className={accessType==="proveedor"?"access-type active provider": "access-type provider"} onClick={()=>setAccessType("proveedor")}><Building2 size={22}/><span><b>Proveedor</b><small>Servicio / entrega</small></span></button>
    </div>

    <div className="caseta-steps"><div className="caseta-step-item active"><span>1</span><strong>Datos de acceso</strong></div><div className="caseta-step-line"/><div className="caseta-step-item"><span>2</span><strong>Evidencia</strong></div><div className="caseta-step-line"/><div className="caseta-step-item"><span>3</span><strong>Registrar ingreso</strong></div></div>

    <div className="caseta-exact-grid">
      <div className="caseta-white-card">
        <div className="exact-card-title"><div className="exact-icon">{accessType==="unidad"?<Truck size={22}/>:accessType==="visitante"?<User size={22}/>:<Building2 size={22}/>}</div><div><h3>1. {accessType==="unidad"?"DATOS DE LA UNIDAD":accessType==="visitante"?"DATOS DEL VISITANTE":"DATOS DEL PROVEEDOR"}</h3><p>Captura la información necesaria para autorizar el acceso.</p></div></div>
        <form className="caseta-exact-form" onSubmit={registrar}>
          {accessType==="unidad"?<>
            <label className="cita-first-field">Folio de cita <span>(opcional · primero)</span><div className="exact-input cita-input"><ClipboardList size={18}/><input value={form.folio_cita} onChange={e=>setForm({...form,folio_cita:e.target.value.toUpperCase()})} onBlur={()=>buscarCita()} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();buscarCita();}}} placeholder="Escanea o escribe el folio de cita"/><button type="button" className="cita-scan-btn" onClick={abrirScanner} title="Escanear QR"><ScanLine size={17}/></button><button type="button" className="cita-search-btn" onClick={()=>buscarCita()} disabled={citaLoading||!form.folio_cita.trim()} title="Buscar cita">{citaLoading?"…":<Search size={16}/>}</button></div>{citaEncontrada&&<small className="cita-found">✓ Cita encontrada · {citaEncontrada.fecha||"fecha no disponible"} {citaEncontrada.hora_inicio?("· "+String(citaEncontrada.hora_inicio).slice(0,5)):""}</small>}</label>
            <label>Nombre del operador<div className="exact-input"><User size={18}/><input required value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})} placeholder="Nombre y apellidos"/></div></label>
            <label>Línea de transporte<div className="exact-input"><Building2 size={18}/><input required value={form.empresa} onChange={e=>setForm({...form,empresa:e.target.value})} placeholder="Empresa transportista"/></div></label>
            <div className="exact-two"><label>Número de tracto<div className="exact-input"><Truck size={18}/><input value={form.tracto_numero} onChange={e=>setForm({...form,tracto_numero:e.target.value})} placeholder="Número económico"/></div></label><label>Placa tracto<div className="exact-input"><Truck size={18}/><input required value={form.tracto_placas} onChange={e=>setForm({...form,tracto_placas:e.target.value.toUpperCase()})} placeholder="ABC-123-X"/></div></label></div><div className="exact-two"><label>Número de caja <span>(opcional)</span><div className="exact-input"><Truck size={18}/><input value={form.caja_numero} onChange={e=>setForm({...form,caja_numero:e.target.value})} placeholder="Número económico"/></div></label><label>Placa caja <span>(opcional)</span><div className="exact-input"><Truck size={18}/><input value={form.caja_placas} onChange={e=>setForm({...form,caja_placas:e.target.value.toUpperCase()})} placeholder="ABC-123-X"/></div></label></div>
            <div className="exact-two"><label>Tipo de operación<div className="exact-input"><ClipboardList size={18}/><select value={form.operacion_tipo} onChange={e=>setForm({...form,operacion_tipo:e.target.value})}><option value="recibo">Recibo</option><option value="embarque">Embarque</option></select></div></label><label>Referencia <span>(opcional)</span><div className="exact-input"><ClipboardList size={18}/><input value={form.referencia} onChange={e=>setForm({...form,referencia:e.target.value})} placeholder="Referencia del cliente"/></div></label></div>
          </>:<>
            <div className="exact-two"><label>Nombre completo<div className="exact-input"><User size={18}/><input required value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})} placeholder="Nombre y apellidos"/></div></label><label>Empresa <span>(opcional)</span><div className="exact-input"><Building2 size={18}/><input value={form.empresa} onChange={e=>setForm({...form,empresa:e.target.value})} placeholder="Empresa / procedencia"/></div></label></div>
            {accessType==="visitante"&&<label>Persona a quien visita<div className="exact-input"><User size={18}/><input required value={form.persona_visita} onChange={e=>setForm({...form,persona_visita:e.target.value})} placeholder="Nombre del anfitrión"/></div></label>}
            <div className="exact-two"><label>Motivo<div className="exact-input"><ClipboardList size={18}/><input required value={form.motivo} onChange={e=>setForm({...form,motivo:e.target.value})} placeholder={accessType==="proveedor"?"Servicio / entrega":"Visita / reunión"}/></div></label><label>Área de destino<div className="exact-input"><Building2 size={18}/><input required value={form.area_destino} onChange={e=>setForm({...form,area_destino:e.target.value})} placeholder="Área / almacén"/></div></label></div>
            <div className="exact-two"><label>Teléfono <span>(opcional)</span><div className="exact-input"><ClipboardList size={18}/><input value={form.telefono} onChange={e=>setForm({...form,telefono:e.target.value})} placeholder="Contacto"/></div></label><label>Observaciones <span>(opcional)</span><div className="exact-input"><ClipboardList size={18}/><input value={form.referencia} onChange={e=>setForm({...form,referencia:e.target.value})} placeholder="Notas"/></div></label></div>
          </>}
          {error&&<div className="notice error"><strong>No se pudo registrar</strong><span>{error}</span></div>}
          {message&&<div className="notice success"><CheckCircle2 size={17}/><strong>{message}</strong></div>}
          <button className="caseta-exact-submit" disabled={loading}><Truck size={22}/>{loading?"Registrando ingreso…":accessType==="unidad"?"Registrar ingreso a Caseta":accessType==="visitante"?"Registrar visitante":"Registrar proveedor"}<span>→</span></button>
        </form>
      </div>

      <div className="caseta-white-card">
        <div className="exact-card-title"><div className="exact-icon"><Camera size={22}/></div><div><h3>2. EVIDENCIA FOTOGRÁFICA</h3><p>Las fotos se conservan como respaldo.</p></div></div>
        <div className="exact-evidence-grid"><input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={recibirFoto} style={{display:"none"}}/><input ref={idInputRef} type="file" accept="image/*" capture="environment" onChange={recibirFotoId} style={{display:"none"}}/>
          <button type="button" className="exact-evidence" onClick={abrirScannerPlaca}><span className="exact-evidence-icon"><ClipboardList size={25}/></span><strong>Foto de placa</strong><small>{accessType==="unidad"?"Evidencia del tracto":"Opcional"}</small>{capturedPhoto?<img src={capturedPhoto} alt="Evidencia de placa"/>:<div className="exact-photo-placeholder">PLACA</div>}{capturedPhoto&&<span className="photo-ok">✓</span>}</button>
          <button type="button" className="exact-evidence" onClick={abrirCamaraId}><span className="exact-evidence-icon"><IdCard size={25}/></span><strong>Foto de identificación</strong><small>Evidencia de acceso</small>{capturedId?<img src={capturedId} alt="Evidencia de identificación"/>:<div className="exact-photo-placeholder id-placeholder">ID</div>}{capturedId&&<span className="photo-ok">✓</span>}</button>
        </div>
        <div className="evidence-note"><Camera size={15}/> Las fotografías son evidencia; los datos se capturan manualmente.</div>
      </div>
    </div>

    <div className="caseta-recent-exact"><div className="recent-exact-head"><div><div className="exact-icon"><Clock size={22}/></div><div><h3>Accesos recientes</h3><p>Unidades, visitantes y proveedores registrados en esta caseta.</p></div></div><div className="recent-exact-actions"><span>{recent.length} registros</span><button type="button" className="secondary-btn" onClick={()=>load(true)} disabled={refreshLoading}><RefreshCw size={15}/>{refreshLoading?"Actualizando…":"Actualizar"}</button></div></div>
      {recent.length?<div className="exact-table-wrap"><table className="exact-table"><thead><tr><th>Folio</th><th>Tipo</th><th>Nombre</th><th>Empresa</th><th>Destino / visita</th><th>Entrada</th><th>Estado</th></tr></thead><tbody>{recent.map(u=><tr key={u.id}><td><strong>{u.folio}</strong></td><td><span className="exact-pill">{u.tipo_acceso==="unidad"?"🚛 Unidad":u.tipo_acceso==="visitante"?"👤 Visitante":"🏢 Proveedor"}</span></td><td>{u.nombre||"—"}</td><td>{u.empresa||"—"}</td><td>{u.persona_visita||u.operacion_tipo||"—"}</td><td>{new Date(u.entrada_at).toLocaleString("es-MX",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</td><td><span className="exact-status"><span/> {u.estado==="dentro"?"Dentro":"Salió"}</span></td></tr>)}</tbody></table></div>:<div className="exact-empty"><ClipboardCheck size={24}/><strong>Sin accesos todavía</strong><span>Los registros aparecerán aquí después de confirmar un acceso.</span></div>}
    </div>

    <div className="caseta-bottom-nav"><div className="bottom-nav-active"><Building2 size={22}/><span>Caseta</span></div><div><Truck size={22}/><span>Dispatch</span></div><div><ClipboardList size={22}/><span>Operación</span></div><div><User size={22}/><span>CSR</span></div><div><BarChart3 size={22}/><span>Reportes</span></div><div className="bottom-brand">Seguimiento<br/><strong>Logístico 360°</strong></div></div>
  {scannerOpen&&<div className="qr-scanner-overlay"><div className="qr-scanner-card"><div className="qr-scanner-head"><strong>Escanear QR de cita</strong><button type="button" onClick={cerrarScanner}><X size={20}/></button></div><div id="caseta-qr-reader" className="qr-reader"></div>{scannerError&&<div className="notice error"><strong>Escáner</strong><span>{scannerError}</span></div>}<small>Apunta la cámara al QR generado por CSR.</small></div></div>}</section>
}
