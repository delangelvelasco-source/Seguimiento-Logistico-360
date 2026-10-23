import Dispatch from "./Dispatch";
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
  en_caseta:"Caseta", validando:"Dispatch", espera_turno:"Espera de turno",
  rampa_asignada:"Rampa", en_operacion:"Operación", documentacion:"Documentación",
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
  useEffect(()=>{ if(profile?.rol==="caseta") setModule("caseta"); else if(profile?.rol==="monitor_almacen" || String(profile?.username||"").toLowerCase()==="mtorres") setModule("monitor"); },[profile?.rol,profile?.username]);
  const [login,setLogin]=useState({user:"",password:""});
  const [form,setForm]=useState({operador_nombre:"",linea_transporte:"",tipo_unidad:"tractocamion",tracto_numero:"",tracto_placas:"",caja_numero:"",caja_placas:"",contacto:"",operacion_tipo:"recibo",cita_at:"",folio_cita:"",numero_sellos:""});
  const [newUser,setNewUser]=useState({username:"",nombre:"",rol:"caseta",almacen_id:"",password:""});
  const [platePhoto,setPlatePhoto]=useState(null);
  const [idPhoto,setIdPhoto]=useState(null);
  const [citaLookup,setCitaLookup]=useState({loading:false,found:false,message:""});
  const [exitSeal,setExitSeal]=useState(null);
  const [platePreview,setPlatePreview]=useState(null);
  const [idPreview,setIdPreview]=useState(null);
  const [editUnit,setEditUnit]=useState(null);

  const allowed = roleModules[profile?.rol] || [];
  const can = key => allowed.includes(key);
  const monitorOnly = profile?.rol==="monitor_almacen" || String(profile?.username||"").toLowerCase()==="mtorres";

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
      .select("id,folio,operador_nombre,linea_transporte,tracto_numero,tracto_placas,caja_numero,caja_placas,contacto,cita_at,estado,rampa_id,ubicacion_tipo,almacen_id,operacion_tipo,numero_sellos,salida_autorizada,salida_caseta_at,created_at,updated_at")
      .eq("almacen_id",warehouseId).order("created_at",{ascending:false}).limit(500);
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
        folio:f, operador_nombre:form.operador_nombre.trim(), linea_transporte:form.linea_transporte.trim(), tipo_unidad:form.tipo_unidad||"tractocamion",
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
      async function saveEvidence(file,evidenceType){
        const safeFile=await compressEvidence(file);
        const ext=(safeFile.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
        const path=warehouseId+"/"+u.id+"/"+Date.now()+"-"+evidenceType+"."+ext;
        const {error:up}=await supabase.storage.from("evidencias-caseta").upload(path,safeFile,{upsert:false,contentType:safeFile.type||"image/jpeg"});
        if(up) throw new Error("No se pudo guardar la foto de "+evidenceType+": "+up.message);
        const {error:ie}=await supabase.from("evidencias_caseta").insert({acceso_id:access.id,almacen_id:warehouseId,unidad_id:u.id,tipo:evidenceType,storage_path:path,creado_por:profile.id});
        if(ie) throw new Error("La foto de "+evidenceType+" se guardó, pero no se pudo registrar la evidencia: "+ie.message);
      }
      await saveEvidence(platePhoto,"placa");
      await saveEvidence(idPhoto,"identificacion");
      const {data:verifiedEvidence,error:ve}=await supabase.from("evidencias_caseta").select("tipo").eq("unidad_id",u.id);
      if(ve) throw ve;
      const savedTypes=new Set((verifiedEvidence||[]).map(x=>x.tipo));
      if(!savedTypes.has("placa") || !savedTypes.has("identificacion")) throw new Error("La unidad se creó, pero faltó guardar una de las dos fotografías. No se limpió el formulario para evitar perder la evidencia.");
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
    try{
      const unit=units.find(u=>u.id===id);
      if(Object.prototype.hasOwnProperty.call(patch,"rampa_id")&&patch.rampa_id){
        const ramp=ramps.find(r=>r.id===patch.rampa_id);
        if(!ramp) throw new Error("No se encontró la rampa seleccionada en este almacén.");
        if(!ramp.activa||ramp.estado!=="operativa") throw new Error("No se puede asignar la unidad a "+(ramp.codigo||"esa rampa")+": está bloqueada o en mantenimiento.");
        if(unit?.almacen_id&&ramp.almacen_id&&unit.almacen_id!==ramp.almacen_id) throw new Error("La rampa pertenece a otro almacén.");
      }
      const safePatch={...patch,updated_at:new Date().toISOString()};
      // Al entrar a Documentación, la unidad ya salió físicamente de la rampa.
      // Liberar la asignación aquí centraliza la regla para todos los módulos que usan updateUnit.
      if(patch.estado==="documentacion" && unit?.rampa_id){
        safePatch.rampa_id=null;
        safePatch.ubicacion_tipo="patio";
      }else{
        if(Object.prototype.hasOwnProperty.call(patch,"rampa_id")&&patch.rampa_id) safePatch.ubicacion_tipo="rampa";
        if(Object.prototype.hasOwnProperty.call(patch,"rampa_id")&&!patch.rampa_id&&unit?.ubicacion_tipo==="rampa") safePatch.ubicacion_tipo="patio";
      }
      const {error:e}=await supabase.from("unidades").update(safePatch).eq("id",id);
      if(e) throw e;
      setNotice(message||"Actualizado.");
      await Promise.all([loadUnits(),loadRamps()]);
    }catch(e){setError(e.message||"No se pudo actualizar la unidad.");}
    finally{setBusy(false);}
  }

  async function saveEditUnit(patch){
    if(!editUnit) return;
    setBusy(true); setError(""); setNotice("");
    try{
      const clean={
        operador_nombre:String(patch.operador_nombre||"").trim(),
        linea_transporte:String(patch.linea_transporte||"").trim(),
        tracto_numero:String(patch.tracto_numero||"").trim(),
        tracto_placas:String(patch.tracto_placas||"").trim().toUpperCase(),
        caja_numero:String(patch.caja_numero||"").trim(),
        caja_placas:String(patch.caja_placas||"").trim().toUpperCase(),
        contacto:String(patch.contacto||"").trim(),
        operacion_tipo:patch.operacion_tipo||"recibo",
        numero_sellos:patch.operacion_tipo==="embarque" ? Number(patch.numero_sellos||0) : null
      };
      const {error:e}=await supabase.from("unidades").update({...clean,updated_at:new Date().toISOString()}).eq("id",editUnit.id);
      if(e) throw e;
      const {error:ae}=await supabase.from("accesos_caseta").update({
        nombre:clean.operador_nombre,empresa:clean.linea_transporte,telefono:clean.contacto,
        tracto_numero:clean.tracto_numero,tracto_placas:clean.tracto_placas,
        caja_numero:clean.caja_numero||null,caja_placas:clean.caja_placas||null,operacion_tipo:clean.operacion_tipo
      }).eq("unidad_id",editUnit.id);
      if(ae) throw ae;
      setEditUnit(null);
      setNotice("Datos actualizados correctamente.");
      await loadUnits();
    }catch(e){setError(e.message||"No se pudieron actualizar los datos.");}
    finally{setBusy(false);}
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
      {!monitorOnly&&<header className="topbar"><div><small>OP360 / {MODULES.find(m=>m[0]===module)?.[1]}</small><h2>{currentWarehouse?currentWarehouse.codigo+" · "+currentWarehouse.nombre:"Operación general"}</h2></div><div className="live"><i/> En línea</div></header>}
      {error&&<div className="alert error">{error}<button onClick={()=>setError("")}>×</button></div>}
      {notice&&<div className="alert ok">{notice}<button onClick={()=>setNotice("")}>×</button></div>}
      <section className="content">
        {module==="caseta"&&<Caseta form={form} setForm={setForm} submit={registerUnit} units={units} busy={busy} platePhoto={platePhoto} setPlatePhoto={setPlatePhoto} idPhoto={idPhoto} setIdPhoto={setIdPhoto} citaLookup={citaLookup} buscarCita={buscarCita} profile={profile} onUpdate={(id,p,m)=>updateUnit(id,p,m)} platePreview={platePreview} setPlatePreview={setPlatePreview} idPreview={idPreview} setIdPreview={setIdPreview}/>}
        {module==="trafico"&&<Traffic units={units} counts={counts} reload={()=>loadUnits()}/>}
        {module==="rampas"&&<Ramps ramps={ramps} units={units} onUpdate={(id,p,m)=>updateUnit(id,p,m)} reload={()=>loadRamps()}/>}
        {module==="dispatch"&&<Dispatch warehouseId={currentWarehouse?.id} onEdit={setEditUnit}/>}
        {module==="operacion"&&<Operation units={units} ramps={ramps} onUpdate={(id,p,m)=>updateUnit(id,p,m)}/>}
        {module==="csr"&&<CSR units={units} warehouseId={currentWarehouse?.id} onUpdate={(id,p,m)=>updateUnit(id,p,m)}/>}
        {module==="monitor"&&<Monitor units={units} counts={counts} warehouse={currentWarehouse} ramps={ramps}/>}
        {module==="guardia"&&<Guardia units={units} profile={profile} onUpdate={(id,p,m)=>updateUnit(id,p,m)}/>}
        {module==="admin"&&<Admin users={users} warehouses={warehouses} form={newUser} setForm={setNewUser} submit={createUser} busy={busy}/>}
      </section>
      {editUnit&&<EditUnitModal unit={editUnit} onClose={()=>setEditUnit(null)} onSave={saveEditUnit} busy={busy}/>}

    </main>
  </div>;
}

function Login({login,setLogin,submit,busy,error}){
 return <div className="login-page"><div className="login-card"><div className="brand-mark big">OP</div><h1>OP360</h1><p>Operación y visibilidad logística</p><form onSubmit={submit}><label>Usuario o correo<input autoFocus value={login.user} onChange={e=>setLogin({...login,user:e.target.value})} placeholder="admin@op360.lat"/></label><label>Contraseña<input type="password" value={login.password} onChange={e=>setLogin({...login,password:e.target.value})} placeholder="••••••••"/></label>{error&&<div className="form-error">{error}</div>}<button className="primary full" disabled={busy}>{busy?"Entrando…":"Entrar a OP360"}</button></form></div></div>;
}

