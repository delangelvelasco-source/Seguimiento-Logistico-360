import React, { useEffect, useMemo, useState } from "react";
import { supabase, supabaseConfigured } from "./lib/supabase";

const MODULES = [
  ["caseta","Caseta","Ingreso y registro"],
  ["trafico","Tráfico","Flujo de unidades"],
  ["rampas","Rampas","Disponibilidad"],
  ["dispatch","Dispatch","Citas y transporte"],
  ["operacion","Operación","Proceso en rampa"],
  ["csr","CSR","Validación documental"],
  ["monitor","Monitor 360","Vista en tiempo real"],
  ["guardia","Guardia","Salida y liberación"],
  ["admin","Administración","Usuarios y almacenes"]
];

const ROLE_PROFILES = {
  admin_global:{label:"Administrador global",description:"Control total de OP360, usuarios, almacenes y operación.",modules:MODULES.map(x=>x[0])},
  admin_almacen:{label:"Administrador de almacén",description:"Administra la operación y configuración de su almacén.",modules:["caseta","trafico","rampas","dispatch","operacion","csr","monitor","admin"]},
  team_lead:{label:"Líder de equipo",description:"Supervisa el flujo operativo y el cumplimiento de las etapas.",modules:["trafico","rampas","dispatch","operacion","csr","monitor"]},
  supervisor:{label:"Supervisor",description:"Supervisa unidades, rampas, operación y desempeño.",modules:["trafico","rampas","dispatch","operacion","csr","monitor"]},
  caseta:{label:"Caseta",description:"Registra ingresos y genera el folio de la unidad.",modules:["caseta","monitor"]},
  dispatch:{label:"Tráfico / Dispatch",description:"Controla llegada, citas, transporte y avance hacia rampa.",modules:["trafico","dispatch","monitor"]},
  operacion:{label:"Operación",description:"Gestiona rampas, inicio y término de la operación.",modules:["trafico","rampas","operacion","monitor"]},
  csr:{label:"CSR",description:"Valida citas, documentación y envía unidades a operación.",modules:["csr","dispatch","monitor"]},
  guardia:{label:"Guardia",description:"Consulta el estado operativo para control de acceso y salida.",modules:["monitor"]},
  documentacion:{label:"Documentación",description:"Revisa documentación y seguimiento de unidades.",modules:["csr","monitor"]},
  aduanas:{label:"Aduanas",description:"Consulta y valida información documental y de operación.",modules:["csr","monitor"]},
  transportista:{label:"Transportista",description:"Consulta el avance de sus unidades.",modules:["monitor"]},
  cliente:{label:"Cliente",description:"Consulta el seguimiento de sus unidades y operación.",modules:["monitor"]},
  monitor_almacen:{label:"Monitor de almacén",description:"Visualiza en tiempo real la operación de un almacén.",modules:["monitor"]}
};

const ROLES = Object.keys(ROLE_PROFILES).filter(r=>r!=="monitor_almacen");
const roleModules = Object.fromEntries(Object.entries(ROLE_PROFILES).map(([r,p])=>[r,p.modules]));

const stateLabels = {
  en_caseta:"En caseta", validando:"Validando", espera_turno:"Espera de turno",
  rampa_asignada:"Rampa asignada", en_operacion:"En operación", documentacion:"Documentación",
  liberada:"Liberada", incidencia:"Incidencia", cancelada:"Cancelada"
};

function today(){ return new Date().toISOString().slice(0,10); }
function folio(){ const d=today().replaceAll("-","").slice(2); return "T-"+d+"-"+Math.floor(10000+Math.random()*90000); }
function clsState(s){ return "state state-"+String(s||"").replaceAll("_","-"); }

