// Estas cuatro estructuras se completan al vuelo con lo que devuelve el Apps Script
// (acción "listas"), en vez de estar hardcodeadas acá.
let TIENDAS = [];
let PRODUCTOS = {};          // { familia: [producto, producto, ...] }
let PRODUCTO_GRUPO = {};     // { producto: grupoModelo }
let MODELOS_POR_GRUPO = {};  // { grupoModelo: [modelo, modelo, ...] }

function modelosDe(prod) {
  const gm = PRODUCTO_GRUPO[prod];
  if (!gm) return null;
  return MODELOS_POR_GRUPO[gm] || null;
}
/* Detecta productos tipo "Silicone case negra otras marcas", "Vidrio templado otras
   marcas", etc. Para estos no hay lista de modelos (no tienen marca definida), así
   que en vez de una lista de modelos pedimos Marca + Modelo como texto libre. */
function esOtrasMarcas(prod){
  return /otras marcas/i.test(prod || '');
}
/* Genera una clave de grupoModelo estable a partir de una marca escrita a mano
   (sin tildes, en mayúsculas), para que la próxima vez que alguien escriba la
   misma marca (con otra tipografía o acentos) quede agrupada junto a la anterior. */
function grupoDesdeMarca(marca){
  return normalizarBusqueda(marca).trim().toUpperCase();
}

/* --- Utilidades de calidad de datos (texto libre: Marca, Modelo, "otro") --- */