function Caseta({form,setForm,submit,units,busy,platePhoto,setPlatePhoto,idPhoto,setIdPhoto,citaLookup,buscarCita,profile,onUpdate,platePreview,setPlatePreview,idPreview,setIdPreview}){
 const [casetaTab,setCasetaTab]=useState("ingreso");
 const [sealsByUnit,setSealsByUnit]=useState({});
 const [sealLoading,setSealLoading]=useState(false);
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
 const salida=units.filter(u=>u.salida_autorizada===true&&u.estado==="liberada"&&!u.salida_caseta_at);
 useEffect(()=>{let alive=true;async function loadSeals(){const ids=salida.map(u=>u.id);if(!ids.length){setSealsByUnit({});return;}setSealLoading(true);const {data,error}=await supabase.from("sellos_unidad").select("id,unidad_id,numero_fisico,numero_documentado,origen,resultado,observaciones").in("unidad_id",ids);if(alive&&!error){const grouped={};for(const seal of (data||[])){(grouped[seal.unidad_id]||(grouped[seal.unidad_id]=[])).push(seal);}setSealsByUnit(grouped);}if(alive)setSealLoading(false);}loadSeals();return()=>{alive=false}},[casetaTab,units.map(u=>u.id+":"+u.salida_autorizada+":"+u.salida_caseta_at).join("|")]);
  async function verifyExit(u){
    const expected=(sealsByUnit[u.id]||[])
      .filter(x=>x.origen==="dispatch")
      .map(x=>String(x.numero_fisico||"").trim())
      .filter(Boolean);
    const box=u.caja_numero||u.caja_placas||"SIN CAJA";
    const line=u.linea_transporte||"SIN LÍNEA DE TRANSPORTE";
    const typed=window.prompt(
      "Captura el sello físico para la caja "+box+" · Línea de transporte: "+line+". Si la unidad no trae sello, escribe NA."+
      (expected.length?"\nSellos registrados por Dispatch: "+expected.join(", "):"\nDispatch no tiene sellos registrados."),
      ""
    );
    if(typed===null)return;
    const physical=typed.trim().toUpperCase();
    const noSeal=physical==="NA";
    if(!physical){window.alert("Captura un número de sello o NA si no trae sello.");return;}
    const match=noSeal?expected.length===0:expected.includes(physical);
    const {data:userData}=await supabase.auth.getUser();
    const now=new Date().toISOString();
    const {error}=await supabase.from("sellos_unidad").insert({
      unidad_id:u.id,numero_fisico:physical,numero_documentado:expected.join(", ")||null,
      origen:"guardia",resultado:noSeal?"no_aplica":match?"coincide":"discrepancia",
      requiere_revision:!match&&!noSeal,
      motivo_revision:noSeal?"Unidad declarada sin sello":match?null:"Sello físico no coincide con los registrados por Dispatch",
      colocado_por:userData?.user?.id||null,verificado_por:userData?.user?.id||null,
      verificado_at:now,
      observaciones:noSeal?"Guardia confirma que la unidad no trae sello.":match?"Sello verificado por guardia; coincide con Dispatch.":"Salida retenida: validar discrepancia de sellos.",
      created_by:userData?.user?.id||null,updated_at:now
    });
    if(error){window.alert("No se pudo guardar la validación: "+error.message);return;}
    if(!match&&!noSeal){
      window.alert("NO COINCIDE o no existe sello de Dispatch. La salida queda pendiente para revisión.");
      const {data}=await supabase.from("sellos_unidad").select("id,unidad_id,numero_fisico,numero_documentado,origen,resultado,observaciones").in("unidad_id",[u.id]);
      setSealsByUnit(prev=>({...prev,[u.id]:data||[]}));
      return;
    }
    const {error:updateError}=await supabase.from("unidades").update({salida_caseta_at:now,guardia_salida_usuario_id:userData?.user?.id||null,updated_at:now}).eq("id",u.id).eq("salida_autorizada",true);
    if(updateError){window.alert("Sello validado, pero no se pudo registrar la salida: "+updateError.message);return;}
    window.alert(noSeal?"Se registró NA: unidad sin sello. Salida registrada para "+u.folio+".":"Sello coincide. Salida registrada para "+u.folio+".");
    await onUpdate(u.id,{salida_caseta_at:now,guardia_salida_usuario_id:userData?.user?.id||null},"Salida validada para "+u.folio+".");
    const {data:refreshSeals}=await supabase.from("sellos_unidad").select("id,unidad_id,numero_fisico,numero_documentado,origen,resultado,observaciones").in("unidad_id",[u.id]);
    setSealsByUnit(prev=>({...prev,[u.id]:refreshSeals||[]}));
  }

 return <><Page title="Caseta" sub="Registro de ingreso y control de salida del almacén."/>
 <div className="m360-ops-tabs caseta-tabs"><button type="button" className={casetaTab==="ingreso"?"selected":""} onClick={()=>setCasetaTab("ingreso")}>Registrar ingreso</button><button type="button" className={casetaTab==="salida"?"selected":""} onClick={()=>setCasetaTab("salida")}>Registrar salida <b>{salida.length}</b></button></div>
 {casetaTab==="ingreso"&&<div className="grid2">
  <form className="panel" onSubmit={submit}>
   <h3>Registrar unidad</h3>
   <div className="formgrid">
    <label>No. de cita (folio) opcional><div className="inline-field"><input type="text" value={form.folio_cita} onChange={e=>setForm({...form,folio_cita:e.target.value})} onBlur={buscarCita} placeholder="Ej. C-1002-1"/><button type="button" className="secondary" onClick={buscarCita} disabled={citaLookup.loading}>{citaLookup.loading?"Buscando…":"Buscar"}</button></div>{citaLookup.message&&<small className={citaLookup.found?"lookup-ok":"lookup-note"}>{citaLookup.message}</small>}</label>
    <label>Operador *{f("operador_nombre",true)}</label><label>Línea de transporte / empresa *{f("linea_transporte",true)}</label><label>Tipo de unidad *<select required value={form.tipo_unidad||"tractocamion"} onChange={e=>setForm({...form,tipo_unidad:e.target.value})}><option value="contenedor">Contenedor</option><option value="tractocamion">Tráiler / tractocamión</option><option value="plataforma">Plataforma</option><option value="esquita">Esquita</option><option value="rabon">Rabón</option><option value="camion_3_5">Camión 3.5 toneladas</option><option value="van">Van</option><option value="particular">Vehículo particular</option><option value="otro">Otro</option></select></label>
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
 </div>}
 {casetaTab==="salida"&&<div className="panel exit-panel"><h3>Unidades liberadas por Dispatch · Validación de sellos</h3><p className="section-copy">Captura el sello físico que presenta el guardia. La salida solo se registra si coincide con un sello registrado por Dispatch.</p>
  {sealLoading&&<p>Consultando sellos…</p>}
  {salida.length===0?<Empty text="No hay unidades liberadas por Dispatch pendientes de validar en este almacén."/>:salida.slice(0,100).map(u=>{const seals=sealsByUnit[u.id]||[];const expected=seals.filter(x=>x.origen==="dispatch");const guard=seals.filter(x=>x.origen==="guardia");const lastGuard=guard[guard.length-1];const alreadyVerified=guard.some(x=>x.resultado==="coincide");return <div className="unit-card" key={"salida-"+u.id}><UnitMain u={u}/><div><small>{u.operacion_tipo==="embarque"?"Embarque":"Recibo"} · Sellos de Dispatch: {expected.length?expected.map(x=>x.numero_fisico).join(", "):"SIN REGISTRO"}{lastGuard?" · Última validación: "+lastGuard.resultado:""}</small><div className="actions"><button className="primary" type="button" disabled={busy||sealLoading||alreadyVerified} onClick={()=>verifyExit(u)}>{alreadyVerified?"Sello validado":"Validar sello y registrar salida"}</button></div></div></div>})}
 </div>}
 </>;
}

