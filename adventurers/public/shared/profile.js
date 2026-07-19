/* Perfil transversal del Club de Aventureros.
   Incluye el overlay de ingreso (documento → carga el nombre solo) y los
   puntos del reto. El perfil vive en localStorage y es el mismo en todas
   las páginas del sitio.

   Uso en una página:
     <link rel="stylesheet" href="/shared/profile.css">
     <script src="/shared/profile.js"></script>
     AvProfile.init({ chip: document.getElementById('playerChip'), autoOpen: true });

   API:
     AvProfile.get()                 -> {id, name, points, today:{card,quiz}, limit:{card,quiz}, doc} | null
     AvProfile.canScore(kind?)       -> true si puede sumar puntos hoy ('card' | 'quiz')
     AvProfile.score(correct, kind)  -> +1 (con tope diario por tipo) o -1 (piso 0)
     AvProfile.open()           -> abre el formulario de ingreso/cambio
     AvProfile.onChange(fn)     -> callback cuando cambia el perfil
*/
(function(){
  const PKEY = 'aventureros-player';
  let player = null;
  try{ player = JSON.parse(localStorage.getItem(PKEY) || 'null') }catch(e){ player = null }

  const LIMIT_FALLBACK = {card: 5, quiz: 5};
  const normToday = t => (t && typeof t === 'object') ? {card: t.card || 0, quiz: t.quiz || 0} : {card: 0, quiz: 0};

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
      today: normToday(data.today),
      limit: data.limit || LIMIT_FALLBACK
    };
    save();
    emit();
  }
  function canScore(kind){
    if(!player) return false;
    const t = normToday(player.today);
    const l = player.limit || LIMIT_FALLBACK;
    if(kind) return t[kind] < (l[kind] ?? 5);
    return t.card < (l.card ?? 5) || t.quiz < (l.quiz ?? 5);
  }

  let scoring = false;
  async function score(correct, kind){
    if(!player || scoring) return;
    scoring = true;
    try{
      const data = await api('score', {doc: player.doc, correct, kind});
      setFromResponse(data, player.doc);
    }catch(err){
      if(err.status === 429 && player){
        const l = player.limit || LIMIT_FALLBACK;
        player.today = normToday(player.today);
        player.today[kind === 'quiz' ? 'quiz' : 'card'] = l[kind === 'quiz' ? 'quiz' : 'card'] ?? 5;
        save();
        emit();
      }
      alert(err.message);
    }
    scoring = false;
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
        <p class="pf-sub">Cada acierto suma ⭐ 1 punto al tablero del club: hasta 5 de comidas y 5 de preguntas por día.</p>
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
    // cerrar tocando el fondo oscuro o con Escape
    overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
    document.addEventListener('keydown', e => {
      if(e.key === 'Escape' && !overlay.hidden) close();
    });

    // Al escribir el documento se busca el perfil: si existe, saluda con el
    // nombre; si es nuevo, aparece el campo de nombre para crearlo.
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

  // Chip del jugador: muestra nombre + puntos, o "Ingresar" si no hay perfil.
  // Tocarlo abre el formulario (sirve también para cambiar de jugador).
  function mountChip(el){
    if(!el) return;
    const render = () => {
      const t = player ? normToday(player.today) : null;
      const l = player ? (player.limit || LIMIT_FALLBACK) : null;
      el.innerHTML = player
        ? `<button type="button" class="pf-chip" title="Cambiar jugador">🧒 ${esc(player.name)} · ⭐ ${player.points} · ${t.card + t.quiz}/${(l.card ?? 5) + (l.quiz ?? 5)} hoy</button>`
        : `<button type="button" class="pf-chip pf-chip-empty" title="Ingresar">👤 Ingresar</button>`;
      el.querySelector('.pf-chip').addEventListener('click', open);
    };
    listeners.push(render);
    render();
  }

  function init(opts = {}){
    injectOverlay();
    if(opts.chip) mountChip(opts.chip);
    if(opts.autoOpen && !player) open();
  }

  window.AvProfile = {
    init,
    get: () => player,
    onChange: fn => listeners.push(fn),
    canScore,
    score,
    open
  };
})();