export default function App(){
  const [session,setSession]=useState(null);
  const [profile,setProfile]=useState(null);
  const [warehouses,setWarehouses]=useState([]);
  const [units,setUnits]=useState([]);
  const [ramps,setRamps]=useState([]);
  const [users,setUsers]=useState([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [module,setModule]=useState("trafico");
  useEffect(()=>{ if(profile?.rol==="caseta") setModule("caseta"); },[profile?.rol]);
  const [login,setLogin]=useState({user:"",password:""});
  const [form,setForm]=useState({operador_nombre:"",linea_transporte:"",tracto_numero:"",tracto_placas:"",caja_numero:"",caja_placas:"",contacto:"",operacion_tipo:"recibo",cita_at:"",folio_cita:"",numero_sellos:""});
  const [newUser,setNewUser]=useState({username:"",nombre:"",rol:"caseta",almacen_id:"",password:""});
  const [platePhoto,setPlatePhoto]=useState(null);
  const [idPhoto,setIdPhoto]=useState(null);
  const [citaLookup,setCitaLookup]=useState({loading:false,found:false,message:""});
  const [exitSeal,setExitSeal]=useState(null);
  const [platePreview,setPlatePreview]=useState(null);
  const [idPreview,setIdPreview]=useState(null);

  const allowed = roleModules[profile?.rol] || [];
  const can = key => allowed.includes(key);

  useEffect(()=>{
    let alive=true;
    if(!supabaseConfigured){ setLoading(false); return; }
    supabase.auth.getSession().then(({data})=>{
      if(!alive) return;
      setSession(data.session||null);
      if(!data.session) setLoading(false);
    }).catch(()=>setLoading(false));
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>{
      setSession(s||null);
      if(!s){ setProfile(null); setLoading(false); }
    });
    return ()=>{ alive=false; subscription.unsubscribe(); };
  },[]);

  useEffect(()=>{
    if(session) loadApp(session.user.id);
  },[session]);

  useEffect(()=>{
    if(!profile) return;
    const timer=setInterval(()=>{ loadUnits(); loadRamps(); },10000);
    return ()=>clearInterval(timer);
  },[profile?.id,profile?.almacen_id,warehouses.length]);

  async function loadApp(uid){
    setLoading(true); setError("");
    try{
      const [{data:p,error:pe},{data:w,error:we}]=await Promise.all([
        supabase.from("usuarios").select("id,nombre,rol,activo,almacen_id,username").eq("id",uid).maybeSingle(),
        supabase.from("almacenes").select("id,codigo,nombre,activa").eq("activa",true).order("codigo")
      ]);
      if(pe) throw pe;
      if(!p || !p.activo) throw new Error("El usuario no tiene un perfil activo en OP360.");
      setProfile(p); setWarehouses(w||[]);
      const warehouseId=p.almacen_id || w?.[0]?.id || null;
      await Promise.all([loadUnits(warehouseId),loadRamps(warehouseId),p.rol==="admin_global"?loadUsers():Promise.resolve()]);
    }catch(e){ setError(e.message||"No se pudo cargar OP360."); }
    finally{ setLoading(false); }
  }

  async function loadUnits(warehouseId=profile?.almacen_id||warehouses?.[0]?.id){
    if(!warehouseId) return;
    const {data,error:e}=await supabase.from("unidades")
      .select("id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,contacto,cita_at,estado,rampa_id,almacen_id,operacion_tipo,numero_sellos,salida_autorizada,salida_caseta_at,created_at,updated_at")
      .eq("almacen_id",warehouseId).order("created_at",{ascending:false}).limit(100);
    if(!e) setUnits(data||[]);
  }

  async function loadRamps(warehouseId=profile?.almacen_id||warehouses?.[0]?.id){
    if(!warehouseId) return;
    const {data}=await supabase.from("rampas").select("id,codigo,nombre,activa,estado,motivo").eq("almacen_id",warehouseId).order("codigo");
    setRamps(data||[]);
  }

  async function loadUsers(){
    const {data}=await supabase.from("usuarios").select("id,nombre,rol,activo,almacen_id,username,created_at").order("created_at",{ascending:false});
    setUsers(data||[]);
  }

  async function loginSubmit(e){
    e.preventDefault(); setBusy(true); setError("");
    const value=login.user.trim().toLowerCase();
    const candidates=value.includes("@")?[value]:[value+"@login.op360.local",value+"@login.seguimiento360.local"];
    let last="";
    for(const email of candidates){
      const {error:e}=await supabase.auth.signInWithPassword({email,password:login.password});
      if(!e){ setBusy(false); return; }
      last=e.message;
    }
    setError(last||"No se pudo iniciar sesión."); setBusy(false);
  }

  async function logout(){ await supabase.auth.signOut(); setModule("trafico"); }

  async function buscarCita(){
    const folioCita=form.folio_cita.trim();
    if(!folioCita){ setCitaLookup({loading:false,found:false,message:""}); return; }
    setCitaLookup({loading:true,found:false,message:"Buscando cita…"});
    const {data:cita,error:ce}=await supabase.from("citas").select("id,folio,tipo_operacion,referencia,pallets,unidades_solicitadas").eq("folio",folioCita).maybeSingle();
    if(ce){ setCitaLookup({loading:false,found:false,message:"No se pudo consultar la cita."}); return; }
    if(!cita){ setCitaLookup({loading:false,found:false,message:"No encontré ese folio de cita."}); return; }
    const {data:pre}=await supabase.from("cita_datos_precarga").select("operador_nombre,linea_transporte,contacto,tipo_unidad,tracto_numero,tracto_placas,caja_numero,caja_placas").eq("cita_id",cita.id).maybeSingle();
    setForm(prev=>({...prev,
      operador_nombre:pre?.operador_nombre||prev.operador_nombre,
      linea_transporte:pre?.linea_transporte||prev.linea_transporte,
      tracto_numero:pre?.tracto_numero||prev.tracto_numero,
      tracto_placas:pre?.tracto_placas||prev.tracto_placas,
      caja_numero:pre?.caja_numero||prev.caja_numero,
      caja_placas:pre?.caja_placas||prev.caja_placas,
      contacto:pre?.contacto||prev.contacto,
      operacion_tipo:cita.tipo_operacion||prev.operacion_tipo
    }));
    setCitaLookup({loading:false,found:true,message:"Cita encontrada. Datos precargados desde CSR."});
  }

  async function registerUnit(e){
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try{
      const warehouseId=profile?.almacen_id||warehouses[0]?.id;
      if(!warehouseId) throw new Error("No hay almacén asignado.");
      if(!platePhoto || !idPhoto) throw new Error("Debes tomar la foto de placas y la foto de ID.");
      const f=folio();
      const {data:u,error:e1}=await supabase.from("unidades").insert({
        folio:f, operador_nombre:form.operador_nombre.trim(), linea_transporte:form.linea_transporte.trim(),
        tracto_numero:form.tracto_numero.trim(), tracto_placas:form.tracto_placas.trim().toUpperCase(),
        caja_numero:form.caja_numero.trim()||null, caja_placas:form.caja_placas.trim().toUpperCase()||null,
        contacto:form.contacto.trim(), cita_at:null, folio_cita:form.folio_cita.trim()||null, numero_sellos:form.operacion_tipo==="embarque" ? Number(form.numero_sellos||0) : null, estado:"en_caseta",
        operacion_tipo:form.operacion_tipo, almacen_id:warehouseId, caseta_usuario_id:profile.id
      }).select("id").single();
      if(e1) throw e1;
      const {data:access,error:ae}=await supabase.from("accesos_caseta").insert({
        folio:f, almacen_id:warehouseId, tipo_acceso:"unidad", nombre:form.operador_nombre.trim(),
        empresa:form.linea_transporte.trim(), telefono:form.contacto.trim(),
        tracto_numero:form.tracto_numero.trim(), tracto_placas:form.tracto_placas.trim().toUpperCase(),
        caja_numero:form.caja_numero.trim()||null, caja_placas:form.caja_placas.trim().toUpperCase()||null,
        operacion_tipo:form.operacion_tipo, folio_cita:form.folio_cita.trim()||null, unidad_id:u.id, registrado_por:profile.id
      }).select("id").single();
      if(ae) throw ae;
      async function compressEvidence(file){
        if(!file) return file;
        if(!file.type.startsWith("image/") || file.size<1800000) return file;
        const bitmap=await createImageBitmap(file);
        const max=1600;
        const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement("canvas");
        canvas.width=Math.max(1,Math.round(bitmap.width*scale));
        canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const ctx=canvas.getContext("2d");
        ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.82));
        return blob?new File([blob],(file.name||"evidencia").replace(/\.[^.]+$/,"")+".jpg",{type:"image/jpeg"}):file;
      }
      async function saveEvidence(file,type){
        const safeFile=await compressEvidence(file);
        const ext=(safeFile.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
        const path=warehouseId+"/"+u.id+"/"+Date.now()+"-"+type+"."+ext;
        const {error:up}=await supabase.storage.from("evidencias-caseta").upload(path,safeFile,{upsert:false,contentType:safeFile.type||"image/jpeg"});
        if(up) throw new Error("No se pudo guardar la foto de "+type+": "+up.message);
        const {error:ie}=await supabase.from("evidencias_caseta").insert({acceso_id:access.id,almacen_id:warehouseId,unidad_id:u.id,tipo,storage_path:path,creado_por:profile.id});
        if(ie) throw new Error("La foto de "+type+" se guardó, pero no se pudo registrar la evidencia: "+ie.message);
      }
      await saveEvidence(platePhoto,"placa");
      await saveEvidence(idPhoto,"identificacion");
      setForm({operador_nombre:"",linea_transporte:"",tracto_numero:"",tracto_placas:"",caja_numero:"",caja_placas:"",contacto:"",operacion_tipo:"recibo",cita_at:"",folio_cita:"",numero_sellos:""});
      setPlatePhoto(null); setIdPhoto(null); setPlatePreview(null); setIdPreview(null); setCitaLookup({loading:false,found:false,message:""});
      const plateInput=document.getElementById("plate-file"); if(plateInput) plateInput.value="";
      const idInput=document.getElementById("id-file"); if(idInput) idInput.value="";
      setNotice("Unidad registrada correctamente: "+f);
      await loadUnits();
    }catch(e){ setError(e.message||"No se pudo registrar la unidad."); }
    finally{ setBusy(false); }
  }

  async function updateUnit(id,patch,message){
    setBusy(true); setError(""); setNotice("");
    const {error:e}=await supabase.from("unidades").update({...patch,updated_at:new Date().toISOString()}).eq("id",id);
    if(e) setError(e.message); else { setNotice(message||"Actualizado."); await loadUnits(); }
    setBusy(false);
  }

  async function createUser(e){
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try{
      const {data,error:e1}=await supabase.functions.invoke("admin-crear-usuario",{
        body:{username:newUser.username,nombre:newUser.nombre,rol:newUser.rol,almacen_id:newUser.almacen_id||null,password:newUser.password}
      });
      if(e1) throw e1;
      if(data?.error) throw new Error(data.error);
      setNotice("Usuario creado: "+newUser.username);
      setNewUser({username:"",nombre:"",rol:"caseta",almacen_id:"",password:""});
      await loadUsers();
    }catch(e){ setError(e.message||"No se pudo crear el usuario."); }
    finally{ setBusy(false); }
  }

  const counts=useMemo(()=>Object.fromEntries(Object.keys(stateLabels).map(k=>[k,units.filter(u=>u.estado===k).length])),[units]);
  const currentWarehouse=warehouses.find(w=>w.id===(profile?.almacen_id||warehouses[0]?.id));

  if(loading) return <div className="boot"><div className="brand-dot">OP</div><h1>OP360</h1><p>Cargando operación…</p></div>;
  if(!supabaseConfigured) return <div className="boot"><div className="brand-dot">OP</div><h1>OP360</h1><p>Supabase no está configurado.</p></div>;
  if(!session) return <Login login={login} setLogin={setLogin} submit={loginSubmit} busy={busy} error={error}/>;

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">OP</div><div><b>OP360</b><span>Operación y visibilidad</span></div></div>
      <div className="userbox"><b>{profile?.nombre||"Usuario"}</b><span>{ROLE_PROFILES[profile?.rol]?.label||profile?.rol||"sin rol"}</span></div>
      <nav>{MODULES.filter(m=>can(m[0])).map(m=><button key={m[0]} className={module===m[0]?"nav active":"nav"} onClick={()=>setModule(m[0])}><span>{icon(m[0])}</span><div><b>{m[1]}</b><small>{m[2]}</small></div></button>)}</nav>
      <button className="logout" onClick={logout}>Cerrar sesión</button>
    </aside>
    <main>
      <header className="topbar"><div><small>OP360 / {MODULES.find(m=>m[0]===module)?.[1]}</small><h2>{currentWarehouse?currentWarehouse.codigo+" · "+currentWarehouse.nombre:"Operación general"}</h2></div><div className="live"><i/> En línea</div></header>
      {error&&<div className="alert error">{error}<button onClick={()=>setError("")}>×</button></div>}
      {notice&&<div className="alert ok">{notice}<button onClick={()=>setNotice("")}>×</button></div>}
      <section className="content">
        {module==="caseta"&&<Caseta form={form} setForm={setForm} submit={registerUnit} units={units} busy={busy} platePhoto={platePhoto} setPlatePhoto={setPlatePhoto} idPhoto={idPhoto} setIdPhoto={setIdPhoto} citaLookup={citaLookup} buscarCita={buscarCita} profile={profile} onUpdate={(id,p,m)=>updateUnit(id,p,m)} platePreview={platePreview} setPlatePreview={setPlatePreview} idPreview={idPreview} setIdPreview={setIdPreview}/>}
        {module==="trafico"&&<Traffic units={units} counts={counts} reload={()=>loadUnits()}/>}
        {module==="rampas"&&<Ramps ramps={ramps} units={units} onUpdate={(id,p,m)=>updateUnit(id,p,m)} reload={()=>loadRamps()}/>}
        {module==="dispatch"&&<Dispatch units={units} onUpdate={(id,p,m)=>updateUnit(id,p,m)}/>}
        {module==="operacion"&&<Operation units={units} ramps={ramps} onUpdate={(id,p,m)=>updateUnit(id,p,m)}/>}
        {module==="csr"&&<CSR units={units} onUpdate={(id,p,m)=>updateUnit(id,p,m)}/>}
        {module==="monitor"&&<Monitor units={units} counts={counts} warehouse={currentWarehouse}/>}
        {module==="guardia"&&<Guardia units={units} profile={profile} onUpdate={(id,p,m)=>updateUnit(id,p,m)}/>}
        {module==="admin"&&<Admin users={users} warehouses={warehouses} form={newUser} setForm={setNewUser} submit={createUser} busy={busy}/>}
      </section>
    </main>
  </div>;
}