function Traffic({units,counts,reload}){
 const [stage,setStage]=useState("todos");
 const [search,setSearch]=useState("");
 const stages=[
  ["en_caseta","1","CASETA","Ingreso"],
  ["validando","2","VALIDACIÓN","Dispatch"],
  ["espera_turno","3","ESPERA","Turno"],
  ["rampa_asignada","4","RAMPA","Asignada"],
  ["en_operacion","5","OPERACIÓN","En proceso"],
  ["documentacion","6","SALIDA","Documentación"],
  ["liberada","✓","LIBERADAS","Finalizadas"]
 ];
 const active=units.filter(u=>!["cancelada","incidencia"].includes(u.estado));
 const filtered=active.filter(u=>{
  const q=search.trim().toLowerCase();
  const matchesStage=stage==="todos"||u.estado===stage;
  const hay=q===""||[u.folio,u.operador_nombre,u.linea_transporte,u.tracto_placas,u.caja_placas].some(v=>String(v||"").toLowerCase().includes(q));
  return matchesStage&&hay;
 });
 return <><Page title="Tráfico" sub="Centro de control del flujo de unidades. Cada etapa indica qué debe suceder después."/>
 <div className="traffic-command">
  <div className="traffic-command-main"><span className="traffic-kicker">CONTROL EN TIEMPO REAL</span><strong>{active.length} unidades activas</strong><small>Selecciona una etapa para ver únicamente las unidades que requieren atención.</small></div>
  <div className="traffic-command-actions"><button className="secondary" onClick={reload}>↻ Actualizar</button></div>
 </div>
 <div className="traffic-flow">
  <button className={"flow-stage "+(stage==="todos"?"selected":"")} onClick={()=>setStage("todos")}><span className="flow-num">ALL</span><b>TODAS</b><small>{active.length} unidades</small></button>
  {stages.map(([key,num,label,sub],i)=><React.Fragment key={key}>
   {i>0&&<span className="flow-arrow">→</span>}
   <button className={"flow-stage "+(stage===key?"selected":"")} onClick={()=>setStage(key)}>
    <span className="flow-num">{num}</span><b>{label}</b><small>{counts[key]||0} · {sub}</small>
   </button>
  </React.Fragment>)}
 </div>

 <div className="traffic-toolbar">
  <div className="traffic-search"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar folio, operador, transporte o placas…"/>{search&&<button onClick={()=>setSearch("")}>×</button>}</div>
  <div className="traffic-filter-label">{stage==="todos"?"Todas las unidades":(stateLabels[stage]||stage)} · {filtered.length}</div>
 </div>
 <div className="panel traffic-list"><PanelHead title="Unidades en flujo"/>
  {filtered.length===0?<Empty text="No hay unidades en esta etapa."/>:<div className="traffic-cards">{filtered.map(u=>{
    const next=stages.findIndex(x=>x[0]===u.estado);
    const nextLabel=next>=0&&next<stages.length-1?stages[next+1][2]:"";
    return <div className="traffic-card" key={u.id}>
      <div className="traffic-card-top"><div><strong>{u.folio||"Sin folio"}</strong><span>{u.operador_nombre||"Sin operador"} · {u.linea_transporte||"Sin transporte"}</span></div><span className={"traffic-state "+clsState(u.estado)}>{stateLabels[u.estado]||u.estado}</span></div>
      <div className="traffic-card-data"><span><small>TRACTO</small><b>{u.tracto_placas||"—"}</b></span><span><small>CAJA</small><b>{u.caja_placas||"—"}</b></span><span><small>OPERACIÓN</small><b>{u.operacion_tipo==="embarque"?"Embarque":"Recibo"}</b></span><span><small>RAMPA</small><b>{u.rampa_id?"Asignada":"—"}</b></span></div>
      <div className="traffic-card-next"><span>{nextLabel?<>Siguiente: <b>{nextLabel}</b></>:"Flujo concluido"}</span><span>Actualización automática</span></div>
    </div>
  })}</div>}
 </div>
 </>;
}
function Ramps({ramps,units,onUpdate,reload}){const waiting=units.filter(u=>u.estado==="espera_turno"&&!u.rampa_id);return <><Page title="Rampas" sub="Tablero visual de rampas en tiempo real."/><div className="ramp-legend"><span><i className="ramp-dot free"/>Libre</span><span><i className="ramp-dot staging"/>Enrampando</span><span><i className="ramp-dot working"/>Cargando / descargando</span><span><i className="ramp-dot leaving"/>Desenrampando</span><span><i className="ramp-dot wait"/>Espera / asignada</span><span><i className="ramp-dot down"/>Fuera de servicio</span></div><div className="panel assign-panel"><h3>Unidades esperando rampa</h3>{waiting.length===0?<Empty text="No hay unidades esperando asignación."/>:waiting.slice(0,10).map(u=><div className="unit-card" key={u.id}><UnitMain u={u}/><div className="actions">{ramps.filter(r=>r.estado==="operativa"&&r.activa).slice(0,8).map(r=><button className="secondary" key={r.id} onClick={()=>onUpdate(u.id,{rampa_id:r.id,estado:"rampa_asignada"},"Rampa "+r.codigo+" asignada a "+u.folio+".")}>{r.codigo}</button>)}</div></div>)}</div><div className="ramp-yard-head"><div><strong>Tablero de rampas</strong><span>19 posiciones · lectura visual del estado</span></div><b>{ramps.length}/19</b></div><div className="ramp-yard-grid">{ramps.slice().sort((a,b)=>String(a.codigo||"").localeCompare(String(b.codigo||""),undefined,{numeric:true})).map(r=>{const u=units.find(x=>x.rampa_id===r.id&&!x.salida_caseta_at&&!["liberada","cancelada","completada"].includes(String(x.estado||"").toLowerCase()));let visual="free",label="DISPONIBLE";if(r.estado!=="operativa"||!r.activa){visual="down";label=String(r.estado||"").toLowerCase().includes("mantenimiento")?"EN MANTENIMIENTO":"FUERA DE SERVICIO"}else if(u?.estado==="rampa_asignada"){visual="staging";label="ENRAMPANDO"}else if(u?.estado==="en_operacion"){visual="working";label=u.operacion_tipo==="embarque"?"CARGANDO":"DESCARGANDO"}else if(u?.estado==="documentacion"){visual="leaving";label="DESENRAMPANDO"}else if(u){visual="wait";label="ASIGNADA"}return <div className={"ramp-yard-tile ramp-"+visual} key={r.id}><div className="ramp-yard-number">{String(r.codigo||"").replace(/^Rampa\s*/i,"").replace(/^R/i,"").padStart(2,"0")}</div><div className="ramp-yard-door"><span/></div><div className="ramp-yard-info">{u?<><div className="ramp-yard-carrier"><span className="ramp-yard-mark">{transportInitials(u.linea_transporte)}</span><b>{u.linea_transporte||"Sin transporte"}</b></div><strong>{u.folio||"Unidad asignada"}</strong><small>{u.operador_nombre||"Sin operador"}</small><div className="ramp-yard-plates"><span>Tracto {u.tracto_placas||"—"}</span><span>Caja {u.caja_placas||"—"}</span></div><em>{label}</em></>:<><strong>{label}</strong><small>{String(r.estado||"operativa").replaceAll("_"," ")}</small>{r.motivo&&<small>{r.motivo}</small>}</>}</div>{u&&u.estado==="rampa_asignada"&&<button className="secondary ramp-yard-action" onClick={()=>onUpdate(u.id,{estado:"en_operacion",operacion_inicio_at:new Date().toISOString()},"Operación iniciada en "+r.codigo+".")}>Iniciar {u.operacion_tipo==="embarque"?"carga":"descarga"}</button>}{u&&u.estado==="en_operacion"&&<span className="ramp-live">● Operación en curso</span>}</div>})}</div></>}

function Operation({units,ramps,onUpdate}){const active=units.filter(u=>["rampa_asignada","en_operacion"].includes(u.estado));return <><Page title="Operación" sub="Inicia carga o descarga desde la rampa asignada."/><div className="panel operation-board">{active.length===0?<Empty text="No hay unidades asignadas a una rampa."/>:active.map(u=>{const r=ramps.find(x=>x.id===u.rampa_id);const isLoad=u.operacion_tipo==="embarque";return <div className={"unit-card operation-row operation-"+u.estado} key={u.id}><div><UnitMain u={u}/><small>{r?("Rampa "+r.codigo+" · "+r.nombre):"Sin rampa"} · {isLoad?"Embarque / Carga":"Recibo / Descarga"}</small></div><div className="actions">{u.estado==="rampa_asignada"&&<button className="primary" onClick={()=>onUpdate(u.id,{estado:"en_operacion",operacion_inicio_at:new Date().toISOString()},""+(isLoad?"Carga":"Descarga")+" iniciada en "+(r?.codigo||"la rampa")+"." )}>Iniciar {isLoad?"carga":"descarga"}</button>}{u.estado==="en_operacion"&&<button className="primary" onClick={()=>onUpdate(u.id,{estado:"documentacion",operacion_fin_at:new Date().toISOString()},""+(isLoad?"Carga":"Descarga")+" terminada; pasó a documentación.")}>Terminar {isLoad?"carga":"descarga"}</button>}</div></div>})}</div></>}