function sanitizarTexto(texto){
  return (texto || '').toString().replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatearTitleCase(texto){
  return sanitizarTexto(texto).split(' ').map(palabra => {
    if(!palabra) return palabra;
    const soloLetras = palabra.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
    if(!soloLetras) return palabra;
    const yaTieneMayuscula = /[A-ZÁÉÍÓÚÑ]/.test(palabra.slice(1));
    if(yaTieneMayuscula) return palabra;
    return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
  }).join(' ');
}

const TEXTOS_SIN_SENTIDO = new Set(['test','prueba','asdf','qwerty','asd','aaa','xxx','n/a','na','ninguno','nada','...','123','123456']);
function esTextoSinSentido(texto){
  const t = normalizarBusqueda(sanitizarTexto(texto));
  if(!t) return true;
  if(!/[a-z0-9]/i.test(t)) return true;
  if(/^(.)\1+$/.test(t.replace(/\s/g,''))) return true;
  if(TEXTOS_SIN_SENTIDO.has(t)) return true;
  return false;
}

function marcarError(el){
  if(el) el.classList.add('input-error');
}
function limpiarErrores(){
  document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
}

function cantidadValida(v){
  const s = (v === null || v === undefined) ? '' : String(v).trim();
  if(!/^[0-9]+$/.test(s)) return false;
  return parseInt(s, 10) >= 1;
}

function formularioListo(){
  const fecha = document.getElementById('fecha')?.value;
  const tienda = document.getElementById('tienda')?.value;
  if(!fecha || !tienda) return false;
  const items = document.querySelectorAll('.item');
  if(!items.length) return false;
  let listo = true;
  items.forEach(it => {
    const id = it.id.replace('it-', '');
    const fam = document.getElementById(`fam-${id}`)?.value;
    if(!fam){ listo = false; return; }
    const tieneAlgo =
      it.querySelector('.msel-chip input[type=number]') ||
      it.querySelector('.otro-row input[type=number]') ||
      it.querySelector('input[id^="qty-"]');
    if(!tieneAlgo) listo = false;
  });
  return listo;
}
function actualizarEstadoBoton(){
  const btn = document.getElementById('submit');
  if(!btn || btn.textContent.indexOf('Guardando') !== -1) return;
  btn.disabled = !formularioListo();
}

function hayDatosSinEnviar(){
  const doneVisible = document.getElementById('done')?.style.display === 'block';
  if(doneVisible) return false;
  if(document.getElementById('tienda')?.value) return true;
  const items = document.querySelectorAll('.item');
  for(const it of items){
    const id = it.id.replace('it-', '');
    if(document.getElementById(`fam-${id}`)?.value) return true;
  }
  return false;
}

function recordarTienda(tienda){
  try { localStorage.setItem('tune_ultima_tienda', tienda); } catch(e){}
}
function ultimaTiendaGuardada(){
  try { return localStorage.getItem('tune_ultima_tienda') || ''; } catch(e){ return ''; }
}

function buscarDuplicadosEnEnvio(registros){
  const vistos = {};
  const repetidos = [];
  registros.forEach(r => {
    const clave = [r.familia, r.producto, r.modelo||''].join('|').toUpperCase();
    vistos[clave] = (vistos[clave]||0) + 1;
    if(vistos[clave] === 2) repetidos.push(`${r.producto}${r.modelo?' ('+r.modelo+')':''}`);
  });
  return repetidos;
}

window._enviosSesion = window._enviosSesion || new Set();
function buscarDuplicadosDeSesion(registros){
  const repetidos = [];
  registros.forEach(r => {
    const clave = [r.fecha, r.tienda, r.familia, r.producto, r.modelo||''].join('|').toUpperCase();
    if(window._enviosSesion.has(clave)) repetidos.push(`${r.producto}${r.modelo?' ('+r.modelo+')':''}`);
  });
  return repetidos;
}
function registrarEnvioEnSesion(registros){
  registros.forEach(r => {
    const clave = [r.fecha, r.tienda, r.familia, r.producto, r.modelo||''].join('|').toUpperCase();
    window._enviosSesion.add(clave);
  });
}

/* Trae tiendas/productos/modelos desde el Apps Script (JSONP, evita problemas de CORS). */
function cargarListas() {
  return new Promise((resolve, reject) => {
    if (!API_URL) { reject(new Error('Sin API_URL configurada')); return; }
    const cb = 'cbListas_' + Date.now() + '_' + Math.floor(Math.random() * 1e4);
    const s = document.createElement('script');
    let resuelto = false;
    const limpiar = () => { try { delete window[cb]; } catch (e) {} if (s.parentNode) s.parentNode.removeChild(s); };
    const timeoutId = setTimeout(() => {
      if (resuelto) return;
      resuelto = true;
      limpiar();
      reject(new Error('El servidor tardó demasiado en responder.'));
    }, 15000);
    window[cb] = (data) => { if (resuelto) return; resuelto = true; clearTimeout(timeoutId); limpiar(); resolve(data); };
    s.onerror = () => { if (resuelto) return; resuelto = true; clearTimeout(timeoutId); limpiar(); reject(new Error('No se pudo leer las listas del servidor')); };
    s.src = API_URL + '?action=listas&callback=' + cb + '&t=' + Date.now() + '&authuser=0';
    document.body.appendChild(s);
  });
}

/* Comparador alfabético "natural": trata los números dentro del texto como números,
   así "iPhone 2" queda antes que "iPhone 10" en vez de después. */
const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

/* Arma TIENDAS / PRODUCTOS / PRODUCTO_GRUPO / MODELOS_POR_GRUPO a partir de la respuesta del servidor. */
function poblarDesde(data) {
  TIENDAS = Array.isArray(data.tiendas) ? data.tiendas.slice() : [];
  TIENDAS.sort(collator.compare);

  PRODUCTOS = {};
  PRODUCTO_GRUPO = {};
  (data.productos || []).forEach(p => {
    if (!p.familia || !p.producto) return;
    if (!PRODUCTOS[p.familia]) PRODUCTOS[p.familia] = [];
    PRODUCTOS[p.familia].push(p.producto);
    if (p.grupoModelo) PRODUCTO_GRUPO[p.producto] = p.grupoModelo;
  });
  Object.keys(PRODUCTOS).forEach(fam => PRODUCTOS[fam].sort(collator.compare));
  const familiasOrdenadas = Object.keys(PRODUCTOS).sort(collator.compare);
  const productosOrdenados = {};
  familiasOrdenadas.forEach(fam => { productosOrdenados[fam] = PRODUCTOS[fam]; });
  PRODUCTOS = productosOrdenados;

  MODELOS_POR_GRUPO = {};
  (data.modelos || []).forEach(m => {
    if (!m.grupoModelo || !m.modelo) return;
    if (!MODELOS_POR_GRUPO[m.grupoModelo]) MODELOS_POR_GRUPO[m.grupoModelo] = [];
    MODELOS_POR_GRUPO[m.grupoModelo].push(m.modelo);
  });
  Object.keys(MODELOS_POR_GRUPO).forEach(gm => MODELOS_POR_GRUPO[gm].sort((a,b) => collator.compare(b,a)));
}

// (FAM_COLOR, API_URL y Backend ahora viven en faltantes-core.js)


/* LOGICA DE CARGA */
let n = 0;
function addItem() {
  n++;
  const id = n;
  const div = document.createElement('div');
  div.className = 'item';
  div.id = `it-${id}`;
  div.innerHTML = `
    <div class="item-top">
      <span class="item-n">FALTANTE ${String(id).padStart(2,'0')}</span>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="badge" id="bdg-${id}"></span>
        ${id>1 ? `<button class="rm" title="Quitar" onclick="rmItem(${id})">×</button>` : ''}
      </div>
    </div>
    <div class="field">
      <label class="fld">Familia <span class="req">*</span></label>
      <select id="fam-${id}" onchange="onFam(${id})">
        <option value="">Elegí familia...</option>
        ${Object.keys(PRODUCTOS).map(f=>`<option value="${f}">${f}</option>`).join('')}
      </select>
    </div>
    <div id="cuerpo-${id}"></div>`;
  document.getElementById('items').appendChild(div);
  document.getElementById(`fam-${id}`).focus();
  actualizarContadorFaltantes();
  actualizarEstadoBoton();
}
function rmItem(id){
  const total = document.querySelectorAll('.item').length;
  if(total <= 1){
    toast('Necesitás al menos un faltante cargado.');
    return;
  }
  if(!confirm('¿Quitar este faltante? Se va a perder lo que hayas cargado ahí.')) return;
  const e=document.getElementById(`it-${id}`);
  if(e) e.remove();
  actualizarContadorFaltantes();
  actualizarEstadoBoton();
}
function actualizarContadorFaltantes(){
  const el = document.getElementById('contador-faltantes');
  if(!el) return;
  const total = document.querySelectorAll('.item').length;
  el.textContent = total === 1 ? '1 faltante cargado' : `${total} faltantes cargados`;
}

/* Fila reutilizable para el campo opcional "¿falta otro X que no está en la lista?" */
/* Calcula el límite de caracteres para el campo "otro", usando como referencia
   el nombre más largo que ya existe activo en esa misma categoría (familia o marca). */
function maxLongitud(lista, minimo){
  minimo = minimo || 10;
  if(!lista || !lista.length) return minimo;
  return Math.max(...lista.map(s => (s||'').length), minimo);
}
let otrosContador = {}; // { itemId: próximo índice de fila }

function filaOtro(id, tipo, etiquetaBoton, maxLen){
  otrosContador[id] = 0;
  return `
    <div class="field" style="margin-top:14px;">
      <div id="otros-lista-${id}"></div>
      <button type="button" onclick="agregarFilaOtro(${id}, '${tipo}', ${maxLen})" id="btn-otro-${id}"
        data-etiqueta="${etiquetaBoton.replace(/"/g,'&quot;')}"
        style="font-size:13.5px;color:var(--magenta);background:none;border:none;cursor:pointer;font-weight:600;padding:6px 0;">
        + ${etiquetaBoton}
      </button>
    </div>`;
}

function agregarFilaOtro(id, tipo, maxLen){
  const idx = otrosContador[id]++;
  const rowId = `${id}-${idx}`;
  const lista = document.getElementById(`otros-lista-${id}`);
  const row = document.createElement('div');
  row.className = 'otro-row';
  row.id = `otro-row-${rowId}`;
  row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin-bottom:10px;';
  row.innerHTML = `
    <div style="flex:1;">
      <input type="text" id="modc-${rowId}" maxlength="${maxLen}" placeholder="Escribí acá..." oninput="onDetalleInput('${rowId}', '${tipo}');this.classList.remove('input-error')" onblur="this.value=formatearTitleCase(this.value)">
      <div id="modc-sug-${rowId}" style="display:none;margin-top:8px;">
        <div id="modc-sug-titulo-${rowId}" style="font-size:11.5px;color:var(--ink-soft);margin-bottom:5px;">¿Alguno de estos?</div>
        <div id="modc-sug-chips-${rowId}" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
      </div>
    </div>
    <input type="number" id="qty-otro-${rowId}" min="1" step="1" inputmode="numeric" placeholder="Cant." style="width:80px;flex-shrink:0;">
    <button type="button" onclick="quitarFilaOtro(${id}, '${rowId}')" title="Quitar" style="background:none;border:none;color:var(--ink-soft);cursor:pointer;font-size:22px;line-height:1;padding:10px 12px;min-width:44px;flex-shrink:0;">×</button>`;
  lista.appendChild(row);
  document.getElementById(`modc-${rowId}`).focus();
  document.getElementById(`btn-otro-${id}`).textContent = '+ Agregar otro';
}

function quitarFilaOtro(id, rowId){
  const row = document.getElementById(`otro-row-${rowId}`);
  if(row) row.remove();
  const lista = document.getElementById(`otros-lista-${id}`);
  const btn = document.getElementById(`btn-otro-${id}`);
  if(lista && btn && !lista.children.length){
    btn.textContent = '+ ' + btn.dataset.etiqueta;
  }
}

/* --- Desplegable de selección múltiple con buscador (para Producto y Modelo) ---
   En vez de mostrar todos los checkboxes siempre abiertos (muy largo con listas de
   80+ modelos), queda colapsado como un select normal; al abrirlo aparece un buscador
   y la lista con checkboxes. Lo que se va marcando aparece como tarjetitas debajo,
   cada una con su propio campo de cantidad. */
function normalizarBusqueda(s){
  return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
function renderMultiSelect(scopeId, opciones, placeholder){
  return `
    <div class="msel" id="msel-${scopeId}">
      <button type="button" onclick="toggleMultiSelect('${scopeId}')" style="width:100%;text-align:left;font-family:'Inter',sans-serif;font-size:14px;color:var(--ink);padding:11px 12px;background:#FBFAFC;border:1px solid var(--line-strong);border-radius:9px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;">
        <span id="msel-label-${scopeId}" data-placeholder="${placeholder.replace(/"/g,'&quot;')}">${placeholder}</span>
        <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style="flex-shrink:0;margin-left:8px;"><path d="M1 1l5 5 5-5" stroke="#6B6470" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
      </button>
      <div id="msel-panel-${scopeId}" style="display:none;margin-top:8px;border:1px solid var(--line-strong);border-radius:9px;background:#fff;overflow:hidden;box-shadow:var(--shadow);">
        <input type="text" placeholder="Buscar..." oninput="filtrarMultiSelect('${scopeId}', this.value)" style="width:100%;padding:11px 12px;border:none;border-bottom:1px solid var(--line);font-family:'Inter',sans-serif;font-size:14px;outline:none;box-sizing:border-box;">
        <div id="msel-opciones-${scopeId}" style="max-height:240px;overflow-y:auto;">
          ${opciones.map(op => `
            <label class="msel-opcion" data-texto="${normalizarBusqueda(op).replace(/"/g,'&quot;')}" style="display:flex;align-items:center;gap:10px;padding:12px;border-bottom:1px solid var(--line);cursor:pointer;transition:background 0.12s;">
              <input type="checkbox" value="${op.replace(/"/g,'&quot;')}" onchange="onMultiSelectToggle('${scopeId}');this.closest('label').style.background=this.checked?'var(--magenta-soft)':'';" style="width:20px;height:20px;flex-shrink:0;">
              <span style="font-size:14px;">${op}</span>
            </label>`).join('')}
        </div>
        <button type="button" onclick="toggleMultiSelect('${scopeId}', false)" style="width:100%;padding:11px;background:var(--magenta);color:#fff;border:none;font-family:'Sora',sans-serif;font-weight:600;font-size:13px;cursor:pointer;">Listo</button>
      </div>
      <div id="msel-chips-${scopeId}" style="margin-top:10px;"></div>
    </div>`;
}
function toggleMultiSelect(scopeId, forzar){
  const panel = document.getElementById(`msel-panel-${scopeId}`);
  if(!panel) return;
  const abierto = panel.style.display !== 'none';
  panel.style.display = (typeof forzar === 'boolean' ? forzar : !abierto) ? 'block' : 'none';
}
function filtrarMultiSelect(scopeId, texto){
  const q = normalizarBusqueda(texto);
  document.querySelectorAll(`#msel-opciones-${scopeId} .msel-opcion`).forEach(op => {
    op.style.display = (op.dataset.texto || '').includes(q) ? 'flex' : 'none';
  });
}
function onMultiSelectToggle(scopeId){
  renderChipsMultiSelect(scopeId);
  const n = document.querySelectorAll(`#msel-opciones-${scopeId} input[type=checkbox]:checked`).length;
  const label = document.getElementById(`msel-label-${scopeId}`);
  label.textContent = n ? `${n} seleccionado${n>1?'s':''}` : label.dataset.placeholder;
}
function quitarSeleccionMultiSelect(scopeId, valor){
  const chk = document.querySelector(`#msel-opciones-${scopeId} input[type=checkbox][value="${CSS.escape(valor)}"]`);
  if(chk) chk.checked = false;
  onMultiSelectToggle(scopeId);
}
function renderChipsMultiSelect(scopeId){
  const marcados = [...document.querySelectorAll(`#msel-opciones-${scopeId} input[type=checkbox]:checked`)];
  const cont = document.getElementById(`msel-chips-${scopeId}`);
  // conserva las cantidades ya cargadas si el chip ya existía
  const cantidadesPrevias = {};
  cont.querySelectorAll('.msel-chip').forEach(ch => {
    const inp = ch.querySelector('input[type=number]');
    if(inp && inp.value) cantidadesPrevias[ch.dataset.valor] = inp.value;
  });
  cont.innerHTML = marcados.map(chk => {
    const val = chk.value;
    const cantidadPrevia = cantidadesPrevias[val] || '';
    return `
      <div class="msel-chip" data-valor="${val.replace(/"/g,'&quot;')}" style="display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid var(--line);border-radius:9px;margin-bottom:8px;background:#FBFAFC;">
        <span style="flex:1;font-size:14px;">${val}</span>
        <input type="number" min="1" step="1" inputmode="numeric" placeholder="Cant." value="${cantidadPrevia}" style="width:74px;padding:7px 8px;border:1px solid var(--line-strong);border-radius:8px;font-family:'Inter',sans-serif;font-size:14px;">
        <button type="button" onclick="quitarSeleccionMultiSelect('${scopeId}','${val.replace(/'/g,"\\'")}')" style="background:none;border:none;color:var(--ink-soft);cursor:pointer;font-size:22px;line-height:1;padding:10px 12px;min-width:44px;">×</button>
      </div>`;
  }).join('');
}