function Login({login,setLogin,submit,busy,error}){
 return <div className="login-page"><div className="login-card"><div className="brand-mark big">OP</div><h1>OP360</h1><p>Operación y visibilidad logística</p><form onSubmit={submit}><label>Usuario o correo<input autoFocus value={login.user} onChange={e=>setLogin({...login,user:e.target.value})} placeholder="admin@op360.lat"/></label><label>Contraseña<input type="password" value={login.password} onChange={e=>setLogin({...login,password:e.target.value})} placeholder="••••••••"/></label>{error&&<div className="form-error">{error}</div>}<button className="primary full" disabled={busy}>{busy?"Entrando…":"Entrar a OP360"}</button></form></div></div>;
}

function Caseta({form,setForm,submit,units,busy,platePhoto,setPlatePhoto,idPhoto,setIdPhoto,citaLookup,buscarCita,profile,onUpdate,platePreview,setPlatePreview,idPreview,setIdPreview}){
 const f=(k,required=false,type="text")=><input type={type} required={required} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}/>;
 const capture=(type,e)=>{
   const input=e.currentTarget;
   const file=input?.files?.[0]||null;
   if(!file)return;
   const reader=new FileReader();
   reader.onload=()=>{
     const preview=String(reader.result||"");
     if(type==="plate"){setPlatePhoto(file);setPlatePreview(preview);}
     else{setIdPhoto(file);setIdPreview(preview);}
   };
   reader.readAsDataURL(file);
 };
 const salida=units.filter(u=>u.estado==="documentacion");
 return <><Page title="Caseta" sub="Registro de ingreso. El gafete no interviene en este flujo."/>
 <div className="grid2">
  <form className="panel" onSubmit={submit}>
   <h3>Registrar unidad</h3>
   <div className="formgrid">
    <label>No. de cita (folio) opcional><div className="inline-field"><input type="text" value={form.folio_cita} onChange={e=>setForm({...form,folio_cita:e.target.value})} onBlur={buscarCita} placeholder="Ej. C-1002-1"/><button type="button" className="secondary" onClick={buscarCita} disabled={citaLookup.loading}>{citaLookup.loading?"Buscando…":"Buscar"}</button></div>{citaLookup.message&&<small className={citaLookup.found?"lookup-ok":"lookup-note"}>{citaLookup.message}</small>}</label>
    <label>Operador *{f("operador_nombre",true)}</label><label>Línea de transporte *{f("linea_transporte",true)}</label>
    <label>No. de Tracto *{f("tracto_numero",true)}</label><label>Placas del tracto *{f("tracto_placas",true)}</label>
    <label>No. de Caja *{f("caja_numero",true)}</label><label>Placas de caja *{f("caja_placas",true)}</label>
    <label>Contacto *{f("contacto",true,"tel")}</label>
    <label>Tipo de operación *<select required value={form.operacion_tipo} onChange={e=>setForm({...form,operacion_tipo:e.target.value})}><option value="recibo">Recibo</option><option value="embarque">Embarque</option></select></label>
   </div>
   <div className="evidence-grid">
    <label htmlFor="plate-file" className={"evidence-tile evidence-click "+(platePreview?"has-photo":"")}>
      <input id="plate-file" className="evidence-input-camera" type="file" accept="image/*" capture="environment" onChange={e=>capture("plate",e)}/>
      {platePreview?<><img className="evidence-photo" src={platePreview} alt="Foto de placa"/><span className="evidence-confirm">✓ Placa capturada · tocar para cambiar</span></>:<><span className="evidence-icon">📷</span><strong>Foto de placa</strong><small>Toca para tomar la foto de placa</small></>}
    </label>
    <label htmlFor="id-file" className={"evidence-tile evidence-click "+(idPreview?"has-photo":"")}>
      <input id="id-file" className="evidence-input-camera" type="file" accept="image/*" capture="environment" onChange={e=>capture("id",e)}/>
      {idPreview?<><img className="evidence-photo" src={idPreview} alt="Foto de ID / INE"/><span className="evidence-confirm">✓ ID capturada · tocar para cambiar</span></>:<><span className="evidence-icon">🪪</span><strong>Foto de ID / INE</strong><small>Toca para tomar la foto de ID / INE</small></>}
    </label>
   </div>
   <p className="form-note">El gafete no se pide para registrar el ingreso. Las dos fotografías son obligatorias y se previsualizan antes de registrar.</p>
   <button className="primary" disabled={busy}>{busy?"Guardando y enviando evidencia…":"Registrar y enviar a Dispatch"}</button>
  </form>
  <div className="panel"><h3>Últimos ingresos</h3><UnitTable units={units.slice(0,8)}/></div>
 </div>
 <div className="panel exit-panel"><h3>Salida de unidades</h3><p className="section-copy">Caseta también controla la salida de los guardias.</p>
  {salida.length===0?<Empty text="No hay unidades pendientes de salida."/>:salida.slice(0,20).map(u=><div className="unit-card" key={"salida-"+u.id}><UnitMain u={u}/><div><small>Estado: {stateLabels[u.estado]||u.estado}{u.operacion_tipo==="embarque"&&u.numero_sellos!=null?" · Sellos: "+u.numero_sellos:""}</small><div className="actions"><button className="primary" disabled={busy} onClick={()=>{if(u.operacion_tipo==="embarque"){setExitSeal(u)}else{onUpdate(u.id,{estado:"liberada",salida_caseta_at:new Date().toISOString(),guardia_salida_usuario_id:profile?.id||null,salida_autorizada:true,salida_autorizada_at:new Date().toISOString()},"Salida registrada para "+u.folio+".")}}}>Dar salida</button></div></div></div>)}
 </div></>;
}