function CSR({units,onUpdate,warehouseId}){
 const [selectedDay,setSelectedDay]=useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;});
 const [month,setMonth]=useState(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1);});
 const [appointments,setAppointments]=useState([]);
 const [loadingAppointments,setLoadingAppointments]=useState(false);
 const [appointmentError,setAppointmentError]=useState("");
 const [showAddAppointment,setShowAddAppointment]=useState(false);
 const [editingAppointment,setEditingAppointment]=useState(null);
 const [savingAppointment,setSavingAppointment]=useState(false);
 const [appointmentMessage,setAppointmentMessage]=useState("");
 const [newAppointment,setNewAppointment]=useState({tipo_operacion:"recibo",hora_inicio:"08:00",referencia:"",cuenta_cliente:"",pallets:"0",unidades_solicitadas:"1",linea_transporte:"",operador_nombre:"",tracto_numero:"",tracto_placas:"",caja_numero:"",caja_placas:""});
 const list=units.filter(u=>["documentacion","espera_turno"].includes(u.estado));
 const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
 const selectedLabel=new Date(selectedDay+"T12:00:00").toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
 useEffect(()=>{
  let alive=true;
  async function load(){
   if(!warehouseId){setAppointments([]);setAppointmentError("");return;}
   setLoadingAppointments(true);setAppointmentError("");
   const start=new Date(month.getFullYear(),month.getMonth(),1);
   const end=new Date(month.getFullYear(),month.getMonth()+1,1);
   const {data,error}=await supabase.from("citas")
    .select("id,folio,tipo_operacion,fecha,hora_inicio,hora_fin,referencia,cuenta_cliente,pallets,estado,cerrada_at,unidades_solicitadas")
    .eq("almacen_id",warehouseId).gte("fecha",dateKey(start)).lt("fecha",dateKey(end))
    .order("fecha").order("hora_inicio").limit(500);
   if(!alive)return;
   if(error){setAppointmentError("No se pudieron cargar las citas. Intenta actualizar en unos momentos.");setAppointments([]);}
   else setAppointments((data||[]).filter(a=>a.estado!=="cancelada"&&!a.cerrada_at));
   setLoadingAppointments(false);
  }
  load();
  const timer=setInterval(load,60000);
  return()=>{alive=false;clearInterval(timer)};
 },[warehouseId,month.getFullYear(),month.getMonth()]);
 const monthDays=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
 const firstDay=(new Date(month.getFullYear(),month.getMonth(),1).getDay()+6)%7;
 const dayCounts=appointments.reduce((acc,a)=>{acc[a.fecha]=(acc[a.fecha]||0)+1;return acc;},{});
 const selectedAppointments=appointments.filter(a=>a.fecha===selectedDay).sort((a,b)=>String(a.hora_inicio||"").localeCompare(String(b.hora_inicio||"")));
 const shiftMonth=delta=>{const next=new Date(month.getFullYear(),month.getMonth()+delta,1);setMonth(next);setSelectedDay(dateKey(next));};
 const fmtTime=t=>t?String(t).slice(0,5):"Hora pendiente";
 const selectedWeekday=new Date(selectedDay+"T12:00:00").getDay();
 const isBusinessDay=selectedWeekday>=1&&selectedWeekday<=6;
 const closeTime=selectedWeekday===6?13*60:18*60;
 const availableTimes=[];
 if(isBusinessDay){for(let m=8*60;m+30<=closeTime;m+=30){availableTimes.push(String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0"));}}
 const occupiedTimes=new Set(appointments.filter(a=>a.fecha===selectedDay&&a.id!==editingAppointment?.id&&a.estado!=="cancelada"&&!a.cerrada_at).map(a=>String(a.hora_inicio||"").slice(0,5)));
 const openTimes=availableTimes.filter(t=>!occupiedTimes.has(t));
 const todayKey=dateKey(new Date());
 async function editAppointment(a){
  setAppointmentError("");setAppointmentMessage("");
  const {data,error}=await supabase.from("cita_datos_precarga").select("linea_transporte,operador_nombre,tracto_numero,tracto_placas,caja_numero,caja_placas,observaciones").eq("cita_id",a.id).maybeSingle();
  if(error){setAppointmentError("No se pudieron cargar los datos de la cita: "+error.message);return;}
  const d=data||{};
  setEditingAppointment(a);
  setSelectedDay(a.fecha);
  setMonth(new Date(Number(a.fecha.slice(0,4)),Number(a.fecha.slice(5,7))-1,1));
  setNewAppointment({tipo_operacion:a.tipo_operacion||"recibo",hora_inicio:String(a.hora_inicio||"").slice(0,5),referencia:a.referencia||d.observaciones||"",cuenta_cliente:a.cuenta_cliente||"",pallets:String(a.pallets??"0"),unidades_solicitadas:String(a.unidades_solicitadas??"1"),linea_transporte:d.linea_transporte||"",operador_nombre:d.operador_nombre||"",tracto_numero:d.tracto_numero||"",tracto_placas:d.tracto_placas||"",caja_numero:d.caja_numero||"",caja_placas:d.caja_placas||""});
  setShowAddAppointment(true);
 }
 async function saveAppointment(e){
  e.preventDefault();setAppointmentError("");setAppointmentMessage("");
  if(!warehouseId){setAppointmentError("Selecciona un almacén antes de registrar la cita.");return;}
  if(selectedDay<todayKey){setAppointmentError("No puedes registrar una cita en una fecha pasada.");return;}
  if(!openTimes.includes(newAppointment.hora_inicio)){setAppointmentError("Ese horario ya tiene una cita registrada. Selecciona otro bloque disponible.");return;}
  const startMinutes=Number(newAppointment.hora_inicio.slice(0,2))*60+Number(newAppointment.hora_inicio.slice(3,5)),endMinutes=startMinutes+30;
  const conflicts=appointments.filter(a=>a.id!==editingAppointment?.id&&a.fecha===selectedDay&&a.estado!=="cancelada"&&!a.cerrada_at&&Number(String(a.hora_inicio||"00:00").slice(0,2))*60+Number(String(a.hora_inicio||"00:00").slice(3,5))<endMinutes&&Number(String(a.hora_fin||a.hora_inicio||"00:00").slice(0,2))*60+Number(String(a.hora_fin||a.hora_inicio||"00:00").slice(3,5))>startMinutes);
  if(conflicts.length>0){setAppointmentError("Ese bloque ya está ocupado por una cita previa. Elige otra hora.");return;}
  setSavingAppointment(true);
  try{
   const auth=await supabase.auth.getUser(),user=auth.data?.user;
   if(!user?.id){setAppointmentError("Tu sesión expiró. Inicia sesión nuevamente.");return;}
   if(editingAppointment){
    const endTime=String(Math.floor(endMinutes/60)).padStart(2,"0")+":"+String(endMinutes%60).padStart(2,"0");
    const updated=await supabase.from("citas").update({tipo_operacion:newAppointment.tipo_operacion,fecha:selectedDay,hora_inicio:newAppointment.hora_inicio,hora_fin:endTime,referencia:newAppointment.referencia.trim()||null,cuenta_cliente:newAppointment.cuenta_cliente.trim()||null,pallets:Number(newAppointment.pallets||0),unidades_solicitadas:Number(newAppointment.unidades_solicitadas||1),updated_at:new Date().toISOString()}).eq("id",editingAppointment.id).eq("almacen_id",warehouseId).select("id,folio").single();
    if(updated.error){setAppointmentError("No se pudo actualizar la cita: "+updated.error.message);return;}
    const p=await supabase.from("cita_datos_precarga").upsert({cita_id:editingAppointment.id,linea_transporte:newAppointment.linea_transporte.trim()||null,operador_nombre:newAppointment.operador_nombre.trim()||null,tracto_numero:newAppointment.tracto_numero.trim()||null,tracto_placas:newAppointment.tracto_placas.trim().toUpperCase()||null,caja_numero:newAppointment.caja_numero.trim()||null,caja_placas:newAppointment.caja_placas.trim().toUpperCase()||null,observaciones:newAppointment.referencia.trim()||null,actualizado_por:user.id},{onConflict:"cita_id"});
    if(p.error){setAppointmentError("La cita se actualizó, pero no se pudieron guardar los datos de transporte: "+p.error.message);return;}
    setAppointmentMessage("Cambios guardados · Folio "+(updated.data?.folio||editingAppointment.folio));
    setShowAddAppointment(false);setEditingAppointment(null);
    setNewAppointment({tipo_operacion:"recibo",hora_inicio:"",referencia:"",cuenta_cliente:"",pallets:"0",unidades_solicitadas:"1",linea_transporte:"",operador_nombre:"",tracto_numero:"",tracto_placas:"",caja_numero:"",caja_placas:""});
    const start=new Date(month.getFullYear(),month.getMonth(),1),end=new Date(month.getFullYear(),month.getMonth()+1,1);
    const fresh=await supabase.from("citas").select("id,folio,tipo_operacion,fecha,hora_inicio,hora_fin,referencia,cuenta_cliente,pallets,estado,cerrada_at,unidades_solicitadas").eq("almacen_id",warehouseId).gte("fecha",dateKey(start)).lt("fecha",dateKey(end)).order("fecha").order("hora_inicio").limit(500);
    if(!fresh.error)setAppointments((fresh.data||[]).filter(x=>x.estado!=="cancelada"&&!x.cerrada_at));
    return;
   }
   const fr=await supabase.rpc("generar_folio_cita",{p_fecha:selectedDay});
   if(fr.error){setAppointmentError("No se pudo generar el folio: "+fr.error.message);return;}
   const endTime=String(Math.floor(endMinutes/60)).padStart(2,"0")+":"+String(endMinutes%60).padStart(2,"0");
   const r=await supabase.from("citas").insert({almacen_id:warehouseId,csr_usuario_id:user.id,folio:fr.data,tipo_operacion:newAppointment.tipo_operacion,fecha:selectedDay,hora_inicio:newAppointment.hora_inicio,hora_fin:endTime,referencia:newAppointment.referencia.trim()||null,cuenta_cliente:newAppointment.cuenta_cliente.trim()||null,pallets:Number(newAppointment.pallets||0),estado:"borrador",unidades_solicitadas:Number(newAppointment.unidades_solicitadas||1)}).select("id,folio").single();
   if(r.error){setAppointmentError("No se pudo guardar la cita: "+r.error.message);return;}
   const p=await supabase.from("cita_datos_precarga").upsert({cita_id:r.data.id,linea_transporte:newAppointment.linea_transporte.trim()||null,operador_nombre:newAppointment.operador_nombre.trim()||null,tracto_numero:newAppointment.tracto_numero.trim()||null,tracto_placas:newAppointment.tracto_placas.trim().toUpperCase()||null,caja_numero:newAppointment.caja_numero.trim()||null,caja_placas:newAppointment.caja_placas.trim().toUpperCase()||null,observaciones:newAppointment.referencia.trim()||null,actualizado_por:user.id},{onConflict:"cita_id"});
   if(p.error){setAppointmentError("La cita "+r.data.folio+" se creó, pero faltó guardar los datos previos: "+p.error.message);return;}
   setAppointmentMessage("Cita registrada correctamente: "+r.data.folio);setShowAddAppointment(false);setEditingAppointment(null);setNewAppointment({tipo_operacion:"recibo",hora_inicio:"",referencia:"",cuenta_cliente:"",pallets:"0",unidades_solicitadas:"1",linea_transporte:"",operador_nombre:"",tracto_numero:"",tracto_placas:"",caja_numero:"",caja_placas:""});
   const start=new Date(month.getFullYear(),month.getMonth(),1),end=new Date(month.getFullYear(),month.getMonth()+1,1);
   const fresh=await supabase.from("citas").select("id,folio,tipo_operacion,fecha,hora_inicio,hora_fin,referencia,cuenta_cliente,pallets,estado,cerrada_at,unidades_solicitadas").eq("almacen_id",warehouseId).gte("fecha",dateKey(start)).lt("fecha",dateKey(end)).order("fecha").order("hora_inicio").limit(500);
   if(!fresh.error)setAppointments((fresh.data||[]).filter(x=>x.estado!=="cancelada"&&!x.cerrada_at));
  }catch(err){setAppointmentError("Ocurrió un error al registrar la cita. Intenta nuevamente.");}
  finally{setSavingAppointment(false);}
 }
 return <><Page title="CSR" sub="Calendario de citas y validación documental."/>
 <section className="panel csr-calendar-panel" style={{padding:20,marginBottom:16}}>
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:16}}>
   <div><h2 style={{margin:"0 0 5px",fontSize:21,color:"#172744"}}>Calendario de citas</h2><p style={{margin:0,color:"#71809a",fontSize:13}}>Citas del almacén · actualización automática cada minuto</p></div>
   <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="secondary" onClick={()=>{const d=new Date();setMonth(new Date(d.getFullYear(),d.getMonth(),1));setSelectedDay(dateKey(d));}}>Hoy</button><button className="primary" onClick={()=>{setAppointmentError("");setAppointmentMessage("");if(showAddAppointment){setShowAddAppointment(false);setEditingAppointment(null);}else{setEditingAppointment(null);setNewAppointment({tipo_operacion:"recibo",hora_inicio:openTimes[0]||"",referencia:"",cuenta_cliente:"",pallets:"0",unidades_solicitadas:"1",linea_transporte:"",operador_nombre:"",tracto_numero:"",tracto_placas:"",caja_numero:"",caja_placas:""});setShowAddAppointment(true);}}}>{showAddAppointment?"Cerrar":"＋ Agregar cita"}</button></div>
  </div>
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:14}}>
   <button className="secondary" aria-label="Mes anterior" onClick={()=>shiftMonth(-1)}>‹</button>
   <strong style={{fontSize:17,textTransform:"capitalize"}}>{month.toLocaleDateString("es-MX",{month:"long",year:"numeric"})}</strong>
   <button className="secondary" aria-label="Mes siguiente" onClick={()=>shiftMonth(1)}>›</button>
  </div>
  <div className="csr-calendar-grid" style={{display:"grid",gridTemplateColumns:"repeat(7,minmax(0,1fr))",gap:5}}>
   {["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(d=><div key={d} style={{textAlign:"center",fontSize:11,fontWeight:800,color:"#71809a",padding:"7px 0"}}>{d}</div>)}
   {Array.from({length:firstDay},(_,i)=><div key={"blank"+i}/>)}
   {Array.from({length:monthDays},(_,i)=>{const day=i+1;const key=dateKey(new Date(month.getFullYear(),month.getMonth(),day));const active=key===selectedDay;const count=dayCounts[key]||0;const todayKey=dateKey(new Date());return <button key={key} type="button" onClick={()=>setSelectedDay(key)} aria-label={day+" citas "+count} style={{minHeight:58,padding:"7px 2px",borderRadius:12,border:active?"2px solid #315fa8":key===todayKey?"1px solid #315fa8":"1px solid #e2e8f0",background:active?"#eaf1fc":"#fff",color:"#172744",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:5,boxShadow:active?"0 3px 10px #315fa81c":"none"}}>
    <span style={{fontSize:14,fontWeight:active?800:600}}>{day}</span>{count>0?<span style={{fontSize:10,fontWeight:800,background:"#315fa8",color:"#fff",borderRadius:20,minWidth:18,padding:"2px 5px"}}>{count}</span>:<span style={{height:14,fontSize:9,color:"#9aa6b8"}}>·</span>}
   </button>})}
  </div>
  <div style={{display:"flex",gap:14,flexWrap:"wrap",marginTop:12,fontSize:11,color:"#71809a"}}><span>● Citas programadas</span><span style={{color:"#315fa8"}}>Borde azul: día seleccionado</span></div>
 </section>
 <section className="panel csr-agenda-panel" style={{padding:20,marginBottom:16}}>
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:14}}>
   <div><h2 style={{margin:"0 0 5px",fontSize:19,color:"#172744",textTransform:"capitalize"}}>{selectedLabel}</h2><p style={{margin:0,fontSize:13,color:"#71809a"}}>Agenda de citas · {selectedAppointments.length} registradas</p></div>
   {loadingAppointments?<span style={{fontSize:12,color:"#71809a"}}>Actualizando…</span>:null}
  </div>
  {appointmentError?<div style={{padding:12,marginBottom:10,borderRadius:10,background:"#fff1f0",color:"#a12622",fontSize:13}}>{appointmentError}</div>:null}
  {appointmentMessage?<div style={{padding:12,marginBottom:10,borderRadius:10,background:"#e8f7ee",color:"#247449",fontSize:13,fontWeight:700}}>{appointmentMessage}</div>:null}
  {showAddAppointment&&<div role="dialog" aria-modal="true" aria-label={editingAppointment?"Editar cita":"Agregar cita"} onMouseDown={e=>{if(e.target===e.currentTarget){setShowAddAppointment(false);setEditingAppointment(null);}}} style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(15,23,42,.58)",display:"flex",alignItems:"center",justifyContent:"center",padding:14,overflowY:"auto"}}><form className="csr-appointment-form" onSubmit={saveAppointment} onClick={e=>e.stopPropagation()} style={{width:"min(780px,100%)",maxHeight:"calc(100vh - 28px)",overflowY:"auto",border:"1px solid #d9e4f3",background:"#f8fbff",borderRadius:14,padding:16,margin:"auto",boxShadow:"0 20px 60px rgba(15,23,42,.25)"}}>
   <h3 style={{margin:"0 0 5px",color:"#172744"}}>{editingAppointment?"Editar cita · "+editingAppointment.folio:"Nueva cita · "+selectedLabel}</h3>
   <p style={{margin:"0 0 14px",fontSize:12,color:"#60718b"}}>{selectedWeekday===0?"Domingo: no hay ventana de citas.":selectedWeekday===6?"Ventana del sábado: 08:00–13:00.":"Ventana de lunes a viernes: 08:00–18:00."} · Bloques de 30 minutos · cada horario admite una sola cita.</p>
   {!isBusinessDay?<div style={{fontSize:13,color:"#a12622"}}>Este día no tiene ventana de citas. Selecciona de lunes a sábado.</div>:<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12}}>
    <div className="csr-operation-field">
     <span className="csr-field-label">Tipo de operación <b>*</b></span>
     <div className="csr-operation-options" role="group" aria-label="Tipo de operación">
      <button type="button" className={newAppointment.tipo_operacion==="recibo"?"csr-operation-option selected":"csr-operation-option"} aria-pressed={newAppointment.tipo_operacion==="recibo"} onClick={()=>setNewAppointment({...newAppointment,tipo_operacion:"recibo"})}>
       <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M2 8h17v14H2zM19 12h6l5 6v4H19z" fill="currentColor" opacity=".18"/><path d="M3 9h15v13H3zM18 13h6l5 5v4H18z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><circle cx="8" cy="24" r="3" fill="currentColor"/><circle cx="24" cy="24" r="3" fill="currentColor"/><path d="M21 14v4h7" fill="none" stroke="currentColor" strokeWidth="2"/></svg>
       <strong>Recibo</strong><small>Entrada al almacén</small>
      </button>
      <button type="button" className={newAppointment.tipo_operacion==="embarque"?"csr-operation-option selected":"csr-operation-option"} aria-pressed={newAppointment.tipo_operacion==="embarque"} onClick={()=>setNewAppointment({...newAppointment,tipo_operacion:"embarque"})}>
       <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M2 8h17v14H2zM19 12h6l5 6v4H19z" fill="currentColor" opacity=".18"/><path d="M3 9h15v13H3zM18 13h6l5 5v4H18z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><circle cx="8" cy="24" r="3" fill="currentColor"/><circle cx="24" cy="24" r="3" fill="currentColor"/><path d="M21 14v4h7" fill="none" stroke="currentColor" strokeWidth="2"/></svg>
       <strong>Embarque</strong><small>Salida del almacén</small>
      </button>
     </div>
    </div>
    <label>Fecha de cita<input type="date" required min={todayKey} value={selectedDay} onChange={e=>{const v=e.target.value;if(!v)return;setSelectedDay(v);const d=new Date(v+"T12:00:00");setMonth(new Date(d.getFullYear(),d.getMonth(),1));setNewAppointment({...newAppointment,hora_inicio:""});}}/></label>
    <label>Horario disponible<select required value={newAppointment.hora_inicio} onChange={e=>setNewAppointment({...newAppointment,hora_inicio:e.target.value})}>{openTimes.map(t=><option key={t} value={t}>{t}–{String(Math.floor((Number(t.slice(0,2))*60+Number(t.slice(3,5))+30)/60)).padStart(2,"0")+":"+String((Number(t.slice(0,2))*60+Number(t.slice(3,5))+30)%60).padStart(2,"0")}</option>)}</select><small className="csr-slot-note">{openTimes.length} horarios disponibles para esta fecha</small></label>
    <label className="csr-field-client">Cuenta / cliente <b>*</b><input value={newAppointment.cuenta_cliente} onChange={e=>setNewAppointment({...newAppointment,cuenta_cliente:e.target.value})} placeholder="Nombre del cliente"/></label>
    <label>Referencia<input value={newAppointment.referencia} onChange={e=>setNewAppointment({...newAppointment,referencia:e.target.value})} placeholder="SID, RID o referencia"/></label>
    <label className="csr-field-carrier">Línea de transporte<input value={newAppointment.linea_transporte} onChange={e=>setNewAppointment({...newAppointment,linea_transporte:e.target.value})} placeholder="Nombre de la línea"/></label>
    <label>Operador<input value={newAppointment.operador_nombre} onChange={e=>setNewAppointment({...newAppointment,operador_nombre:e.target.value})} placeholder="Nombre del operador"/></label>
    <label>Pallets<input type="number" min="0" value={newAppointment.pallets} onChange={e=>setNewAppointment({...newAppointment,pallets:e.target.value})}/></label>
    <label>Unidades solicitadas <b>*</b><input type="number" min="1" max="2" required value={newAppointment.unidades_solicitadas} onChange={e=>setNewAppointment({...newAppointment,unidades_solicitadas:e.target.value})}/></label>
    <label>Número de tracto<input value={newAppointment.tracto_numero} onChange={e=>setNewAppointment({...newAppointment,tracto_numero:e.target.value})} placeholder="Ej. 1234"/></label>
    <label>Placas de tracto<input value={newAppointment.tracto_placas} onChange={e=>setNewAppointment({...newAppointment,tracto_placas:e.target.value.toUpperCase()})} placeholder="Ej. ABC-123"/></label>
    <label>Número de caja<input value={newAppointment.caja_numero} onChange={e=>setNewAppointment({...newAppointment,caja_numero:e.target.value})} placeholder="Ej. 001"/></label>
    <label>Placas de caja<input value={newAppointment.caja_placas} onChange={e=>setNewAppointment({...newAppointment,caja_placas:e.target.value.toUpperCase()})} placeholder="Ej. ABC-123"/></label>
   </div>}
   <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:14}}><button type="button" className="secondary" onClick={()=>{setShowAddAppointment(false);setEditingAppointment(null);setNewAppointment({tipo_operacion:"recibo",hora_inicio:"",referencia:"",cuenta_cliente:"",pallets:"0",unidades_solicitadas:"1",linea_transporte:"",operador_nombre:"",tracto_numero:"",tracto_placas:"",caja_numero:"",caja_placas:""});}}>Cancelar</button><button type="submit" className="primary" disabled={savingAppointment||!isBusinessDay||openTimes.length===0}>{savingAppointment?"Guardando…":openTimes.length===0?"Sin horarios disponibles":editingAppointment?"Guardar cambios":"Guardar cita"}</button></div>
  </form></div>}
  {!appointmentError&&selectedAppointments.length===0&&!loadingAppointments?<Empty text="No hay citas programadas para esta fecha."/>:null}
  {selectedAppointments.map(a=><article className="csr-appointment-card" key={a.id} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"14px 0",borderTop:"1px solid #edf0f5"}}>
   <div style={{minWidth:66,background:"#edf3fc",color:"#244f91",borderRadius:10,padding:"9px 6px",textAlign:"center",fontWeight:800,fontSize:13}}>{fmtTime(a.hora_inicio)}</div>
   <div style={{flex:1,minWidth:0}}><div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}><strong>{a.folio||"Cita sin folio"}</strong><span style={{fontSize:10,fontWeight:800,padding:"4px 7px",borderRadius:20,background:a.tipo_operacion==="embarque"?"#fff1df":"#e8f7ee",color:a.tipo_operacion==="embarque"?"#a55a10":"#247449"}}>{a.tipo_operacion==="embarque"?"Embarque":"Recibo"}</span></div>
    <p style={{margin:"5px 0",fontSize:13,color:"#52627b"}}>{a.cuenta_cliente||a.referencia||"Sin referencia de cliente"}</p>
    <small style={{color:"#71809a"}}>{a.hora_fin?"Hasta "+fmtTime(a.hora_fin)+" · ":""}{a.unidades_solicitadas!=null?a.unidades_solicitadas+" unidades · ":""}{a.estado==="borrador"?"Pendiente de confirmar":a.estado||"Programada"}</small><div style={{marginTop:8}}><button type="button" className="secondary" style={{fontSize:12,padding:"6px 10px"}} onClick={()=>editAppointment(a)}>✎ Editar cita</button></div>
   </div>
  </article>)}
 </section>
 <section className="panel"><PanelHead title={"Unidades pendientes de CSR: "+list.length}/>{list.length===0?<Empty text="No hay unidades pendientes de CSR."/>:list.map(u=><div className="unit-card" key={u.id}><UnitMain u={u}/><div className="actions"><button className="primary" onClick={()=>onUpdate(u.id,{cita_confirmada:true,csr_confirmacion_at:new Date().toISOString(),estado:"rampa_asignada"},"CSR confirmó la unidad.")}>Confirmar y enviar a rampa</button><button className="secondary" onClick={()=>onUpdate(u.id,{estado:"incidencia"},"CSR marcó incidencia.")}>Revisión</button></div></div>)}</section></>}

