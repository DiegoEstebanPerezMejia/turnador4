"use strict";

/* ============================================================
   Turnero web multiusuario - cliente
   Cada usuario inicia sesión y ve SU turnero. El estado vive en el servidor
   (Neon); el cliente lo consulta cada 2 segundos.
   Todo el texto dinámico se inserta con textContent (sin innerHTML).
   ============================================================ */

const MODO_PANTALLA = new URLSearchParams(location.search).get("modo") === "pantalla";
if (MODO_PANTALLA) document.body.classList.add("pantalla");

const $ = (sel) => document.querySelector(sel);

let usuario = null;      // usuario con sesión iniciada
let estado = null;
let ultimoActualId;      // undefined = aún no se ha pintado nada
let enCurso = false;
let secuencia = 0;
let listaActiva = null;
let temporizador = null;
let cerrandoSesion = false;
const IMPRESION_DEFECTO = {
  imprimir_nuevo: false, imprimir_siguiente: false, ancho_papel: 80,
  encabezado: "", subtitulo: "", pie: "",
  mostrar_fecha: true, mostrar_espera: true, mostrar_empleado: true, mostrar_usuario: false,
  tam_turno: "grande", copias: 1, metodo: "navegador",
};
let cfgImpresion = { ...IMPRESION_DEFECTO };   // configuración de tickets del usuario
const mensajesMostrados = new Set();   // mensajes del administrador ya mostrados en esta sesión
let mostrandoMensaje = false;

function el(tag, clase, texto) {
  const n = document.createElement(tag);
  if (clase) n.className = clase;
  if (texto !== undefined && texto !== null) n.textContent = texto;
  return n;
}

function claveLS() { return `turnero_empleado_sugerido_${usuario ? usuario.id : 0}`; }
function leerLS(clave) {
  try { return localStorage.getItem(clave) || ""; } catch (_) { return ""; }
}
function guardarLS(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch (_) { /* sin almacenamiento */ }
}

function fmtDur(s) {
  if (s === null || s === undefined) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return [h, m, x].map((v) => String(v).padStart(2, "0")).join(":");
}

/* ---------------- API ---------------- */
async function api(url, { method = "GET", body, silencioso = false } = {}) {
  const headers = { "X-Requested-With": "turnero" };
  if (body) headers["Content-Type"] = "application/json";
  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  let data = {};
  try { data = await resp.json(); } catch (_) { /* respuesta sin JSON */ }
  if (!resp.ok) {
    const err = new Error(data.error || `Error ${resp.status}`);
    err.status = resp.status;
    if (resp.status === 401 && !silencioso) sesionTerminada();
    throw err;
  }
  return data;
}

function aplicar(nuevo) {
  secuencia++;            // invalida sondeos que estaban en vuelo
  estado = nuevo;
  render();
}

async function refrescar() {
  if (!usuario) return;
  const mi = ++secuencia;
  try {
    const e = await api("/api/estado");
    if (mi !== secuencia || !usuario) return;
    estado = e;
    render();
    $("#conexion").classList.remove("caida");
  } catch (_) {
    $("#conexion").classList.add("caida");
  }
}

function iniciarSondeo() {
  detenerSondeo();
  refrescar();
  temporizador = setInterval(refrescar, 2000);
}
function detenerSondeo() {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}

/* ---------------- Sesión: login / salir ---------------- */
function mostrarLogin(mensaje) {
  detenerSondeo();
  usuario = null;
  estado = null;
  ultimoActualId = undefined;
  secuencia++;
  listaActiva = null;
  mensajesMostrados.clear();
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#login-error").textContent = mensaje || "";
  $("#login-password").value = "";
  $("#login-usuario").focus();
}

function sesionTerminada() {
  if (cerrandoSesion || !usuario) return;
  mostrarLogin("Tu sesión terminó. Inicia sesión de nuevo.");
}

async function salir() {
  cerrandoSesion = true;
  try { await api("/api/logout", { method: "POST", silencioso: true }); } catch (_) { /* da igual */ }
  cerrandoSesion = false;
  mostrarLogin("");
}

function pintarBarra() {
  const b = $("#barra-usuario");
  b.textContent = "";
  b.append(document.createTextNode(`👤 ${usuario.nombre} (${usuario.usuario}) `));
  const ins = el("span", "insignia", usuario.es_admin ? "Administrador" : "Usuario");
  ins.dataset.color = usuario.es_admin ? "morado" : "azulgris";
  b.append(ins);
  $("#btn-admin").hidden = !usuario.es_admin;
  $("#btn-mensajes").hidden = !usuario.es_admin;
}

async function entrar(u) {
  usuario = u;
  estado = null;
  ultimoActualId = undefined;
  mensajesMostrados.clear();
  $("#login").hidden = true;
  $("#app").hidden = false;
  pintarBarra();
  $("#input-empleado").value = leerLS(claveLS());
  if (u.debe_cambiar) {
    const ok = await cambiarClave(true);
    if (!ok) return;
  }
  cargarImpresion();
  iniciarSondeo();
}

async function arrancar() {
  try {
    const r = await api("/api/me", { silencioso: true });
    await entrar(r.usuario);
  } catch (_) {
    mostrarLogin("");
  }
}

/* ---------------- Render ---------------- */
function destello() {
  const n = $("#turno-actual");
  n.classList.remove("flash");
  void n.offsetWidth;
  n.classList.add("flash");
}

function actualizarEtiquetaEmpleado() {
  const etiqueta = $("#etiqueta-empleado");
  if (estado && !estado.ajustes.empleado_obligatorio) {
    etiqueta.textContent = "Empleado: (modo opcional)";
    return;
  }
  const emp = $("#input-empleado").value.trim() || "(ninguno)";
  etiqueta.textContent = `Empleado: ${emp}`;
}

function render() {
  const e = estado;
  if (!e) return;

  $("#turno-espera").textContent = e.ultimo_espera || "—";
  $("#contador-espera").textContent = `Total en cola: ${e.espera.length} turnos`;

  const actual = e.actual;
  $("#turno-actual").textContent = actual ? actual.codigo : "—";
  $("#empleado-atencion").textContent =
    actual && actual.empleado ? `👤 Atiende: ${actual.empleado}` : "—";
  $("#contador-atencion").textContent = `Total en atención: ${e.atencion.length} turnos`;

  if (actual && ultimoActualId !== undefined && ultimoActualId !== actual.id) destello();
  ultimoActualId = actual ? actual.id : null;

  const bEmp = $("#btn-toggle-empleado");
  const obligatorio = e.ajustes.empleado_obligatorio;
  bEmp.textContent = obligatorio ? "🔒 Empleado: OBLIGATORIO" : "🔓 Empleado: OPCIONAL";
  bEmp.className = "btn " + (obligatorio ? "rojo" : "verde");

  const bCot = $("#btn-toggle-cotizacion");
  const cot = e.ajustes.cotizacion_activa;
  bCot.textContent = cot ? "📝 Cotización: ON" : "📝 Cotización: OFF";
  bCot.className = "btn " + (cot ? "cian" : "gris");

  actualizarEtiquetaEmpleado();

  const s = e.stats;
  $("#stats").textContent =
    `Sesión: ${e.sesion_inicio}  |  Generados: ${s.generados}  |  ` +
    `Atendidos: ${s.atendidos}  |  Limpiados: ${s.limpiados}  |  ` +
    `Espera: ${s.espera}  |  Atención: ${s.atencion}  |  ` +
    `Emp: ${obligatorio ? "OBLIGATORIO" : "OPCIONAL"}  |  Cot: ${cot ? "ON" : "OFF"}`;

  if (listaActiva) listaActiva.pintar();
  revisarMensajes();
}

/* Mensajes del administrador: se muestran al iniciar sesión (o en cuanto llegan, si ya
   estás conectado) y se repiten hasta que el usuario pulsa «Entendido». */
async function revisarMensajes() {
  if (MODO_PANTALLA || mostrandoMensaje || !usuario || !estado || !estado.mensajes) return;
  if (enCurso || document.querySelector("dialog[open]")) return;   // no interrumpir lo que haces
  const m = estado.mensajes.find((x) => !mensajesMostrados.has(x.id));
  if (!m) return;

  mostrandoMensaje = true;
  mensajesMostrados.add(m.id);
  try {
    await dialogo({
      titulo: "📢 Mensaje del administrador",
      color: "naranja",
      bloqueante: true,
      contenido: [
        el("p", "dlg-msg mensaje-texto", m.texto),
        el("p", "sub", `${m.autor} · ${m.creado}`),
      ],
      botones: [{ texto: "✅ Entendido", clase: "naranja", valor: true }],
    });
    if (usuario) await api(`/api/mensajes/${m.id}/leido`, { method: "POST", body: {} });
  } catch (_) {
    mensajesMostrados.delete(m.id);   // no se pudo confirmar: se vuelve a mostrar
  } finally {
    mostrandoMensaje = false;
  }
}