function Traffic({units,counts,reload}){return <><Page title="Tráfico" sub="Seguimiento de unidades por etapa."/><div className="metrics">{[["en_caseta","EN CASETA"],["espera_turno","ESPERA"],["rampa_asignada","RAMPA"],["en_operacion","OPERACIÓN"],["liberada","LIBERADAS"]].map(([k,l])=><div className="metric" key={k}><span>{l}</span><b>{counts[k]||0}</b></div>)}</div><div className="panel"><PanelHead title="Flujo de unidades" action={<button className="secondary" onClick={reload}>Actualizar</button>}/><UnitTable units={units}/></div></>}

function Ramps({ramps,units,onUpdate,reload}){const waiting=units.filter(u=>u.estado==="espera_turno"&&!u.rampa_id);return <><Page title="Rampas" sub="Disponibilidad y asignación."/><div className="panel assign-panel"><h3>Unidades esperando rampa</h3>{waiting.length===0?<Empty text="No hay unidades esperando asignación."/>:waiting.slice(0,10).map(u=><div className="unit-card" key={u.id}><UnitMain u={u}/><div className="actions">{ramps.filter(r=>r.estado==="operativa"&&r.activa).slice(0,8).map(r=><button className="secondary" key={r.id} onClick={()=>onUpdate(u.id,{rampa_id:r.id,estado:"rampa_asignada"},"Rampa "+r.codigo+" asignada a "+u.folio+".")}>{r.codigo}</button>)}</div></div>)}</div><div className="ramp-grid">{ramps.map(r=>{const u=units.find(x=>x.rampa_id===r.id&&!["liberada","cancelada"].includes(x.estado));return <div className={"ramp "+(r.estado==="operativa"?"ready":"down")} key={r.id}><div><b>{r.codigo}</b><span>{r.nombre}</span></div><strong>{u?u.folio:"LIBRE"}</strong><small>{r.estado}</small>{u&&<button className="secondary" onClick={()=>onUpdate(u.id,{estado:"en_operacion",operacion_inicio_at:new Date().toISOString()},"Operación iniciada.")}>Iniciar operación</button>}</div>})}</div></>}

