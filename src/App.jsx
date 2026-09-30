import { useEffect, useMemo, useState } from "react";
import Rampas from "./Rampas";
import Caseta from "./Caseta";
import Dispatch from "./Dispatch";
import CSR from "./CSR";
import Operacion from "./Operacion";
import Documentacion from "./Documentacion";
import Guardia from "./Guardia";
import TorreControl from "./TorreControl";
import Practica from "./Practica";
import { Activity, ArrowRight, Box, CheckCircle2, ClipboardList, ClipboardCheck, Clock3, Factory, LayoutDashboard, LogIn, MapPin, Menu, ShieldCheck, Truck, Users, X, UserPlus, Save, UserCheck, UserX, RefreshCw, Wrench } from "lucide-react";
import { supabase } from "./lib/supabase";

const stages = [["caseta","Caseta","Ingreso y validación"],["dispatch","Dispatch","Cita y transporte"],["csr","CSR","Validación documental"],["operacion","Operación","Rampa y proceso"],["documentacion","Documentación","Revisión documental"],["guardia","Guardia","Salida y liberación"]];

const roleAccess = {
  torre: ["admin_global","admin_almacen","team_lead","supervisor","operacion","monitor_almacen"],
  caseta: ["admin_global","admin_almacen","caseta","supervisor"],
  dispatch: ["admin_global","admin_almacen","dispatch","supervisor","team_lead"],
  csr: ["admin_global","admin_almacen","csr","team_lead","supervisor"],
  operacion: ["admin_global","admin_almacen","operacion","supervisor","team_lead"],
  documentacion: ["admin_global","admin_almacen","documentacion","supervisor","team_lead"],
  guardia: ["admin_global","admin_almacen","guardia","supervisor","team_lead"],
  rampas: ["admin_global","admin_almacen"],
  usuarios: ["admin_global"]
};

const roleOptions = [
  ["admin_global","Admin global"],
  ["admin_almacen","Admin almacén"],
  ["team_lead","Team Lead"],
  ["csr","CSR"],
  ["aduanas","Aduanas"],
  ["transportista","Transportista"],
  ["cliente","Cliente"],
  ["caseta","Caseta"],
  ["dispatch","Dispatch"],
  ["operacion","Operación"],
  ["documentacion","Documentación"],
  ["supervisor","Supervisor"],
  ["guardia","Guardia"],
  ["admin","Admin"],
  ["monitor_almacen","Monitor Almacén"]
];