/* ---------------- Diálogos ---------------- */
function dialogo({ titulo, color = "azul", clase = "", contenido = [], botones = [], onMontar, bloqueante = false }) {
  return new Promise((resolve) => {
    const dlg = el("dialog", `dlg ${clase}`.trim());
    dlg.dataset.color = color;
    let resultado = null;
    const ctl = {
      dlg,
      cerrar: (valor = null) => { resultado = valor; dlg.close(); },
    };
    if (bloqueante) dlg.addEventListener("cancel", (ev) => ev.preventDefault());

    const cuerpo = el("div", "dlg-cuerpo");
    contenido.forEach((n) => cuerpo.append(n));

    const pie = el("div", "dlg-pie");
    botones.forEach((b) => {
      const btn = el("button", `btn ${b.clase || "gris"}`, b.texto);
      btn.type = "button";
      btn.addEventListener("click", async () => {
        if (b.onClick) await b.onClick(ctl, btn);
        else ctl.cerrar(b.valor === undefined ? null : b.valor);
      });
      pie.append(btn);
    });

    dlg.append(el("h3", "dlg-titulo", titulo), cuerpo, pie);
    dlg.addEventListener("close", () => { dlg.remove(); resolve(resultado); });
    document.body.append(dlg);
    dlg.showModal();
    if (onMontar) onMontar(ctl);
  });
}

function aviso(titulo, mensaje, color = "azul") {
  return dialogo({
    titulo,
    color,
    contenido: [el("p", "dlg-msg", mensaje)],
    botones: [{ texto: "Aceptar", clase: color, valor: true }],
  });
}

function confirmar({ titulo, mensaje, color = "naranja", si = "Sí", no = "No" }) {
  return dialogo({
    titulo,
    color,
    contenido: [el("p", "dlg-msg", mensaje)],
    botones: [
      { texto: no, clase: "gris", valor: false },
      { texto: si, clase: color, valor: true },
    ],
    onMontar: (ctl) => {
      const btnNo = ctl.dlg.querySelector(".btn.gris");
      if (btnNo) btnNo.focus();     // por seguridad, el foco inicial es "No"
    },
  }).then((r) => r === true);
}

/* campos: [{name, label, tipo ('text'|'password'|'select'|'checkbox'), placeholder, maxlength,
             inputmode, valor, marcado, grande, autocomplete, limpiarEnError, opciones}]
   validar(valores) -> string con el error, o null si todo está bien (puede ser async) */
function formulario({ titulo, color = "morado", descripcion, info, campos, aceptar, cancelar = "Cancelar", validar, bloqueante = false, botonesExtra = [] }) {
  const err = el("div", "dlg-error");
  const inputs = {};
  const contenido = [];

  if (descripcion) contenido.push(el("p", "dlg-desc", descripcion));
  if (info) {
    const caja = el("div", "dlg-info");
    info.forEach(([k, v]) => {
      const linea = el("div");
      linea.append(el("b", null, k + ": "), document.createTextNode(v));
      caja.append(linea);
    });
    contenido.push(caja);
  }

  campos.forEach((c) => {
    const wrap = el("label", c.tipo === "checkbox" ? "campo check" : "campo");
    let inp;
    if (c.tipo === "select") {
      if (c.label) wrap.append(el("span", "campo-label", c.label));
      inp = el("select", "campo-input");
      c.opciones.forEach(([valor, texto]) => {
        const o = el("option", null, texto);
        o.value = valor;
        inp.append(o);
      });
      if (c.valor !== undefined) inp.value = String(c.valor);
    } else if (c.tipo === "textarea") {
      if (c.label) wrap.append(el("span", "campo-label", c.label));
      inp = el("textarea", "campo-input");
      inp.rows = c.filas || 4;
      if (c.placeholder) inp.placeholder = c.placeholder;
      if (c.maxlength) inp.maxLength = c.maxlength;
      if (c.valor) inp.value = c.valor;
    } else if (c.tipo === "checkbox") {
      inp = el("input");
      inp.type = "checkbox";
      inp.checked = !!c.marcado;
      wrap.append(inp);
      if (c.label) wrap.append(document.createTextNode(" " + c.label));
    } else {
      if (c.label) wrap.append(el("span", "campo-label", c.label));
      inp = el("input", "campo-input" + (c.grande ? " grande" : ""));
      inp.type = c.tipo || "text";
      if (c.placeholder) inp.placeholder = c.placeholder;
      if (c.maxlength) inp.maxLength = c.maxlength;
      if (c.inputmode) inp.inputMode = c.inputmode;
      inp.autocomplete = c.autocomplete || "off";
      if (c.valor) inp.value = c.valor;
    }
    inputs[c.name] = inp;
    if (c.tipo !== "checkbox") wrap.append(inp);
    contenido.push(wrap);
  });
  contenido.push(err);

  const leer = () => {
    const valores = {};
    campos.forEach((c) => {
      valores[c.name] = c.tipo === "checkbox" ? inputs[c.name].checked : inputs[c.name].value;
    });
    return valores;
  };

  let validando = false;
  const enviar = async (ctl) => {
    if (validando) return;
    const valores = leer();

    validando = true;
    let msg = null;
    try {
      msg = validar ? await validar(valores) : null;
    } catch (e) {
      msg = "❌ " + e.message;
    } finally {
      validando = false;
    }

    if (msg) {
      err.textContent = msg;
      campos.forEach((c) => {
        if (c.limpiarEnError) inputs[c.name].value = "";
      });
      const foco = campos.find((c) => c.limpiarEnError);
      if (foco) inputs[foco.name].focus();
      Object.values(inputs).forEach((i) => {
        if (i.tagName === "INPUT" && i.type !== "checkbox") {
          i.classList.add("error");
          setTimeout(() => i.classList.remove("error"), 1500);
        }
      });
      return;
    }
    ctl.cerrar(valores);
  };

  return dialogo({
    titulo,
    color,
    contenido,
    bloqueante,
    botones: [
      { texto: cancelar, clase: "gris", valor: null },
      ...botonesExtra.map((b) => ({ texto: b.texto, clase: b.clase || "azul", onClick: () => b.onClick(leer()) })),
      { texto: aceptar, clase: color, onClick: (ctl) => enviar(ctl) },
    ],
    onMontar: (ctl) => {
      const todos = campos.map((c) => inputs[c.name]);
      todos.forEach((inp, i) => {
        inp.addEventListener("keydown", (ev) => {
          if (ev.key !== "Enter" || inp.tagName === "TEXTAREA") return;   // en un área de texto Enter = salto de línea
          ev.preventDefault();
          if (i < todos.length - 1) todos[i + 1].focus();
          else enviar(ctl);
        });
        inp.addEventListener("input", () => { err.textContent = ""; });
      });
      if (todos[0]) {
        todos[0].focus();
        if (todos[0].select && todos[0].type !== "checkbox") todos[0].select();
      }
    },
  });
}

function envolver(tabla) {
  const w = el("div", "tabla-wrap");
  w.append(tabla);
  return w;
}

function tablaPares(pares) {
  const t = el("table", "tabla plana");
  const thead = el("thead");
  const trh = el("tr");
  ["Concepto", "Valor"].forEach((x) => trh.append(el("th", null, x)));
  thead.append(trh);
  const tb = el("tbody");
  pares.forEach(([k, v]) => {
    const tr = el("tr");
    tr.append(el("td", null, k), el("td", null, String(v)));
    tb.append(tr);
  });
  t.append(thead, tb);
  return envolver(t);
}

/* cols: [[titulo, clave | función(fila)]] */
function tablaDatos(cols, filas, vacio = "Sin datos todavía.") {
  if (!filas.length) return el("p", "vacio", vacio);
  const t = el("table", "tabla plana hist");
  const thead = el("thead");
  const trh = el("tr");
  cols.forEach(([titulo]) => trh.append(el("th", null, titulo)));
  thead.append(trh);
  const tb = el("tbody");
  filas.forEach((f) => {
    const tr = el("tr");
    cols.forEach(([, k]) => {
      const v = typeof k === "function" ? k(f) : f[k];
      tr.append(el("td", null, v === null || v === undefined || v === "" ? "—" : String(v)));
    });
    tb.append(tr);
  });
  t.append(thead, tb);
  return envolver(t);
}

/* ---------------- Ejecución protegida ---------------- */
async function ejecutar(fn) {
  if (enCurso) return;
  enCurso = true;
  try {
    await fn();
  } catch (e) {
    if (e.status !== 401) {          // 401: ya se mostró la pantalla de login
      await aviso("⚠️ Aviso", e.message, "naranja");
      refrescar();
    }
  } finally {
    enCurso = false;
  }
}

/* ---------------- Claves de la sesión (administrador / sub-administrador) ----------------
   Como en la app original, las acciones delicadas piden usuario y contraseña de
   administrador (o de sub-administrador, en las que lo permiten). Son claves propias de
   cada turnero, distintas de la contraseña de acceso. */
async function configurarClavesSesion() {
  const v = await formulario({
    titulo: "🔐 Configura las claves de tu turnero",
    color: "naranja",
    descripcion:
      "Las acciones delicadas (cambiar modos, reiniciar, cerrar jornada) piden la clave del administrador de la sesión o de un sub-administrador.\n\nCrea ahora ambas claves. Deben ser distintas de tu contraseña de acceso.",
    campos: [
      { name: "password_acceso", label: "Tu contraseña de acceso (para confirmar que eres tú):", tipo: "password", autocomplete: "current-password" },
      { name: "admin_usuario", label: "👑 Usuario del administrador de la sesión:", placeholder: "Ej: admin", maxlength: 40 },
      { name: "admin_password", label: "Contraseña del administrador (mín. 6 caracteres):", tipo: "password", autocomplete: "new-password" },
      { name: "sub_usuario", label: "🔧 Usuario del sub-administrador:", placeholder: "Ej: sub_admin", maxlength: 40 },
      { name: "sub_password", label: "Contraseña del sub-administrador:", tipo: "password", autocomplete: "new-password" },
    ],
    aceptar: "💾 Guardar claves",
    validar: async (val) => {
      try {
        await api("/api/sesion/claves/configurar", { method: "POST", body: val });
        return null;
      } catch (e) {
        return "❌ " + e.message;
      }
    },
  });
  if (v) await aviso("Claves guardadas", "✅ Las claves de administrador y sub-administrador de tu turnero quedaron configuradas.", "verde");
  return !!v;
}

