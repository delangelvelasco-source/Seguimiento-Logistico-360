import { useEffect, useMemo, useState } from "react";
import Rampas from "./Rampas";
import Caseta from "./Caseta";
import Dispatch from "./Dispatch";
import CSR from "./CSR";
import Operacion from "./Operacion";
import Documentacion from "./Documentacion";
import Guardia from "./Guardia";
import TorreControl from "./TorreControl";
import { Activity, ArrowRight, Box, CheckCircle2, ClipboardList, Clock3, Factory, LayoutDashboard, LogIn, MapPin, Menu, ShieldCheck, Truck, Users, X, UserPlus, Save, UserCheck, UserX, RefreshCw, Wrench } from "lucide-react";
import { supabase } from "./lib/supabase";

const stages = [["caseta","Caseta","Ingreso y validación"],["dispatch","Dispatch","Cita y transporte"],["csr","CSR","Validación documental"],["operacion","Operación","Rampa y proceso"],["documentacion","Documentación","Revisión documental"],["guardia","Guardia","Salida y liberación"]];

const roleAccess = {
  torre: ["admin_global","admin_almacen","team_lead","supervisor","operacion"],
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
  ["admin","Admin"]
];

function App() {
  const [mobileOpen,setMobileOpen]=useState(false);
  const [session,setSession]=useState(null);
  const [email,setEmail]=useState("");
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

  const isInviteFlow=typeof window!=="undefined" && /(^|[#?&])type=invite([&#]|$)/.test(window.location.hash+window.location.search);

  useEffect(()=>{
    if(!supabase){setAuthLoading(false);return}
    let active=true;
    supabase.auth.getSession().then(({data})=>{if(active){setSession(data.session);setAuthLoading(false)}});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,newSession)=>{if(active)setSession(newSession)});
    return()=>{active=false;subscription.unsubscribe()};
  },[]);

  useEffect(()=>{
    if(!session||!supabase)return;
    let active=true;
    setLoading(true);setDbError("");
    Promise.all([
      supabase.from("usuarios").select("id,nombre,rol,activo,almacen_id").eq("id",session.user.id).maybeSingle(),
      supabase.from("almacenes").select("id,codigo,nombre,activo").eq("activo",true).order("codigo")
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
    const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});
    if(error)setAuthError(error.message);
    setLoginLoading(false);
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

  async function logout(){await supabase?.auth.signOut();setWarehouses([]);setProfile(null);setUsers([])}

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
      p_user_id:u.id,p_nombre:u.nombre,p_rol:u.rol,p_activo:u.activo,p_almacen_id:u.almacen_id||null
    });
    if(error){setUsersError(error.message);return}
    setUsers(prev=>prev.map(x=>x.id===u.id?{...x}:x));
  }

  const roleLabel=useMemo(()=>Object.fromEntries(roleOptions),[]);
  const effectiveWarehouseId=profile?.almacen_id || (profile?.rol==="admin_global" ? warehouses[0]?.id : null);
  const canAccess=(module)=>Boolean(profile?.rol && roleAccess[module]?.includes(profile.rol));

  if(authLoading)return <div className="auth-screen"><div className="auth-card"><div className="brand-mark">360</div><h1>Seguimiento Logístico 360°</h1><p>{isInviteFlow?"Validando invitación…":"Iniciando sesión segura…"}</p></div></div>;

  if(isInviteFlow)return <div className="auth-screen"><form className="auth-card" onSubmit={finishInvite}><div className="brand-mark">360</div><p className="eyebrow">ACTIVACIÓN DE CUENTA</p><h1>Define tu contraseña</h1><p className="auth-copy">{session?"Tu invitación fue aceptada. Crea una contraseña de al menos 8 caracteres para entrar al sistema.":"Abre el enlace de invitación desde el mismo dispositivo y espera a que Supabase valide tu acceso."}</p>{session?<><label>Nueva contraseña<input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="••••••••" minLength={8} required/></label>{authError&&<div className="notice error"><strong>No se pudo activar la cuenta</strong><span>{authError}</span></div>}<button className="login-btn" disabled={passwordLoading}>{passwordLoading?"Guardando…":"Activar cuenta"} <CheckCircle2 size={17}/></button></>:<div className="notice error"><strong>La invitación no creó una sesión</strong><span>Si llegaste aquí desde un correo anterior, solicita una nueva invitación.</span></div>}</form></div>;

  if(!session)return <div className="auth-screen"><form className="auth-card" onSubmit={login}><div className="brand-mark">360</div><p className="eyebrow">TORRE DE CONTROL</p><h1>Seguimiento Logístico 360°</h1><p className="auth-copy">Acceso al sistema operativo de logística.</p><label>Correo<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="usuario@empresa.com" required/></label><label>Contraseña<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required/></label>{authError&&<div className="notice error"><strong>No se pudo iniciar sesión</strong><span>{authError}</span></div>}<button className="login-btn" disabled={loginLoading}>{loginLoading?"Iniciando…":"Iniciar sesión"} <LogIn size={17}/></button><small className="auth-note">La cuenta debe existir en Supabase Auth y tener permisos en el almacén correspondiente.</small></form></div>;

  return <div className="app-shell"><aside className={mobileOpen?"sidebar open":"sidebar"}><div className="brand"><div className="brand-mark">360</div><div><strong>Seguimiento</strong><span>Logístico 360°</span></div></div><nav><a className="nav-item active" href="#dashboard"><LayoutDashboard size={18}/>Dashboard</a>{canAccess("torre")&&<a className="nav-item" href="#torre"><Activity size={18}/>Torre de Control</a>}{stages.map(([id,label])=>canAccess(id)&&<a className="nav-item" href={"#"+id} key={id}><Activity size={18}/>{label}</a>)}<a className="nav-item" href="#patio"><MapPin size={18}/>Patio</a>{canAccess("rampas")&&<a className="nav-item" href="#rampas"><Wrench size={18}/>Rampas</a>}{canAccess("usuarios")&&<a className="nav-item" href="#usuarios"><Users size={18}/>Usuarios</a>}</nav><div className="sidebar-footer"><div className="secure"><ShieldCheck size={16}/>RLS / Supabase</div><small>{session.user.email}</small><small>{profile?.rol ? roleLabel[profile.rol] : "Cargando rol…"}</small><button className="logout" onClick={logout}>Cerrar sesión</button></div></aside>{mobileOpen&&<button className="backdrop" onClick={()=>setMobileOpen(false)} aria-label="Cerrar menú"/>}<main className="main"><header className="topbar"><button className="menu-btn" onClick={()=>setMobileOpen(!mobileOpen)} aria-label="Menú">{mobileOpen?<X size={22}/>:<Menu size={22}/>}</button><div><div className="eyebrow">TORRE DE CONTROL</div><h1>Seguimiento Logístico 360°</h1></div><div className="top-actions"><span className="status online"><span className="dot"/>Backend conectado</span></div></header><section id="dashboard" className="hero"><div><p className="eyebrow">OPERACIÓN INTEGRAL</p><h2>Del cliente a la entrega, con una sola fuente de verdad.</h2><p className="hero-copy">Caseta, Dispatch, CSR, Operación, Documentación, Patio y Guardia trabajan sobre la misma operación, con trazabilidad y validaciones.</p></div><div className="hero-card"><Truck size={30}/><div><strong>Flujo piloto</strong><span>Caseta → Dispatch → CSR → Operación</span></div><ArrowRight size={20}/></div></section>{canAccess("torre")&&effectiveWarehouseId&&<TorreControl warehouseId={effectiveWarehouseId}/>} <section className="metrics"><Metric icon={<Truck/>} label="Unidades activas" value="—"/><Metric icon={<Clock3/>} label="Dentro de SLA" value="—"/><Metric icon={<Box/>} label="En patio" value="—"/><Metric icon={<CheckCircle2/>} label="Liberadas hoy" value="—"/></section><section className="panel-grid"><div className="panel"><div className="panel-title"><div><ClipboardList size={19}/><strong>Áreas del flujo</strong></div><span className="tag">Piloto</span></div><div className="stage-list">{stages.map(([id,label,desc],i)=><div className="stage" key={id}><div className="stage-number">{i+1}</div><div><strong>{label}</strong><span>{desc}</span></div><ArrowRight size={17}/></div>)}</div></div><div className="panel"><div className="panel-title"><div><Factory size={19}/><strong>Almacenes activos</strong></div><span className="tag">{warehouses.length||"—"}</span></div>{dbError&&<div className="notice error"><strong>Consulta bloqueada</strong><span>{dbError}</span></div>}{loading?<div className="empty">Consultando Supabase…</div>:warehouses.length?<div className="warehouse-list">{warehouses.map(w=><div className="warehouse" key={w.id}><span className="warehouse-code">{w.codigo}</span><div><strong>{w.nombre}</strong><span>Operativo</span></div><CheckCircle2 size={18}/></div>)}</div>:!dbError?<div className="empty">No hay almacenes visibles para este usuario.</div>:null}</div></section>{profile?.rol==="admin_global"&&<section id="usuarios" className="users-section"><div className="panel"><div className="panel-title"><div><Users size={19}/><strong>Administración de usuarios</strong></div><button className="secondary-btn" onClick={loadUsers} disabled={usersLoading}><RefreshCw size={15}/>Actualizar</button></div><p className="section-copy">Crea accesos por invitación y administra roles, almacén y estado sin entrar al panel de Supabase.</p><form className="invite-form" onSubmit={inviteUser}><div><label>Nombre<input value={invite.nombre} onChange={e=>setInvite({...invite,nombre:e.target.value})} placeholder="Nombre del usuario" required/></label></div><div><label>Correo<input type="email" value={invite.email} onChange={e=>setInvite({...invite,email:e.target.value})} placeholder="usuario@empresa.com" required/></label></div><div><label>Rol<select value={invite.rol} onChange={e=>setInvite({...invite,rol:e.target.value,almacen_id:["admin_global","transportista","cliente","aduanas"].includes(e.target.value)?"":invite.almacen_id})}>{roleOptions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div><div><label>Almacén<select value={invite.almacen_id} onChange={e=>setInvite({...invite,almacen_id:e.target.value})} disabled={["admin_global","transportista","cliente","aduanas"].includes(invite.rol)}><option value="">Sin asignar</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.codigo} · {w.nombre}</option>)}</select></label></div><button className="login-btn invite-btn" disabled={inviteLoading}><UserPlus size={16}/>{inviteLoading?"Enviando…":"Enviar invitación"}</button></form>{inviteMessage&&<div className="notice success"><strong>{inviteMessage}</strong></div>}{usersError&&<div className="notice error"><strong>Error</strong><span>{usersError}</span></div>}{usersLoading?<div className="empty">Cargando usuarios…</div>:<div className="users-table-wrap"><table className="users-table"><thead><tr><th>Usuario</th><th>Rol</th><th>Almacén</th><th>Estado</th><th></th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td><strong>{u.nombre||"Sin nombre"}</strong><span>{u.email||"—"}</span></td><td><select value={u.rol} onChange={e=>setUsers(prev=>prev.map(x=>x.id===u.id?{...x,rol:e.target.value}:x))}>{roleOptions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></td><td><select value={u.almacen_id||""} onChange={e=>setUsers(prev=>prev.map(x=>x.id===u.id?{...x,almacen_id:e.target.value||null}:x))} disabled={["admin_global","transportista","cliente","aduanas"].includes(u.rol)}><option value="">Sin asignar</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.codigo} · {w.nombre}</option>)}</select></td><td><button className={u.activo?"state-btn active":"state-btn inactive"} onClick={()=>setUsers(prev=>prev.map(x=>x.id===u.id?{...x,activo:!x.activo}:x))}>{u.activo?<><UserCheck size={14}/>Activo</>:<><UserX size={14}/>Inactivo</>}</button></td><td><button className="save-btn" onClick={()=>updateUser(u)}><Save size={14}/>Guardar</button></td></tr>)}</tbody></table></div>}</div></section>}{canAccess("caseta")&&effectiveWarehouseId&&<Caseta warehouseId={effectiveWarehouseId}/>}
{canAccess("rampas")&&effectiveWarehouseId&&<Rampas warehouseId={effectiveWarehouseId} canEdit={true}/>}
{canAccess("dispatch")&&effectiveWarehouseId&&<Dispatch warehouseId={effectiveWarehouseId}/>}
{canAccess("csr")&&effectiveWarehouseId&&<CSR warehouseId={effectiveWarehouseId}/>}
{canAccess("operacion")&&effectiveWarehouseId&&<Operacion warehouseId={effectiveWarehouseId}/>}
{canAccess("documentacion")&&effectiveWarehouseId&&<Documentacion warehouseId={effectiveWarehouseId}/>}
{canAccess("guardia")&&effectiveWarehouseId&&<Guardia warehouseId={effectiveWarehouseId}/>}<section className="next"><div><p className="eyebrow">SIGUIENTE ETAPA</p><h3>Construir los módulos operativos sobre esta base.</h3><p>Agenda CSR, Caseta, Dispatch, Patio, Guardia y Torre de Control.</p></div><div className="architecture"><span>GitHub</span><b>→</b><span>Frontend</span><b>→</b><span>Supabase</span><b>→</b><span>Producción</span></div></section><footer>Seguimiento Logístico 360° · Torre de Control · v0.4.0</footer></main></div>;
}
function Metric({icon,label,value}){return <div className="metric"><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div>}
export default App;
