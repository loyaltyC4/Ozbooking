/* BookAustralia - Shared JS (v3: server-proxied LiteAPI + optional Supabase member login)
   Guest checkout always works. Login is optional and unlocks member prices + saved trips. */

const BA = {
  // ---- Supabase (publishable key is client-safe by design) ----
  SUPA_URL: 'https://fuaommqybyqsiayzofmb.supabase.co',
  SUPA_KEY: 'sb_publishable_Ab3q7O7GPpOA_pleL8nMQQ_VMyRNEEJ',
  MEMBER_EXTRA: 0.08, // legacy client estimate - no longer shown in UI; real member pricing is applied server-side via MEMBER_MARGIN in api/_liteapi.js
  _sb: null, user: null, saved: [], authMode: 'signup',

  // ---- i18n (EN / 简体中文). Language switch persists + reloads so every page renders in one language. ----
  lang: (typeof localStorage!=='undefined' && localStorage.getItem('ba_lang')) || 'en',
  t(en, zh){ return this.lang === 'zh' ? zh : en; },
  setLang(l){ try{ localStorage.setItem('ba_lang', l); }catch(e){} if(l===this.lang){ const w=document.getElementById('navLangWrap'); if(w) w.classList.remove('open'); return; } this.lang = l; location.reload(); },
  toggleLang(){ this.setLang(this.lang === 'zh' ? 'en' : 'zh'); },
  toggleLangMenu(e){ if(e){ e.stopPropagation(); } const w=document.getElementById('navLangWrap'); if(w) w.classList.toggle('open'); },
  loadCJK(){ if(this.lang!=='zh' || document.getElementById('cjkFont')) return; const l=document.createElement('link'); l.id='cjkFont'; l.rel='stylesheet'; l.href='https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&display=swap'; document.head.appendChild(l); },

  CITIES: {
    'sydney':{code:'SYD',cc:'AU'},'melbourne':{code:'MEL',cc:'AU'},'gold coast':{code:'OOL',cc:'AU'},
    'cairns':{code:'CNS',cc:'AU'},'brisbane':{code:'BNE',cc:'AU'},'perth':{code:'PER',cc:'AU'},
    'adelaide':{code:'ADL',cc:'AU'},'hobart':{code:'HBA',cc:'AU'}
  },

  // ---- Date + misc helpers ----
  today(){return new Date()},
  addDays(d,n){const r=new Date(d);r.setDate(r.getDate()+n);return r},
  fmt(d){return d.toISOString().split('T')[0]},
  defaultCheckin(){return this.fmt(this.addDays(this.today(),7))},
  defaultCheckout(){return this.fmt(this.addDays(this.today(),10))},
  nightsBetween(ci,co){const a=new Date(ci),b=new Date(co);return Math.max(1,Math.round((b-a)/86400000))},
  prettyCity(c){return (c||'').split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ')},
  getParam(k){return new URLSearchParams(location.search).get(k)},

  storeHotel(d){ if(typeof d==='string'){ try{ d=JSON.parse(d); }catch(e){} } try{ sessionStorage.setItem('ba_hotel',JSON.stringify(d)); }catch(e){} },
  getHotel(){ try{ let v=JSON.parse(sessionStorage.getItem('ba_hotel')); if(typeof v==='string'){ try{ v=JSON.parse(v); }catch(e){} } return v; }catch{return null} },
  money(n){ return (n==null||isNaN(n))?'-':'A$'+Math.round(n).toLocaleString(); },
  storeBooking(d){sessionStorage.setItem('ba_booking',JSON.stringify(d))},
  getBooking(){try{return JSON.parse(sessionStorage.getItem('ba_booking'))}catch{return null}},
  storeSearch(d){sessionStorage.setItem('ba_search',JSON.stringify(d))},
  getSearch(){try{return JSON.parse(sessionStorage.getItem('ba_search'))}catch{return null}},
  hotelName(h,city){return (h&&(h.hotelName||h.name))||(city?`${this.prettyCity(city)} Hotel`:'Hotel')},

  // ---- LiteAPI via server proxy (session token attached when signed in; server gates member/CUG rates) ----
  async authHeader(){
    try{ if(BA._sb){ const { data } = await BA._sb.auth.getSession(); const t = data && data.session && data.session.access_token; if(t) return { Authorization:'Bearer '+t }; } }catch(e){}
    return {};
  },
  async searchHotels({city,checkin,checkout,guests=2}){
    const q=new URLSearchParams({city,checkin,checkout,guests:String(guests)});
    const r=await fetch(`/api/search?${q}`,{ headers: await BA.authHeader() }); const j=await r.json();
    return Array.isArray(j.hotels)?j.hotels:[];
  },
  async getHotelDetails({hotelId,checkin,checkout,guests=2}){
    const q=new URLSearchParams({hotelId,checkin,checkout,guests:String(guests)});
    const r=await fetch(`/api/hotel?${q}`,{ headers: await BA.authHeader() }); return await r.json();
  },
  async prebook(offerId,member){
    const r=await fetch('/api/prebook',{method:'POST',headers:{'content-type':'application/json',...(await BA.authHeader())},body:JSON.stringify({offerId,member:!!member})});
    return await r.json();
  },
  async book(prebookId,holder,guests,member,transactionId){
    const r=await fetch('/api/book',{method:'POST',headers:{'content-type':'application/json',...(await BA.authHeader())},body:JSON.stringify({prebookId,holder,guests,member:!!member,transactionId})});
    return await r.json();
  },
  getRetailPrice(h){return h&&h.retail!=null?h.retail:null},
  getSuggestedPrice(h){return h&&h.suggested!=null?h.suggested:null},
  MIN_SAVE: 5, // don't show a "save %" badge below this - "Save 1%" is meaningless
  getSavings(h){const rp=this.getRetailPrice(h),sp=this.getSuggestedPrice(h);if(!(rp&&sp&&sp>rp))return null;const p=Math.round((1-rp/sp)*100);return p>=this.MIN_SAVE?p:null;},

  // ---- Member pricing ----
  isMember(){return !!this.user},
  memberPrice(retail){return retail!=null?Math.round(retail*(1-this.MEMBER_EXTRA)):null},
  memberPct(){return Math.round(this.MEMBER_EXTRA*100)},

  // ================= AUTH =================
  auth:{
    async init(){
      if(BA._authInit) return; BA._authInit=true;
      if(!window.supabase){ console.warn('supabase-js not loaded'); BA.updateNavAuth(); return; }
      BA._sb = window.supabase.createClient(BA.SUPA_URL, BA.SUPA_KEY, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      try{
        const { data } = await BA._sb.auth.getSession();
        BA.user = data.session?.user || null;
      }catch(e){ console.warn('session error',e); }
      await BA.auth.loadSaved();
      BA.updateNavAuth();
      document.dispatchEvent(new CustomEvent('ba-auth'));
      BA._sb.auth.onAuthStateChange(async (_e,session)=>{
        BA.user = session?.user || null;
        await BA.auth.loadSaved();
        BA.updateNavAuth();
        document.dispatchEvent(new CustomEvent('ba-auth'));
      });
    },
    async signUp(email,password,name){
      const { data,error } = await BA._sb.auth.signUp({ email,password,options:{ data:{ full_name:name||'' } } });
      if(error) throw error;
      return data; // data.session null if email confirmation required
    },
    async signIn(email,password){
      const { data,error } = await BA._sb.auth.signInWithPassword({ email,password });
      if(error) throw error; return data;
    },
    async magic(email){
      const { error } = await BA._sb.auth.signInWithOtp({ email, options:{ emailRedirectTo: location.href } });
      if(error) throw error;
    },
    async signOut(){ await BA._sb?.auth.signOut(); BA.toast('Signed out'); },
    async loadSaved(){
      BA.saved=[];
      if(!BA.user||!BA._sb) return;
      try{ const { data } = await BA._sb.from('saved_stays').select('*').order('created_at',{ascending:false}); BA.saved=data||[]; }
      catch(e){ console.warn('loadSaved',e); }
    },
    async save(stay){
      if(!BA.user){ BA.openAuth('signup'); return false; }
      try{
        await BA._sb.from('saved_stays').insert({ user_id:BA.user.id, hotel_id:stay.hotel_id, hotel_name:stay.hotel_name, city:stay.city, checkin:stay.checkin, checkout:stay.checkout, price:stay.price, main_photo:stay.main_photo||null });
        await BA.auth.loadSaved(); BA.updateNavAuth(); BA.toast('Saved to your trips'); return true;
      }catch(e){ BA.toast('Could not save'); return false; }
    },
    async remove(id){
      try{ await BA._sb.from('saved_stays').delete().eq('id',id); await BA.auth.loadSaved(); BA.updateNavAuth(); BA.renderSaved(); document.dispatchEvent(new CustomEvent('ba-auth')); }catch(e){}
    },
    isSaved(hotelId){ return BA.saved.some(s=>s.hotel_id===hotelId); }
  },

  // ================= NAV / UI =================
  renderNav(active){
    const T=this.t.bind(this);
    const links=[
      ['Destinations',T('Destinations','目的地'),'index.html#destinations','home'],
      ['Stays',T('Stays','住宿'),'search.html?city=Sydney','search'],
      ['Experiences',T('Experiences','体验活动'),'experiences.html','exp'],
      ['How it works',T('How it works','运作方式'),'index.html#how-it-works','how'],
      ['Why direct',T('Why direct','为何直订'),'index.html#value','value']
    ];
    const linkHtml=links.map(([_,label,h,k])=>`<a href="${h}"${active===k?' style="color:var(--tx)"':''}>${label}</a>`).join('');
    const overlayHtml=links.map(([_,label,h])=>`<a href="${h}" onclick="BA.closeMenu()">${label}</a>`).join('');
    const langPill=`<div class="nav-lang-wrap" id="navLangWrap">
      <button class="nav-lang" onclick="BA.toggleLangMenu(event)" aria-haspopup="true" title="Language / 语言"><i class="ph ph-globe-simple"></i><span>${this.lang==='zh'?'中文':'EN'}</span><i class="ph-bold ph-caret-down caret"></i></button>
      <div class="lang-menu">
        <button class="${this.lang==='en'?'on':''}" onclick="BA.setLang('en')">English${this.lang==='en'?'<i class="ph-bold ph-check"></i>':''}</button>
        <button class="${this.lang==='zh'?'on':''}" onclick="BA.setLang('zh')">简体中文${this.lang==='zh'?'<i class="ph-bold ph-check"></i>':''}</button>
      </div>
    </div>`;
    return `
    <nav class="nav" id="nav">
      <div class="nav-inner">
        <a href="index.html" class="nav-logo"><span>Oz</span>Bookings</a>
        <div class="nav-links">${linkHtml}</div>
        <div class="nav-right">
          ${langPill}
          <span class="nav-auth" id="baAuth"></span>
          <a class="nav-cta" href="search.html?city=Sydney">${T('Search stays','搜索住宿')}<i class="ph-bold ph-arrow-up-right"></i></a>
          <button class="burger" aria-label="Menu" onclick="BA.toggleMenu()"><span></span><span></span></button>
        </div>
      </div>
    </nav>
    <div class="nav-overlay">
      ${overlayHtml}
      <a href="search.html?city=Sydney" class="btn btn-coral" onclick="BA.closeMenu()" style="align-self:flex-start;margin-top:24px">${T('Search stays','搜索住宿')}<span class="btn-i"><i class="ph-bold ph-arrow-up-right"></i></span></a>
      <button class="btn btn-outline" onclick="BA.toggleLang()" style="align-self:flex-start;margin-top:14px">${this.lang==='zh'?'Switch to English':'切换到中文'}<span class="btn-i"><i class="ph-bold ph-translate"></i></span></button>
    </div>`;
  },
  updateNavAuth(){
    const el=document.getElementById('baAuth'); if(!el) return;
    if(BA.user){
      el.innerHTML=`<button class="nav-acct" onclick="BA.openSaved()"><i class="ph-fill ph-heart"></i>Saved (${BA.saved.length})</button><button class="nav-signout" onclick="BA.auth.signOut()">Sign out</button>`;
    }else{
      el.innerHTML=`<button class="nav-signin" onclick="BA.openAuth('login')">Sign in</button>`;
    }
  },
  toggleMenu(){document.body.classList.toggle('menu-open')},
  closeMenu(){document.body.classList.remove('menu-open')},

  injectUI(){
    if(document.getElementById('baAuthModal')) return;
    const wrap=document.createElement('div');
    wrap.innerHTML=`
    <div class="ba-modal" id="baAuthModal">
      <div class="ba-card">
        <div class="ba-card-head">
          <button class="ba-close" onclick="BA.closeAuth()"><i class="ph-bold ph-x"></i></button>
          <h3 id="baAuthTitle">Unlock member prices</h3>
          <p id="baAuthSub">Free to join. Members unlock lower, sign-in-only rates on eligible stays.</p>
        </div>
        <div class="ba-body">
          <div class="ba-perks" id="baPerks">
            <div class="ba-perk"><i class="ph-fill ph-tag"></i>Exclusive member-only rates</div>
            <div class="ba-perk"><i class="ph-fill ph-heart"></i>Save trips and rebook in one tap</div>
            <div class="ba-perk"><i class="ph-fill ph-lock-simple-open"></i>Free forever. No booking fees.</div>
          </div>
          <div class="ba-err" id="baErr"></div>
          <div class="ba-ok" id="baOk"></div>
          <div class="fg" id="baNameWrap"><label>Full name</label><input id="baName" placeholder="Alex Nguyen" autocomplete="name"></div>
          <div class="fg"><label>Email</label><input id="baEmail" type="email" placeholder="you@example.com" autocomplete="email"></div>
          <div class="fg"><label>Password</label><input id="baPass" type="password" placeholder="At least 6 characters" autocomplete="current-password"></div>
          <button class="btn btn-coral btn-full" onclick="BA.authSubmit()" style="margin-top:8px"><span id="baSubmitTxt">Create free account</span><span class="btn-i"><i class="ph-bold ph-arrow-right"></i></span></button>
          <div class="ba-or">or</div>
          <button class="btn btn-outline btn-full" onclick="BA.authMagic()"><span>Email me a magic link</span><span class="btn-i"><i class="ph-bold ph-envelope-simple"></i></span></button>
          <div class="ba-alt" id="baAlt"></div>
        </div>
      </div>
    </div>
    <div class="ba-modal" id="baSavedModal">
      <div class="ba-card">
        <div class="ba-card-head"><button class="ba-close" onclick="BA.closeSaved()"><i class="ph-bold ph-x"></i></button><h3>Your saved stays</h3><p id="baSavedSub"></p></div>
        <div class="ba-body" id="baSavedList"></div>
        <div class="ba-body" style="padding-top:0;border-top:1px solid var(--bd)"><button class="nav-signout" onclick="BA.auth.signOut();BA.closeSaved()"><i class="ph ph-sign-out" style="vertical-align:-2px"></i> Sign out</button></div>
      </div>
    </div>
    <div class="ba-toast" id="baToast"><i class="ph-fill ph-check-circle"></i><span id="baToastMsg"></span></div>`;
    document.body.appendChild(wrap);
    [document.getElementById('baAuthModal'),document.getElementById('baSavedModal')].forEach(m=>{
      m.addEventListener('click',e=>{ if(e.target===m){ m.classList.remove('show'); } });
    });
  },
  openAuth(mode){ BA.injectUI(); BA.switchAuth(mode||'signup'); BA.setErr(''); BA.setOk(''); document.getElementById('baAuthModal').classList.add('show'); },
  closeAuth(){ document.getElementById('baAuthModal')?.classList.remove('show'); },
  switchAuth(mode){
    BA.authMode=mode;
    const t=document.getElementById('baAuthTitle'),s=document.getElementById('baAuthSub'),st=document.getElementById('baSubmitTxt'),nw=document.getElementById('baNameWrap'),alt=document.getElementById('baAlt'),perks=document.getElementById('baPerks');
    if(mode==='login'){
      t.textContent='Welcome back'; s.textContent='Sign in to see your member prices and saved trips.'; st.textContent='Sign in';
      nw.style.display='none'; perks.style.display='none';
      alt.innerHTML=`New here? <button onclick="BA.switchAuth('signup')">Create a free account</button>`;
    }else{
      t.textContent='Unlock member prices'; s.textContent='Free to join. Members unlock lower, sign-in-only rates on eligible stays.'; st.textContent='Create free account';
      nw.style.display=''; perks.style.display='';
      alt.innerHTML=`Already a member? <button onclick="BA.switchAuth('login')">Sign in</button>`;
    }
  },
  setErr(m){ const e=document.getElementById('baErr'); if(e){ e.textContent=m; e.classList.toggle('show',!!m); } },
  setOk(m){ const e=document.getElementById('baOk'); if(e){ e.textContent=m; e.classList.toggle('show',!!m); } },
  async authSubmit(){
    BA.setErr(''); BA.setOk('');
    const email=document.getElementById('baEmail').value.trim(), pass=document.getElementById('baPass').value, name=document.getElementById('baName').value.trim();
    if(!email||!pass){ BA.setErr('Enter your email and password.'); return; }
    try{
      if(BA.authMode==='signup'){
        const data=await BA.auth.signUp(email,pass,name);
        if(data.session){ BA.closeAuth(); BA.toast('Welcome! Member prices unlocked'); }
        else{ BA.setOk('Account created. Check your email to confirm, then sign in.'); BA.switchAuth('login'); }
      }else{
        await BA.auth.signIn(email,pass); BA.closeAuth(); BA.toast('Signed in - member prices unlocked');
      }
    }catch(e){ BA.setErr(e.message||'Something went wrong.'); }
  },
  async authMagic(){
    BA.setErr(''); BA.setOk('');
    const email=document.getElementById('baEmail').value.trim();
    if(!email){ BA.setErr('Enter your email for the magic link.'); return; }
    try{ await BA.auth.magic(email); BA.setOk('Magic link sent. Check your email to sign in.'); }
    catch(e){ BA.setErr(e.message||'Could not send link.'); }
  },
  openSaved(){ BA.injectUI(); BA.renderSaved(); document.getElementById('baSavedModal').classList.add('show'); },
  closeSaved(){ document.getElementById('baSavedModal')?.classList.remove('show'); },
  renderSaved(){
    const list=document.getElementById('baSavedList'), sub=document.getElementById('baSavedSub'); if(!list) return;
    if(!BA.saved.length){ list.innerHTML='<p style="color:var(--tx3);font-size:14px;padding:8px 0">No saved stays yet. Tap the heart on any hotel to save it here.</p>'; sub.textContent=''; return; }
    sub.textContent=`${BA.saved.length} stay${BA.saved.length>1?'s':''} saved`;
    list.innerHTML=BA.saved.map(s=>`
      <div class="saved-item">
        <img src="${s.main_photo||'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=200&q=80'}" alt="">
        <div class="si-info"><h4>${s.hotel_name||'Hotel'}</h4><p>${BA.prettyCity(s.city||'')}${s.checkin?' · '+s.checkin+' to '+s.checkout:''}</p></div>
        <a href="search.html?city=${encodeURIComponent(s.city||'Sydney')}&ci=${s.checkin||''}&co=${s.checkout||''}&gu=2" class="btn btn-sm btn-outline" style="padding:8px 10px 8px 14px"><span>Rebook</span><span class="btn-i"><i class="ph-bold ph-arrow-right"></i></span></a>
        <button class="si-rm" onclick="BA.auth.remove('${s.id}')" title="Remove"><i class="ph ph-trash"></i></button>
      </div>`).join('');
  },
  toast(msg){ BA.injectUI(); const t=document.getElementById('baToast'); document.getElementById('baToastMsg').textContent=msg; t.classList.add('show'); clearTimeout(BA._tt); BA._tt=setTimeout(()=>t.classList.remove('show'),2600); },

  // ================= WELCOME OFFER =================
  maybeShowOffer(){
    try{
      if(this.user) return;                                   // already a member
      if(localStorage.getItem('ba_offer_seen')) return;       // permanently claimed/closed
      if(sessionStorage.getItem('ba_offer_dismissed')) return;// dismissed this session
    }catch(e){}
    if(/checkout|confirmation/i.test(location.pathname)) return; // never interrupt a booking
    if(document.getElementById('offerModal')) return;
    const T=this.t.bind(this);
    const img='https://pub.hyperagent.com/api/published/pbf01KWVH07P1_YSHJDMY05643K9FF/eb55320c-cad3-4125-b54c-1665e3028e3b.png';
    const m=document.createElement('div'); m.className='offer-modal'; m.id='offerModal';
    m.innerHTML=`<div class="offer-card">
      <button class="offer-x" onclick="BA.closeOffer()" aria-label="Close"><i class="ph-bold ph-x"></i></button>
      <div class="offer-visual"><img src="${img}" alt="" onerror="this.style.display='none'"><span class="offer-badge">${T('Member offer','会员优惠')}</span></div>
      <div class="offer-body">
        <div class="offer-kicker">${T('Join OzBookings - free','加入 OzBookings · 免费')}</div>
        <h3>${T('Unlock member rates on your stay','解锁会员专享直订价')}</h3>
        <p>${T('Create a free account and unlock member-only direct rates - below the public price, on this booking and every stay after.','创建免费账户，解锁会员专享直订价--低于公开价格，首单及此后每一单均享。')}</p>
        <ul class="offer-perks">
          <li><i class="ph-fill ph-tag"></i>${T('Member-only rates on eligible stays','符合条件住宿的会员专享价')}</li>
          <li><i class="ph-fill ph-lock-simple-open"></i>${T('Free forever - no booking fees','永久免费 · 无预订手续费')}</li>
          <li><i class="ph-fill ph-heart"></i>${T('Save your trips and rebook in a tap','收藏行程，一键再订')}</li>
        </ul>
        <button class="btn btn-coral btn-full" onclick="BA.claimOffer()"><span>${T('Unlock my member rate','解锁我的会员价')}</span><span class="btn-i"><i class="ph-bold ph-arrow-right"></i></span></button>
        <button class="offer-later" onclick="BA.closeOffer()">${T('Maybe later','以后再说')}</button>
      </div>
    </div>`;
    m.addEventListener('click',e=>{ if(e.target===m) BA.closeOffer(); });
    document.body.appendChild(m);
    requestAnimationFrame(()=>m.classList.add('show'));
  },
  closeOffer(){ const m=document.getElementById('offerModal'); if(m){ m.classList.remove('show'); setTimeout(()=>{ try{m.remove();}catch(e){} },500); } try{ sessionStorage.setItem('ba_offer_dismissed','1'); }catch(e){} },
  claimOffer(){ try{ localStorage.setItem('ba_offer_seen','1'); }catch(e){} this.closeOffer(); this.openAuth('signup'); },

  // ---- common init ----
  init(){
    try{ document.documentElement.lang = this.lang==='zh' ? 'zh-CN' : 'en'; }catch(e){}
    // Vercel Web Analytics + Speed Insights (same-origin proxied scripts; injected once)
    try{ ['/_vercel/insights/script.js','/_vercel/speed-insights/script.js'].forEach(src=>{ if(document.querySelector('script[data-va="'+src+'"]')) return; const s=document.createElement('script'); s.defer=true; s.src=src; s.setAttribute('data-va',src); document.head.appendChild(s); }); }catch(e){}
    // Google Analytics 4 (gtag) - injected once, on every page
    try{ if(!window.__ga4){ window.__ga4=1; var gj=document.createElement('script'); gj.async=true; gj.src='https://www.googletagmanager.com/gtag/js?id=G-5TTGG45RS7'; document.head.appendChild(gj); window.dataLayer=window.dataLayer||[]; window.gtag=function(){dataLayer.push(arguments);}; gtag('js', new Date()); gtag('config','G-5TTGG45RS7'); } }catch(e){}
    this.loadCJK();
    const ro=new IntersectionObserver(e=>{e.forEach(x=>{if(x.isIntersecting){x.target.classList.add('visible');ro.unobserve(x.target)}})},{threshold:.1,rootMargin:'0px 0px -8% 0px'});
    document.querySelectorAll('.reveal:not(.visible)').forEach(el=>ro.observe(el));
    document.querySelectorAll('.btn:not([data-mag])').forEach(b=>{
      b.setAttribute('data-mag','1');
      b.addEventListener('mousemove',e=>{const r=b.getBoundingClientRect();b.style.transform=`translate(${(e.clientX-r.left-r.width/2)*.12}px,${(e.clientY-r.top-r.height/2)*.12}px)`});
      b.addEventListener('mouseleave',()=>{b.style.transform='';b.style.transition='transform 500ms cubic-bezier(.32,.72,0,1)'});
      b.addEventListener('mouseenter',()=>{b.style.transition='transform 100ms ease-out'});
    });
    if(!this._wired){
      this._wired=true;
      BA.injectUI();
      BA.auth.init();
      window.addEventListener('scroll',()=>{const n=document.getElementById('nav');if(n)n.classList.toggle('scrolled',window.scrollY>40)},{passive:true});
      document.addEventListener('keydown',e=>{if(e.key==='Escape'){this.closeMenu();this.closeAuth();this.closeSaved();document.getElementById('navLangWrap')?.classList.remove('open');}});
      document.addEventListener('click',e=>{const w=document.getElementById('navLangWrap');if(w&&!e.target.closest('#navLangWrap'))w.classList.remove('open');});
      // Member offer: show on genuine intent (exit-intent or ~50% scroll), once - not an on-load interstitial
      (function armOffer(){
        try{ if(/checkout|confirmation/i.test(location.pathname)) return;
             if(localStorage.getItem('ba_offer_seen')||sessionStorage.getItem('ba_offer_dismissed')) return; }catch(e){}
        var done=false;
        function fire(){ if(done) return; done=true; cleanup(); try{ BA.maybeShowOffer(); }catch(e){} }
        function onScroll(){ var sc=window.scrollY||document.documentElement.scrollTop||0; var h=document.documentElement.scrollHeight-window.innerHeight; if(h>400 && sc/h>=0.5) fire(); }
        function onExit(e){ if((e.clientY||0)<=0) fire(); }
        function cleanup(){ window.removeEventListener('scroll',onScroll); document.removeEventListener('mouseout',onExit); }
        window.addEventListener('scroll',onScroll,{passive:true});
        document.addEventListener('mouseout',onExit);
        setTimeout(fire, 60000); // last-resort fallback: appears once, unobtrusively
      })();
    }
  },

  renderFooter(){
    return `
    <footer class="ft">
      <div class="wrap">
        <div class="ft-g">
          <div class="ft-brand"><h3><span>Oz</span>Bookings</h3><p>Compare hotel prices across Australia and book direct. Members save even more.</p><div class="ft-social" style="display:flex;gap:12px;margin-top:18px"><a href="https://www.instagram.com/ozbookings/" target="_blank" rel="noopener noreferrer" aria-label="OzBookings on Instagram" style="width:40px;height:40px;border:1px solid var(--bd);border-radius:50%;display:grid;place-items:center;color:var(--tx2);font-size:19px;text-decoration:none"><i class="ph ph-instagram-logo"></i></a><a href="https://www.tiktok.com/@ozbookings" target="_blank" rel="noopener noreferrer" aria-label="OzBookings on TikTok" style="width:40px;height:40px;border:1px solid var(--bd);border-radius:50%;display:grid;place-items:center;color:var(--tx2);font-size:19px;text-decoration:none"><i class="ph ph-tiktok-logo"></i></a></div></div>
          <div class="ft-col"><h4>Destinations</h4><a href="/hotels-in-sydney">Sydney</a><a href="/hotels-in-melbourne">Melbourne</a><a href="/hotels-in-gold-coast">Gold Coast</a><a href="/hotels-in-cairns">Cairns</a><a href="/hotels-in-brisbane">Brisbane</a><a href="/hotels-in-perth">Perth</a><a href="/hotels-in-adelaide">Adelaide</a><a href="/hotels-in-hobart">Hobart</a></div>
          <div class="ft-col"><h4>Company</h4><a href="about.html">About us</a><a href="index.html#how-it-works">How it works</a><a href="index.html#value">Why book direct</a><a href="/book-direct-vs-booking-sites">Book direct vs OTAs</a><a href="/how-to-avoid-hotel-booking-fees-australia">Avoid booking fees</a><a href="contact.html">Contact</a></div>
          <div class="ft-col"><h4>${this.t('Support','支持')}</h4><a href="help.html">${this.t('Help centre','帮助中心')}</a><a href="/free-cancellation-hotels-australia">${this.t('Free cancellation','免费取消')}</a><a href="terms.html#cancellation">${this.t('Cancellation policy','取消政策')}</a><a href="privacy.html">${this.t('Privacy policy','隐私政策')}</a><a href="contact.html">${this.t('Contact','联系我们')}</a></div>
        </div>
        <div class="ft-bot"><span>&copy; 2026 OzBookings</span><span>Rates powered by LiteAPI</span></div>
      </div>
    </footer>`;
  },

  skeletonCards(n=6){
    let h='';
    for(let i=0;i<n;i++) h+=`<div class="dbc dbc-static"><div class="dbc-in"><div class="skel skel-img"></div><div style="padding:18px 20px"><div class="skel skel-title"></div><div class="skel skel-text" style="width:80%"></div><div class="skel skel-text" style="width:50%"></div></div></div></div>`;
    return h;
  }
};

document.addEventListener('DOMContentLoaded',()=>BA.init());
