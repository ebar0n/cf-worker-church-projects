/* Perfil transversal del Club de Aventureros.
   Incluye el overlay de ingreso (documento → carga el nombre solo) y los
   puntos del reto. El perfil vive en localStorage y es el mismo en todas
   las páginas del sitio.

   Uso en una página:
     <link rel="stylesheet" href="/shared/profile.css">
     <script src="/shared/profile.js"></script>
     AvProfile.init({
       chip: document.getElementById('playerChip'),
       activity: 'pr41',
       caps: {card: 5, quiz: 2},   // lo que vale ESTA actividad; el techo del backend es 5+5
       autoOpen: true
     });

   El tope diario es por actividad: cada juego tiene sus propias 5 tarjetas y
   5 preguntas, así que `activity` debe ser el slug del juego (registrado en
   ACTIVITIES del worker).

   API:
     AvProfile.get()                 -> {id, name, points, age, today:{<actividad>:{card,quiz}}, limit:{card,quiz}, doc} | null
     AvProfile.clubClass()               -> 'Abejitas Industriosas' | null  (según la edad)
     AvProfile.today()               -> {card, quiz} de hoy en la actividad actual
     AvProfile.canScore(kind?)       -> true si puede sumar puntos hoy ('card' | 'quiz')
     AvProfile.cap(kind)             -> tope real de hoy: el menor entre servidor y actividad
     AvProfile.score(correct, kind)  -> +1 con tope diario por tipo; la incorrecta solo se registra
     AvProfile.pick(bucket, items, n, keyFn)
                                -> n elementos sin repetir hasta agotar la bolsa
                                   (por niño y por semana; luego reinicia)
     AvProfile.open()           -> abre el formulario de ingreso/cambio
     AvProfile.onChange(fn)     -> callback cuando cambia el perfil
*/
(function(){
  // Debe coincidir con la versión de package.json; check-games.mjs lo exige.
  // Va embebida, no en un endpoint, para que se lea también sin señal: así se
  // sabe si el teléfono ya se actualizó incluso en el wifi del campamento.
  const APP_VERSION = '1.0.0';
  const PKEY = 'aventureros-player';
  let player = null;
  try{ player = JSON.parse(localStorage.getItem(PKEY) || 'null') }catch(e){ player = null }

  // Clases del Club de Aventureros. Para cambiar un nombre, se cambia aquí y
  // queda cambiado en todo el sitio. La de 5 años está por confirmar.
  const CLASSES = [
    {upTo: 3,  name: 'Principiantes'},
    {age: 4,   name: 'Corderitos'},
    {age: 5,   name: 'Aves Madrugadoras'},
    {age: 6,   name: 'Abejitas Industriosas'},
    {age: 7,   name: 'Rayitos de Sol'},
    {age: 8,   name: 'Constructores'},
    {from: 9,  name: 'Manos Ayudadoras'}
  ];
  const AGES = [2, 3, 4, 5, 6, 7, 8, 9];
  function classForAge(edad){
    if(edad === null || edad === undefined) return null;
    const n = Number(edad);
    for(const c of CLASSES){
      if(c.age !== undefined && n === c.age) return c.name;
      if(c.upTo !== undefined && n <= c.upTo) return c.name;
      if(c.from !== undefined && n >= c.from) return c.name;
    }
    return null;
  }

  const LIMIT_FALLBACK = {card: 5, quiz: 5};
  let ACTIVITY = null;
  // Tope propio de la actividad, declarado en init({caps}). El backend topa en
  // 5+5, pero cada juego vale distinto: sin esto, cada página tendría que
  // auto-limitarse por su cuenta y doce implementaciones fallan doce veces.
  let CAPS = null;
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
  // El tope real es el menor entre el del servidor y el que declaró la actividad.
  function capFor(kind){
    const l = (player && player.limit) || LIMIT_FALLBACK;
    const servidor = l[kind] ?? 5;
    const propio = CAPS && Number.isFinite(CAPS[kind]) ? CAPS[kind] : servidor;
    return Math.min(servidor, Math.max(0, propio));
  }
  function canScore(kind){
    if(!player || !ACTIVITY) return false;
    const t = todayFor(ACTIVITY);
    if(kind) return t[kind] < capFor(kind);
    return t.card < capFor('card') || t.quiz < capFor('quiz');
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
    const tipo = kind === 'quiz' ? 'quiz' : 'card';
    // Un acierto por encima del tope de la actividad no se envía: se ignora en
    // silencio. Así ningún juego puede pasarse aunque su lógica interna falle.
    if(correct && todayFor(ACTIVITY)[tipo] >= capFor(tipo)) return;
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
  let pfAgeWrap, pfAges, pfAgeClass;
  let pickedAge = null;
  let lookup = null;
  let lookupTimer = null;

  function resetForm(){
    lookup = null;
    pickedAge = null;
    pfDoc.value = '';
    pfName.value = '';
    pfError.textContent = '';
    pfStatus.hidden = true;
    pfNameWrap.hidden = false;
    pfAgeWrap.hidden = false;
    pfAgeClass.hidden = true;
    pfAges.querySelectorAll('.pf-age').forEach(x => x.classList.remove('on'));
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
        <h2>🧒 ¿Quién va a aprender?</h2>
        <p class="pf-sub">Cada acierto suma ⭐ 1 punto al tablero del club. Cada actividad tiene su propio puntaje del día, y lo que ganen en todas se va sumando.</p>
        <form class="pf-form">
          <label>Número de documento del niño o la niña
            <input class="pf-doc" type="text" inputmode="numeric" autocomplete="off" maxlength="15" placeholder="Solo números">
          </label>
          <div class="pf-status" hidden></div>
          <label class="pf-name-wrap">Nombre del niño o la niña
            <input class="pf-name" type="text" maxlength="40" autocomplete="off" placeholder="Ej: Sara">
          </label>
          <div class="pf-age-wrap">
            <span class="pf-age-label">¿Cuántos años tiene?</span>
            <div class="pf-ages"></div>
            <p class="pf-age-class" hidden></p>
          </div>
          <p class="pf-note">🔒 En el tablero solo aparece el nombre. El documento no se le muestra a nadie.</p>
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
    pfAgeWrap = overlay.querySelector('.pf-age-wrap');
    pfAges = overlay.querySelector('.pf-ages');
    pfAgeClass = overlay.querySelector('.pf-age-class');

    pfAges.innerHTML = AGES.map(e =>
      `<button type="button" class="pf-age" data-edad="${e}">${e}</button>`
    ).join('');
    pfAges.addEventListener('click', ev => {
      const b = ev.target.closest('.pf-age');
      if(!b) return;
      pickedAge = Number(b.dataset.edad);
      pfAges.querySelectorAll('.pf-age').forEach(x => x.classList.toggle('on', x === b));
      pfAgeClass.textContent = `Clase: ${classForAge(pickedAge)}`;
      pfAgeClass.hidden = false;
    });
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
          const yaTieneEdad = data.player.age !== null && data.player.age !== undefined;
          pfAgeWrap.hidden = yaTieneEdad;
          pfStatus.textContent = yaTieneEdad
            ? `✔ ¡Hola, ${data.player.name}! (${classForAge(data.player.age)}) Toca ¡A jugar!`
            : `✔ ¡Hola, ${data.player.name}! Falta decir cuántos años tiene 👇`;
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
            if(pickedAge === null){
              throw new Error('Toca la edad del niño o la niña.');
            }
            data = await api('register', {name: pfName.value, doc, age: pickedAge});
          }
        }
        // Perfil viejo sin edad: se completa aquí.
        const sinEdad = data.player.age === null || data.player.age === undefined;
        if(sinEdad){
          if(pickedAge === null) throw new Error('Toca la edad del niño o la niña.');
          data = await api('edad', {doc, age: pickedAge});
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

  // El trofeo vive en el extremo izquierdo de la barra y el chip en el derecho:
  // son los dos lados del header, no un par de botones juntos.
  function mountTrophy(el){
    const barra = el && el.parentElement;
    if(!barra || barra.querySelector('.pf-trophy')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pf-trophy';
    btn.title = 'Tablero de puntos';
    btn.setAttribute('aria-label', 'Tablero de puntos');
    btn.textContent = '🏆';
    btn.addEventListener('click', openBoard);
    const volver = barra.querySelector('.back-link');
    if(volver) volver.insertAdjacentElement('afterend', btn);
    else barra.prepend(btn);
  }

  function mountChip(el){
    if(!el) return;
    mountTrophy(el);
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
        const clase = classForAge(player.age);
        el.innerHTML = offline + `<button type="button" class="pf-chip" title="${clase ? esc(clase) + ' · ' : ''}Cambiar jugador">🧒 ${esc(player.name)}${clase ? `<span class="c-clase"> · ${esc(clase)}</span>` : ''} · ⭐ ${player.points}${espera}<span class="c-hoy"> · ${t.card + t.quiz}/${max} aquí hoy</span></button>`;
      }else{
        const map = player.today || {};
        const hoy = Object.keys(map).reduce((sum, k) => sum + normToday(map[k]).card + normToday(map[k]).quiz, 0);
        const clase2 = classForAge(player.age);
        el.innerHTML = offline + `<button type="button" class="pf-chip" title="${clase2 ? esc(clase2) + ' · ' : ''}Cambiar jugador">🧒 ${esc(player.name)}${clase2 ? `<span class="c-clase"> · ${esc(clase2)}</span>` : ''} · ⭐ ${player.points}${espera}<span class="c-hoy"> · +${hoy} hoy</span></button>`;
      }
      el.querySelector('.pf-chip').addEventListener('click', open);
    };
    listeners.push(render);
    render();
  }

  // ── Tablero de puntos ──
  // Vive aquí y no en la portada para que el trofeo esté en todas las páginas.
  let boardEl = null;
  function injectBoard(){
    if(boardEl) return;
    boardEl = document.createElement('div');
    boardEl.className = 'pf-overlay pf-tablero';
    boardEl.hidden = true;
    boardEl.innerHTML = `
      <div class="pf-card">
        <button class="pf-close" type="button" aria-label="Cerrar">✕</button>
        <h2>🏆 Tablero de puntos</h2>
        <p class="pf-sub">Cada acierto suma ⭐ 1 punto. Cada actividad tiene su propio cupo diario, y no todas valen lo mismo.</p>
        <ol class="pf-board"></ol>
        <p class="pf-board-empty" hidden></p>
      </div>`;
    document.body.appendChild(boardEl);
    boardEl.querySelector('.pf-close').addEventListener('click', () => { boardEl.hidden = true });
    boardEl.addEventListener('click', e => { if(e.target === boardEl) boardEl.hidden = true });
    document.addEventListener('keydown', e => {
      if(e.key === 'Escape' && !boardEl.hidden) boardEl.hidden = true;
    });
  }

  async function openBoard(){
    injectBoard();
    const lista = boardEl.querySelector('.pf-board');
    const vacia = boardEl.querySelector('.pf-board-empty');
    boardEl.hidden = false;
    lista.innerHTML = '';
    vacia.textContent = 'Cargando…';
    vacia.hidden = false;
    try{
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      const jugadores = data.players || [];
      if(!jugadores.length){
        vacia.textContent = 'Aún no hay puntos registrados… ¡sé el primero!';
        return;
      }
      const medallas = ['🥇','🥈','🥉'];
      lista.innerHTML = jugadores.map((j, i) => {
        const isMe = player && j.name === player.name;
        return `<li${isMe ? ' class="me"' : ''}>
          <span class="rank">${medallas[i] || i + 1}</span>
          <span class="who">${esc(j.name)}</span>
          <span class="pts">⭐ ${j.points}</span>
        </li>`;
      }).join('');
      vacia.hidden = true;
    }catch(err){
      vacia.textContent = navigator.onLine
        ? 'No pudimos cargar el tablero. Intenta de nuevo más tarde.'
        : '📴 Sin señal: el tablero necesita conexión.';
    }
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

  // Sella la versión al final de la página. Sirve para saber, mirando el
  // teléfono, si la app instalada ya tomó el último despliegue.
  function stampVersion(){
    const foot = document.querySelector('footer');
    if(!foot || foot.querySelector('.pf-version')) return;
    const tag = document.createElement('span');
    tag.className = 'pf-version';
    tag.textContent = ' · v' + APP_VERSION;
    foot.appendChild(tag);
  }

  function init(opts = {}){
    if(opts.activity) ACTIVITY = opts.activity;
    if(opts.caps) CAPS = opts.caps;
    injectOverlay();
    if(opts.chip) mountChip(opts.chip);
    if(opts.install) mountInstall(opts.install);
    if(opts.autoOpen && !player) open();
    registerSW();
    stampVersion();
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
    cap: capFor,
    pending: pendingCount,
    clubClass: () => classForAge(player && player.age),
    clubClasses: () => CLASSES.map(c => c.name),
    toast,
    canScore,
    score,
    pick,
    open,
    board: openBoard
  };
})();