function EditUnitModal({unit,onClose,onSave,busy}){
 const [f,setF]=useState({operador_nombre:unit.operador_nombre||"",linea_transporte:unit.linea_transporte||"",tracto_numero:unit.tracto_numero||"",tracto_placas:unit.tracto_placas||"",caja_numero:unit.caja_numero||"",caja_placas:unit.caja_placas||"",contacto:unit.contacto||"",operacion_tipo:unit.operacion_tipo||"recibo",numero_sellos:unit.numero_sellos??""});
 const submit=async e=>{e.preventDefault();await onSave(f);};
 return <div className="modal-backdrop" onClick={onClose}><div className="edit-modal" onClick={e=>e.stopPropagation()}><div className="panel-head"><h3>Editar datos · {unit.folio}</h3><button className="secondary" type="button" onClick={onClose}>Cerrar</button></div><form onSubmit={submit} className="edit-form"><label>Operador *<input required value={f.operador_nombre} onChange={e=>setF({...f,operador_nombre:e.target.value})}/></label><label>Línea de transporte *<input required value={f.linea_transporte} onChange={e=>setF({...f,linea_transporte:e.target.value})}/></label><label>No. de Tracto *<input required value={f.tracto_numero} onChange={e=>setF({...f,tracto_numero:e.target.value})}/></label><label>Placas del tracto *<input required value={f.tracto_placas} onChange={e=>setF({...f,tracto_placas:e.target.value})}/></label><label>No. de Caja *<input required value={f.caja_numero} onChange={e=>setF({...f,caja_numero:e.target.value})}/></label><label>Placas de caja *<input required value={f.caja_placas} onChange={e=>setF({...f,caja_placas:e.target.value})}/></label><label>Contacto *<input required value={f.contacto} onChange={e=>setF({...f,contacto:e.target.value})}/></label><label>Tipo de operación *<select required value={f.operacion_tipo} onChange={e=>setF({...f,operacion_tipo:e.target.value})}><option value="recibo">Recibo</option><option value="embarque">Embarque</option></select></label>{f.operacion_tipo==="embarque"&&<label>Número de sellos *<input type="number" min="0" required value={f.numero_sellos} onChange={e=>setF({...f,numero_sellos:e.target.value})}/></label>}<div className="actions"><button className="secondary" type="button" onClick={onClose}>Cancelar</button><button className="primary" type="submit" disabled={busy}>{busy?"Guardando…":"Guardar cambios"}</button></div></form></div></div>}