function Dispatch({units,onUpdate}){
 const pending=units.filter(u=>["en_caseta","validando","espera_turno"].includes(u.estado));
 const [evidence,setEvidence]=useState(null); const [loadingEvidence,setLoadingEvidence]=useState(false);
 async function verEvidencia(u){
  setLoadingEvidence(true); setEvidence({folio:u.folio,items:[]});
  try{
    const {data,error}=await supabase.from("evidencias_caseta").select("id,tipo,storage_path,created_at").eq("unidad_id",u.id).order("created_at",{ascending:true});
    if(error) throw error;
    if(!data?.length){setEvidence({folio:u.folio,items:[]});return;}
    const withTimeout=(promise,ms=8000)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error("Tiempo de espera agotado al cargar la evidencia.")),ms))]);
    const results=await Promise.all(data.map(async item=>{
      try{
        const {data:urlData,error:urlError}=await withTimeout(supabase.storage.from("evidencias-caseta").createSignedUrl(item.storage_path,900));
        return !urlError&&urlData?.signedUrl?{...item,url:urlData.signedUrl}:null;
      }catch{return null;}
    }));
    const items=results.filter(Boolean);
    setEvidence({folio:u.folio,items,error:items.length?"":"No fue posible obtener las fotografías. Verifica el acceso al almacenamiento."});
  }catch(e){setEvidence({folio:u.folio,error:e.message||"No se pudo cargar la evidencia.",items:[]});}
  finally{setLoadingEvidence(false);}
 }
 return <><Page title="Dispatch" sub="Control de llegada, cita y transporte."/><div className="panel"><PanelHead title={"Pendientes: "+pending.length}/>{pending.map(u=><div className="unit-card" key={u.id}><UnitMain u={u}/><div className="actions"><button className="secondary" onClick={()=>verEvidencia(u)}>📷 Ver evidencia</button><button className="secondary" onClick={()=>{const msg=["OP360 · Seguimiento de unidad","Folio: "+u.folio,"Operador: "+(u.operador_nombre||"—"),"Transporte: "+(u.linea_transporte||"—"),"Tracto: "+(u.tracto_placas||"—"),"Caja: "+(u.caja_placas||"—"),"Operación: "+(u.operacion_tipo==="embarque"?"Embarque":"Recibo"),"Estado: "+(stateLabels[u.estado]||u.estado)].join("\n");window.open("https://wa.me/?text="+encodeURIComponent(msg),"_blank","noopener,noreferrer")}}>💬 WhatsApp</button><button className="primary" onClick={()=>onUpdate(u.id,{estado:"espera_turno"},"Unidad confirmada por Dispatch.")}>Confirmar llegada</button><button className="secondary" onClick={()=>onUpdate(u.id,{estado:"incidencia"},"Unidad marcada con incidencia.")}>Incidencia</button></div></div>)}</div>{evidence&&<div className="modal-backdrop" onClick={()=>setEvidence(null)}><div className="evidence-modal" onClick={e=>e.stopPropagation()}><div className="panel-head"><h3>Evidencia · {evidence.folio}</h3><button className="secondary" onClick={()=>setEvidence(null)}>Cerrar</button></div>{loadingEvidence?<Empty text="Cargando fotografías…"/>:evidence.error?<div className="form-error">{evidence.error}</div>:evidence.items.length===0?<Empty text="No hay fotografías de evidencia para esta unidad."/>:<div className="evidence-grid">{evidence.items.map(x=><div className="evidence-card" key={x.id}><b>{x.tipo==="placa"?"Placas":"ID / identificación"}</b><img src={x.url} alt={x.tipo}/><small>{new Date(x.created_at).toLocaleString("es-MX")}</small></div>)}</div>}</div></div>}</>}