function onFam(id){
  const fam = document.getElementById(`fam-${id}`).value;
  const bdg = document.getElementById(`bdg-${id}`);
  const cuerpo = document.getElementById(`cuerpo-${id}`);
  if(!fam){ bdg.style.display='none'; cuerpo.innerHTML=''; return; }
  bdg.textContent = fam; bdg.style.display='inline-block';
  bdg.style.background = FAM_COLOR[fam]||'#eee'; bdg.style.color='#3a3340';

  if(fam === 'Seguridad' || fam === 'Vidrios'){
    cuerpo.innerHTML = `
      <div class="field">
        <label class="fld">Producto <span class="req">*</span></label>
        <select id="prod-${id}" onchange="onProdUnico(${id})">
          <option value="">Elegí producto...</option>
          ${(PRODUCTOS[fam]||[]).map(p=>`<option value="${p.replace(/"/g,'&quot;')}">${p}</option>`).join('')}
          <option value="OTROS">OTROS (no está en la lista)</option>
        </select>
      </div>
      <div id="detalle-${id}"></div>`;
  } else {
    const productos = PRODUCTOS[fam] || [];
    const scopeId = `prod-multi-${id}`;
    cuerpo.innerHTML = `
      <div class="field">
        <label class="fld">Productos faltantes <span class="req">*</span></label>
        <div class="hint" style="margin-bottom:8px;">Elegí uno o varios. A cada uno le vas a poner su cantidad.</div>
        ${renderMultiSelect(scopeId, productos, 'Elegí productos...')}
      </div>
      ${filaOtro(id, 'producto', 'Agregar producto que no está en la lista', maxLongitud(productos))}`;
  }
}

function onProdUnico(id){
  const prod = document.getElementById(`prod-${id}`).value;
  const fam = document.getElementById(`fam-${id}`).value;
  const detalle = document.getElementById(`detalle-${id}`);
  if(!prod){ detalle.innerHTML=''; return; }

  if(prod === 'OTROS'){
    const maxLen = maxLongitud(PRODUCTOS[fam]);
    const etiquetaTipo = fam === 'Vidrios' ? 'Ingrese tipo de vidrio/lámina' : 'Ingrese tipo de funda';
    detalle.innerHTML = `
      <div class="field">
        <label class="fld">${etiquetaTipo} <span class="req">*</span></label>
        <input type="text" id="modc-${id}" maxlength="${maxLen}" placeholder="Escribí qué producto es..." oninput="onDetalleInput(${id}, 'producto');this.classList.remove('input-error')" onblur="this.value=formatearTitleCase(this.value)">
        <div id="modc-sug-${id}" style="display:none;margin-top:8px;">
          <div id="modc-sug-titulo-${id}" style="font-size:11.5px;color:var(--ink-soft);margin-bottom:5px;">¿Alguno de estos?</div>
          <div id="modc-sug-chips-${id}" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
        </div>
      </div>
      <div class="field" style="margin-top:14px;">
        <label class="fld">Ingrese marca, si corresponde</label>
        <input type="text" id="marcaotros-${id}" maxlength="30" placeholder="Ej: Huawei, Noblex, LG, Alcatel, etc." onblur="this.value=formatearTitleCase(this.value)">
      </div>
      <div class="field" style="margin-top:14px;">
        <label class="fld">Ingrese modelo, si corresponde</label>
        <input type="text" id="modelootros-${id}" maxlength="40" placeholder="Escribí el modelo (opcional)..." onblur="this.value=formatearTitleCase(this.value)">
      </div>
      <div class="field" style="margin-top:14px;">
        <label class="fld">Cantidad estimada perdida <span class="req">*</span></label>
        <input type="number" id="qty-${id}" min="1" step="1" inputmode="numeric" placeholder="0">
      </div>`;
    return;
  }

  const mods = modelosDe(prod);
  if(mods){
    const scopeId = `mod-multi-${id}`;
    detalle.innerHTML = `
      <div class="field">
        <label class="fld">Modelos faltantes <span class="req">*</span></label>
        <div class="hint" style="margin-bottom:8px;">Elegí uno o varios. A cada uno le vas a poner su cantidad.</div>
        ${renderMultiSelect(scopeId, mods, 'Elegí modelos...')}
      </div>
      ${filaOtro(id, 'modelo', 'Agregar modelo que no está en la lista', maxLongitud(mods))}`;
  } else if(esOtrasMarcas(prod)){
    detalle.innerHTML = `
      <div class="field">
        <label class="fld">Marca <span class="req">*</span></label>
        <input type="text" id="marca-${id}" maxlength="30" placeholder="Ej: Huawei, Noblex, LG, Alcatel, etc." onblur="this.value=formatearTitleCase(this.value)">
      </div>
      <div class="field" style="margin-top:14px;">
        <label class="fld">Modelos <span class="req">*</span></label>
        <div class="hint" style="margin-bottom:8px;">Agregá uno o varios modelos de esa marca, con su cantidad.</div>
        ${filaOtro(id, 'modelo', 'Agregar modelo', 40)}
      </div>`;
  } else {
    detalle.innerHTML = `
      <div class="field">
        <label class="fld">Cantidad estimada perdida <span class="req">*</span></label>
        <input type="number" id="qty-${id}" min="1" step="1" inputmode="numeric" placeholder="0">
      </div>`;
  }
}

function toast(msg){
  const t=document.getElementById('toast');
  document.getElementById('toast-msg').textContent=msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2600);
}



/* --- Coincidencia difusa para sugerir el modelo/producto correcto al escribir en "Otros" ---
   Es heurística y local (sin IA ni servicios externos): tolera errores de tipeo y abreviaturas
   de marca ("sam", "samsunf"), comparando por distancia de edición contra la lista real.
   Como el contexto ya viene acotado (marca del producto elegido, o familia elegida),
   no hace falta que sea perfecta: alcanza con acercar 1 a 3 opciones para elegir con un clic. */
function tokenizar(str){
  return (str||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
}
function distanciaLevenshtein(a, b){
  const m=a.length, n=b.length;
  if(m===0) return n;
  if(n===0) return m;
  const dp = new Array(n+1);
  for(let j=0;j<=n;j++) dp[j]=j;
  for(let i=1;i<=m;i++){
    let prev = dp[0]; dp[0]=i;
    for(let j=1;j<=n;j++){
      const temp = dp[j];
      dp[j] = Math.min(dp[j]+1, dp[j-1]+1, prev + (a[i-1]===b[j-1]?0:1));
      prev = temp;
    }
  }
  return dp[n];
}
function ratioEdicion(a, b){
  if(!a && !b) return 1;
  const maxLen = Math.max(a.length, b.length);
  return maxLen===0 ? 1 : 1 - (distanciaLevenshtein(a,b)/maxLen);
}
const MARCAS_STOPWORDS = new Set(['SAMSUNG','GALAXY','APPLE','IPHONE','XIAOMI','MOTOROLA']);
function nucleoSinMarca(tokens){
  const filtrados = tokens.filter(t=>!MARCAS_STOPWORDS.has(t));
  return (filtrados.length ? filtrados : tokens).join('');
}
function puntajeCoincidencia(input, candidato){
  const tokA = tokenizar(input), tokB = tokenizar(candidato);
  const completo = ratioEdicion(tokA.join(''), tokB.join(''));
  const nucleo = ratioEdicion(nucleoSinMarca(tokA), nucleoSinMarca(tokB));
  return Math.max(completo, nucleo);
}
/* Puntaje usado SOLO para mostrar sugerencias (más generoso que puntajeCoincidencia):
   si lo que escribiste está contenido tal cual dentro del nombre del candidato
   (ej. "teclado" dentro de "Teclado para Tablet"), sube el puntaje aunque la
   diferencia de longitud total sea grande. No se usa para el bloqueo de typos,
   que debe seguir siendo estricto para no confundir una abreviación válida con un error. */
function puntajeSugerencia(input, candidato){
  let mejor = puntajeCoincidencia(input, candidato);
  const inputNorm = normalizarBusqueda(input).trim();
  if(inputNorm.length >= 3 && normalizarBusqueda(candidato).includes(inputNorm)){
    mejor = Math.max(mejor, 0.9);
  }
  // Nombres compuestos con "/" (ej. "Parlante Go 3/Go 4") representan variantes
  // distintas; compara también contra cada mitad, porque el usuario puede estar
  // buscando específicamente una de ellas ("go 4") y no el nombre completo.
  if(candidato.includes('/')){
    candidato.split('/').forEach(parte => {
      const p = parte.trim();
      if(p) mejor = Math.max(mejor, puntajeCoincidencia(input, p));
    });
  }
  return mejor;
}
function mejoresCoincidencias(input, candidatos, max, umbral){
  if(!input || !candidatos || !candidatos.length) return [];
  return candidatos
    .map(c => ({ c, p: puntajeSugerencia(input, c) }))
    .filter(x => x.p >= umbral)
    .sort((a,b) => b.p - a.p)
    .slice(0, max)
    .map(x => x.c);
}
function resetSugerencia(id){
  const sugBox = document.getElementById(`modc-sug-${id}`);
  const chips = document.getElementById(`modc-sug-chips-${id}`);
  if(sugBox) sugBox.style.display='none';
  if(chips) chips.innerHTML='';
}
let _detalleTimers = {};
function onDetalleInput(id, tipo){
  clearTimeout(_detalleTimers[id]);
  _detalleTimers[id] = setTimeout(()=>evaluarSugerencia(id, tipo), 300);
}
function normalizarExacta(s){
  return normalizarBusqueda(s).replace(/\s+/g, ' ').trim();
}
/* Devuelve la lista de referencia (candidatos) para comparar un texto de "otro":
   productos de la familia elegida, o modelos de la marca del producto elegido. */
function candidatosPara(tipo, fam, prod){
  if(tipo === 'producto') return PRODUCTOS[fam] || [];
  const gm = PRODUCTO_GRUPO[prod];
  return gm ? (MODELOS_POR_GRUPO[gm] || []) : [];
}
/* Si el texto escrito se parece MUCHÍSIMO a algo que ya existe (score muy alto,
   no solo "parecido"), devuelve esa coincidencia — probablemente sea un error de
   tipeo (ej. "telcado" en vez de "Teclado mecánico") y no un producto/modelo nuevo. */
function posibleTypoDe(detalle, candidatos){
  if(!detalle || !candidatos || !candidatos.length) return null;
  const valNorm = normalizarExacta(detalle);
  if(candidatos.some(c => normalizarExacta(c) === valNorm)) return null; // es exactamente ese, no es error
  let mejor = null, mejorPuntaje = 0;
  candidatos.forEach(c => {
    const p = puntajeCoincidencia(detalle, c);
    if(p > mejorPuntaje){ mejorPuntaje = p; mejor = c; }
  });
  return (mejor && mejorPuntaje >= 0.75) ? mejor : null;
}
function evaluarSugerencia(id, tipo){
  const campo = document.getElementById(`modc-${id}`);
  const sugBox = document.getElementById(`modc-sug-${id}`);
  const chips = document.getElementById(`modc-sug-chips-${id}`);
  const titulo = document.getElementById(`modc-sug-titulo-${id}`);
  if(!campo || !sugBox || !chips) return;
  const val = campo.value.trim();
  if(val.length < 2){ resetSugerencia(id); return; }

  // El id puede venir como "5" (campo único) o "5-2" (fila dinámica de "otro");
  // en ambos casos el ítem base (para leer familia/producto elegidos) es la primera parte.
  const baseId = String(id).split('-')[0];
  const fam = document.getElementById(`fam-${baseId}`)?.value;
  const prod = document.getElementById(`prod-${baseId}`)?.value;
  const candidatos = candidatosPara(tipo, fam, prod);

  // Si lo que escribieron ya existe tal cual en la lista (ignorando mayúsculas/tildes/espacios),
  // lo mostramos primero y con un título más directo, para evitar cargarlo de nuevo como "nuevo".
  const valNorm = normalizarExacta(val);
  const exacto = candidatos.find(c => normalizarExacta(c) === valNorm);

  let sugeridos = mejoresCoincidencias(val, candidatos, 3, 0.45);
  if(exacto){
    sugeridos = [exacto, ...sugeridos.filter(s => s !== exacto)].slice(0, 3);
  }

  if(sugeridos.length){
    titulo.textContent = exacto ? 'Ya está en la lista:' : '¿Alguno de estos?';
    chips.innerHTML = sugeridos.map(s =>
      `<button type="button" onclick="usarSugerencia('${id}','${s.replace(/'/g,"\\'")}')" style="font-size:12.5px;padding:5px 10px;border-radius:20px;border:1px solid var(--line-strong);background:#fff;color:var(--ink);cursor:pointer;">${s}</button>`
    ).join('');
    sugBox.style.display = 'block';
  } else {
    resetSugerencia(id);
  }
}
function usarSugerencia(id, valor){
  document.getElementById(`modc-${id}`).value = valor;
  resetSugerencia(id);
}