function Guardia({units,profile,onUpdate}){const active=units.filter(u=>u.estado==="documentacion");return <><Page title="Guardia" sub="Control de salida y liberación de unidades."/><div className="panel"><PanelHead title={"Unidades para salida: "+active.length}/>{active.length===0?<Empty text="No hay unidades pendientes de salida."/>:active.map(u=><div className="unit-card" key={u.id}><UnitMain u={u}/><div><small>Estado: {stateLabels[u.estado]||u.estado}{u.operacion_tipo==="embarque"&&u.numero_sellos!=null?" · Sellos: "+u.numero_sellos:""}</small><div className="actions"><button className="primary" onClick={()=>onUpdate(u.id,{estado:"liberada",salida_caseta_at:new Date().toISOString(),guardia_salida_usuario_id:profile?.id||null,salida_autorizada:true,salida_autorizada_at:new Date().toISOString()},"Salida registrada para "+u.folio+".")}>Dar salida</button></div></div></div>)}</div></>}

function Monitor({units,counts,warehouse,ramps=[]}){
 const [selectedDay,setSelectedDay]=useState(new Date().toLocaleDateString("en-CA"));
 const [showLagging,setShowLagging]=useState(false);
 const [opsTab,setOpsTab]=useState("active");
 const [opsSearch,setOpsSearch]=useState("");
 const [historyUnits,setHistoryUnits]=useState([]);
 const [historyLoading,setHistoryLoading]=useState(false);
 const [historyError,setHistoryError]=useState("");
 const [appointmentRows,setAppointmentRows]=useState([]);
 const [appointmentLoading,setAppointmentLoading]=useState(false);
 const [appointmentError,setAppointmentError]=useState("");
 useEffect(()=>{let alive=true;async function loadHistory(){if(!warehouse?.id||!selectedDay){setHistoryUnits([]);return;}setHistoryLoading(true);setHistoryError("");const start=new Date(selectedDay+"T00:00:00");const end=new Date(start);end.setDate(end.getDate()+1);const {data,error}=await supabase.from("unidades").select("id,folio,operador_nombre,linea_transporte,tracto_placas,caja_placas,estado,created_at,updated_at,almacen_id").eq("almacen_id",warehouse.id).gte("created_at",start.toISOString()).lt("created_at",end.toISOString()).order("created_at",{ascending:false}).limit(500);if(!alive)return;if(error){setHistoryError("No se pudo consultar el historial de esta fecha.");setHistoryUnits([]);}else{setHistoryUnits(data||[]);}setHistoryLoading(false);}loadHistory();return()=>{alive=false}},[selectedDay,warehouse?.id]);
 useEffect(()=>{let alive=true;let timer;async function loadAppointments(){if(!warehouse?.id){setAppointmentRows([]);return;}setAppointmentLoading(true);setAppointmentError("");const now=new Date();const today=new Date(now);today.setHours(0,0,0,0);const tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1);const dayAfter=new Date(tomorrow);dayAfter.setDate(dayAfter.getDate()+1);const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;const {data,error}=await supabase.from("citas").select("id,folio,tipo_operacion,fecha,hora_inicio,hora_fin,referencia,cuenta_cliente,pallets,estado,cerrada_at,unidades_solicitadas").eq("almacen_id",warehouse.id).gte("fecha",dateKey(today)).lt("fecha",dateKey(dayAfter)).order("fecha").order("hora_inicio").limit(100);if(!alive)return;if(error){setAppointmentError("No se pudieron consultar las citas de CSR.");setAppointmentRows([]);}else{const horizon=now.getTime()+24*60*60*1000;const rows=(data||[]).filter(a=>a.estado!=="cancelada"&&!a.cerrada_at).filter(a=>{const start=new Date(`${a.fecha}T${String(a.hora_inicio||"00:00:00").slice(0,8)}`);return start.getTime()>=today.getTime()&&start.getTime()<=horizon;});setAppointmentRows(rows);}setAppointmentLoading(false);}loadAppointments();timer=setInterval(loadAppointments,60000);return()=>{alive=false;if(timer)clearInterval(timer)}},[warehouse?.id]);
 const active=units.filter(u=>!["liberada","cancelada","incidencia"].includes(u.estado));
 const operational=units.filter(u=>["rampa_asignada","en_operacion","documentacion"].includes(u.estado)).length;
 const patio=units.filter(u=>["en_caseta","validando","espera_turno","rampa_asignada"].includes(u.estado)).length;
 const today=units.filter(u=>{if(!u.created_at)return false;const d=new Date(u.created_at);const n=new Date();return d.getFullYear()===n.getFullYear()&&d.getMonth()===n.getMonth()&&d.getDate()===n.getDate()});
 const completed=today.filter(u=>u.estado==="liberada").length;
 const dayUnits=historyUnits;
 const lagging=active.filter(u=>u.created_at&&(Date.now()-new Date(u.created_at).getTime())>=60*60*1000);
  const upcoming=units.filter(u=>u.cita_at&&new Date(u.cita_at).getTime()>=Date.now()&&new Date(u.cita_at).getTime()<=Date.now()+24*60*60*1000&&!["liberada","cancelada"].includes(u.estado)).sort((a,b)=>new Date(a.cita_at)-new Date(b.cita_at));
  const recentMoves=units.slice().sort((a,b)=>new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0)).slice(0,5);
  const opsBase=opsTab==="active"?active:opsTab==="yard"?units.filter(u=>["en_caseta","validando","espera_turno","rampa_asignada"].includes(u.estado)):opsTab==="appointments"?upcoming:opsTab==="completed"?today.filter(u=>u.estado==="liberada"):lagging;
  const opsRows=opsBase.filter(u=>[u.folio,u.operador_nombre,u.linea_transporte,u.tracto_placas,u.caja_placas].some(v=>String(v||"").toLowerCase().includes(opsSearch.toLowerCase()))).sort((a,b)=>new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0));
 const selectedDateLabel=new Date(selectedDay+"T12:00:00").toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
 const stageKeys=["en_caseta","validando","espera_turno","rampa_asignada","en_operacion","documentacion","liberada"];
 const stageNames={"en_caseta":"Caseta","validando":"Dispatch","espera_turno":"Espera turno","rampa_asignada":"Rampa","en_operacion":"Operación","documentacion":"Documentación","liberada":"Liberada"};
 const stageIcons={"en_caseta":"▣","validando":"▰","espera_turno":"◷","rampa_asignada":"▰","en_operacion":"⚙","documentacion":"▤","liberada":"✓"};
 const stageColors={"en_caseta":["#fff2d6","#c78b18"],"validando":["#e7f1ff","#2775d2"],"espera_turno":["#fff0e7","#e4773b"],"rampa_asignada":["#eee9ff","#6747d8"],"en_operacion":["#e5f7ed","#218956"],"documentacion":["#f0e9ff","#7948ce"],"liberada":["#e5f7ed","#22945a"]};
 const timeLabel=u=>{if(!u.created_at)return "—";const mins=Math.max(0,Math.floor((Date.now()-new Date(u.created_at).getTime())/60000));return mins<60?mins+" min":Math.floor(mins/60)+" h "+(mins%60)+" min"};
 const rampUnits=active.filter(u=>u.rampa_codigo||u.rampa_id||u.rampa);
 const rampForUnit=r=>units.find(u=>u.ubicacion_tipo==="rampa"&&String(u.rampa_id||"")===String(r.id)&&!u.salida_caseta_at&&!["liberada","cancelada","completada","incidencia"].includes(String(u.estado||"").toLowerCase()));
 const rampLabel=(r,i=0)=>{const code=String(r.codigo||"").trim();if(code)return code;const name=String(r.nombre||"").trim();const hasUuid=/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(name);return name&&!hasUuid?name:("Rampa "+String(i+1).padStart(2,"0"));};
 const rampState=r=>{const st=String(r.estado||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");if(!r.activa||st.includes("mantenimiento")||st.includes("fuera")||st.includes("servicio")||st.includes("no_disponible")||st.includes("no disponible"))return {label:st.includes("mantenimiento")?"En mantenimiento":"Fuera de servicio",kind:"offline"};const u=rampForUnit(r);if(u)return {label:"En uso",kind:"occupied",unit:u};if(st.includes("espera")||st.includes("asign"))return {label:"En espera",kind:"waiting"};if(st.includes("carg")||st.includes("descarg")||st.includes("ocupad")||st.includes("en operacion"))return {label:"En operación",kind:"working"};return {label:"Disponible",kind:"free"};};
 return <><Page title="Monitor 360" sub={warehouse?warehouse.nombre:"Vista general"}/>
 <section className="m360-board">
  <header className="m360-header"><div className="m360-brand"><div className="m360-logo">OP</div><div><b>OP360</b><span>Monitor 360 · {warehouse?.nombre||"Almacén"}</span></div></div><div className="m360-online"><i/> En línea<small>Actualización automática</small></div></header>
  <div className="m360-site"><div className="m360-site-icon">▦</div><div className="m360-site-name"><small>ALMACÉN</small><strong>{warehouse?.codigo||"OP360"} · {warehouse?.nombre||"Operación general"}</strong><span>⌖ Monterrey, Nuevo León</span></div><div className="m360-date"><small>{new Date().toLocaleDateString("es-MX",{weekday:"short",day:"2-digit",month:"short",year:"numeric"})}</small><b>{new Date().toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})}</b><span>Tiempo real</span></div><div className="m360-weather"><span>☀</span><b>Monitor activo</b><small>Estado del almacén</small></div></div>
   <section className="m360-ops">
    <div className="m360-ops-top"><div><span className="m360-eyebrow">RESUMEN OPERATIVO</span><h2>Control de unidades</h2><p>Indicadores, retrasos, citas y movimientos del almacén.</p></div><label className="m360-ops-search">⌕ <input aria-label="Buscar unidad, folio o transportista" placeholder="Buscar unidad, folio o transportista…" value={opsSearch} onChange={e=>setOpsSearch(e.target.value)}/></label></div>
    <div className="m360-ops-tabs">{[{id:"active",label:"Unidades en proceso",n:active.length},{id:"yard",label:"En patio",n:patio},{id:"appointments",label:"Citas próximas",n:upcoming.length},{id:"completed",label:"Completadas",n:completed},{id:"delayed",label:"Retrasadas",n:lagging.length}].map(t=><button key={t.id} className={opsTab===t.id?"selected":""} onClick={()=>setOpsTab(t.id)}><span>{t.label}</span><b>{t.n}</b></button>)}</div>
    <div className="m360-ops-table-panel"><div className="m360-panel-title"><div><h2>{opsTab==="delayed"?"Unidades retrasadas":opsTab==="appointments"?"Próximas citas":opsTab==="completed"?"Unidades completadas":opsTab==="yard"?"Unidades en patio":"Unidades en proceso"}</h2><p>{opsTab==="delayed"?"Unidades activas con 60 minutos o más desde su registro.":"Información operativa actualizada automáticamente."}</p></div><span className="m360-count">{opsRows.length} registros</span></div>
    <div className="m360-ops-table-wrap"><table className="m360-ops-table"><thead><tr><th>Hora / folio</th><th>Transportista / operador</th><th>Unidad</th><th>Operación</th><th>Rampa</th><th>Estatus</th><th>Tiempo</th></tr></thead><tbody>{opsRows.map(u=><tr key={u.id}><td><b>{u.folio||"—"}</b><small>{u.created_at?new Date(u.created_at).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"}):"—"}</small></td><td>{u.linea_transporte||"Sin transporte"}<small>{u.operador_nombre||"Sin operador"}</small></td><td>{u.tracto_placas||"—"}<small>{u.caja_placas||""}</small></td><td>{u.operacion_tipo==="embarque"?"Embarque":"Recibo"}</td><td>{u.rampa_codigo||u.rampa||"—"}</td><td><span className={"m360-state "+u.estado}>{stageNames[u.estado]||stateLabels[u.estado]||u.estado}</span></td><td>{timeLabel(u)}</td></tr>)}</tbody></table></div>{!opsRows.length?<Empty text={opsSearch?"No hay resultados para esa búsqueda.":"No hay unidades en esta categoría."}/>:null}</div>
    <div className="m360-ops-bottom"><section className="m360-ops-mini"><div className="m360-panel-title"><div><h2>Próximas citas</h2><p>Citas de hoy y las siguientes 24 horas · fuente CSR.</p></div><b>{appointmentRows.length}</b></div>{appointmentLoading&&!appointmentRows.length?<Empty text="Consultando citas…"/>:null}{appointmentError?<Empty text={appointmentError}/>:null}{appointmentRows.slice(0,5).map(a=><article key={a.id}><div><b>{a.folio||"Cita sin folio"}</b><span>{new Date(`${a.fecha}T${String(a.hora_inicio||"00:00:00").slice(0,8)}`).toLocaleString("es-MX",{weekday:"short",hour:"2-digit",minute:"2-digit",day:"2-digit",month:"short"})}</span></div><small>{a.cuenta_cliente||a.referencia||"Sin referencia"} · {a.tipo_operacion==="embarque"?"Embarque":"Recibo"} · {a.estado==="borrador"?"Borrador · pendiente de confirmar":a.estado}</small></article>)}{!appointmentLoading&&!appointmentError&&!appointmentRows.length?<Empty text="No hay citas vigentes para hoy o las siguientes 24 horas."/>:null}</section><section className="m360-ops-mini"><div className="m360-panel-title"><div><h2>Últimos movimientos</h2><p>Actividad reciente de las unidades.</p></div></div>{recentMoves.map(u=><article key={u.id}><div><b>{u.folio||"Unidad"}</b><span>{new Date(u.updated_at||u.created_at).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})}</span></div><small>{stageNames[u.estado]||stateLabels[u.estado]||u.estado} · {u.operador_nombre||u.linea_transporte||"Sin operador"}</small></article>)}{!recentMoves.length?<Empty text="Todavía no hay movimientos registrados."/>:null}</section></div>
   </section>
   <section className="m360-panel m360-history"><div className="m360-panel-title"><div><h2>Calendario de operación</h2><p>Consulta las unidades registradas por fecha y revisa las que llevan más de 60 minutos sin finalizar.</p></div><span className="m360-count">{dayUnits.length} unidades</span></div><div className="m360-history-controls"><label>Seleccionar día<input type="date" value={selectedDay} onChange={e=>setSelectedDay(e.target.value)} /></label><button type="button" className={showLagging?"m360-lagging-btn selected":"m360-lagging-btn"} onClick={()=>setShowLagging(v=>!v)}>⏱ Unidades rezagadas ({lagging.length})</button></div><div className="m360-history-summary"><b>{selectedDateLabel}</b><span>{dayUnits.filter(u=>u.estado==="liberada").length} liberadas · {dayUnits.filter(u=>!["liberada","cancelada"].includes(u.estado)).length} pendientes o en proceso</span></div><div className="m360-history-list">{historyLoading&&!showLagging?<Empty text="Consultando operaciones de la fecha seleccionada…"/>:historyError&&!showLagging?<Empty text={historyError}/>:(showLagging?lagging:dayUnits).length?(showLagging?lagging:dayUnits).map(u=><article key={u.id}><div><b>{u.folio||"Sin folio"}</b><span className={"m360-state "+u.estado}>{stageNames[u.estado]||stateLabels[u.estado]||u.estado}</span></div><p>{u.operador_nombre||"Sin operador"} · {u.linea_transporte||"Sin transporte"}</p><small>{u.tracto_placas||"Sin placas"} · {new Date(u.created_at).toLocaleString("es-MX",{dateStyle:"short",timeStyle:"short"})}</small>{showLagging?<strong>Tiempo transcurrido: {timeLabel(u)}</strong>:null}</article>):<Empty text={showLagging?"No hay unidades activas con más de 60 minutos transcurridos.":"No hay unidades registradas en esta fecha dentro del historial cargado."}/>}</div></section>
  <div className="m360-kpis">
   <div className="m360-kpi primary"><span className="m360-kpi-icon">▣</span><small>Unidades del día</small><strong>{today.length}</strong><span>{active.length} activas · {completed} liberadas</span></div>
   <div className="m360-kpi green"><span className="m360-kpi-icon">▰</span><small>En proceso</small><strong>{active.length}</strong></div>
   <div className="m360-kpi amber"><span className="m360-kpi-icon">◷</span><small>En espera</small><strong>{units.filter(u=>u.estado==="espera_turno").length}</strong></div>
   <div className="m360-kpi purple"><span className="m360-kpi-icon">▤</span><small>Documentación</small><strong>{units.filter(u=>u.estado==="documentacion").length}</strong></div>
   <div className="m360-kpi gray"><span className="m360-kpi-icon">✓</span><small>Finalizadas</small><strong>{completed}</strong></div>
  </div>
  <section className="m360-panel m360-flow"><div className="m360-panel-title"><div><h2>Flujo operativo</h2><p>Seguimiento visual por etapa en tiempo real.</p></div><span className="m360-live-tag"><i/> Actualización automática</span></div>
   <div className="m360-flow-track">{stageKeys.map(k=>{const tone=stageColors[k];const value=k==="liberada"?completed:units.filter(u=>u.estado===k).length;return <div className={"m360-stage "+k} key={k}><div className="m360-stage-icon" style={{background:tone[0],color:tone[1]}}>{stageIcons[k]}</div><strong>{stageNames[k]}</strong><b>{value}</b><span>{k==="liberada"?"Finalizado":value?"En proceso":"En espera"}</span></div>})}</div>
  </section>
  <section className="m360-panel m360-ramps"><div className="m360-panel-title"><div><h2>Rampas</h2><p>Estado de las posiciones configuradas en este almacén.</p></div><span className="m360-count">{ramps.length} posiciones</span></div>
   <div className="m360-ramp-summary"><span><i className="free"/> Disponible</span><span><i className="used"/> En uso</span><span><i className="waiting"/> En espera</span><span><i className="offline"/> Fuera de servicio</span></div>
   {ramps.length?<div className="m360-ramp-grid">{ramps.map((r,i)=>{const state=rampState(r);return <div className={"m360-dock "+state.kind} key={r.id||i} title={state.unit?`${rampLabel(r,i)} · ${state.label} · ${state.unit.folio||"Unidad"}`:`${rampLabel(r,i)} · ${state.label}`}><div className="m360-dock-number">{rampLabel(r,i).replace(/^Rampa\s*/i,"").replace(/^R/i,"").padStart(2,"0")}</div><div className="m360-dock-door"><span/><i/></div><div className="m360-dock-info">{state.unit?<><div className="m360-dock-carrier"><span className="m360-dock-carrier-mark">{transportInitials(state.unit.linea_transporte)}</span><b className="m360-dock-carrier-name">{state.unit.linea_transporte||"Sin transporte"}</b></div><strong className="m360-dock-folio">{state.unit.folio||"Unidad asignada"}</strong><small>{state.unit.operador_nombre||state.unit.tracto_placas||state.unit.caja_placas||(state.unit.operacion_tipo==="embarque"?"Embarque":"Recibo")}</small></>:<><b>{state.label}</b><small>{r.motivo||"Posición registrada"}</small></>}</div></div>})}</div>:<div className="m360-empty-inline">No hay posiciones de rampa configuradas para este almacén.</div>}
  </section>
  <section className="m360-panel m360-units"><div className="m360-panel-title"><div><h2>Unidades activas · {active.length}</h2><p>Folio, operador, unidad, etapa y tiempo transcurrido.</p></div></div>
   {active.length?<div className="m360-table-wrap"><table className="m360-table"><thead><tr><th>Folio</th><th>Operador / transporte</th><th>Unidad</th><th>Etapa</th><th>Tiempo</th></tr></thead><tbody>{active.slice(0,30).map(u=><tr key={u.id}><td><b>{u.folio||"—"}</b></td><td>{u.operador_nombre||"Sin operador"}<small>{u.linea_transporte||"Sin transporte"}</small></td><td>{u.tracto_placas||"—"}<small>{u.caja_placas||""}</small></td><td><span className={"m360-state "+u.estado}>{stageNames[u.estado]||stateLabels[u.estado]||u.estado}</span></td><td>{timeLabel(u)}</td></tr>)}</tbody></table><div className="m360-mobile-units">{active.slice(0,30).map(u=><article key={u.id}><div className="m360-mobile-unit-heading"><div className="m360-carrier-brand" aria-label={"Transportista "+(u.linea_transporte||"Sin transporte")}>{transportInitials(u.linea_transporte)}</div><div className="m360-carrier-name"><span>LÍNEA DE TRANSPORTE</span><b>{u.linea_transporte||"Sin transporte"}</b></div><span className={"m360-state "+u.estado}>{stageNames[u.estado]||stateLabels[u.estado]||u.estado}</span></div><div className="m360-mobile-unit-folio"><span>FOLIO</span><b>{u.folio||"—"}</b></div><div className="m360-mobile-unit-details"><div><span>OPERADOR</span><b>{u.operador_nombre||"Sin operador"}</b></div><div><span>TRACTO / PLACAS</span><b>{u.tracto_placas||"—"}</b></div><div><span>CAJA</span><b>{u.caja_placas||"—"}</b></div></div><footer><span>Tiempo en sistema</span><b>{timeLabel(u)}</b></footer></article>)}</div></div>:<Empty text="No hay unidades activas en este momento."/>}
  </section>
  <div className="m360-bottom-grid"><section className="m360-panel"><div className="m360-panel-title"><h2>Actividad reciente</h2></div>{units.slice().sort((a,b)=>new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0)).slice(0,4).map((u,i)=><div className="m360-activity" key={u.id||i}><i style={{background:["#e6a51e","#2775d2","#7449d4","#29935b"][i]}}/><span><b>{u.folio||"Unidad"}</b><small>{stageNames[u.estado]||stateLabels[u.estado]||u.estado} · {u.updated_at||u.created_at?new Date(u.updated_at||u.created_at).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"}):"Hora no disponible"}</small></span></div>)}</section>
   <section className="m360-panel"><div className="m360-panel-title"><h2>Resumen del día</h2></div><div className="m360-summary-row"><span>Ingresos registrados hoy</span><b>{today.length}</b></div><div className="m360-summary-row"><span>En proceso</span><b>{active.length}</b></div><div className="m360-summary-row"><span>Liberadas hoy</span><b>{completed}</b></div><div className="m360-summary-row"><span>Tiempo promedio</span><b>{active.length?timeLabel(active[0]):"—"}</b></div></section></div>
 </section></>}

function Admin({users,warehouses,form,setForm,submit,busy}){return <><Page title="Administración" sub="Usuarios, roles y almacenes."/><div className="grid2"><form className="panel" onSubmit={submit}><h3>Crear usuario</h3><div className="formgrid"><label>Usuario<input required pattern="[a-zA-Z0-9._-]{3,40}" value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></label><label>Nombre<input required value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})}/></label><label>Rol<select value={form.rol} onChange={e=>setForm({...form,rol:e.target.value})}>{ROLES.map(r=><option key={r} value={r}>{ROLE_PROFILES[r]?.label||r}</option>)}</select></label><label>Almacén<select value={form.almacen_id} onChange={e=>setForm({...form,almacen_id:e.target.value})}><option value="">Sin almacén</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.codigo} · {w.nombre}</option>)}</select></label><label>Contraseña<input required minLength="8" type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label></div><button className="primary" disabled={busy}>{busy?"Creando…":"Crear usuario"}</button></form><div className="panel"><h3>Usuarios y perfiles</h3><div className="user-list">{users.map(u=><div key={u.id}><div><b>{u.nombre}</b><span>{u.username||"sin usuario"} · {ROLE_PROFILES[u.rol]?.label||u.rol}</span></div><em className={u.activo?"pill on":"pill"}>{u.activo?"Activo":"Inactivo"}</em></div>)}</div></div></div></>}