function Operation({units,ramps,onUpdate}){const active=units.filter(u=>["rampa_asignada","en_operacion"].includes(u.estado));return <><Page title="Operación" sub="Control de rampa y proceso."/><div className="panel">{active.length===0?<Empty text="No hay unidades en operación."/>:active.map(u=><div className="unit-card" key={u.id}><UnitMain u={u}/><div className="actions">{u.estado==="rampa_asignada"&&<button className="primary" onClick={()=>onUpdate(u.id,{estado:"en_operacion",operacion_inicio_at:new Date().toISOString()},"Operación iniciada.")}>Iniciar</button>}{u.estado==="en_operacion"&&<button className="primary" onClick={()=>onUpdate(u.id,{estado:"documentacion",operacion_fin_at:new Date().toISOString()},"Operación terminada; pasó a documentación.")}>Terminar operación</button>}</div></div>)}</div></>}

function CSR({units,onUpdate}){const list=units.filter(u=>["documentacion","espera_turno"].includes(u.estado));return <><Page title="CSR" sub="Citas y validación documental."/><div className="panel">{list.length===0?<Empty text="No hay unidades pendientes de CSR."/>:list.map(u=><div className="unit-card" key={u.id}><UnitMain u={u}/><div className="actions"><button className="primary" onClick={()=>onUpdate(u.id,{cita_confirmada:true,csr_confirmacion_at:new Date().toISOString(),estado:"rampa_asignada"},"CSR confirmó la unidad.")}>Confirmar y enviar a rampa</button><button className="secondary" onClick={()=>onUpdate(u.id,{estado:"incidencia"},"CSR marcó incidencia.")}>Revisión</button></div></div>)}</div></>}
function Guardia({units,profile,onUpdate}){const active=units.filter(u=>u.estado==="documentacion");return <><Page title="Guardia" sub="Control de salida y liberación de unidades."/><div className="panel"><PanelHead title={"Unidades para salida: "+active.length}/>{active.length===0?<Empty text="No hay unidades pendientes de salida."/>:active.map(u=><div className="unit-card" key={u.id}><UnitMain u={u}/><div><small>Estado: {stateLabels[u.estado]||u.estado}{u.operacion_tipo==="embarque"&&u.numero_sellos!=null?" · Sellos: "+u.numero_sellos:""}</small><div className="actions"><button className="primary" onClick={()=>onUpdate(u.id,{estado:"liberada",salida_caseta_at:new Date().toISOString(),guardia_salida_usuario_id:profile?.id||null,salida_autorizada:true,salida_autorizada_at:new Date().toISOString()},"Salida registrada para "+u.folio+".")}>Dar salida</button></div></div></div>)}</div></>}