let _enviandoAhora = false;
async function enviar(){
  if(_enviandoAhora) return; // evita doble envío si tocan el botón dos veces rápido
  limpiarErrores();

  const fechaEl = document.getElementById('fecha');
  const tiendaEl = document.getElementById('tienda');
  const fecha = fechaEl.value;
  const tienda = tiendaEl.value;
  if(!fecha){ marcarError(fechaEl); toast('Completá la fecha.'); return; }
  if(!tienda){ marcarError(tiendaEl); toast('Elegí tu tienda.'); return; }

  // Defensa extra por si el navegador no respetó el min/max del campo fecha.
  const hoyStr = new Date().toISOString().slice(0,10);
  const ayer = new Date(); ayer.setDate(ayer.getDate()-1);
  const ayerStr = ayer.toISOString().slice(0,10);
  if(fecha > hoyStr || fecha < ayerStr){
    marcarError(fechaEl);
    toast('La fecha tiene que ser hoy o ayer.');
    return;
  }

  const items = document.querySelectorAll('.item');
  if(!items.length){ toast('Agregá al menos un faltante.'); return; }

  const registros = []; let ok = true; let algoMarcado = false; let mensajeError = null;
  const nuevosProductos = []; // { familia, producto } escritos como "otro" (producto)
  const nuevosModelos = [];   // { grupoModelo, modelo } escritos como "otro" (modelo)

  items.forEach(it=>{
    const id = it.id.replace('it-','');
    const famEl = document.getElementById(`fam-${id}`);
    const fam = famEl?.value;
    if(!fam){ ok=false; marcarError(famEl); return; }

    if(fam === 'Seguridad' || fam === 'Vidrios'){
      const prodEl = document.getElementById(`prod-${id}`);
      const prod = prodEl?.value;
      if(!prod){ ok=false; marcarError(prodEl); return; }

      if(prod === 'OTROS'){
        const detalleEl = document.getElementById(`modc-${id}`);
        const marcaEl = document.getElementById(`marcaotros-${id}`);
        const modeloEl = document.getElementById(`modelootros-${id}`);
        const qtyEl = document.getElementById(`qty-${id}`);
        const detalle = sanitizarTexto(detalleEl?.value);
        const marca = sanitizarTexto(marcaEl?.value);
        const modeloTxt = sanitizarTexto(modeloEl?.value);
        const qty = qtyEl?.value;

        if(!detalle){ ok=false; marcarError(detalleEl); return; }
        if(esTextoSinSentido(detalle)){ ok=false; marcarError(detalleEl); mensajeError = `"${detalle}" no parece un producto válido. Revisalo.`; return; }
        if(marca && esTextoSinSentido(marca)){ ok=false; marcarError(marcaEl); mensajeError = `"${marca}" no parece una marca válida. Revisala.`; return; }
        if(modeloTxt && esTextoSinSentido(modeloTxt)){ ok=false; marcarError(modeloEl); mensajeError = `"${modeloTxt}" no parece un modelo válido. Revisalo.`; return; }
        if(!cantidadValida(qty)){ ok=false; marcarError(qtyEl); mensajeError = 'La cantidad tiene que ser un número entero de 1 o más.'; return; }

        const grupo = marca ? grupoDesdeMarca(marca) : '';
        const productoFinal = marca ? `${detalle} ${marca}` : detalle;

        registros.push({ fecha, tienda, familia: fam, producto: productoFinal, modelo: modeloTxt, cantidad: parseInt(qty,10) });
        nuevosProductos.push({ familia: fam, producto: productoFinal, grupoModelo: grupo });
        if(!PRODUCTOS[fam]) PRODUCTOS[fam] = [];
        if(!PRODUCTOS[fam].includes(productoFinal)){ PRODUCTOS[fam].push(productoFinal); PRODUCTOS[fam].sort(collator.compare); }
        if(marca) PRODUCTO_GRUPO[productoFinal] = grupo;
        if(marca && modeloTxt){
          nuevosModelos.push({ grupoModelo: grupo, modelo: modeloTxt });
          if(!MODELOS_POR_GRUPO[grupo]) MODELOS_POR_GRUPO[grupo] = [];
          if(!MODELOS_POR_GRUPO[grupo].includes(modeloTxt)){ MODELOS_POR_GRUPO[grupo].push(modeloTxt); MODELOS_POR_GRUPO[grupo].sort((a,b) => collator.compare(b,a)); }
        }
        algoMarcado = true;
        return;
      }

      const mods = modelosDe(prod);
      if(mods){
        const chips = [...document.querySelectorAll(`#msel-chips-mod-multi-${id} .msel-chip`)];
        chips.forEach(chip => {
          const qtyEl = chip.querySelector('input[type=number]');
          const qty = qtyEl?.value;
          if(!cantidadValida(qty)){ ok=false; marcarError(qtyEl); mensajeError = 'La cantidad tiene que ser un número entero de 1 o más.'; return; }
          registros.push({ fecha, tienda, familia: fam, producto: prod, modelo: chip.dataset.valor, cantidad: parseInt(qty,10) });
          algoMarcado = true;
        });
        const filasOtroModelo = [...document.querySelectorAll(`#otros-lista-${id} .otro-row`)];
        filasOtroModelo.forEach(row => {
          const detalleEl = row.querySelector('input[type=text]');
          const qtyEl = row.querySelector('input[type=number]');
          const detalle = sanitizarTexto(detalleEl?.value);
          const qty = qtyEl?.value;
          if(!detalle && !qty) return; // fila vacía sin tocar, se ignora
          if(!detalle){ ok=false; marcarError(detalleEl); return; }
          if(!cantidadValida(qty)){ ok=false; marcarError(qtyEl); mensajeError = 'La cantidad tiene que ser un número entero de 1 o más.'; return; }
          if(esTextoSinSentido(detalle)){ ok=false; marcarError(detalleEl); mensajeError = `"${detalle}" no parece un modelo válido. Revisalo.`; return; }
          const posibleTypo = posibleTypoDe(detalle, MODELOS_POR_GRUPO[PRODUCTO_GRUPO[prod]] || []);
          if(posibleTypo){ ok=false; marcarError(detalleEl); mensajeError = `"${detalle}" se parece mucho a "${posibleTypo}" — ¿fue un error de tipeo? Elegilo de las sugerencias, o corregí el texto si es realmente distinto.`; return; }
          registros.push({ fecha, tienda, familia: fam, producto: prod, modelo: detalle, cantidad: parseInt(qty,10) });
          const gm = PRODUCTO_GRUPO[prod];
          if(gm){
            nuevosModelos.push({ grupoModelo: gm, modelo: detalle });
            if(!MODELOS_POR_GRUPO[gm]) MODELOS_POR_GRUPO[gm] = [];
            if(!MODELOS_POR_GRUPO[gm].includes(detalle)){ MODELOS_POR_GRUPO[gm].push(detalle); MODELOS_POR_GRUPO[gm].sort((a,b) => collator.compare(b,a)); }
          }
          algoMarcado = true;
        });
        if(!chips.length && !filasOtroModelo.length){ ok=false; mensajeError = 'Elegí al menos un modelo, o agregá uno con "+ Agregar modelo".'; return; }
      } else if(esOtrasMarcas(prod)){
        const marcaEl = document.getElementById(`marca-${id}`);
        const marca = sanitizarTexto(marcaEl?.value);
        const filasModeloMarca = [...document.querySelectorAll(`#otros-lista-${id} .otro-row`)];
        if(!marca){ ok=false; marcarError(marcaEl); return; }
        if(esTextoSinSentido(marca)){ ok=false; marcarError(marcaEl); mensajeError = `"${marca}" no parece una marca válida. Revisala.`; return; }
        if(!filasModeloMarca.length){ ok=false; mensajeError = 'Agregá al menos un modelo de esa marca con "+ Agregar modelo".'; return; }

        const productoFinal = prod.replace(/otras marcas/i, marca);
        const grupo = grupoDesdeMarca(marca);
        let huboModelo = false;

        filasModeloMarca.forEach(row => {
          const modeloEl = row.querySelector('input[type=text]');
          const qtyEl = row.querySelector('input[type=number]');
          const modeloTexto = sanitizarTexto(modeloEl?.value);
          const qty = qtyEl?.value;
          if(!modeloTexto && !qty) return; // fila vacía sin tocar, se ignora
          if(!modeloTexto){ ok=false; marcarError(modeloEl); return; }
          if(!cantidadValida(qty)){ ok=false; marcarError(qtyEl); mensajeError = 'La cantidad tiene que ser un número entero de 1 o más.'; return; }
          if(esTextoSinSentido(modeloTexto)){ ok=false; marcarError(modeloEl); mensajeError = `"${modeloTexto}" no parece un modelo válido. Revisalo.`; return; }
          registros.push({ fecha, tienda, familia: fam, producto: productoFinal, modelo: modeloTexto, cantidad: parseInt(qty,10) });
          nuevosModelos.push({ grupoModelo: grupo, modelo: modeloTexto });
          if(!MODELOS_POR_GRUPO[grupo]) MODELOS_POR_GRUPO[grupo] = [];
          if(!MODELOS_POR_GRUPO[grupo].includes(modeloTexto)){ MODELOS_POR_GRUPO[grupo].push(modeloTexto); MODELOS_POR_GRUPO[grupo].sort((a,b) => collator.compare(b,a)); }
          algoMarcado = true;
          huboModelo = true;
        });

        if(huboModelo){
          nuevosProductos.push({ familia: fam, producto: productoFinal, grupoModelo: grupo });
          if(!PRODUCTOS[fam]) PRODUCTOS[fam] = [];
          if(!PRODUCTOS[fam].includes(productoFinal)){ PRODUCTOS[fam].push(productoFinal); PRODUCTOS[fam].sort(collator.compare); }
          PRODUCTO_GRUPO[productoFinal] = grupo;
        }
      } else {
        const qtyEl = document.getElementById(`qty-${id}`);
        const qty = qtyEl?.value;
        if(!cantidadValida(qty)){ ok=false; marcarError(qtyEl); mensajeError = 'La cantidad tiene que ser un número entero de 1 o más.'; return; }
        registros.push({ fecha, tienda, familia: fam, producto: prod, modelo: '', cantidad: parseInt(qty,10) });
        algoMarcado = true;
      }
    } else {
      const chips = [...document.querySelectorAll(`#msel-chips-prod-multi-${id} .msel-chip`)];
      chips.forEach(chip => {
        const qtyEl = chip.querySelector('input[type=number]');
        const qty = qtyEl?.value;
        if(!cantidadValida(qty)){ ok=false; marcarError(qtyEl); mensajeError = 'La cantidad tiene que ser un número entero de 1 o más.'; return; }
        registros.push({ fecha, tienda, familia: fam, producto: chip.dataset.valor, modelo: '', cantidad: parseInt(qty,10) });
        algoMarcado = true;
      });
      const filasOtroProducto = [...document.querySelectorAll(`#otros-lista-${id} .otro-row`)];
      filasOtroProducto.forEach(row => {
        const detalleEl = row.querySelector('input[type=text]');
        const qtyEl = row.querySelector('input[type=number]');
        const detalle = sanitizarTexto(detalleEl?.value);
        const qty = qtyEl?.value;
        if(!detalle && !qty) return; // fila vacía sin tocar, se ignora
        if(!detalle){ ok=false; marcarError(detalleEl); return; }
        if(!cantidadValida(qty)){ ok=false; marcarError(qtyEl); mensajeError = 'La cantidad tiene que ser un número entero de 1 o más.'; return; }
        if(esTextoSinSentido(detalle)){ ok=false; marcarError(detalleEl); mensajeError = `"${detalle}" no parece un producto válido. Revisalo.`; return; }
        const posibleTypo = posibleTypoDe(detalle, PRODUCTOS[fam] || []);
        if(posibleTypo){ ok=false; marcarError(detalleEl); mensajeError = `"${detalle}" se parece mucho a "${posibleTypo}" — ¿fue un error de tipeo? Elegilo de las sugerencias, o corregí el texto si es realmente distinto.`; return; }
        registros.push({ fecha, tienda, familia: fam, producto: detalle, modelo: '', cantidad: parseInt(qty,10) });
        nuevosProductos.push({ familia: fam, producto: detalle });
        if(!PRODUCTOS[fam]) PRODUCTOS[fam] = [];
        if(!PRODUCTOS[fam].includes(detalle)){ PRODUCTOS[fam].push(detalle); PRODUCTOS[fam].sort(collator.compare); }
        algoMarcado = true;
      });
      if(!chips.length && !filasOtroProducto.length){ ok=false; mensajeError = 'Elegí al menos un producto, o agregá uno con "+ Agregar".'; return; }
    }
  });
  if(!ok){ toast(mensajeError || 'Revisá los faltantes: falta completar una cantidad, o el detalle si escribiste "otro".'); return; }
  if(!algoMarcado || !registros.length){ toast('Marcá al menos un producto o modelo faltante.'); return; }

  // Aviso (no bloquea) si alguna cantidad parece demasiado alta para un solo faltante.
  const cantidadAlta = registros.find(r => r.cantidad > 50);
  if(cantidadAlta){
    const seguir = confirm(`"${cantidadAlta.producto}${cantidadAlta.modelo?' ('+cantidadAlta.modelo+')':''}" tiene una cantidad de ${cantidadAlta.cantidad}. ¿Confirmás que es correcta?`);
    if(!seguir) return;
  }

  // Aviso (no bloquea) si el mismo producto/modelo aparece repetido dentro de este mismo envío.
  const repetidosEnEnvio = buscarDuplicadosEnEnvio(registros);
  if(repetidosEnEnvio.length){
    const seguir = confirm(`Estás por cargar esto más de una vez en el mismo reporte:\n${repetidosEnEnvio.join('\n')}\n¿Confirmás que está bien así?`);
    if(!seguir) return;
  }

  // Aviso (no bloquea) si ya cargaste lo mismo antes en esta sesión (misma fecha/tienda/producto/modelo).
  const repetidosDeSesion = buscarDuplicadosDeSesion(registros);
  if(repetidosDeSesion.length){
    const seguir = confirm(`Ya cargaste esto antes hoy, en esta misma tienda:\n${repetidosDeSesion.join('\n')}\n¿Confirmás que hay que cargarlo de nuevo?`);
    if(!seguir) return;
  }

  // Deduplicar por si dos faltantes de la misma carga escriben el mismo producto/modelo nuevo
  const dedupe = (arr, keyFn) => {
    const vistos = new Set();
    return arr.filter(x => { const k = keyFn(x); if(vistos.has(k)) return false; vistos.add(k); return true; });
  };
  const nuevosProductosDedup = dedupe(nuevosProductos, x => x.familia + '|' + x.producto.toUpperCase());
  const nuevosModelosDedup = dedupe(nuevosModelos, x => x.grupoModelo + '|' + x.modelo.toUpperCase());

  // Confirmación explícita antes de crear producto/marca/modelo nuevo (no hay lista contra la
  // cual comparar en estos casos, así que conviene un paso extra antes de guardarlo para siempre).
  if(nuevosProductosDedup.length || nuevosModelosDedup.length){
    const resumen = [
      ...nuevosProductosDedup.map(p => `Producto nuevo: "${p.producto}"`),
      ...nuevosModelosDedup.map(m => `Modelo nuevo: "${m.modelo}"`)
    ].join('\n');
    const seguir = confirm(`Vas a agregar esto como nuevo en la lista, para todas las tiendas:\n${resumen}\n¿Confirmás?`);
    if(!seguir) return;
  }

  _enviandoAhora = true;
  const btn = document.getElementById('submit');
  btn.disabled = true; btn.textContent = 'Guardando...';

  try {
    await Backend.saveRecords(registros, nuevosProductosDedup, nuevosModelosDedup);
    recordarTienda(tienda);
    registrarEnvioEnSesion(registros);
    mostrarDone(tienda, fecha, registros);
  } catch(err){
    console.error(err);
    btn.disabled=false; btn.textContent='Enviar reporte';
    toast('No se pudo guardar. Reintentá en un momento.');
  } finally {
    _enviandoAhora = false;
  }
}

