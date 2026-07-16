/* LOGICA DE RESUMEN */
let DATA = [];
let sortBy = 'cantidad', sortDir = 'desc';
let activeTab = 'detalle';
let filtros = { tienda:'', familia:'', desde:'', hasta:'' };

async function cargar(){
  try { DATA = await Backend.loadRecords(); }
  catch(err){ console.error(err); DATA = []; }
  render();
}

function refresh(){ document.getElementById('content').innerHTML='<div class="loading">Actualizando...</div>'; cargar(); }

function aplicarFiltros(rows){
  return rows.filter(r=>{
    if(filtros.tienda && r.tienda!==filtros.tienda) return false;
    if(filtros.familia && r.familia!==filtros.familia) return false;
    if(filtros.desde && r.fecha < filtros.desde) return false;
    if(filtros.hasta && r.fecha > filtros.hasta) return false;
    return true;
  });
}

function render(){
  const c = document.getElementById('content');
  if(!DATA.length){
    c.innerHTML = `<div class="panel" style="border-radius:var(--r);border-top:1px solid var(--line);">
      <div class="empty"><div class="ic">📭</div><h3>Todavía no hay faltantes cargados</h3>
      <p>Cuando las tiendas completen sus reportes en <a href="01_carga_tiendas.html">la página de carga</a>, vas a verlos acá.</p></div></div>`;
    return;
  }

  const rows = aplicarFiltros(DATA);
  const totalUnidades = rows.reduce((s,r)=>s+(r.cantidad||0),0);
  const tiendasActivas = new Set(rows.map(r=>r.tienda)).size;
  const productosDistintos = new Set(rows.map(r=>r.producto)).size;

  const tiendas = [...new Set(DATA.map(r=>r.tienda))].sort();
  const familias = [...new Set(DATA.map(r=>r.familia))].sort();

  c.innerHTML = `
    <div class="kpis">
      <div class="kpi accent"><div class="v">${totalUnidades.toLocaleString('es-AR')}</div><div class="l">Unidades perdidas (estimado)</div></div>
      <div class="kpi"><div class="v">${rows.length.toLocaleString('es-AR')}</div><div class="l">Registros de faltante</div></div>
      <div class="kpi"><div class="v">${tiendasActivas}</div><div class="l">Tiendas con reportes</div></div>
      <div class="kpi"><div class="v">${productosDistintos}</div><div class="l">Productos distintos</div></div>
    </div>

    <div class="filters">
      <div class="filter"><label>Tienda</label><select id="f-tienda" onchange="setF('tienda',this.value)">
        <option value="">Todas</option>${tiendas.map(t=>`<option value="${t}" ${filtros.tienda===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="filter"><label>Familia</label><select id="f-fam" onchange="setF('familia',this.value)">
        <option value="">Todas</option>${familias.map(f=>`<option value="${f}" ${filtros.familia===f?'selected':''}>${f}</option>`).join('')}</select></div>
      <div class="filter"><label>Desde</label><input type="date" id="f-desde" value="${filtros.desde}" onchange="setF('desde',this.value)"></div>
      <div class="filter"><label>Hasta</label><input type="date" id="f-hasta" value="${filtros.hasta}" onchange="setF('hasta',this.value)"></div>
      ${(filtros.tienda||filtros.familia||filtros.desde||filtros.hasta)?'<button class="clear-f" onclick="clearF()">Limpiar filtros</button>':''}
    </div>

    <div class="tabs">
      <button class="tab ${activeTab==='detalle'?'active':''}" onclick="setTab('detalle')">Detalle</button>
      <button class="tab ${activeTab==='producto'?'active':''}" onclick="setTab('producto')">Por producto</button>
      <button class="tab ${activeTab==='tienda'?'active':''}" onclick="setTab('tienda')">Por tienda</button>
    </div>
    <div class="panel" id="panel"></div>`;

  renderPanel(rows);
}

function renderPanel(rows){
  const panel = document.getElementById('panel');
  if(activeTab==='detalle') panel.innerHTML = tablaDetalle(rows);
  else if(activeTab==='producto') panel.innerHTML = tablaAgrupada(rows, 'producto', 'Producto');
  else panel.innerHTML = tablaAgrupada(rows, 'tienda', 'Tienda');
}

function th(label, key, extra=''){
  const arrow = sortBy===key ? (sortDir==='desc'?'▼':'▲') : '';
  return `<th onclick="sortCol('${key}')" ${extra}>${label}<span class="arrow">${arrow}</span></th>`;
}

function tablaDetalle(rows){
  const sorted = [...rows].sort((a,b)=>cmp(a,b));
  if(!sorted.length) return `<div class="empty"><div class="ic">🔍</div><h3>Sin resultados</h3><p>Probá ajustando los filtros.</p></div>`;
  return `<div class="scroll"><table>
    <thead><tr>${th('Fecha','fecha')}${th('Tienda','tienda')}${th('Familia','familia')}${th('Producto','producto')}${th('Modelo','modelo')}${th('Cant.','cantidad','style="text-align:right;"')}</tr></thead>
    <tbody>${sorted.map(r=>`<tr>
      <td class="muted">${(r.fecha||'').split('-').reverse().join('/')}</td>
      <td>${r.tienda||''}</td>
      <td><span class="fam-tag" style="background:${FAM_COLOR[r.familia]||'#eee'};color:#3a3340;">${r.familia||''}</span></td>
      <td>${r.producto||''}</td>
      <td class="muted">${r.modelo||'—'}</td>
      <td class="num">${r.cantidad||0}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function tablaAgrupada(rows, key, label){
  const map = {};
  rows.forEach(r=>{ const k = r[key]||'(sin dato)'; if(!map[k]) map[k]={cant:0,fam:r.familia,n:0}; map[k].cant+=(r.cantidad||0); map[k].n++; });
  let arr = Object.entries(map).map(([k,v])=>({k, ...v}));
  arr.sort((a,b)=> sortDir==='desc'? b.cant-a.cant : a.cant-b.cant);
  if(!arr.length) return `<div class="empty"><div class="ic">🔍</div><h3>Sin resultados</h3><p>Probá ajustando los filtros.</p></div>`;
  const max = Math.max(...arr.map(a=>a.cant),1);
  return `<div class="scroll"><table>
    <thead><tr><th>${label}</th>${key==='producto'?'<th>Familia</th>':''}<th>Distribución</th><th onclick="toggleDir()" style="text-align:right;cursor:pointer;">Unidades <span class="arrow">${sortDir==='desc'?'▼':'▲'}</span></th><th style="text-align:right;">Registros</th></tr></thead>
    <tbody>${arr.map(a=>`<tr>
      <td>${a.k}</td>
      ${key==='producto'?`<td><span class="fam-tag" style="background:${FAM_COLOR[a.fam]||'#eee'};color:#3a3340;">${a.fam||''}</span></td>`:''}
      <td><div class="bar-row"><div class="bar-track"><div class="bar-fill" style="width:${(a.cant/max*100).toFixed(1)}%"></div></div></div></td>
      <td class="num" style="color:var(--magenta);">${a.cant}</td>
      <td class="num muted">${a.n}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function cmp(a,b){
  let va=a[sortBy], vb=b[sortBy];
  if(sortBy==='cantidad'){ va=va||0; vb=vb||0; return sortDir==='desc'? vb-va : va-vb; }
  va=(va||'').toString().toLowerCase(); vb=(vb||'').toString().toLowerCase();
  return sortDir==='desc'? vb.localeCompare(va) : va.localeCompare(vb);
}
function sortCol(key){ if(sortBy===key) sortDir = sortDir==='desc'?'asc':'desc'; else { sortBy=key; sortDir = key==='cantidad'?'desc':'asc'; } render(); }
function toggleDir(){ sortDir = sortDir==='desc'?'asc':'desc'; render(); }
function setF(k,v){ filtros[k]=v; render(); }
function clearF(){ filtros={tienda:'',familia:'',desde:'',hasta:''}; render(); }
function setTab(t){ activeTab=t; render(); }

function exportCSV(){
  const rows = aplicarFiltros(DATA);
  if(!rows.length){ alert('No hay datos para exportar.'); return; }
  const head = ['Fecha','Tienda','Familia','Producto','Modelo','Cantidad estimada perdida'];
  const lines = [head.join(',')];
  rows.forEach(r=>{
    const cells = [r.fecha, r.tienda, r.familia, r.producto, r.modelo||'', r.cantidad||0]
      .map(x=>{ const s=(x==null?'':String(x)); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; });
    lines.push(cells.join(','));
  });
  const blob = new Blob(['\ufeff'+lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `faltantes_tune_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
