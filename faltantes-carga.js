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

/* Trae tiendas/productos/modelos desde el Apps Script (JSONP, evita problemas de CORS). */
function cargarListas() {
  return new Promise((resolve, reject) => {
    if (!API_URL) { reject(new Error('Sin API_URL configurada')); return; }
    const cb = 'cbListas_' + Date.now() + '_' + Math.floor(Math.random() * 1e4);
    const s = document.createElement('script');
    const limpiar = () => { try { delete window[cb]; } catch (e) {} if (s.parentNode) s.parentNode.removeChild(s); };
    window[cb] = (data) => { limpiar(); resolve(data); };
    s.onerror = () => { limpiar(); reject(new Error('No se pudo leer las listas del servidor')); };
    s.src = API_URL + '?action=listas&callback=' + cb + '&t=' + Date.now();
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
  Object.keys(MODELOS_POR_GRUPO).forEach(gm => MODELOS_POR_GRUPO[gm].sort(collator.compare));
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
    <div class="field">
      <label class="fld">Producto <span class="req">*</span></label>
      <select id="prod-${id}" disabled onchange="onProd(${id})"><option value="">Elegí familia primero...</option></select>
    </div>
    <div class="field" id="modf-${id}" style="display:none;">
      <label class="fld">Modelo</label>
      <select id="mod-${id}" onchange="onModeloChange(${id})"><option value="">Elegí modelo...</option></select>
    </div>
    <div class="field" id="modcf-${id}" style="display:none;">
      <label class="fld" id="modc-label-${id}">Otros</label>
      <input type="text" id="modc-${id}" placeholder="Escribí el modelo..." oninput="onDetalleInput(${id})">
      <div class="hint" id="modc-hint-${id}">Aclaración o modelo específico, si corresponde.</div>
      <div id="modc-sug-${id}" style="display:none;margin-top:8px;">
        <div style="font-size:11.5px;color:var(--ink-soft);margin-bottom:5px;">¿Alguno de estos?</div>
        <div id="modc-sug-chips-${id}" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
      </div>
    </div>
    <div class="field">
      <label class="fld">Cantidad estimada perdida <span class="req">*</span></label>
      <input type="number" id="qty-${id}" min="1" placeholder="0">
    </div>`;
  document.getElementById('items').appendChild(div);
  document.getElementById(`fam-${id}`).focus();
}
function rmItem(id){ const e=document.getElementById(`it-${id}`); if(e) e.remove(); }

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
function mejoresCoincidencias(input, candidatos, max, umbral){
  if(!input || !candidatos || !candidatos.length) return [];
  return candidatos
    .map(c => ({ c, p: puntajeCoincidencia(input, c) }))
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
function onDetalleInput(id){
  clearTimeout(_detalleTimers[id]);
  _detalleTimers[id] = setTimeout(()=>evaluarSugerencia(id), 300);
}
function evaluarSugerencia(id){
  const campo = document.getElementById(`modc-${id}`);
  const sugBox = document.getElementById(`modc-sug-${id}`);
  const chips = document.getElementById(`modc-sug-chips-${id}`);
  if(!campo || !sugBox || !chips) return;
  const val = campo.value.trim();
  if(val.length < 2){ resetSugerencia(id); return; }

  const prod = document.getElementById(`prod-${id}`)?.value;
  const fam = document.getElementById(`fam-${id}`)?.value;
  let candidatos = [];
  if(prod === 'OTROS'){
    candidatos = PRODUCTOS[fam] || [];
  } else {
    const gm = PRODUCTO_GRUPO[prod];
    candidatos = gm ? (MODELOS_POR_GRUPO[gm]||[]) : [];
  }

  const sugeridos = mejoresCoincidencias(val, candidatos, 3, 0.45);
  if(sugeridos.length){
    chips.innerHTML = sugeridos.map(s =>
      `<button type="button" onclick="usarSugerencia(${id},'${s.replace(/'/g,"\\'")}')" style="font-size:12.5px;padding:5px 10px;border-radius:20px;border:1px solid var(--line-strong);background:#fff;color:var(--ink);cursor:pointer;">${s}</button>`
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

function onFam(id){
  const fam = document.getElementById(`fam-${id}`).value;
  const ps = document.getElementById(`prod-${id}`);
  const bdg = document.getElementById(`bdg-${id}`);
  const mcf = document.getElementById(`modcf-${id}`);
  document.getElementById(`modf-${id}`).style.display='none';
  if(!fam){ ps.innerHTML='<option value="">Elegí familia primero...</option>'; ps.disabled=true; bdg.style.display='none'; mcf.style.display='none'; return; }
  bdg.textContent = fam; bdg.style.display='inline-block';
  bdg.style.background = FAM_COLOR[fam]||'#eee'; bdg.style.color='#3a3340';
  ps.disabled=false;
  ps.innerHTML = '<option value="">Elegí producto...</option>'
    + PRODUCTOS[fam].map(p=>`<option value="${p.replace(/"/g,'&quot;')}">${p}</option>`).join('')
    + '<option value="OTROS">OTROS (no está en la lista)</option>';
  mcf.style.display='none';
  document.getElementById(`modc-${id}`).value = ''; resetSugerencia(id);
}
function onProd(id){
  const prod = document.getElementById(`prod-${id}`).value;
  const fam = document.getElementById(`fam-${id}`).value;
  const mf = document.getElementById(`modf-${id}`), mcf = document.getElementById(`modcf-${id}`), ms = document.getElementById(`mod-${id}`);
  const lbl = document.getElementById(`modc-label-${id}`), hint = document.getElementById(`modc-hint-${id}`);

  if(prod === 'OTROS'){
    // Producto no está en la lista: se oculta el modelo y se pide el detalle del producto.
    mf.style.display='none';
    ms.value='';
    mcf.style.display='block';
    lbl.textContent = 'Ingrese otro producto';
    hint.textContent = 'Escribí qué producto es.';
    document.getElementById(`modc-${id}`).focus();
    return;
  }

  const mods = modelosDe(prod);
  if(mods){
    mf.style.display='block';
    ms.innerHTML = '<option value="">Elegí modelo...</option>'
      + mods.map(m=>`<option value="${m}">${m}</option>`).join('')
      + '<option value="OTROS">OTROS (no está en la lista)</option>';
    mcf.style.display='none';
    document.getElementById(`modc-${id}`).value = ''; resetSugerencia(id);
  } else {
    mf.style.display='none';
    mcf.style.display='none';
    document.getElementById(`modc-${id}`).value = ''; resetSugerencia(id);
  }
}
function onModeloChange(id){
  const ms = document.getElementById(`mod-${id}`);
  const mcf = document.getElementById(`modcf-${id}`);
  const lbl = document.getElementById(`modc-label-${id}`), hint = document.getElementById(`modc-hint-${id}`);
  if(!ms) return;
  if(ms.value === 'OTROS'){
    mcf.style.display='block';
    lbl.textContent = 'Ingrese otro modelo';
    hint.textContent = 'Escribí el modelo exacto.';
    document.getElementById(`modc-${id}`).focus();
  } else {
    mcf.style.display='none';
    document.getElementById(`modc-${id}`).value = ''; resetSugerencia(id);
  }
}

function toast(msg){
  const t=document.getElementById('toast');
  document.getElementById('toast-msg').textContent=msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2600);
}

async function enviar(){
  const fecha = document.getElementById('fecha').value;
  const tienda = document.getElementById('tienda').value;
  if(!fecha){ toast('Completá la fecha.'); return; }
  if(!tienda){ toast('Elegí tu tienda.'); return; }

  const items = document.querySelectorAll('.item');
  if(!items.length){ toast('Agregá al menos un faltante.'); return; }

  const registros = []; let ok = true;
  const nuevosProductos = []; // { familia, producto } escritos en "OTROS" (producto)
  const nuevosModelos = [];   // { grupoModelo, modelo } escritos en "OTROS" (modelo)
  items.forEach(it=>{
    const id = it.id.replace('it-','');
    const fam = document.getElementById(`fam-${id}`)?.value;
    const prodSel = document.getElementById(`prod-${id}`)?.value;
    const qty = document.getElementById(`qty-${id}`)?.value;
    const modSel = document.getElementById(`mod-${id}`)?.value || '';
    const detalle = (document.getElementById(`modc-${id}`)?.value || '').trim();

    if(!fam || !prodSel || !qty){ ok=false; return; }

    let producto = prodSel;
    let modelo = '';

    if(prodSel === 'OTROS'){
      if(!detalle){ ok=false; return; }
      producto = detalle;
      nuevosProductos.push({ familia: fam, producto: detalle });
      if(!PRODUCTOS[fam]) PRODUCTOS[fam] = [];
      if(!PRODUCTOS[fam].includes(detalle)) PRODUCTOS[fam].push(detalle);
    } else if(modSel === 'OTROS'){
      if(!detalle){ ok=false; return; }
      modelo = detalle;
      const gm = PRODUCTO_GRUPO[prodSel];
      if(gm){
        nuevosModelos.push({ grupoModelo: gm, modelo: detalle });
        if(!MODELOS_POR_GRUPO[gm]) MODELOS_POR_GRUPO[gm] = [];
        if(!MODELOS_POR_GRUPO[gm].includes(detalle)) MODELOS_POR_GRUPO[gm].push(detalle);
      }
    } else {
      modelo = modSel || detalle;
    }

    registros.push({ fecha, tienda, familia: fam, producto, modelo, cantidad: parseInt(qty) });
  });
  if(!ok){ toast('Completá familia, producto y cantidad en cada faltante (y el detalle si elegiste "OTROS").'); return; }

  // Deduplicar por si dos faltantes de la misma carga escriben el mismo producto/modelo nuevo
  const dedupe = (arr, keyFn) => {
    const vistos = new Set();
    return arr.filter(x => { const k = keyFn(x); if(vistos.has(k)) return false; vistos.add(k); return true; });
  };
  const nuevosProductosDedup = dedupe(nuevosProductos, x => x.familia + '|' + x.producto.toUpperCase());
  const nuevosModelosDedup = dedupe(nuevosModelos, x => x.grupoModelo + '|' + x.modelo.toUpperCase());

  const btn = document.getElementById('submit');
  btn.disabled = true; btn.textContent = 'Guardando...';

  try {
    await Backend.saveRecords(registros, nuevosProductosDedup, nuevosModelosDedup);
    mostrarDone(tienda, fecha, registros);
  } catch(err){
    console.error(err);
    btn.disabled=false; btn.textContent='Enviar reporte';
    toast('No se pudo guardar. Reintentá en un momento.');
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
}

async function iniciarCarga() {
  try {
    const data = await cargarListas();
    poblarDesde(data);
    poblarSelectTiendas();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    addItem();
  } catch (err) {
    console.error(err);
    document.getElementById('loading').style.display = 'none';
    document.getElementById('load-error').style.display = 'block';
  }
}
var _hoy = new Date();
document.getElementById('fecha').value = _hoy.getFullYear() + '-' + String(_hoy.getMonth()+1).padStart(2,'0') + '-' + String(_hoy.getDate()).padStart(2,'0');
iniciarCarga();