async function pedirCredenciales(motivo, permitirSub) {
  const est = await api("/api/sesion/claves");
  if (!est.configuradas) {
    const ok = await configurarClavesSesion();
    if (!ok) return null;
  }

  let creds = null;
  const v = await formulario({
    titulo: "🔐 Acceso al Sistema",
    color: "morado",
    descripcion: permitirSub
      ? "Ingresa las credenciales del administrador o del sub-administrador de la sesión:"
      : "Esta acción solo la puede autorizar el administrador de la sesión:",
    campos: [
      { name: "usuario", label: "👤 Usuario:", placeholder: "Usuario (admin / sub_admin de la sesión)", autocomplete: "off" },
      { name: "password", label: "🔑 Contraseña:", tipo: "password", placeholder: "Contraseña", autocomplete: "off", limpiarEnError: true },
    ],
    aceptar: "Ingresar",
    validar: async (val) => {
      try {
        const r = await api("/api/sesion/auth/verificar", {
          method: "POST",
          body: { usuario: val.usuario, password: val.password, permitir_sub_admin: permitirSub, motivo },
        });
        creds = { usuario: val.usuario, password: val.password, rol: r.rol };
        return null;
      } catch (e) {
        return "❌ " + e.message;
      }
    },
  });
  return v ? creds : null;
}

function cambiarClaveSesion() {
  return ejecutar(async () => {
    const c = await pedirCredenciales("cambiar la contraseña", false);
    if (!c) return;

    const v = await formulario({
      titulo: "🔑 Cambiar Clave de la sesión",
      color: "naranja",
      campos: [
        { name: "rol", label: "Cuenta:", tipo: "select", opciones: [["admin", "👑 Administrador"], ["sub_admin", "🔧 Sub-Administrador"]] },
        { name: "actual", label: "Contraseña actual:", tipo: "password", autocomplete: "off" },
        { name: "nueva", label: "Nueva contraseña (mín. 6 caracteres):", tipo: "password", autocomplete: "new-password" },
        { name: "confirmar", label: "Confirmar nueva contraseña:", tipo: "password", autocomplete: "new-password" },
      ],
      aceptar: "💾 Guardar",
      validar: async (val) => {
        try {
          await api("/api/sesion/claves/cambiar", {
            method: "POST",
            body: { usuario: c.usuario, password: c.password, ...val },
          });
          return null;
        } catch (e) {
          return "❌ " + e.message;
        }
      },
    });
    if (v) await aviso("Contraseña actualizada", "✅ La contraseña se ha cambiado correctamente.", "verde");
  });
}

/* ---------------- Acciones del turnero ---------------- */
function nuevoTurno() {
  return ejecutar(async () => {
    const r = await api("/api/turnos", { method: "POST" });
    aplicar(r.estado);
    if (cfgImpresion.imprimir_nuevo) imprimirNuevo(r.turno, r.estado);
  });
}

async function solicitarCotizacion(turno, manual) {
  const titulo = manual ? "📝 Registrar Cotización (Alt+C)" : "📝 Registro de Cotización";
  const v = await formulario({
    titulo,
    color: "cian",
    info: [["Turno", turno.codigo], ["Empleado", turno.empleado || "(sin empleado)"]],
    descripcion: "Ingresa los últimos 6 dígitos de la cotización generada:",
    campos: [
      { name: "cotizacion", placeholder: "Últimos 6 números (ej: 123456)", maxlength: 6, inputmode: "numeric", grande: true },
    ],
    aceptar: "✅ Registrar",
    cancelar: "Omitir",
    validar: async (val) => {
      const c = val.cotizacion.trim();
      if (!c) return "❌ Debes ingresar los últimos 6 dígitos";
      if (!/^[0-9]{6}$/.test(c)) return "❌ Deben ser exactamente 6 dígitos numéricos";
      try {
        const r = await api(`/api/turnos/${turno.id}/cotizacion`, { method: "POST", body: { cotizacion: c } });
        aplicar(r.estado);
        return null;
      } catch (e) {
        return "❌ " + e.message;
      }
    },
  });
  if (v && manual) {
    await aviso("✅ Cotización registrada", `Se registró la cotización ${v.cotizacion.trim()}\npara el turno ${turno.codigo}.`, "cian");
  }
}

function siguiente() {
  return ejecutar(async () => {
    if (!estado || !estado.espera.length) {
      await aviso("Sin turnos", "No hay turnos en espera para atender.");
      return;
    }

    let empleado = null;
    if (estado.ajustes.empleado_obligatorio && !estado.siguiente_empleado_pendiente) {
      const v = await formulario({
        titulo: "👤 Empleado que Atiende",
        color: "verde",
        descripcion: "Este empleado atenderá el siguiente turno:",
        campos: [
          { name: "empleado", placeholder: "Ej: VEN 02, T 001...", maxlength: 60, grande: true, valor: $("#input-empleado").value.trim() },
        ],
        aceptar: "✅ Llamar Turno",
        validar: (val) => (val.empleado.trim() ? null : "❌ Debes ingresar el número de empleado"),
      });
      if (!v) return;
      empleado = v.empleado.trim();
      $("#input-empleado").value = empleado;
      guardarLS(claveLS(), empleado);
    }

    const r = await api("/api/siguiente", { method: "POST", body: { empleado } });
    aplicar(r.estado);
    if (cfgImpresion.imprimir_siguiente) imprimirTickets([{ t: r.turno, tipo: "llamado" }], cfgImpresion);

    if (r.estado.ajustes.cotizacion_activa) {
      await solicitarCotizacion(r.turno, false);
    }
  });
}

function devolverTurno() {
  return ejecutar(async () => {
    if (!estado || !estado.atencion.length) {
      await aviso("Sin turnos", "No hay turnos en atención para devolver.");
      return;
    }
    const ok = await confirmar({
      titulo: "⚠️ Confirmar devolución",
      mensaje: `¿Estás seguro de devolver el turno ${estado.actual.codigo} a la cola de espera?\n\nEl turno volverá al inicio de la lista de espera.`,
    });
    if (!ok) return;
    const r = await api("/api/devolver", { method: "POST" });
    aplicar(r.estado);
  });
}

function cotizacionManual() {
  return ejecutar(async () => {
    if (!estado || !estado.actual) {
      await aviso("Sin turnos", "No hay turnos en atención para registrar cotización.");
      return;
    }
    const t = estado.actual;
    if (t.cotizacion) {
      await aviso(
        "✅ Cotización ya registrada",
        `El turno ${t.codigo} ya tiene una cotización registrada:\n\nCotización: ${t.cotizacion}\nEmpleado: ${t.empleado || "(sin empleado)"}\n\nNo se puede registrar una nueva cotización para este turno.`,
        "cian"
      );
      return;
    }
    await solicitarCotizacion(t, true);
  });
}

function limpiar(tipo) {
  const espera = tipo === "espera";
  return ejecutar(async () => {
    const base = `/api/limpiar/${tipo}`;
    const prev = await api(base, { method: "POST", body: { validar: true } });
    const ok = await confirmar({
      titulo: "⚠️ Confirmar limpieza",
      mensaje: espera
        ? `Se eliminarán los ${prev.total} turno(s) en espera.\n\n¿Deseas continuar?`
        : `Se eliminarán los ${prev.total} turno(s) en atención.\n\nLos tiempos de atención se registrarán hasta este momento.\n\n¿Deseas continuar?`,
    });
    if (!ok) return;
    const r = await api(base, { method: "POST", body: {} });
    aplicar(r.estado);
    await aviso(
      "Limpieza completada",
      `✅ Se han eliminado ${r.total} turno(s) ${espera ? "de la cola de espera" : "de atención"}.`,
      "verde"
    );
  });
}
const limpiarEspera = () => limpiar("espera");
const limpiarAtencion = () => limpiar("atencion");

function alternarEmpleado() {
  return ejecutar(async () => {
    const c = await pedirCredenciales("cambiar el modo de empleado", false);
    if (!c) return;
    const r = await api("/api/ajustes/empleado", { method: "POST", body: { usuario: c.usuario, password: c.password } });
    aplicar(r.estado);

    let msg = "";
    if (r.pendientes_borrados > 0) {
      msg += `Se han eliminado ${r.pendientes_borrados} empleado(s) en memoria que estaban asociados a turnos devueltos.\n\nLos próximos turnos que se atiendan solicitarán un nuevo número de empleado (según el modo actual).\n\n`;
    }
    msg += r.estado.ajustes.empleado_obligatorio
      ? "🔒 Modo OBLIGATORIO activado.\nSe pedirá número de empleado cada vez que llames un turno."
      : "🔓 Modo OPCIONAL activado.\nNo se pedirá número de empleado al llamar turnos.";
    await aviso("Modo Empleado", msg, "morado");
  });
}

function alternarCotizacion() {
  return ejecutar(async () => {
    const c = await pedirCredenciales("cambiar el modo de cotización", false);
    if (!c) return;
    const r = await api("/api/ajustes/cotizacion", { method: "POST", body: { usuario: c.usuario, password: c.password } });
    aplicar(r.estado);
    await aviso(
      "Modo Cotización",
      r.estado.ajustes.cotizacion_activa
        ? "📝 Cotización ON activado.\nAl atender cada turno se solicitará automáticamente los últimos 6 dígitos de la cotización generada."
        : "📝 Cotización OFF desactivado.\nNo se solicitará cotización al atender turnos.",
      "cian"
    );
  });
}