function Monitor({units,counts,warehouse}){return <><Page title="Monitor 360" sub={warehouse?warehouse.nombre:"Vista general"}/><div className="monitor-head"><div><b>{warehouse?.codigo||"OP360"}</b><span>Actualización al abrir cada vista</span></div><div className="live"><i/> OPERACIÓN ACTIVA</div></div><div className="monitor-grid">{Object.entries(stateLabels).map(([k,l])=><div className="monitor-box" key={k}><small>{l}</small><strong>{counts[k]||0}</strong></div>)}</div><div className="panel"><h3>Unidades activas</h3><UnitTable units={units.filter(u=>u.estado==="documentacion")}/></div></>}

function Admin({users,warehouses,form,setForm,submit,busy}){return <><Page title="Administración" sub="Usuarios, roles y almacenes."/><div className="grid2"><form className="panel" onSubmit={submit}><h3>Crear usuario</h3><div className="formgrid"><label>Usuario<input required pattern="[a-zA-Z0-9._-]{3,40}" value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></label><label>Nombre<input required value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})}/></label><label>Rol<select value={form.rol} onChange={e=>setForm({...form,rol:e.target.value})}>{ROLES.map(r=><option key={r} value={r}>{ROLE_PROFILES[r]?.label||r}</option>)}</select></label><label>Almacén<select value={form.almacen_id} onChange={e=>setForm({...form,almacen_id:e.target.value})}><option value="">Sin almacén</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.codigo} · {w.nombre}</option>)}</select></label><label>Contraseña<input required minLength="8" type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label></div><button className="primary" disabled={busy}>{busy?"Creando…":"Crear usuario"}</button></form><div className="panel"><h3>Usuarios y perfiles</h3><div className="user-list">{users.map(u=><div key={u.id}><div><b>{u.nombre}</b><span>{u.username||"sin usuario"} · {ROLE_PROFILES[u.rol]?.label||u.rol}</span></div><em className={u.activo?"pill on":"pill"}>{u.activo?"Activo":"Inactivo"}</em></div>)}</div></div></div></>}

