// Configuración compartida: URL del backend, cliente de guardado/lectura, y colores por familia.
// Lo usan tanto la página de carga como el panel de resumen.
const FAM_COLOR = {
  "Audio":"#DBEAFE","Energía":"#DCFCE7","Vidrios":"#FEF3C7","Varios":"#FCE7F3",
  "Periféricos":"#EDE9FE","Smartwatch":"#FFEDD5","Seguridad":"#E0F2FE"
};

// ===========================================================================
//  CONFIGURACIÓN DEL SERVIDOR
//  Pegá entre las comillas la URL de tu Apps Script (la que termina en /exec).
//  Mientras esté vacía, la página guarda los datos solo en este navegador.
// ===========================================================================
const API_URL = "https://script.google.com/macros/s/AKfycbzVhuxDlxvSK-Gr_cypuV_Aw34CtjA1IEOOMiXmN4K02J6Fk9g9qYDvBq1YHrqHBYlGdw/exec";

const Backend = {
  usandoServidor(){ return !!API_URL; },

  async saveRecords(registros, nuevosProductos, nuevosModelos){
    if(API_URL){
      await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "add", registros: registros, nuevosProductos: nuevosProductos||[], nuevosModelos: nuevosModelos||[] })
      });
      return true;
    }
    // Sin servidor: guarda en este navegador (sirve para probar)
    const ts = Date.now();
    for(let i=0;i<registros.length;i++){
      const key = `faltante:${ts}_${i}_${Math.random().toString(36).slice(2,7)}`;
      const val = JSON.stringify({ ...registros[i], creado: new Date().toISOString() });
      if (window.storage && window.storage.set) await window.storage.set(key, val, true);
      else localStorage.setItem(key, val);
    }
    return true;
  },

  async loadRecords(){
    if(API_URL){
      return await new Promise((resolve, reject)=>{
        const cb = "cb_" + Date.now() + "_" + Math.floor(Math.random()*1e4);
        const s = document.createElement("script");
        const limpiar = ()=>{ try{ delete window[cb]; }catch(e){} if(s.parentNode) s.parentNode.removeChild(s); };
        window[cb] = (data)=>{ limpiar(); resolve(Array.isArray(data)?data:[]); };
        s.onerror = ()=>{ limpiar(); reject(new Error("No se pudo leer del servidor")); };
        s.src = API_URL + "?action=list&callback=" + cb + "&t=" + Date.now() + "&authuser=0";
        document.body.appendChild(s);
      });
    }
    // Sin servidor: lee de este navegador
    const out = [];
    let keys = [];
    if (window.storage && window.storage.list){ const r = await window.storage.list("faltante:", true); keys = (r&&r.keys)||[]; }
    else { for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k&&k.startsWith("faltante:")) keys.push(k); } }
    for(const k of keys){
      try {
        let v;
        if (window.storage && window.storage.get){ const r = await window.storage.get(k, true); v = r&&r.value; }
        else v = localStorage.getItem(k);
        if(v){ const o = JSON.parse(v); o._key = k; out.push(o); }
      } catch(e){}
    }
    return out;
  }
};