function reiniciar() {
  return ejecutar(async () => {
    await api("/api/reiniciar", { method: "POST", body: { validar: true } });
    const c = await pedirCredenciales("reiniciar el contador de turnos", true);
    if (!c) return;
    const ok = await confirmar({
      titulo: "🔄 Confirmar Reinicio",
      mensaje:
        "¿Reiniciar el contador de turnos a 0?\n\nSe reiniciará:\n• Contador de turnos generados → 0\n\nNO se borrarán:\n• Total de turnos atendidos\n• Total de turnos limpiados\n• Historial de atenciones\n• Estadísticas de tiempo\n\nEsta acción no se puede deshacer.",
    });
    if (!ok) return;
    const r = await api("/api/reiniciar", { method: "POST", body: { usuario: c.usuario, password: c.password } });
    aplicar(r.estado);
    await aviso("✅ Reinicio Completado", "El contador de turnos ha sido reiniciado a 0.\nLas estadísticas acumuladas permanecen intactas.", "verde");
  });
}

function cerrarJornada() {
  return ejecutar(async () => {
    const c = await pedirCredenciales("cerrar la sesión", true);
    if (!c) return;
    const ok = await confirmar({
      titulo: "🏁 Cerrar jornada",
      color: "rojo",
      mensaje:
        "¿Cerrar la jornada actual?\n\nSe guardará el resumen en tu historial y el contador de turnos volverá a 0. Los turnos que sigan en espera o en atención se darán por cerrados.\n\nEsta acción no se puede deshacer.",
    });
    if (!ok) return;
    const r = await api("/api/sesion/cerrar", { method: "POST", body: { usuario: c.usuario, password: c.password } });
    aplicar(r.estado);
    await dialogo({
      titulo: "📊 Resumen de la Jornada",
      color: "azul",
      clase: "ancho",
      contenido: [tablaPares(r.resumen)],
      botones: [{ texto: "Cerrar", clase: "azul", valor: true }],
    });
  });
}

async function mostrarHistorial() {
  return ejecutar(async () => {
    const { sesiones } = await api("/api/historial");
    const cols = [
      ["ID Sesión", "id_sesion"], ["Inicio", "fecha_inicio"], ["Cierre", "fecha_cierre"],
      ["Generados", "total_generados"], ["Atendidos", "total_atendidos"],
      ["En Espera", "en_espera_al_cerrar"], ["Limpiados", "total_limpiados"],
      ["T. Promedio Atención", "tiempo_promedio_atencion"], ["T. Máx. Atención", "tiempo_maximo_atencion"],
      ["Empleados Activos", (s) => Object.entries(s.turnos_por_empleado || {}).map(([k, v]) => `Emp ${k}: ${v}`).join(", ")],
    ];
    await dialogo({
      titulo: "📜 Historial de Jornadas",
      color: "naranja",
      clase: "ancho",
      contenido: [tablaDatos(cols, sesiones, "No hay jornadas registradas todavía.")],
      botones: [{ texto: "Cerrar", clase: "azul", valor: true }],
    });
  });
}

/* ---------------- Lista completa (espera / atención) ---------------- */
function abrirLista(tipo) {
  const espera = tipo === "espera";
  const color = espera ? "azul" : "verde";
  let seleccion = null;

  const instr = el("p", "dlg-desc", "💡 Selecciona un turno y presiona Retroceso (Backspace) para eliminarlo");
  const tabla = el("table", "tabla");
  const thead = el("thead");
  const trh = el("tr");
  ["#", "Turno", "Empleado", "Posición"].forEach((x) => trh.append(el("th", null, x)));
  thead.append(trh);
  const tbody = el("tbody");
  tabla.append(thead, tbody);
  const contador = el("div", "dlg-contador");

  function items() {
    return estado ? (espera ? estado.espera : estado.atencion) : [];
  }

  function pintar() {
    const lista = items();
    if (!lista.some((t) => t.id === seleccion)) seleccion = null;
    tbody.replaceChildren();
    lista.forEach((t, i) => {
      const tr = el("tr", t.id === seleccion ? "sel" : "");
      tr.append(
        el("td", null, String(i + 1)),
        el("td", "codigo", t.codigo),
        el("td", null, espera ? "—" : t.empleado || "—"),
        el("td", null, `${i + 1} de ${lista.length}`)
      );
      tr.addEventListener("click", () => { seleccion = t.id; pintar(); });
      tbody.append(tr);
    });
    contador.textContent = `Total: ${lista.length} turno(s)`;
  }

  function eliminar() {
    return ejecutar(async () => {
      if (seleccion === null) {
        await aviso("Sin selección", "Selecciona un turno de la lista para eliminarlo.", color);
        return;
      }
      const t = items().find((x) => x.id === seleccion);
      if (!t) return;
      const ok = await confirmar({ titulo: "Confirmar eliminación", mensaje: `¿Eliminar el turno ${t.codigo}?` });
      if (!ok) return;
      const r = await api(`/api/turnos/${t.id}`, { method: "DELETE" });
      const idx = items().findIndex((x) => x.id === t.id);
      aplicar(r.estado);
      const lista = items();
      if (lista.length) seleccion = lista[Math.min(idx, lista.length - 1)].id;
      pintar();
    });
  }

  listaActiva = { pintar };
  dialogo({
    titulo: espera ? "📋 Lista Completa de Turnos en Espera" : "📋 Lista Completa de Turnos en Atención",
    color,
    clase: "ancho",
    contenido: [instr, envolver(tabla), contador],
    botones: [
      { texto: "🗑️ Eliminar seleccionado", clase: "rosa", onClick: () => eliminar() },
      { texto: "Cerrar", clase: color, valor: true },
    ],
    onMontar: (ctl) => {
      ctl.dlg.addEventListener("keydown", (ev) => {
        if (ev.key === "Backspace") { ev.preventDefault(); eliminar(); }
      });
      pintar();
    },
  }).then(() => { listaActiva = null; });
}

/* ---------------- Impresión de tickets (impresora térmica 80 mm / 58 mm) ----------------
   Se imprime desde el navegador con un documento propio de ancho fijo en mm (72 mm útiles
   en papel de 80 mm, 48 mm en 58 mm) y sin márgenes: funciona con cualquier impresora
   instalada en el equipo, p. ej. ZKTeco 8012. El tamaño de papel (rollo) lo toma del
   controlador de la impresora. Para imprimir sin ventana de confirmación, ver README. */
async function cargarImpresion() {
  try {
    const r = await api("/api/impresion");
    cfgImpresion = { ...IMPRESION_DEFECTO, ...r.config };
  } catch (_) {
    cfgImpresion = { ...IMPRESION_DEFECTO };
  }
}

function imprimirNuevo(t, est) {
  const delante = est ? Math.max(0, est.espera.findIndex((x) => x.id === t.id)) : 0;
  imprimirTickets([{ t, tipo: "nuevo", delante }], cfgImpresion);
}

/* ---- Impresión directa por USB (ESC/POS, sin ventana de impresión) ----
   Usa WebUSB (Chrome/Edge). La impresora se vincula una sola vez con «Vincular impresora USB»;
   después imprime sola. Requiere que el equipo permita a Chrome acceder al dispositivo (en
   Windows, controlador WinUSB; ver README). Si falla, se imprime con el navegador. */
let usbImpresora = null;   // { dev, ep }
const CP858 = { "á": 0xA0, "é": 0x82, "í": 0xA1, "ó": 0xA2, "ú": 0xA3, "ñ": 0xA4, "Ñ": 0xA5, "ü": 0x81,
                "Á": 0xB5, "É": 0x90, "Í": 0xD6, "Ó": 0xE0, "Ú": 0xE9, "¿": 0xA8, "¡": 0xAD, "°": 0xF8 };

function bytesTexto(s) {
  const out = [];
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c < 127) out.push(c);
    else if (CP858[ch] !== undefined) out.push(CP858[ch]);
    else out.push(0x3f);
  }
  return out;
}

async function usbAbrir(dev) {
  if (!dev.opened) await dev.open();
  if (dev.configuration === null) await dev.selectConfiguration(1);
  let mejor = null;
  for (const itf of dev.configuration.interfaces) {
    for (const alt of itf.alternates) {
      const out = alt.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
      if (out && (!mejor || alt.interfaceClass === 7)) mejor = { n: itf.interfaceNumber, alt: alt.alternateSetting, ep: out.endpointNumber };
    }
  }
  if (!mejor) throw new Error("La impresora no tiene un canal de salida USB utilizable.");
  await dev.claimInterface(mejor.n);
  if (mejor.alt) await dev.selectAlternateInterface(mejor.n, mejor.alt);
  usbImpresora = { dev, ep: mejor.ep };
  return usbImpresora;
}

async function usbVincular() {
  if (!navigator.usb) throw new Error("Este navegador no permite USB directo. Usa Chrome o Edge (en https).");
  const dev = await navigator.usb.requestDevice({ filters: [] });
  usbImpresora = null;
  await usbAbrir(dev);
  guardarLS("turnero_usb", `${dev.vendorId}:${dev.productId}`);
  return dev;
}