function App() {
  useEffect(() => {
    let stopped = false;
    const checkForNewBuild = async () => {
      try {
        // Vite cambia main.jsx por un asset con hash en producción.
        // Comparamos el módulo real servido por index.html para detectar cualquier build nuevo.
        const currentScript = Array.from(document.scripts)
          .find(el => el.type === "module" || (el.src && /assets\//.test(el.src)));
        const currentAsset = currentScript?.getAttribute("src") || "";
        const url = new URL("./index.html", window.location.href);
        url.searchParams.set("__version_check", Date.now().toString());
        const response = await fetch(url.toString(), {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache, no-store, max-age=0" }
        });
        if (!response.ok || stopped) return;
        const html = await response.text();
        const match = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i)
          || html.match(/<script[^>]+src=["']([^"']+)["'][^>]+type=["']module["']/i);
        const remoteAsset = match?.[1] || "";
        if (
          currentAsset &&
          remoteAsset &&
          new URL(currentAsset, window.location.href).pathname !==
            new URL(remoteAsset, window.location.href).pathname &&
          !stopped
        ) {
          window.location.reload();
        }
      } catch {}
    };
    checkForNewBuild();
    const timer = window.setInterval(checkForNewBuild, 30000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);


  const [mobileOpen,setMobileOpen]=useState(false);
  const [focusSection,setFocusSection]=useState("");
  const [session,setSession]=useState(null);
  const [email,setEmail]=useState("");
  const [loginUsername,setLoginUsername]=useState("");
  const [password,setPassword]=useState("");
  const [newPassword,setNewPassword]=useState("");
  const [authLoading,setAuthLoading]=useState(true);
  const [loginLoading,setLoginLoading]=useState(false);
  const [passwordLoading,setPasswordLoading]=useState(false);
  const [authError,setAuthError]=useState("");
  const [warehouses,setWarehouses]=useState([]);
  const [profile,setProfile]=useState(null);
  const [loading,setLoading]=useState(false);
  const [dbError,setDbError]=useState("");
  const [users,setUsers]=useState([]);
  const [usersLoading,setUsersLoading]=useState(false);
  const [usersError,setUsersError]=useState("");
  const [invite,setInvite]=useState({email:"",nombre:"",rol:"admin_almacen",almacen_id:""});
  const [inviteLoading,setInviteLoading]=useState(false);
  const [inviteMessage,setInviteMessage]=useState("");
  const [createUser,setCreateUser]=useState({username:"",password:"",nombre:"",rol:"guardia",almacen_id:""});
  useEffect(()=>{
    const sync=()=>{
      const id=window.location.hash.replace("#","");
      setFocusSection(stages.some(([stage])=>stage===id)?id:"");
    };
    sync(); window.addEventListener("hashchange",sync);
    return()=>window.removeEventListener("hashchange",sync);
  },[]);
  const [createUserLoading,setCreateUserLoading]=useState(false);
  const [createUserMessage,setCreateUserMessage]=useState("");
  const [passwordDrafts,setPasswordDrafts]=useState({});
  const [recoveryMode,setRecoveryMode]=useState(false);
  const [recoveryEmail,setRecoveryEmail]=useState("");
  const [recoveryMessage,setRecoveryMessage]=useState("");
  const [sessionLocked,setSessionLocked]=useState(false);
  const [idleWarning,setIdleWarning]=useState(false);

  const isInviteFlow=typeof window!=="undefined" && /(^|[#?&])type=invite([&#]|$)/.test(window.location.hash+window.location.search);

  useEffect(()=>{
    if(!supabase){setAuthLoading(false);return}
    let active=true;
    supabase.auth.getSession().then(({data})=>{if(active){setSession(data.session);setAuthLoading(false)}});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,newSession)=>{if(active){setSession(newSession);if(event==="PASSWORD_RECOVERY")setRecoveryMode(true)}});
    return()=>{active=false;subscription.unsubscribe()};
  },[]);

  useEffect(()=>{
    if(!session||!supabase||["monitor_almacen","monitor_general"].includes(profile?.rol))return;
    let warningTimer=null;
    let lockTimer=null;
    let lastActivity=Date.now();
    const IDLE_WARNING_MS=13*60*1000;
    const IDLE_LOCK_MS=15*60*1000;
    const resetIdle=()=>{
      if(sessionLocked)return;
      lastActivity=Date.now();
      setIdleWarning(false);
      window.clearTimeout(warningTimer);
      window.clearTimeout(lockTimer);
      warningTimer=window.setTimeout(()=>{
        if(Date.now()-lastActivity>=IDLE_WARNING_MS)setIdleWarning(true);
      },IDLE_WARNING_MS);
      lockTimer=window.setTimeout(()=>{
        if(Date.now()-lastActivity>=IDLE_LOCK_MS){
          setIdleWarning(false);
          setSessionLocked(true);
        }
      },IDLE_LOCK_MS);
    };
    const events=["pointerdown","keydown","touchstart","mousemove","scroll"];
    events.forEach(event=>window.addEventListener(event,resetIdle,{passive:true}));
    resetIdle();
    return()=>{
      window.clearTimeout(warningTimer);
      window.clearTimeout(lockTimer);
      events.forEach(event=>window.removeEventListener(event,resetIdle));
    };
  },[session,sessionLocked,profile?.rol]);

  useEffect(()=>{
    if(!session||!supabase)return;
    let active=true;
    setLoading(true);setDbError("");
    Promise.all([
      supabase.from("usuarios").select("id,nombre,rol,activo,almacen_id").eq("id",session.user.id).maybeSingle(),
      supabase.from("almacenes").select("id,codigo,nombre,activa").eq("activa",true).order("codigo")
    ]).then(([p,w])=>{
      if(!active)return;
      if(p.error)setDbError(p.error.message); else setProfile(p.data);
      if(w.error)setDbError(w.error.message); else setWarehouses(w.data||[]);
      setLoading(false);
    });
    return()=>{active=false};
  },[session]);

  useEffect(()=>{
    if(profile?.rol==="admin_global" && profile.activo) loadUsers();
  },[profile?.rol,profile?.activo]);

  async function loadUsers(){
    setUsersLoading(true);setUsersError("");
    const {data,error}=await supabase.rpc("admin_listar_usuarios");
    if(error)setUsersError(error.message); else setUsers(data||[]);
    setUsersLoading(false);
  }

  async function login(e){
    e.preventDefault();setLoginLoading(true);setAuthError("");
    const value=loginUsername.trim().toLowerCase();
    const email=value.includes("@") ? value : value+"@login.seguimiento360.local";
    const {error}=await supabase.auth.signInWithPassword({email,password});
    if(error)setAuthError(error.message==="Invalid login credentials" ? "Usuario/correo o contraseña incorrectos." : error.message);
    setLoginLoading(false);
  }

  async function requestPasswordReset(e){
    e.preventDefault();setLoginLoading(true);setAuthError("");setRecoveryMessage("");
    const email=recoveryEmail.trim().toLowerCase();
    if(!email.includes("@")){setAuthError("Escribe el correo electrónico de recuperación.");setLoginLoading(false);return}
    const redirectTo=window.location.origin+window.location.pathname;
    const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo});
    if(error)setAuthError(error.message);
    else setRecoveryMessage("Si el correo corresponde a una cuenta, recibirás un enlace para restablecer la contraseña.");
    setLoginLoading(false);
  }

  async function finishRecovery(e){
    e.preventDefault();setPasswordLoading(true);setAuthError("");
    if(newPassword.length<8){setAuthError("La contraseña debe tener al menos 8 caracteres.");setPasswordLoading(false);return}
    const {error}=await supabase.auth.updateUser({password:newPassword});
    if(error){setAuthError(error.message);setPasswordLoading(false);return}
    setRecoveryMode(false);setNewPassword("");setPassword("");setRecoveryMessage("");
    window.history.replaceState({},document.title,window.location.pathname);
    await supabase.auth.signOut();
    setSession(null);
    setPasswordLoading(false);
  }

  async function finishInvite(e){
    e.preventDefault();setPasswordLoading(true);setAuthError("");
    if(newPassword.length<8){setAuthError("La contraseña debe tener al menos 8 caracteres.");setPasswordLoading(false);return}
    const {error}=await supabase.auth.updateUser({password:newPassword});
    if(error){setAuthError(error.message);setPasswordLoading(false);return}
    window.history.replaceState({},document.title,window.location.pathname+window.location.search);
    setPassword("");
    setNewPassword("");
    setPasswordLoading(false);
  }

  async function logout(){setSessionLocked(false);setIdleWarning(false);await supabase?.auth.signOut();setWarehouses([]);setProfile(null);setUsers([])}

  async function inviteUser(e){
    e.preventDefault();setInviteLoading(true);setInviteMessage("");setUsersError("");
    const {data,error}=await supabase.functions.invoke("admin-invitar-usuario",{body:invite});
    if(error){setUsersError(error.message);setInviteLoading(false);return}
    if(data?.error){setUsersError(data.error);setInviteLoading(false);return}
    setInviteMessage("Invitación enviada. El usuario recibirá un correo para activar su acceso.");
    setInvite({email:"",nombre:"",rol:"admin_almacen",almacen_id:""});
    await loadUsers();
    setInviteLoading(false);
  }

  async function updateUser(u){
    const {error}=await supabase.rpc("admin_actualizar_usuario",{
      p_user_id:u.id,p_nombre:u.nombre,p_rol:u.rol,p_activo:u.activo,p_almacen_id:u.almacen_id||null,p_username:u.username||null
    });
    if(error){setUsersError(error.message);return}
    setUsers(prev=>prev.map(x=>x.id===u.id?{...x}:x));
  }

  async function changeUserPassword(userId){
    const password=passwordDrafts[userId]||"";
    if(password.length<8){setUsersError("La contraseña debe tener al menos 8 caracteres.");return}
    setUsersError("");
    const {data,error}=await supabase.functions.invoke("admin-cambiar-password",{body:{user_id:userId,password}});
    if(error){setUsersError(error.message);return}
    if(data?.error){setUsersError(data.error);return}
    setCreateUserMessage("Contraseña guardada correctamente.");
    setPasswordDrafts(prev=>({...prev,[userId]:""}));
  }

  async function createInternalUser(e){
    e.preventDefault();setCreateUserLoading(true);setCreateUserMessage("");setUsersError("");
    const {data,error}=await supabase.functions.invoke("admin-crear-usuario",{body:createUser});
    if(error){setUsersError(error.message);setCreateUserLoading(false);return}
    if(data?.error){setUsersError(data.error);setCreateUserLoading(false);return}
    setCreateUserMessage("Usuario creado correctamente. Ya puede entrar con su usuario y contraseña.");
    setCreateUser({username:"",password:"",nombre:"",rol:"guardia",almacen_id:""});
    await loadUsers();
    setCreateUserLoading(false);
  }

  const roleLabel=useMemo(()=>Object.fromEntries(roleOptions),[]);
  const effectiveWarehouseId=profile?.almacen_id || (profile?.rol==="admin_global" ? warehouses[0]?.id : null);
  const canAccess=(module)=>Boolean(profile?.rol && roleAccess[module]?.includes(profile.rol));

  if(authLoading)return <div className="auth-screen"><div className="auth-card"><div className="brand-mark">360</div><h1>Seguimiento Logístico 360°</h1><p>{isInviteFlow?"Validando invitación…":"Iniciando sesión segura…"}</p></div></div>;

  if(isInviteFlow)return <div className="auth-screen"><form className="auth-card" onSubmit={finishInvite}><div className="brand-mark">360</div><p className="eyebrow">ACTIVACIÓN DE CUENTA</p><h1>Define tu contraseña</h1><p className="auth-copy">{session?"Tu invitación fue aceptada. Crea una contraseña de al menos 8 caracteres para entrar al sistema.":"Abre el enlace de invitación desde el mismo dispositivo y espera a que Supabase valide tu acceso."}</p>{session?<><label>Nueva contraseña<input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="••••••••" minLength={8} required/></label>{authError&&<div className="notice error"><strong>No se pudo activar la cuenta</strong><span>{authError}</span></div>}<button className="login-btn" disabled={passwordLoading}>{passwordLoading?"Guardando…":"Activar cuenta"} <CheckCircle2 size={17}/></button></>:<div className="notice error"><strong>La invitación no creó una sesión</strong><span>Si llegaste aquí desde un correo anterior, solicita una nueva invitación.</span></div>}</form></div>;

  if(recoveryMode && session)return <div className="auth-screen"><form className="auth-card" onSubmit={finishRecovery}><div className="brand-mark">360</div><p className="eyebrow">RECUPERACIÓN DE ACCESO</p><h1>Define una nueva contraseña</h1><p className="auth-copy">El enlace de recuperación fue validado. Crea una contraseña de al menos 8 caracteres.</p><label>Nueva contraseña<input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="••••••••" minLength={8} required/></label>{authError&&<div className="notice error"><strong>No se pudo cambiar la contraseña</strong><span>{authError}</span></div>}<button className="login-btn" disabled={passwordLoading}>{passwordLoading?"Guardando…":"Guardar nueva contraseña"} <CheckCircle2 size={17}/></button></form></div>;

  if(!session && recoveryMode)return <div className="auth-screen"><form className="auth-card" onSubmit={requestPasswordReset}><div className="brand-mark">360</div><p className="eyebrow">RECUPERAR ACCESO</p><h1>Restablecer contraseña</h1><p className="auth-copy">Escribe el correo asociado a tu cuenta. Te enviaremos un enlace para crear una nueva contraseña.</p><label>Correo electrónico<input type="email" value={recoveryEmail} onChange={e=>setRecoveryEmail(e.target.value)} placeholder="tu@correo.com" autoCapitalize="none" autoCorrect="off" required/></label>{authError&&<div className="notice error"><strong>No se pudo solicitar el cambio</strong><span>{authError}</span></div>}{recoveryMessage&&<div className="notice success"><strong>{recoveryMessage}</strong></div>}<button className="login-btn" disabled={loginLoading}>{loginLoading?"Enviando…":"Enviar enlace"} <CheckCircle2 size={17}/></button><button type="button" className="secondary-btn" onClick={()=>{setRecoveryMode(false);setAuthError("");setRecoveryMessage("")}}>Volver al inicio</button></form></div>;

  if(!session)return <div className="auth-screen"><form className="auth-card" onSubmit={login}><div className="brand-mark">360</div><p className="eyebrow">TORRE DE CONTROL</p><h1>Seguimiento Logístico 360°</h1><p className="auth-copy">Acceso al sistema operativo de logística.</p><label>Usuario o correo<input value={loginUsername} onChange={e=>setLoginUsername(e.target.value.toLowerCase())} placeholder="ej. guardia01 o correo@dominio.com" autoCapitalize="none" autoCorrect="off" required/></label><label>Contraseña<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required/></label>{authError&&<div className="notice error"><strong>No se pudo iniciar sesión</strong><span>{authError}</span></div>}<button className="login-btn" disabled={loginLoading}>{loginLoading?"Iniciando…":"Iniciar sesión"} <LogIn size={17}/></button><button type="button" className="secondary-btn" onClick={()=>{setRecoveryMode(true);setAuthError("");setRecoveryEmail(loginUsername.includes("@")?loginUsername:"")}}>¿Olvidaste tu contraseña?</button><small className="auth-note">Los usuarios internos pueden entrar con usuario; el administrador original también puede entrar con su correo.</small></form></div>;

  if(profile?.rol==="monitor_almacen") return <div className="monitor-screen"><TorreControl warehouseId={effectiveWarehouseId} onLogout={logout}/></div>;

  return <><div className="app-shell"><aside className={mobileOpen?"sidebar open":"sidebar"}><div className="brand"><div className="brand-mark">360</div><div><strong>Seguimiento</strong><span>Logístico 360°</span></div></div><nav><a className="nav-item active" href="#dashboard" onClick={()=>setMobileOpen(false)}><LayoutDashboard size={18}/>Dashboard</a>{canAccess("torre")&&<a className="nav-item" href="#torre" onClick={()=>setMobileOpen(false)}><Activity size={18}/>Torre de Control</a>}<a className="nav-item practice-nav" href="#practica" onClick={()=>setMobileOpen(false)}><ClipboardCheck size={18}/>Modo práctica</a>{stages.map(([id,label])=>canAccess(id)&&<a className="nav-item" href={"#"+id} key={id} onClick={()=>setMobileOpen(false)}><Activity size={18}/>{label}</a>)}<a className="nav-item" href="#patio" onClick={()=>setMobileOpen(false)}><MapPin size={18}/>Patio</a>{canAccess("rampas")&&<a className="nav-item" href="#rampas" onClick={()=>setMobileOpen(false)}><Wrench size={18}/>Rampas</a>}{canAccess("usuarios")&&<a className="nav-item" href="#usuarios" onClick={()=>setMobileOpen(false)}><Users size={18}/>Usuarios</a>}</nav><div className="sidebar-footer"><div className="secure"><ShieldCheck size={16}/>RLS / Supabase</div><small>{session.user.email}</small><small>{profile?.rol ? roleLabel[profile.rol] : "Cargando rol…"}</small><button className="logout" onClick={logout}>Cerrar sesión</button></div></aside>{mobileOpen&&<button className="backdrop" onClick={()=>setMobileOpen(false)} aria-label="Cerrar menú"/>}<main className="main" data-focus={focusSection||undefined}>
      {focusSection&&<style>{`.main[data-focus] > *:not(header):not(#${focusSection}){display:none !important;} .main[data-focus] > #${focusSection}{display:block !important;} .main[data-focus] > header{position:sticky;top:0;z-index:50;}`}</style>}
<header className="topbar"><button className="menu-btn" onClick={()=>setMobileOpen(!mobileOpen)} aria-label="Menú">{mobileOpen?<X size={22}/>:<Menu size={22}/>}</button><div><div className="eyebrow">TORRE DE CONTROL</div><h1>Seguimiento Logístico 360°</h1></div><div className="top-actions"><span className="status online"><span className="dot"/>Backend conectado</span></div></header><section id="dashboard" className="hero360"><div className="hero360-copy"><div className="hero360-brand"><div className="hero360-logo">360</div><div><strong>ALMACÉN<br/><b>360</b></strong><span>CONTROL · VISIBILIDAD · EFICIENCIA</span></div></div><p className="eyebrow">OPERACIÓN INTEGRAL</p><h2>GESTIÓN TOTAL<br/><b>DE TU OPERACIÓN</b></h2><p className="hero-copy">Citas, Caseta, Rampas, Embarques y Recibos en una sola plataforma.</p><div className="hero360-pills"><span>📅 CITAS</span><span>🚛 CASETA</span><span>🏭 RAMPAS</span><span>📊 MONITOREO</span></div></div><div className="hero360-dashboard"><div className="hero360-top"><span><i/> Monitoreo en tiempo real</span><b>ALMACÉN 360</b></div><div className="hero360-cards"><div><strong>RAMPA 01</strong><em className="green">Disponible</em><strong>RAMPA 02</strong><em className="gray">Ocupada</em><strong>RAMPA 03</strong><em className="green">Disponible</em></div><div className="hero360-calendar"><b>📅 Citas de Transporte</b><div className="hero360-days"><span>Lun<br/><strong>28</strong></span><span>Mar<br/><strong>29</strong></span><span className="selected">Mié<br/><strong>30</strong></span><span>Jue<br/><strong>01</strong></span></div><div className="hero360-slots"><i>08:00 <b>Disponible</b></i><i>08:30 <b>Disponible</b></i><i className="occupied">09:00 <b>Ocupada</b></i><i>09:30 <b>Disponible</b></i></div></div><div className="hero360-phone"><b>Registrar Ingreso</b><span>Transportista</span><span>Nombre del operador</span><button>Registrar ingreso →</button></div></div></div></section>{profile?.rol==="monitor_almacen" ? <TorreControl warehouseId={effectiveWarehouseId} onLogout={logout}/> : <><Practica/> {canAccess("torre")&&effectiveWarehouseId&&<TorreControl warehouseId={effectiveWarehouseId}/>}</>} <section className="metrics"><Metric icon={<Truck/>} label="Unidades activas" value="—"/><Metric icon={<Clock3/>} label="Dentro de SLA" value="—"/><Metric icon={<Box/>} label="En patio" value="—"/><Metric icon={<CheckCircle2/>} label="Liberadas hoy" value="—"/></section><section className="panel-grid"><div className="panel"><div className="panel-title"><div><ClipboardList size={19}/><strong>Áreas del flujo</strong></div><span className="tag">Piloto</span></div><div className="stage-list">{stages.map(([id,label,desc],i)=><div className="stage" key={id}><div className="stage-number">{i+1}</div><div><strong>{label}</strong><span>{desc}</span></div><ArrowRight size={17}/></div>)}</div></div><div className="panel"><div className="panel-title"><div><Factory size={19}/><strong>Almacenes activos</strong></div><span className="tag">{warehouses.length||"—"}</span></div>{dbError&&<div className="notice error"><strong>Consulta bloqueada</strong><span>{dbError}</span></div>}{loading?<div className="empty">Consultando Supabase…</div>:warehouses.length?<div className="warehouse-list">{warehouses.map(w=><div className="warehouse" key={w.id}><span className="warehouse-code">{w.codigo}</span><div><strong>{w.nombre}</strong><span>Operativo</span></div><CheckCircle2 size={18}/></div>)}</div>:!dbError?<div className="empty">No hay almacenes visibles para este usuario.</div>:null}</div></section>{profile?.rol==="admin_global"&&<section id="usuarios" className="users-section"><div className="panel"><div className="panel-title"><div><Users size={19}/><strong>Administración de usuarios</strong></div><button className="secondary-btn" onClick={loadUsers} disabled={usersLoading}><RefreshCw size={15}/>Actualizar</button></div><p className="section-copy">El administrador crea directamente el usuario y la contraseña. No se requiere correo electrónico.</p><form className="invite-form" onSubmit={createInternalUser}>
<div><label>Usuario<input value={createUser.username} onChange={e=>setCreateUser({...createUser,username:e.target.value.toLowerCase()})} placeholder="ej. guardia01" pattern="[a-z0-9._-]{3,40}" required/></label></div>
<div><label>Contraseña<input type="password" value={createUser.password} onChange={e=>setCreateUser({...createUser,password:e.target.value})} placeholder="Mínimo 8 caracteres" minLength={8} required/></label></div>
<div><label>Nombre<input value={createUser.nombre} onChange={e=>setCreateUser({...createUser,nombre:e.target.value})} placeholder="Nombre del usuario" required/></label></div>
<div><label>Rol<select value={createUser.rol} onChange={e=>setCreateUser({...createUser,rol:e.target.value,almacen_id:["admin_global","transportista","cliente","aduanas"].includes(e.target.value)?"":createUser.almacen_id})}>{roleOptions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div>
<div><label>Almacén<select value={createUser.almacen_id} onChange={e=>setCreateUser({...createUser,almacen_id:e.target.value})} disabled={["admin_global","transportista","cliente","aduanas"].includes(createUser.rol)}><option value="">Sin asignar</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.codigo} · {w.nombre}</option>)}</select></label></div>
<button className="login-btn invite-btn" disabled={createUserLoading}><UserPlus size={16}/>{createUserLoading?"Creando…":"Crear usuario"}</button></form>{inviteMessage&&<div className="notice success"><strong>{inviteMessage}</strong></div>}{usersError&&<div className="notice error"><strong>Error</strong><span>{usersError}</span></div>}{usersLoading?<div className="empty">Cargando usuarios…</div>:<div className="users-table-wrap"><table className="users-table"><thead><tr><th>Nombre</th><th>Usuario</th><th>Contraseña</th><th>Rol</th><th>Almacén</th><th>Estado</th><th></th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td><strong>{u.nombre||"Sin nombre"}</strong></td><td><input value={u.username||""} onChange={e=>setUsers(prev=>prev.map(x=>x.id===u.id?{...x,username:e.target.value.toLowerCase()}:x))} placeholder="usuario"/></td><td className="user-password-cell"><input type="password" value={passwordDrafts[u.id]||""} onChange={e=>setPasswordDrafts(prev=>({...prev,[u.id]:e.target.value}))} placeholder="Nueva contraseña" minLength={8}/><button type="button" className="table-save-btn" onClick={()=>changeUserPassword(u.id)} disabled={(passwordDrafts[u.id]||"").length<8}>Guardar</button></td><td><select value={u.rol} onChange={e=>setUsers(prev=>prev.map(x=>x.id===u.id?{...x,rol:e.target.value}:x))}>{roleOptions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></td><td><select value={u.almacen_id||""} onChange={e=>setUsers(prev=>prev.map(x=>x.id===u.id?{...x,almacen_id:e.target.value||null}:x))} disabled={["admin_global","transportista","cliente","aduanas"].includes(u.rol)}><option value="">Sin asignar</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.codigo} · {w.nombre}</option>)}</select></td><td><button className={u.activo?"state-btn active":"state-btn inactive"} onClick={()=>setUsers(prev=>prev.map(x=>x.id===u.id?{...x,activo:!x.activo}:x))}>{u.activo?<><UserCheck size={14}/>Activo</>:<><UserX size={14}/>Inactivo</>}</button></td><td><button className="save-btn" onClick={()=>updateUser(u)}><Save size={14}/>Guardar</button></td></tr>)}</tbody></table></div>}</div></section>}{canAccess("caseta")&&(effectiveWarehouseId?<Caseta warehouseId={effectiveWarehouseId}/>:<section id="caseta" className="users-section"><div className="panel"><div className="panel-title"><div><LogIn size={19}/><strong>Caseta · Registro de ingreso</strong></div></div><div className="notice error"><strong>Caseta no puede abrir todavía</strong><span>Tu sesión tiene permiso de Caseta, pero no hay un almacén activo disponible para esta sesión. Revisa la asignación del almacén o la consulta de almacenes en Supabase.</span></div></div></section>)}
{canAccess("rampas")&&effectiveWarehouseId&&<Rampas warehouseId={effectiveWarehouseId} canEdit={true}/>}
{canAccess("dispatch")&&effectiveWarehouseId&&<Dispatch warehouseId={effectiveWarehouseId}/>}
{canAccess("csr")&&effectiveWarehouseId&&<CSR warehouseId={effectiveWarehouseId}/>}
{canAccess("operacion")&&effectiveWarehouseId&&<Operacion warehouseId={effectiveWarehouseId}/>}
{canAccess("documentacion")&&effectiveWarehouseId&&<Documentacion warehouseId={effectiveWarehouseId}/>}
{canAccess("guardia")&&effectiveWarehouseId&&<Guardia warehouseId={effectiveWarehouseId}/>}<section className="next"><div><p className="eyebrow">SIGUIENTE ETAPA</p><h3>Construir los módulos operativos sobre esta base.</h3><p>Agenda CSR, Caseta, Dispatch, Patio, Guardia y Torre de Control.</p></div><div className="architecture"><span>GitHub</span><b>→</b><span>Frontend</span><b>→</b><span>Supabase</span><b>→</b><span>Producción</span></div></section><footer>Seguimiento Logístico 360° · Torre de Control · v0.4.0</footer></main></div>{(idleWarning||sessionLocked)&&<div className="session-lock-overlay"><div className="session-lock-card"><div className="session-lock-icon"><ShieldCheck size={24}/></div><p className="eyebrow">{sessionLocked?"SESIÓN BLOQUEADA":"SEGURIDAD DE SESIÓN"}</p><h2>{sessionLocked?"Sesión bloqueada por inactividad":"Tu sesión está por bloquearse"}</h2><p>{sessionLocked?"Por seguridad, el acceso fue bloqueado después de 15 minutos sin actividad. Inicia sesión nuevamente para continuar.":"Llevas 13 minutos sin actividad. Si necesitas continuar, confirma que sigues aquí."}</p>{sessionLocked?<button className="login-btn" onClick={logout}>Volver a iniciar sesión <LogIn size={17}/></button>:<button className="login-btn" onClick={()=>{setIdleWarning(false);window.dispatchEvent(new Event("pointerdown"))}}>Continuar sesión <CheckCircle2 size={17}/></button>}</div></div>}</>;
}
function Metric({icon,label,value}){return <div className="metric"><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div>}
export default App;