function UnitTable({units}){return <div className="table-wrap">{units.length===0?<Empty text="No hay unidades registradas."/>:<table><thead><tr><th>Folio</th><th>Operador</th><th>Transporte</th><th>Tracto</th><th>Estado</th></tr></thead><tbody>{units.map(u=><tr key={u.id}><td><b>{u.folio}</b></td><td>{u.operador_nombre||"—"}</td><td>{u.linea_transporte||"—"}</td><td>{u.tracto_placas||"—"}</td><td><span className={clsState(u.estado)}>{stateLabels[u.estado]||u.estado}</span></td></tr>)}</tbody></table>}</div>}
function UnitMain({u}){return <div><b>{u.folio}</b><span>{u.operador_nombre} · {u.linea_transporte}</span><small>{u.tracto_placas} {u.caja_placas?"· "+u.caja_placas:""}</small></div>}
function Page({title,sub}){return <div className="page-title"><div><h1>{title}</h1><p>{sub}</p></div><span className="live"><i/> Tiempo real</span></div>}
function PanelHead({title,action}){return <div className="panel-head"><h3>{title}</h3>{action}</div>}
function Empty({text}){return <div className="empty">{text}</div>}
function icon(k){return ({caseta:"▣",trafico:"↔",rampas:"▥",dispatch:"◫",operacion:"⚙",csr:"✓",monitor:"▦",guardia:"⇥",admin:"⚙"})[k]||"•";}