async function usbObtener() {
  if (usbImpresora && usbImpresora.dev.opened) return usbImpresora;
  if (!navigator.usb) throw new Error("Sin soporte WebUSB.");
  const devs = await navigator.usb.getDevices();
  const guardado = leerLS("turnero_usb");
  const dev = devs.find((d) => `${d.vendorId}:${d.productId}` === guardado) || devs[0];
  if (!dev) throw new Error("No hay impresora USB vinculada.");
  return usbAbrir(dev);
}

function construirEscPos(lista, cfg) {
  const cols = cfg.ancho_papel === 58 ? 32 : 48;
  const maxMult = { mediano: 2, grande: 3, enorme: 4 }[cfg.tam_turno] || 3;
  const copias = Math.min(3, Math.max(1, Number(cfg.copias) || 1));
  const b = [];
  const raw = (...x) => b.push(...x);
  const linea = (txt = "") => { raw(...bytesTexto(txt), 0x0a); };
  const centrado = (txt) => {
    // parte textos largos en renglones del ancho del papel
    const palabras = String(txt).split(" ");
    let l = "";
    for (const p of palabras) {
      if ((l + " " + p).trim().length > cols) { if (l) linea(l); l = p.slice(0, cols); }
      else l = (l + " " + p).trim();
    }
    if (l) linea(l);
  };
  const raya = () => linea("-".repeat(cols));

  raw(0x1b, 0x40, 0x1b, 0x74, 19);          // reiniciar + página de códigos CP858
  lista.forEach(({ t, tipo, delante }) => {
    for (let i = 0; i < copias; i++) {
      raw(0x1b, 0x61, 1);                    // centrar
      if (cfg.encabezado) { raw(0x1b, 0x45, 1, 0x1d, 0x21, 0x11); centrado(cfg.encabezado.slice(0, cols / 2)); raw(0x1d, 0x21, 0, 0x1b, 0x45, 0); }
      if (cfg.subtitulo) centrado(cfg.subtitulo);
      if (cfg.mostrar_usuario && usuario) centrado(usuario.nombre);
      raya();
      linea(tipo === "nuevo" ? "SU TURNO" : "TURNO EN ATENCION");
      const mult = Math.max(1, Math.min(maxMult, Math.floor(cols / String(t.codigo).length)));
      raw(0x1b, 0x45, 1, 0x1d, 0x21, ((mult - 1) << 4) | (mult - 1));
      linea(t.codigo);
      raw(0x1d, 0x21, 0, 0x1b, 0x45, 0);
      raya();
      if (tipo === "nuevo") {
        if (cfg.mostrar_espera) centrado(delante > 0 ? `Turnos delante de usted: ${delante}` : "Usted es el siguiente en ser atendido");
        if (cfg.mostrar_fecha && t.fecha) centrado(t.fecha);
      } else {
        if (cfg.mostrar_empleado && t.empleado) centrado(`Atiende: ${t.empleado}`);
        if (cfg.mostrar_fecha && (t.llamado || t.fecha)) centrado(t.llamado || t.fecha);
      }
      if (cfg.pie) { raya(); centrado(cfg.pie); }
      raw(0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0);   // avanzar y cortar
    }
  });
  return new Uint8Array(b);
}

async function imprimirUSB(lista, cfg) {
  const { dev, ep } = await usbObtener();
  const datos = construirEscPos(lista, cfg);
  for (let i = 0; i < datos.length; i += 4096) await dev.transferOut(ep, datos.slice(i, i + 4096));
}

/* lista: [{ t: turno, tipo: "nuevo" | "llamado", delante?: número }] */
function imprimirTickets(lista, cfg) {
  if (cfg.metodo === "usb") {
    imprimirUSB(lista, cfg).catch((e) => {
      console.error("Impresión USB falló; se usa el navegador", e);
      usbImpresora = null;
      imprimirNavegador(lista, cfg);
    });
    return;
  }
  imprimirNavegador(lista, cfg);
}

function imprimirNavegador(lista, cfg) {
  const ancho = cfg.ancho_papel === 58 ? 58 : 80;
  const util = ancho === 58 ? 48 : 72;          // zona realmente imprimible, en mm
  const base = { mediano: 14, grande: 20, enorme: 26 }[cfg.tam_turno] || 20;
  const copias = Math.min(3, Math.max(1, Number(cfg.copias) || 1));

  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true");
  f.style.cssText = `position:fixed;left:-10000px;top:0;width:${util}mm;height:120mm;border:0;`;
  document.body.append(f);
  const d = f.contentDocument;
  d.open();
  d.write('<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Ticket</title></head><body></body></html>');
  d.close();

  const css = d.createElement("style");
  css.textContent = `
    @page { margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { width: ${util}mm; color: #000; font-family: Arial, Helvetica, sans-serif; text-align: center; }
    .ticket { padding: 3mm 0 7mm; page-break-after: always; break-after: page; }
    .ticket:last-child { page-break-after: auto; break-after: auto; }
    .enc { font-size: 5mm; font-weight: bold; line-height: 1.15; overflow-wrap: anywhere; }
    .sub, .det, .pie { overflow-wrap: anywhere; }
    .sub { font-size: 3.6mm; margin-top: 1mm; }
    .usr { font-size: 3.2mm; margin-top: 1mm; }
    .linea { border-top: 0.4mm dashed #000; margin: 2.5mm 0; }
    .lbl { font-size: 4mm; letter-spacing: 0.4mm; }
    .num { font-weight: bold; line-height: 1.05; white-space: nowrap; margin: 1.5mm 0; }
    .det { font-size: 3.8mm; margin-top: 1mm; }
    .pie { font-size: 3.4mm; margin-top: 1mm; }
  `;
  d.head.append(css);

  const nodo = (clase, texto) => {
    const n = d.createElement("div");
    n.className = clase;
    n.textContent = texto;
    return n;
  };

  lista.forEach(({ t, tipo, delante }) => {
    for (let i = 0; i < copias; i++) {
      const tk = d.createElement("div");
      tk.className = "ticket";
      if (cfg.encabezado) tk.append(nodo("enc", cfg.encabezado));
      if (cfg.subtitulo) tk.append(nodo("sub", cfg.subtitulo));
      if (cfg.mostrar_usuario && usuario) tk.append(nodo("usr", usuario.nombre));
      tk.append(nodo("linea", ""));
      tk.append(nodo("lbl", tipo === "nuevo" ? "SU TURNO" : "TURNO EN ATENCIÓN"));
      const num = nodo("num", t.codigo);
      num.style.fontSize = `${Math.min(base, util / (String(t.codigo).length * 0.66))}mm`;
      tk.append(num);
      tk.append(nodo("linea", ""));
      if (tipo === "nuevo") {
        if (cfg.mostrar_espera) {
          tk.append(nodo("det", delante > 0 ? `Turnos delante de usted: ${delante}` : "Usted es el siguiente en ser atendido"));
        }
        if (cfg.mostrar_fecha && t.fecha) tk.append(nodo("det", t.fecha));
      } else {
        if (cfg.mostrar_empleado && t.empleado) tk.append(nodo("det", `Atiende: ${t.empleado}`));
        if (cfg.mostrar_fecha && (t.llamado || t.fecha)) tk.append(nodo("det", t.llamado || t.fecha));
      }
      if (cfg.pie) {
        tk.append(nodo("linea", ""));
        tk.append(nodo("pie", cfg.pie));
      }
      d.body.append(tk);
    }
  });

  setTimeout(() => {
    try {
      f.contentWindow.focus();
      f.contentWindow.print();
    } catch (e) {
      console.error("No se pudo imprimir el ticket", e);
    }
    setTimeout(() => f.remove(), 60000);
  }, 300);
}