function mostrarDone(tienda, fecha, registros){
  document.getElementById('app').style.display='none';
  document.getElementById('done').style.display='block';
  const fechaFmt = fecha.split('-').reverse().join('/');
  document.getElementById('done-desc').textContent =
    `${tienda} · ${fechaFmt} · ${registros.length} producto${registros.length!==1?'s':''} registrado${registros.length!==1?'s':''}`;
  document.getElementById('recap').innerHTML = `
    <table>
      <thead><tr><th>Familia</th><th>Producto</th><th>Modelo</th><th style="text-align:right;">Cant.</th></tr></thead>
      <tbody>${registros.map(r=>`<tr>
        <td><span style="font-size:11px;padding:3px 8px;border-radius:12px;background:${FAM_COLOR[r.familia]};color:#3a3340;">${r.familia}</span></td>
        <td>${r.producto}</td>
        <td style="color:var(--ink-soft);">${r.modelo||'—'}</td>
        <td class="num">${r.cantidad}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  window.scrollTo({top:0, behavior:'smooth'});
}

function nuevo(){
  document.getElementById('done').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('items').innerHTML='';
  document.getElementById('submit').disabled=false;
  document.getElementById('submit').textContent='Enviar reporte';
  n=0; addItem();
  window.scrollTo({top:0, behavior:'smooth'});
}
// poblar tiendas (se llama recién cuando ya llegaron las listas del servidor)
function poblarSelectTiendas() {
  const selT = document.getElementById('tienda');
  selT.innerHTML = '<option value="">Elegí tu tienda...</option>';
  TIENDAS.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; selT.appendChild(o); });
  const ultima = ultimaTiendaGuardada();
  if(ultima && TIENDAS.includes(ultima)) selT.value = ultima;
  selT.addEventListener('change', () => { if(selT.value) recordarTienda(selT.value); });
}

