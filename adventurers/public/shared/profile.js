/* Perfil transversal del Club de Aventureros.
   Incluye el overlay de ingreso (documento → carga el nombre solo) y los
   puntos del reto. El perfil vive en localStorage y es el mismo en todas
   las páginas del sitio.

   Uso en una página:
     <link rel="stylesheet" href="/shared/profile.css">
     <script src="/shared/profile.js"></script>
     AvProfile.init({ chip: document.getElementById('playerChip'), activity: 'pr41', autoOpen: true });

   El tope diario es por actividad: cada juego tiene sus propias 5 tarjetas y
   5 preguntas, así que `activity` debe ser el slug del juego (registrado en
   ACTIVITIES del worker).

   API:
     AvProfile.get()                 -> {id, name, points, today:{<actividad>:{card,quiz}}, limit:{card,quiz}, doc} | null
     AvProfile.today()               -> {card, quiz} de hoy en la actividad actual
     AvProfile.canScore(kind?)       -> true si puede sumar puntos hoy ('card' | 'quiz')
     AvProfile.score(correct, kind)  -> +1 con tope diario por tipo; la incorrecta solo se registra
     AvProfile.pick(bucket, items, n, keyFn)
                                -> n elementos sin repetir hasta agotar la bolsa
                                   (por niño y por semana; luego reinicia)
     AvProfile.open()           -> abre el formulario de ingreso/cambio
     AvProfile.onChange(fn)     -> callback cuando cambia el perfil
*/
(function(){
  const PKEY = 'aventureros-player';
  let player = null;
  try{ player = JSON.parse(localStorage.getItem(PKEY) || 'null') }catch(e){ player = null }

  const LIMIT_FALLBACK = {card: 5, quiz: 5};
  let ACTIVITY = null;
  const normToday = t => (t && typeof t === 'object') ? {card: t.card || 0, quiz: t.quiz || 0} : {card: 0, quiz: 0};
  // today llega como {actividad: {card, quiz}}; las respuestas viejas traían {card, quiz} planos.
  const normTodayMap = t => {
    if(!t || typeof t !== 'object') return {};
    if(typeof t.card === 'number' || typeof t.quiz === 'number') return {pr39: normToday(t)};
    const out = {};
    Object.keys(t).forEach(k => { out[k] = normToday(t[k]) });
    return out;
  };
  const todayFor = activity => {
    if(!player) return {card: 0, quiz: 0};
    return normToday((player.today || {})[activity || ACTIVITY]);
  };

  const listeners = [];
  const emit = () => listeners.forEach(fn => { try{ fn(player) }catch(e){} });
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function api(path, body){
    const res = await fetch('/api/' + path, {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok){
      const err = new Error(data.error || 'Algo salió mal. Intenta de nuevo.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function save(){
    if(player) localStorage.setItem(PKEY, JSON.stringify(player));
    else localStorage.removeItem(PKEY);
  }
  function setFromResponse(data, doc){
    player = {
      ...data.player,
      doc: String(doc).replace(/\D/g,''),
      today: normTodayMap(data.today),
      limit: data.limit || LIMIT_FALLBACK
    };
    save();
    emit();
  }
  function canScore(kind){
    if(!player || !ACTIVITY) return false;
    const t = todayFor(ACTIVITY);
    const l = player.limit || LIMIT_FALLBACK;
    if(kind) return t[kind] < (l[kind] ?? 5);
    return t.card < (l.card ?? 5) || t.quiz < (l.quiz ?? 5);
  }

  async function refresh(){
    if(!player || !player.doc) return;
    try{
      const data = await api('login', {doc: player.doc});
      setFromResponse(data, player.doc);
    }catch(err){
      if(err.status === 404){
        player = null;
        save();
        emit();
      }
    }
  }

  // ── Cola de puntos: sin señal no se pierde ningún acierto ──
  // Se guarda el intento y se reenvía al volver la conexión o al abrir la app.
  // El tope diario lo impone el servidor, así que reenviar nunca infla puntos.
  const QKEY = 'aventureros-cola';
  const loadQueue = () => {
    try{ return JSON.parse(localStorage.getItem(QKEY) || '[]') }catch(e){ return [] }
  };
  const saveQueue = q => {
    try{ localStorage.setItem(QKEY, JSON.stringify(q)) }catch(e){}
  };
  const pendingCount = () => loadQueue().filter(it => it.correct).length;

  function enqueue(entry){
    const q = loadQueue();
    q.push(entry);
    saveQueue(q);
    emit();
  }

  let flushing = false;
  async function flushQueue(){
    if(flushing) return;
    const q = loadQueue();
    if(!q.length) return;
    flushing = true;
    let sent = 0;
    while(true){
      const queue = loadQueue();
      if(!queue.length) break;
      const entry = queue[0];
      try{
        const data = await api('score', entry);
        if(entry.correct) sent++;
        setFromResponse(data, entry.doc);
      }catch(err){
        // Sin red: se deja la cola intacta para el próximo intento.
        if(err.status === undefined) break;
        // 429 = ya llegó al tope del día; 4xx = intento inservible. Se descarta.
        if(err.status === 429 && entry.activity){
          const l = (player && player.limit) || LIMIT_FALLBACK;
          const type = entry.kind === 'quiz' ? 'quiz' : 'card';
          if(player){
            player.today = normTodayMap(player.today);
            player.today[entry.activity] = todayFor(entry.activity);
            player.today[entry.activity][type] = l[type] ?? 5;
            save();
          }
        }
      }
      saveQueue(loadQueue().slice(1));
      emit();
    }
    flushing = false;
    if(sent) toast(`✅ Se enviaron ${sent} punto${sent === 1 ? '' : 's'} que quedaron guardados sin señal.`);
  }

  // Los envíos se encolan en serie: dos aciertos seguidos no se pisan.
  let scoreChain = Promise.resolve();
  function score(correct, kind){
    scoreChain = scoreChain.then(() => sendScore(correct, kind), () => sendScore(correct, kind));
    return scoreChain;
  }
  async function sendScore(correct, kind){
    if(!player) return;
    const entry = {doc: player.doc, correct, kind, activity: ACTIVITY};
    if(!navigator.onLine){
      enqueue(entry);
      if(correct) toast('📴 Sin señal: tu punto queda guardado y se enviará solo.');
      return;
    }
    try{
      const data = await api('score', entry);
      setFromResponse(data, player.doc);
    }catch(err){
      if(err.status === undefined){
        // Falló la red, no el servidor: se guarda para después.
        enqueue(entry);
        if(correct) toast('📴 Sin señal: tu punto queda guardado y se enviará solo.');
        return;
      }
      if(err.status === 429 && ACTIVITY){
        const l = player.limit || LIMIT_FALLBACK;
        const type = kind === 'quiz' ? 'quiz' : 'card';
        player.today = normTodayMap(player.today);
        player.today[ACTIVITY] = todayFor(ACTIVITY);
        player.today[ACTIVITY][type] = l[type] ?? 5;
        save();
        emit();
      }
      toast(err.message, true);
    }
  }

  // ── Avisos ──
  let toastWrap = null;
  function toast(message, bad){
    if(!toastWrap){
      toastWrap = document.createElement('div');
      toastWrap.className = 'pf-toast-wrap';
      document.body.appendChild(toastWrap);
    }
    const el = document.createElement('div');
    el.className = 'pf-toast' + (bad ? ' bad' : '');
    el.textContent = message;
    toastWrap.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  // ── Bolsa de rotación: no repetir preguntas ni tarjetas ──
  // Se guarda por niño (o 'anon') y por semana ISO de Bogotá: dentro de la
  // semana nada se repite hasta agotar la bolsa, y al agotarse vuelve a
  // empezar. Al cambiar de semana o de jugador, la bolsa arranca limpia.
  const ROT_PREFIX = 'aventureros-bolsa:';

  function shuffle(arr){
    const a = arr.slice();
    for(let i = a.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function weekKey(){
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Bogota'})
      .format(new Date()).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7) + 3); // jueves de la semana ISO
    const jan4 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((dt - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
    return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  function pick(bucket, items, n, keyFn){
    const kf = keyFn || (it => it.q || it.name || JSON.stringify(it));
    const storeKey = `${ROT_PREFIX}${player ? 'p' + player.id : 'anon'}:${bucket}`;
    let state = null;
    try{ state = JSON.parse(localStorage.getItem(storeKey) || 'null') }catch(e){}
    const week = weekKey();
    if(!state || state.week !== week) state = {week, used: []};
    const used = new Set(state.used);
    const out = [];
    for(let round = 0; out.length < n && round < 3; round++){
      const taken = new Set(out.map(kf));
      const pool = shuffle(items.filter(it => !used.has(kf(it)) && !taken.has(kf(it))));
      if(!pool.length){ used.clear(); continue } // bolsa agotada: se reinicia
      for(const it of pool){
        if(out.length >= n) break;
        out.push(it);
      }
    }
    out.forEach(it => used.add(kf(it)));
    try{ localStorage.setItem(storeKey, JSON.stringify({week, used: [...used]})) }catch(e){}
    return out;
  }

  // ── Overlay de ingreso ──
  let overlay, pfForm, pfDoc, pfName, pfNameWrap, pfStatus, pfError, pfSubmit;
  let lookup = null;
  let lookupTimer = null;

  function resetForm(){
    lookup = null;
    pfDoc.value = '';
    pfName.value = '';
    pfError.textContent = '';
    pfStatus.hidden = true;
    pfNameWrap.hidden = false;
  }

  function open(){
    resetForm();
    overlay.hidden = false;
  }
  function close(){
    overlay.hidden = true;
  }

  function injectOverlay(){
    overlay = document.createElement('div');
    overlay.className = 'pf-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="pf-card">
        <button class="pf-close" type="button" aria-label="Cerrar">✕</button>
        <h2>🧒 ¿Quién va a jugar?</h2>
        <p class="pf-sub">Cada acierto suma ⭐ 1 punto al tablero del club: en cada actividad se pueden ganar hasta 5 puntos de juego y 5 de preguntas por día.</p>
        <form class="pf-form">
          <label>Número de documento del niño o la niña
            <input class="pf-doc" type="text" inputmode="numeric" autocomplete="off" maxlength="15" placeholder="Solo números">
          </label>
          <div class="pf-status" hidden></div>
          <label class="pf-name-wrap">Nombre del niño o la niña
            <input class="pf-name" type="text" maxlength="40" autocomplete="off" placeholder="Ej: Sara">
          </label>
          <p class="pf-note">🔒 En el tablero solo aparece el nombre: el documento no se muestra a nadie ni se guarda en claro.</p>
          <div class="pf-error"></div>
          <div class="pf-actions">
            <button class="pf-btn pf-submit" type="submit">¡A jugar!</button>
            <button class="pf-btn pf-btn-outline pf-skip" type="button">Jugar sin puntos</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);

    pfForm = overlay.querySelector('.pf-form');
    pfDoc = overlay.querySelector('.pf-doc');
    pfName = overlay.querySelector('.pf-name');
    pfNameWrap = overlay.querySelector('.pf-name-wrap');
    pfStatus = overlay.querySelector('.pf-status');
    pfError = overlay.querySelector('.pf-error');
    pfSubmit = overlay.querySelector('.pf-submit');

    // "Jugar sin puntos" = salir del perfil: borra la sesión guardada
    overlay.querySelector('.pf-skip').addEventListener('click', () => {
      player = null;
      save();
      emit();
      close();
    });
    overlay.querySelector('.pf-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
    document.addEventListener('keydown', e => {
      if(e.key === 'Escape' && !overlay.hidden) close();
    });

    pfDoc.addEventListener('input', () => {
      clearTimeout(lookupTimer);
      lookup = null;
      pfError.textContent = '';
      const doc = pfDoc.value.replace(/\D/g,'');
      if(doc.length < 4){
        pfStatus.hidden = true;
        pfNameWrap.hidden = false;
        return;
      }
      lookupTimer = setTimeout(async () => {
        try{
          const data = await api('login', {doc});
          lookup = {doc, data};
          pfNameWrap.hidden = true;
          pfStatus.textContent = `✔ ¡Hola, ${data.player.name}! Toca ¡A jugar!`;
          pfStatus.className = 'pf-status ok';
          pfStatus.hidden = false;
        }catch(err){
          if(err.status === 404){
            pfNameWrap.hidden = false;
            pfStatus.textContent = 'Documento nuevo: escribe el nombre para crear el perfil 👇';
            pfStatus.className = 'pf-status';
            pfStatus.hidden = false;
          }
        }
      }, 350);
    });

    pfForm.addEventListener('submit', async e => {
      e.preventDefault();
      pfError.textContent = '';
      pfSubmit.disabled = true;
      try{
        const doc = pfDoc.value;
        const digits = doc.replace(/\D/g,'');
        if(!digits){
          throw new Error('El documento debe tener solo números.');
        }
        let data;
        if(lookup && lookup.doc === digits){
          data = lookup.data;
        }else{
          try{
            data = await api('login', {doc});
          }catch(err){
            if(err.status !== 404) throw err;
            if(!pfName.value.trim()){
              throw new Error('Escribe el nombre para crear el perfil.');
            }
            data = await api('register', {name: pfName.value, doc});
          }
        }
        setFromResponse(data, doc);
        close();
        resetForm();
      }catch(err){
        pfError.textContent = err.message;
      }
      pfSubmit.disabled = false;
    });
  }

  function mountChip(el){
    if(!el) return;
    const render = () => {
      const pend = pendingCount();
      const offline = !navigator.onLine
        ? '<span class="pf-offline" title="Los puntos se guardan y se envían al volver la señal">📴 sin señal</span>'
        : '';
      const espera = pend ? ` · ⏳ ${pend}` : '';
      if(!player){
        el.innerHTML = offline + `<button type="button" class="pf-chip pf-chip-empty" title="Ingresar">👤 Ingresar</button>`;
      }else if(ACTIVITY){
        const t = todayFor(ACTIVITY);
        const l = player.limit || LIMIT_FALLBACK;
        const max = (l.card ?? 5) + (l.quiz ?? 5);
        el.innerHTML = offline + `<button type="button" class="pf-chip" title="Cambiar jugador">🧒 ${esc(player.name)} · ⭐ ${player.points}${espera} · ${t.card + t.quiz}/${max} aquí hoy</button>`;
      }else{
        const map = player.today || {};
        const hoy = Object.keys(map).reduce((sum, k) => sum + normToday(map[k]).card + normToday(map[k]).quiz, 0);
        el.innerHTML = offline + `<button type="button" class="pf-chip" title="Cambiar jugador">🧒 ${esc(player.name)} · ⭐ ${player.points}${espera} · +${hoy} hoy</button>`;
      }
      el.querySelector('.pf-chip').addEventListener('click', open);
    };
    listeners.push(render);
    render();
  }

  // ── App instalable ──
  let installEvent = null;
  const standalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function registerSW(){
    if(!('serviceWorker' in navigator)) return;
    if(location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // Android/escritorio: botón real. iPhone: instrucciones, porque Safari no
  // ofrece prompt de instalación.
  function mountInstall(el){
    if(!el) return;
    const render = () => {
      if(standalone()){ el.hidden = true; return }
      if(installEvent){
        el.hidden = false;
        el.innerHTML = '<button type="button" class="pf-install">📲 Instalar la app</button>';
        el.querySelector('button').addEventListener('click', async () => {
          const ev = installEvent;
          installEvent = null;
          el.hidden = true;
          try{ await ev.prompt() }catch(e){}
        });
      }else if(isIOS()){
        el.hidden = false;
        el.innerHTML = '<p class="pf-install-hint">📲 Para tenerla como app: toca <strong>Compartir</strong> y luego <strong>Añadir a pantalla de inicio</strong>.</p>';
      }else{
        el.hidden = true;
      }
    };
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      installEvent = e;
      render();
    });
    window.addEventListener('appinstalled', () => {
      installEvent = null;
      el.hidden = true;
      toast('🎉 ¡Listo! Ya puedes abrirla desde la pantalla de inicio.');
    });
    render();
  }

  function init(opts = {}){
    if(opts.activity) ACTIVITY = opts.activity;
    injectOverlay();
    if(opts.chip) mountChip(opts.chip);
    if(opts.install) mountInstall(opts.install);
    if(opts.autoOpen && !player) open();
    registerSW();
    refresh();
    flushQueue();
    window.addEventListener('online', () => { emit(); flushQueue() });
    window.addEventListener('offline', emit);
    window.addEventListener('storage', e => {
      if(e.key !== PKEY) return;
      try{ player = JSON.parse(e.newValue || 'null') }catch(err){ player = null }
      emit();
    });
  }

  window.AvProfile = {
    init,
    get: () => player,
    onChange: fn => listeners.push(fn),
    today: () => todayFor(ACTIVITY),
    pending: pendingCount,
    toast,
    canScore,
    score,
    pick,
    open
  };
})();