function configurarImpresion() {
  return ejecutar(async () => {
    await cargarImpresion();
    const c = cfgImpresion;
    const campos = [
      { name: "imprimir_nuevo", label: "Imprimir ticket al generar un turno nuevo (➕ Nuevo Turno)", tipo: "checkbox", marcado: c.imprimir_nuevo },
      { name: "imprimir_siguiente", label: "Imprimir ticket al llamar el turno siguiente (Siguiente ▶)", tipo: "checkbox", marcado: c.imprimir_siguiente },
      { name: "metodo", label: "Método de impresión:", tipo: "select", valor: c.metodo, opciones: [["navegador", "Navegador (muestra el diálogo, salvo modo --kiosk-printing)"], ["usb", "USB directa ESC/POS (automática, sin diálogo)"]] },
      { name: "ancho_papel", label: "Ancho del papel:", tipo: "select", valor: c.ancho_papel, opciones: [["80", "80 mm (ZKTeco 8012 y similares)"], ["58", "58 mm"]] },
      { name: "tam_turno", label: "Tamaño del número de turno:", tipo: "select", valor: c.tam_turno, opciones: [["mediano", "Mediano"], ["grande", "Grande"], ["enorme", "Enorme"]] },
      { name: "copias", label: "Copias por ticket:", tipo: "select", valor: c.copias, opciones: [["1", "1"], ["2", "2"], ["3", "3"]] },
      { name: "encabezado", label: "Encabezado (nombre del negocio, máx. 40):", maxlength: 40, valor: c.encabezado, placeholder: "Ej: Mi Negocio" },
      { name: "subtitulo", label: "Subtítulo (máx. 60):", maxlength: 60, valor: c.subtitulo, placeholder: "Ej: Sucursal Centro" },
      { name: "pie", label: "Pie del ticket (máx. 120):", maxlength: 120, valor: c.pie, placeholder: "Ej: Gracias por su preferencia" },
      { name: "mostrar_fecha", label: "Mostrar fecha y hora", tipo: "checkbox", marcado: c.mostrar_fecha },
      { name: "mostrar_espera", label: "Mostrar cuántos turnos hay delante (ticket de turno nuevo)", tipo: "checkbox", marcado: c.mostrar_espera },
      { name: "mostrar_empleado", label: "Mostrar el empleado que atiende (ticket de turno llamado)", tipo: "checkbox", marcado: c.mostrar_empleado },
      { name: "mostrar_usuario", label: "Mostrar el nombre de esta sesión", tipo: "checkbox", marcado: c.mostrar_usuario },
    ];
    const aCfg = (v) => ({ ...v, ancho_papel: Number(v.ancho_papel), copias: Number(v.copias) });

    const v = await formulario({
      titulo: "🖨️ Configuración de impresión",
      color: "cian",
      descripcion: "Con «Navegador» se usa la impresora del diálogo de impresión; con «USB directa» el ticket sale solo, sin ventana (vincula la impresora una vez). Los cambios son solo de tu sesión.",
      campos,
      aceptar: "💾 Guardar",
      botonesExtra: [
        {
          texto: "🔌 Vincular impresora USB",
          clase: "naranja",
          onClick: async () => {
            try {
              const dev = await usbVincular();
              await aviso("Impresora vinculada", `✅ ${dev.productName || "Impresora USB"} lista. Elige «USB directa» y guarda.`, "verde");
            } catch (e) {
              if (e.name !== "NotFoundError") await aviso("No se pudo vincular", e.message || String(e), "rojo");
            }
          },
        },
        {
          texto: "🖨️ Imprimir prueba",
          clase: "azul",
          onClick: (valores) => {
            const ahora = new Date().toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
            const demo = { codigo: "T-001", fecha: ahora, llamado: ahora, empleado: "VEN 02" };
            imprimirTickets([{ t: demo, tipo: "nuevo", delante: 3 }, { t: demo, tipo: "llamado" }], aCfg(valores));
          },
        },
      ],
      validar: async (val) => {
        try {
          const r = await api("/api/impresion", { method: "PUT", body: aCfg(val) });
          cfgImpresion = { ...IMPRESION_DEFECTO, ...r.config };
          return null;
        } catch (e) {
          return "❌ " + e.message;
        }
      },
    });
    if (v) await aviso("Impresión", "✅ Configuración de impresión guardada.", "verde");
  });
}

async function reimprimir() {
  return ejecutar(async () => {
    if (!estado) return;
    const enEspera = estado.espera.length ? estado.espera[estado.espera.length - 1] : null;
    const enAtencion = estado.actual;
    if (!enEspera && !enAtencion) {
      await aviso("Sin turnos", "No hay turnos en espera ni en atención para imprimir.");
      return;
    }
    const botones = [];
    if (enEspera) botones.push({ texto: `Último en espera: ${enEspera.codigo}`, clase: "azul", valor: "nuevo" });
    if (enAtencion) botones.push({ texto: `En atención: ${enAtencion.codigo}`, clase: "verde", valor: "llamado" });
    botones.push({ texto: "Cancelar", clase: "gris", valor: null });

    const opcion = await dialogo({
      titulo: "🖨️ Reimprimir ticket",
      color: "cian",
      contenido: [el("p", "dlg-msg", "¿Qué ticket quieres volver a imprimir?")],
      botones,
    });
    if (opcion === "nuevo") {
      imprimirTickets([{ t: enEspera, tipo: "nuevo", delante: estado.espera.length - 1 }], cfgImpresion);
    } else if (opcion === "llamado") {
      imprimirTickets([{ t: enAtencion, tipo: "llamado" }], cfgImpresion);
    }
  });
}

/* ---------------- Descarga de estadísticas en PDF ---------------- */
async function descargarPDF(usuarioId, btn) {
  const propio = !usuarioId || (usuario && usuarioId === usuario.id);
  const url = propio ? "/api/estadisticas/pdf" : `/api/estadisticas/pdf?usuario_id=${usuarioId}`;
  const textoOriginal = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Generando…"; }
  try {
    const resp = await fetch(url, { credentials: "same-origin", headers: { "X-Requested-With": "turnero" } });
    if (!resp.ok) {
      let msg = `Error ${resp.status}`;
      try { msg = (await resp.json()).error || msg; } catch (_) { /* sin JSON */ }
      if (resp.status === 401) { sesionTerminada(); return; }
      throw new Error(msg);
    }
    const blob = await resp.blob();
    const m = /filename="([^"]+)"/.exec(resp.headers.get("Content-Disposition") || "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = m ? m[1] : "estadisticas.pdf";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (e) {
    await aviso("⚠️ No se pudo descargar el PDF", e.message, "naranja");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
  }
}

/* ---------------- Mi contraseña ---------------- */
async function cambiarClave(obligatoria = false) {
  const v = await formulario({
    titulo: obligatoria ? "🔑 Elige una contraseña nueva" : "🔑 Cambiar mi contraseña",
    color: "naranja",
    bloqueante: obligatoria,
    descripcion: obligatoria ? "Por seguridad debes cambiar tu contraseña antes de continuar." : undefined,
    campos: [
      { name: "actual", label: "Contraseña actual:", tipo: "password", autocomplete: "current-password" },
      { name: "nueva", label: "Nueva contraseña (mín. 6 caracteres):", tipo: "password", autocomplete: "new-password" },
      { name: "confirmar", label: "Confirmar nueva contraseña:", tipo: "password", autocomplete: "new-password" },
    ],
    aceptar: "💾 Guardar",
    cancelar: obligatoria ? "Salir" : "Cancelar",
    validar: async (val) => {
      try {
        const r = await api("/api/password", { method: "POST", body: val });
        usuario = r.usuario;
        return null;
      } catch (e) {
        return "❌ " + e.message;
      }
    },
  });
  if (!v) {
    if (obligatoria) await salir();
    return false;
  }
  await aviso("Contraseña actualizada", "✅ Tu contraseña se cambió correctamente.\nLas demás sesiones abiertas con tu usuario se cerraron.", "verde");
  return true;
}

/* ---------------- Estadísticas detalladas ---------------- */
function tarjetas(lista) {
  const g = el("div", "kpis");
  lista.forEach(([valor, etiqueta]) => {
    const k = el("div", "kpi");
    k.append(el("b", null, String(valor)), el("span", null, etiqueta));
    g.append(k);
  });
  return g;
}

function titulo(texto, sub) {
  const n = [el("h4", "seccion", texto)];
  if (sub) n.push(el("p", "sub", sub));
  return n;
}

function colsEmpleado() {
  return [
    ["Empleado", "empleado"], ["Turnos", "turnos"], ["Cotizaciones", "cotizaciones"],
    ["T. promedio", "promedio_f"], ["T. mínimo", "minimo_f"], ["T. máximo", "maximo_f"], ["T. total", "total_f"],
  ];
}

function tarjetasBloque(b, extra = []) {
  const t = b.tiempos;
  return tarjetas([
    ...extra,
    [b.generados, "Turnos generados"],
    [b.atendidos, "Turnos atendidos"],
    [b.limpiados, "Turnos limpiados"],
    [b.cotizaciones, "Cotizaciones"],
    [b.empleados, "Empleados distintos"],
    [t.promedio_f, "Tiempo promedio"],
    [t.minimo_f, "Tiempo mínimo"],
    [t.maximo_f, "Tiempo máximo"],
    [t.total_f, "Tiempo total atendiendo"],
  ]);
}

function graficoHoras(filas) {
  if (!filas.length) return el("p", "vacio", "Sin datos todavía.");
  const max = Math.max(...filas.map((f) => f.turnos));
  const caja = el("div", "barras");
  filas.forEach((f) => {
    const fila = el("div", "barra-fila");
    const i = el("i");
    i.style.width = `${Math.max(3, Math.round((f.turnos / max) * 100))}%`;
    const pista = el("div");
    pista.append(i);
    fila.append(el("span", null, f.hora), pista, el("b", null, String(f.turnos)));
    caja.append(fila);
  });
  return caja;
}