async function iniciarCarga() {
  try {
    const data = await cargarListas();
    poblarDesde(data);
    poblarSelectTiendas();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    addItem();
    actualizarEstadoBoton();
  } catch (err) {
    console.error(err);
    document.getElementById('loading').style.display = 'none';
    document.getElementById('load-error').style.display = 'block';
  }
}

// Fecha: hoy por defecto, y limitada entre ayer y hoy (para no cargar fechas futuras o muy viejas por error).
var _hoy = new Date();
var _fechaHoyStr = _hoy.getFullYear() + '-' + String(_hoy.getMonth()+1).padStart(2,'0') + '-' + String(_hoy.getDate()).padStart(2,'0');
var _ayer = new Date(); _ayer.setDate(_hoy.getDate()-1);
var _fechaAyerStr = _ayer.getFullYear() + '-' + String(_ayer.getMonth()+1).padStart(2,'0') + '-' + String(_ayer.getDate()).padStart(2,'0');
document.getElementById('fecha').value = _fechaHoyStr;
document.getElementById('fecha').setAttribute('min', _fechaAyerStr);
document.getElementById('fecha').setAttribute('max', _fechaHoyStr);

// Actualiza en vivo si el botón "Enviar reporte" puede habilitarse, ante cualquier
// cambio dentro del formulario (delegado a nivel documento, cubre todos los campos
// dinámicos sin necesidad de enganchar el listener uno por uno).
document.addEventListener('input', function(e){
  actualizarEstadoBoton();
  if(e.target && e.target.classList) e.target.classList.remove('input-error');
});
document.addEventListener('change', actualizarEstadoBoton);

// Enter en un campo de texto no debe disparar ningún envío accidental.
document.addEventListener('keydown', function(e){
  if(e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'submit'){
    e.preventDefault();
  }
});

// Avisa antes de cerrar/recargar la pestaña si hay datos cargados sin enviar.
window.addEventListener('beforeunload', function(e){
  if(hayDatosSinEnviar()){
    e.preventDefault();
    e.returnValue = '';
  }
});

iniciarCarga();