function UnitTable({units}){return <div className="table-wrap">{units.length===0?<Empty text="No hay unidades registradas."/>:<table><thead><tr><th>Folio</th><th>Operador</th><th>Transporte</th><th>Tracto</th><th>Estado</th></tr></thead><tbody>{units.map(u=><tr key={u.id}><td><b>{u.folio}</b></td><td>{u.operador_nombre||"—"}</td><td>{u.linea_transporte||"—"}</td><td>{u.tracto_placas||"—"}</td><td><span className={clsState(u.estado)}>{stateLabels[u.estado]||u.estado}</span></td></tr>)}</tbody></table>}</div>}
function transportInitials(value){const s=String(value||"").trim();if(!s)return "—";const words=s.split(/\\s+/).filter(Boolean);return (words.length>1?words.map(w=>w[0]).join(""):s.replace(/[^a-z0-9]/gi,"").slice(0,3)).toUpperCase().slice(0,3)}
function UnitMain({u}){return <div className="unit-main-layout"><div className="unit-main-top"><div className="unit-main-field"><span>LÍNEA</span><b>{u.linea_transporte||"—"}</b></div><div className="unit-main-field"><span>OPERADOR</span><b>{u.operador_nombre||"—"}</b></div></div><div className="unit-main-details"><div><span>CAJA</span><b>{u.caja_placas||"—"}</b></div><div><span>PLACAS</span><b>{u.tracto_placas||"—"}</b></div></div><div className="unit-main-folio"><span>FOLIO</span><b>{u.folio||"Sin folio"}</b></div></div>}
function Page({title,sub}){return <div className="page-title"><div><h1>{title}</h1><p>{sub}</p></div><span className="live"><i/> Tiempo real</span></div>}
function PanelHead({title,action}){return <div className="panel-head"><h3>{title}</h3>{action}</div>}
function Empty({text}){return <div className="empty">{text}</div>}
function icon(k){return ({caseta:"▣",trafico:"↔",rampas:"▥",dispatch:"◫",operacion:"⚙",csr:"✓",monitor:"▦",guardia:"⇥",admin:"⚙"})[k]||"•";}