function mostrarEstadisticas(usuarioId) {
  return ejecutar(async () => {
    const url = usuarioId && (!usuario || usuarioId !== usuario.id)
      ? `/api/estadisticas?usuario_id=${usuarioId}`
      : "/api/estadisticas";
    const d = await api(url);
    const a = d.actual;
    const h = d.historico;
    const propia = !usuarioId || usuarioId === usuario.id;

    const nodos = [];
    nodos.push(el("p", "sub", `Usuario: ${d.usuario.nombre} (${d.usuario.usuario}) · Generado: ${d.generado}`));

    nodos.push(...titulo("Jornada actual", `Inicio: ${a.inicio} · Empleado: ${a.modo_empleado} · Cotización: ${a.modo_cotizacion}`));
    nodos.push(tarjetasBloque(a, [[a.espera, "En espera ahora"], [a.atencion, "En atención ahora"]]));
    nodos.push(...titulo("Por empleado (jornada actual)"));
    nodos.push(tablaDatos(colsEmpleado(), a.por_empleado));
    nodos.push(...titulo("Detalle de turnos atendidos (jornada actual)"));
    nodos.push(tablaDatos(
      [
        ["Turno", "turno"], ["Empleado", "empleado"], ["Fecha", (r) => (r.fecha || "").split("-").reverse().join("/")],
        ["Llamado", "hora_llamado"], ["Fin", "hora_fin"], ["Duración", (r) => fmtDur(r.duracion_segundos)],
        ["Cotización", "cotizacion"], ["Limpiado", (r) => (r.limpiado ? "Sí" : "")],
      ],
      a.detalle,
      "Aún no se ha atendido ningún turno en esta jornada."
    ));

    nodos.push(...titulo("Acumulado de todas las jornadas", `Incluye la jornada actual y ${h.sesiones_cerradas} jornada(s) cerrada(s).`));
    nodos.push(tarjetasBloque(h, [[h.sesiones_cerradas, "Jornadas cerradas"]]));
    nodos.push(...titulo("Por empleado (acumulado)"));
    nodos.push(tablaDatos(colsEmpleado(), h.por_empleado));
    nodos.push(...titulo("Por día"));
    nodos.push(tablaDatos(
      [
        ["Fecha", "fecha"], ["Atendidos", "turnos"], ["Empleados", "empleados"], ["Cotizaciones", "cotizaciones"],
        ["T. promedio", "promedio_f"], ["T. mínimo", "minimo_f"], ["T. máximo", "maximo_f"], ["T. total", "total_f"],
      ],
      h.por_dia
    ));
    nodos.push(...titulo("Turnos atendidos por hora del día"));
    nodos.push(graficoHoras(h.por_hora));
    nodos.push(...titulo("Jornadas cerradas"));
    nodos.push(tablaDatos(
      [
        ["ID", "id_sesion"], ["Inicio", "fecha_inicio"], ["Cierre", "fecha_cierre"], ["Duración", "duracion"],
        ["Generados", "generados"], ["Atendidos", "atendidos"], ["Limpiados", "limpiados"],
        ["Cotizaciones", "cotizaciones"], ["T. promedio", "promedio"], ["T. máximo", "maximo"],
      ],
      d.sesiones,
      "Todavía no hay jornadas cerradas."
    ));

    dialogo({
      titulo: propia ? "📊 Mis estadísticas" : `📊 Estadísticas de ${d.usuario.nombre}`,
      color: "azulgris",
      clase: "ancho",
      contenido: nodos,
      botones: [
        { texto: "📄 Descargar PDF", clase: "verde", onClick: (ctl, btn) => descargarPDF(usuarioId, btn) },
        { texto: "🔄 Actualizar", clase: "azul", onClick: async (ctl) => { ctl.cerrar(true); } },
        { texto: "Cerrar", clase: "gris", valor: false },
      ],
    }).then((recargar) => { if (recargar) mostrarEstadisticas(usuarioId); });
  });
}

/* ---------------- Administración de usuarios ---------------- */
function abrirAdmin() {
  if (!usuario || !usuario.es_admin) return;
  const tbody = el("tbody");
  const tabla = el("table", "tabla plana");
  const thead = el("thead");
  const trh = el("tr");
  ["Usuario", "Nombre", "Rol", "Acceso", "Último acceso", "Cola", "Acciones"].forEach((x) => trh.append(el("th", null, x)));
  thead.append(trh);
  tabla.append(thead, tbody);
  const ayuda = el("p", "dlg-desc",
    "Cada usuario trabaja con su propio turnero. Quitar el acceso cierra su sesión al instante; sus datos se conservan.");
  const msg = el("div", "dlg-error");
  let usuarios = [];

  function boton(texto, clase, fn, deshabilitado = false) {
    const b = el("button", `btn ${clase}`, texto);
    b.type = "button";
    b.disabled = deshabilitado;
    b.addEventListener("click", fn);
    return b;
  }

  async function cargar() {
    const r = await api("/api/admin/usuarios");
    usuarios = r.usuarios;
    pintar();
  }

  async function accion(fn) {
    msg.textContent = "";
    await ejecutar(async () => { await fn(); await cargar(); });
  }

  function pintar() {
    tbody.replaceChildren();
    usuarios.forEach((u) => {
      const yo = u.id === usuario.id;
      const tr = el("tr", u.activo ? "" : "inactivo");
      const celdaUsuario = el("td", "izq");
      celdaUsuario.append(document.createTextNode(u.usuario + (yo ? " (tú)" : "")));
      if (u.debe_cambiar) celdaUsuario.append(el("div", "sub", "debe cambiar su clave"));
      tr.append(
        celdaUsuario,
        el("td", "izq", u.nombre),
        el("td", null, u.es_admin ? "Administrador" : "Usuario"),
        el("td", null, u.activo ? "✅ Con acceso" : "⛔ Sin acceso"),
        el("td", null, u.ultimo_acceso || "Nunca"),
        el("td", null, `${u.en_espera} / ${u.en_atencion}`)
      );

      const acc = el("div", "acciones");
      acc.append(
        boton(u.activo ? "⛔ Quitar acceso" : "✅ Dar acceso", u.activo ? "rojo" : "verde", () => accion(async () => {
          if (u.activo) {
            const ok = await confirmar({ titulo: "Quitar acceso", mensaje: `¿Quitar el acceso a ${u.nombre} (${u.usuario})?\n\nSu sesión se cerrará de inmediato. Sus datos se conservan.` });
            if (!ok) return;
          }
          await api(`/api/admin/usuarios/${u.id}`, { method: "PATCH", body: { activo: !u.activo } });
        }), yo),
        boton(u.es_admin ? "Quitar admin" : "Hacer admin", "morado", () => accion(async () => {
          const ok = await confirmar({
            titulo: "Cambiar rol",
            mensaje: u.es_admin ? `${u.nombre} dejará de ser administrador.` : `${u.nombre} podrá crear usuarios y dar o quitar accesos.`,
          });
          if (!ok) return;
          await api(`/api/admin/usuarios/${u.id}`, { method: "PATCH", body: { es_admin: !u.es_admin } });
        }), yo),
        boton("🔑 Clave", "naranja", () => accion(async () => {
          const v = await formulario({
            titulo: `🔑 Nueva contraseña para ${u.usuario}`,
            color: "naranja",
            campos: [
              { name: "password", label: "Nueva contraseña (mín. 6 caracteres):", tipo: "password", autocomplete: "new-password" },
              { name: "debe_cambiar", label: "Pedirle que la cambie al entrar", tipo: "checkbox", marcado: true },
            ],
            aceptar: "💾 Guardar",
            validar: async (val) => {
              try {
                await api(`/api/admin/usuarios/${u.id}`, { method: "PATCH", body: val });
                return null;
              } catch (e) {
                return "❌ " + e.message;
              }
            },
          });
          if (v) await aviso("Contraseña actualizada", `La contraseña de ${u.usuario} se cambió y sus sesiones abiertas se cerraron.`, "verde");
        }), yo),
        boton("📊 Estadísticas", "azulgris", () => { mostrarEstadisticas(u.id); }),
        boton("♻️ Inicializar", "cafe", () => accion(async () => {
          const ok = await confirmar({
            titulo: "Inicializar turnero",
            mensaje: `Se cerrará la jornada de ${u.nombre} (queda en su historial) y su turnero volverá a empezar desde cero.\n\nLos turnos pendientes se darán por cerrados.\n\n¿Continuar?`,
          });
          if (!ok) return;
          const r = await api(`/api/admin/usuarios/${u.id}/inicializar`, { method: "POST", body: {} });
          await dialogo({
            titulo: `📊 Resumen de la jornada de ${u.usuario}`,
            color: "azul",
            clase: "ancho",
            contenido: [tablaPares(r.resumen)],
            botones: [{ texto: "Cerrar", clase: "azul", valor: true }],
          });
        })),
        boton("🔐 Claves sesión", "azulgris", () => accion(async () => {
          const ok = await confirmar({
            titulo: "Restablecer claves de la sesión",
            mensaje: `Se borrarán las claves de administrador y sub-administrador del turnero de ${u.nombre}.\n\nLa próxima vez que use una acción protegida tendrá que crearlas de nuevo con su contraseña de acceso.\n\n¿Continuar?`,
          });
          if (!ok) return;
          await api(`/api/admin/usuarios/${u.id}/claves-sesion/restablecer`, { method: "POST", body: {} });
          await aviso("Claves restablecidas", `Las claves de la sesión de ${u.usuario} se borraron. Deberá configurarlas de nuevo.`, "verde");
        }))
      );
      const td = el("td");
      td.append(acc);
      tr.append(td);
      tbody.append(tr);
    });
  }

  function nuevoUsuario() {
    return accion(async () => {
      const v = await formulario({
        titulo: "➕ Nuevo usuario",
        color: "verde",
        descripcion: "Su turnero se crea vacío y listo para usar.",
        campos: [
          { name: "usuario", label: "Usuario (letras, números . _ -):", maxlength: 40, autocomplete: "off" },
          { name: "nombre", label: "Nombre completo:", maxlength: 80 },
          { name: "password", label: "Contraseña inicial (mín. 6 caracteres):", tipo: "password", autocomplete: "new-password" },
          { name: "es_admin", label: "Es administrador", tipo: "checkbox" },
          { name: "debe_cambiar", label: "Pedirle que cambie la clave al entrar", tipo: "checkbox", marcado: true },
        ],
        aceptar: "✅ Crear",
        validar: async (val) => {
          try {
            await api("/api/admin/usuarios", { method: "POST", body: val });
            return null;
          } catch (e) {
            return "❌ " + e.message;
          }
        },
      });
      if (v) await aviso("Usuario creado", `✅ Se creó el usuario ${v.usuario.trim().toLowerCase()}.\nYa puede iniciar sesión con la contraseña que le asignaste.`, "verde");
    });
  }

  dialogo({
    titulo: "👥 Administración de usuarios",
    color: "morado",
    clase: "ancho",
    contenido: [ayuda, envolver(tabla), msg],
    botones: [
      { texto: "➕ Nuevo usuario", clase: "verde", onClick: () => nuevoUsuario() },
      { texto: "Cerrar", clase: "gris", valor: true },
    ],
    onMontar: () => { cargar().catch((e) => { msg.textContent = "❌ " + e.message; }); },
  });
}

/* ---------------- Mensajes en pantalla (administrador) ---------------- */
function abrirMensajesAdmin() {
  if (!usuario || !usuario.es_admin) return;
  const tbody = el("tbody");
  const tabla = el("table", "tabla plana");
  const thead = el("thead");
  const trh = el("tr");
  ["Mensaje", "Para", "Enviado", "Confirmado", "Estado", ""].forEach((x) => trh.append(el("th", null, x)));
  thead.append(trh);
  tabla.append(thead, tbody);
  const ayuda = el("p", "dlg-desc",
    "Los mensajes aparecen en pantalla cuando el usuario inicia sesión (o al instante si ya está conectado) y se repiten hasta que pulsa «Entendido».");
  const vacio = el("p", "vacio", "Todavía no has enviado mensajes.");
  const msg = el("div", "dlg-error");

  async function cargar() {
    const r = await api("/api/admin/mensajes");
    tbody.replaceChildren();
    vacio.hidden = r.mensajes.length > 0;
    r.mensajes.forEach((m) => {
      const tr = el("tr", m.activo ? "" : "inactivo");
      const acc = el("div", "acciones");
      if (m.activo) {
        const b = el("button", "btn rosa", "🗑️ Retirar");
        b.type = "button";
        b.addEventListener("click", async () => {
          msg.textContent = "";
          await ejecutar(async () => {
            const ok = await confirmar({ titulo: "Retirar mensaje", mensaje: "Dejará de mostrarse a quienes aún no lo hayan confirmado.\n\n¿Retirarlo?" });
            if (!ok) return;
            await api(`/api/admin/mensajes/${m.id}`, { method: "DELETE" });
            await cargar();
          });
        });
        acc.append(b);
      }
      const td = el("td");
      td.append(acc);
      tr.append(
        el("td", "texto", m.texto),
        el("td", null, m.para),
        el("td", null, m.creado),
        el("td", null, `${m.leidos} de ${m.total}`),
        el("td", null, m.activo ? "📢 Activo" : "Retirado"),
        td
      );
      tbody.append(tr);
    });
  }

  function nuevoMensaje() {
    return ejecutar(async () => {
      const { usuarios } = await api("/api/admin/usuarios");
      const activos = usuarios.filter((u) => u.activo);
      const campos = [
        { name: "texto", label: "Mensaje (máx. 500 caracteres):", tipo: "textarea", filas: 5, maxlength: 500, placeholder: "Escribe el aviso que verán en su pantalla…" },
        { name: "todos", label: "Enviar a TODOS los usuarios", tipo: "checkbox", marcado: true },
        ...activos.map((u) => ({ name: `u_${u.id}`, label: `Solo a: ${u.nombre} (${u.usuario})`, tipo: "checkbox" })),
      ];
      const v = await formulario({
        titulo: "📢 Nuevo mensaje",
        color: "cian",
        descripcion: "Si marcas «TODOS», se ignoran las casillas de usuarios individuales.",
        campos,
        aceptar: "📢 Enviar",
        validar: async (val) => {
          const texto = val.texto.trim();
          if (!texto) return "❌ Escribe el mensaje";
          let destinatarios = null;
          if (!val.todos) {
            destinatarios = activos.filter((u) => val[`u_${u.id}`]).map((u) => u.id);
            if (!destinatarios.length) return "❌ Elige al menos un destinatario o marca «TODOS»";
          }
          try {
            await api("/api/admin/mensajes", { method: "POST", body: { texto, destinatarios } });
            return null;
          } catch (e) {
            return "❌ " + e.message;
          }
        },
      });
      if (v) await cargar();
    });
  }

  dialogo({
    titulo: "📢 Mensajes en pantalla",
    color: "cian",
    clase: "ancho",
    contenido: [ayuda, envolver(tabla), vacio, msg],
    botones: [
      { texto: "➕ Nuevo mensaje", clase: "cian", onClick: () => nuevoMensaje() },
      { texto: "Cerrar", clase: "gris", valor: true },
    ],
    onMontar: () => { cargar().catch((e) => { msg.textContent = "❌ " + e.message; }); },
  });
}

/* ---------------- Modo pantalla: botón de salida ---------------- */
function salirModoPantalla() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  window.close();                                  // funciona si la pestaña la abrió «Modo Pantalla»
  setTimeout(() => { location.href = "/"; }, 200);  // si no se pudo cerrar, vuelve al turnero
}

function prepararSalidaPantalla() {
  const b = $("#btn-salir-pantalla");
  b.hidden = false;
  let t = null;
  const mostrar = () => {
    b.classList.add("visible");
    clearTimeout(t);
    t = setTimeout(() => b.classList.remove("visible"), 3500);
  };
  ["mousemove", "pointerdown", "touchstart", "keydown"].forEach((ev) =>
    document.addEventListener(ev, mostrar, { passive: true })
  );
  b.addEventListener("click", salirModoPantalla);
  mostrar();   // se ve unos segundos al entrar, para saber que está ahí
}

/* ---------------- Eventos ---------------- */
function init() {
  if (MODO_PANTALLA) prepararSalidaPantalla();

  // Controles del turnero: desplegables, recuerdan si los dejaste abiertos o cerrados.
  const det = $("#controles");
  if (leerLS("turnero_controles_abierto") === "0") det.open = false;
  det.addEventListener("toggle", () => guardarLS("turnero_controles_abierto", det.open ? "1" : "0"));

  $("#form-login").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = $("#login-error");
    const btn = $("#login-enviar");
    err.textContent = "";
    btn.disabled = true;
    try {
      const r = await api("/api/login", {
        method: "POST",
        silencioso: true,
        body: { usuario: $("#login-usuario").value, password: $("#login-password").value },
      });
      $("#login-password").value = "";
      await entrar(r.usuario);
    } catch (e) {
      err.textContent = "❌ " + e.message;
      $("#login-password").value = "";
      $("#login-password").focus();
    } finally {
      btn.disabled = false;
    }
  });

  $("#input-empleado").addEventListener("input", (ev) => {
    guardarLS(claveLS(), ev.target.value.trim());
    actualizarEtiquetaEmpleado();
  });

  $("#btn-stats").addEventListener("click", () => mostrarEstadisticas());
  $("#btn-admin").addEventListener("click", abrirAdmin);
  $("#btn-mensajes").addEventListener("click", abrirMensajesAdmin);
  $("#btn-clave-sesion").addEventListener("click", cambiarClaveSesion);
  $("#btn-clave").addEventListener("click", () => ejecutar(() => cambiarClave(false)));
  $("#btn-salir").addEventListener("click", salir);

  $("#btn-nuevo").addEventListener("click", nuevoTurno);
  $("#btn-lista-espera").addEventListener("click", () => abrirLista("espera"));
  $("#btn-limpiar-espera").addEventListener("click", limpiarEspera);

  $("#btn-siguiente").addEventListener("click", siguiente);
  $("#btn-anterior").addEventListener("click", devolverTurno);
  $("#btn-lista-atencion").addEventListener("click", () => abrirLista("atencion"));
  $("#btn-limpiar-atencion").addEventListener("click", limpiarAtencion);

  $("#btn-toggle-empleado").addEventListener("click", alternarEmpleado);
  $("#btn-toggle-cotizacion").addEventListener("click", alternarCotizacion);
  $("#btn-cotizar").addEventListener("click", cotizacionManual);
  $("#btn-reiniciar").addEventListener("click", reiniciar);
  $("#btn-historial").addEventListener("click", mostrarHistorial);
  $("#btn-imprimir-config").addEventListener("click", configurarImpresion);
  $("#btn-reimprimir").addEventListener("click", reimprimir);
  $("#btn-cerrar-sesion").addEventListener("click", cerrarJornada);
  $("#btn-pantalla").addEventListener("click", () => window.open("/?modo=pantalla", "_blank"));

  // Atajos: Alt+letra (Ctrl+N/L/K... los reservan los navegadores) y Retroceso.
  document.addEventListener("keydown", (ev) => {
    if (MODO_PANTALLA || !usuario || $("#app").hidden) return;
    if (document.querySelector("dialog[open]")) return;

    const tag = (ev.target.tagName || "").toLowerCase();
    const escribiendo = tag === "input" || tag === "textarea" || tag === "select" || ev.target.isContentEditable;

    if (ev.key === "Backspace" && !escribiendo && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      devolverTurno();
      return;
    }
    if (!ev.altKey || ev.ctrlKey || ev.metaKey) return;

    const mapa = {
      KeyN: nuevoTurno,
      KeyS: siguiente,
      KeyA: devolverTurno,
      KeyL: limpiarEspera,
      KeyK: limpiarAtencion,
      KeyC: cotizacionManual,
      KeyP: reimprimir,
    };
    const fn = mapa[ev.code];
    if (fn) { ev.preventDefault(); fn(); }
  });

  // Doble clic en el modo pantalla: pantalla completa.
  document.addEventListener("dblclick", () => {
    if (!MODO_PANTALLA) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });

  arrancar();
}

init();
