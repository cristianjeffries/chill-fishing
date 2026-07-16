// Storage: use the host's window.storage if present (e.g. Claude), else fall back to localStorage for standalone/local use.
if(typeof window!=='undefined'&&typeof window.storage==='undefined'){
  window.storage={
    async get(k){try{const v=localStorage.getItem(k);return v==null?null:{key:k,value:v};}catch(e){return null;}},
    async set(k,v){try{localStorage.setItem(k,v);}catch(e){}return {key:k,value:v};},
    async delete(k){try{localStorage.removeItem(k);}catch(e){}return {key:k,deleted:true};},
    async list(p){try{return {keys:Object.keys(localStorage).filter(x=>!p||x.startsWith(p))};}catch(e){return {keys:[]};}}
  };
}
const canvas=document.getElementById('canvas');
const ctx=canvas.getContext('2d');
const CW=680,CH=410,WY=205,WW=8000,LW=130;
const HUD_H=40;
const WATER_DEPTH=700;
const SEA_BOTTOM=WY+WATER_DEPTH;
const DPR=Math.min(window.devicePixelRatio||1,2);
const DISP=1120; // on-screen width in CSS px; logical drawing stays CW x CH so no layout changes
canvas.width=Math.round(DISP*DPR);canvas.height=Math.round(DISP*(CH/CW)*DPR);
{const s=DISP*DPR/CW;ctx.scale(s,s);}ctx.imageSmoothingEnabled=true;
const SAVE_KEY='fishing_v10';

// ── Day/Night ──
// DAY_DUR=300s, NIGHT_DUR=180s  (real seconds)
const DAY_DUR=300, NIGHT_DUR=180, FULL_CYCLE=DAY_DUR+NIGHT_DUR;
let timeOfDay=0; // 0..FULL_CYCLE
function isDaytime(){return timeOfDay<DAY_DUR;}
function dayFraction(){return Math.min(1,timeOfDay/DAY_DUR);}// 0=dawn,1=dusk
function nightFraction(){if(isDaytime())return 0;return(timeOfDay-DAY_DUR)/NIGHT_DUR;}
function skyAlpha(){
  // 0=full day, 1=full night
  const t=timeOfDay/FULL_CYCLE; // 0..1
  const angle=t*Math.PI*2;
  return Math.max(0,(Math.cos(angle)+1)/2*0.88);// peaks at 0 (midnight) and 0 (noon)
  // Actually: noon=t=0, dusk=t=0.5*(DAY_DUR/FULL_CYCLE)
}
const TUTORIAL_PAGES=[
  {title:'\ud83c\udfa3 Welcome to Chill Fishing',html:'<p class="intro-p">You\'re a fisherman with a simple goal: <b>collect as many different species of fish as you can.</b></p><p class="intro-p">Sail out, explore deeper zones, upgrade or swap your boat, and keep an eye out for rare fish that only surface during special events \u2014 like storms.</p>'},
  {title:'Getting around',html:'<ul class="intro-list"><li><b>A / D</b> or <b>\u2190 / \u2192</b> \u2014 sail your boat</li><li><b>Hold Space</b> \u2014 charge a cast</li><li><b>W / S</b> or <b>\u2191 / \u2193</b> \u2014 aim your casting depth</li><li><b>Release Space</b> \u2014 cast your line</li></ul>'},
  {title:'Reeling & menus',html:'<ul class="intro-list"><li><b>Space</b> \u2014 reel in when a fish bites</li><li><b>R</b> \u2014 retrieve your line</li><li><b>Esc</b> \u2014 open the menu</li><li>Use the side <b>drawer</b> for quests, journal & cargo</li></ul><p class="intro-p" style="text-align:center;margin-top:14px;">Good luck, and have fun! \ud83d\udc1f</p>'}
];
let tutorialPage=0,tutorialMode='intro';
function openTutorial(mode){tutorialMode=mode;tutorialPage=0;introOpen=true;if(mode==='review')document.getElementById('pause-menu').classList.add('hidden');document.getElementById('intro-overlay').classList.add('open');renderTutorialPage();}
function renderTutorialPage(){
  const p=TUTORIAL_PAGES[tutorialPage],last=tutorialPage>=TUTORIAL_PAGES.length-1;
  document.getElementById('tut-title').innerHTML=p.title;
  document.getElementById('tut-content').innerHTML=p.html;
  document.getElementById('tut-prev').style.visibility=tutorialPage>0?'visible':'hidden';
  document.getElementById('tut-next').style.display=last?'none':'';
  const sb=document.getElementById('tut-start');sb.style.display=last?'':'none';sb.textContent=tutorialMode==='review'?'Done':'Start fishing';
  document.getElementById('tut-close').style.display=tutorialMode==='review'?'':'none';
  document.getElementById('tut-dots').innerHTML=TUTORIAL_PAGES.map((_,i)=>`<span class="tut-dot${i===tutorialPage?' on':''}"></span>`).join('');
}
function tutorialGo(dir){tutorialPage=Math.max(0,Math.min(TUTORIAL_PAGES.length-1,tutorialPage+dir));renderTutorialPage();}
function finishTutorial(){document.getElementById('intro-overlay').classList.remove('open');introOpen=false;if(tutorialMode==='intro')tutorialSeen.intro=true;else document.getElementById('pause-menu').classList.remove('hidden');}
function closeTutorialReview(){document.getElementById('intro-overlay').classList.remove('open');introOpen=false;document.getElementById('pause-menu').classList.remove('hidden');}
function devResetTutorial(){tutorialSeen={};setMsg('Tutorial reset \u2014 will show on next New Game');}
function devResetSave(){resetNewGame();tutorialSeen={};saveGame();setMsg('Save reset to a fresh game');}
function makeBolt(){
  let x=CW*(0.2+Math.random()*0.6);const segs=6+Math.floor(Math.random()*4),endY=WY-8;const pts=[[x,-6]];
  for(let i=1;i<=segs;i++){const y=endY*i/segs;x+=(Math.random()-0.5)*46;pts.push([x,y]);}
  let branch=null;if(Math.random()<0.6){const bi=2+Math.floor(Math.random()*Math.max(1,segs-2)),bp=pts[bi];branch=[[bp[0],bp[1]],[bp[0]+(Math.random()<0.5?-1:1)*(20+Math.random()*30),bp[1]+28+Math.random()*30]];}
  return {pts,branch,life:0.16};
}
function strikeLightning(allowDouble){lightningBolt=makeBolt();lightningFlash=1;if(allowDouble&&Math.random()<0.4)lightningNext=0.12+Math.random()*0.22;}
function updateWeather(dt){
  const playing=gameMode==='play';
  // Progression (scheduler, transitions, storm spawn/despawn, new lightning) only advances during play.
  // In the menu the weather freezes in place but its particles keep animating so it stays alive.
  if(playing){
    if(!devWeatherLock){weatherTimer-=dt;if(weatherTimer<=0){
      if(weather==='clear'){const r=Math.random();weather=r<0.5?'rain':(r<0.85?'fog':'storm');weatherTimer=28+Math.random()*30;}
      else{weather='clear';weatherTimer=100+Math.random()*110;}}}
    weatherAmt+=((weather==='clear'?0:1)-weatherAmt)*Math.min(1,dt*0.5);
    if(weather!=='clear')weatherFx=weather;else if(weatherAmt<0.02)weatherFx='clear';
    if(weather==='storm'&&!stormActive){stormActive=true;lightningTimer=3+Math.random()*4;lightningBolt=null;lightningNext=0;spawnStormFish();}else if(weather!=='storm'&&stormActive){stormActive=false;despawnStormFish();}
    if(weatherFx==='storm'){lightningTimer-=dt;if(lightningTimer<=0){strikeLightning(true);lightningTimer=8+Math.random()*8;}if(lightningNext>0){lightningNext-=dt;if(lightningNext<=0){strikeLightning(false);lightningNext=0;}}}
  }
  // Let any in-progress flash/bolt finish fading even in the menu (avoids a frozen white frame),
  // but no NEW strikes are scheduled while paused.
  if(lightningFlash>0)lightningFlash-=dt*3.2;
  if(lightningBolt){lightningBolt.life-=dt;if(lightningBolt.life<=0)lightningBolt=null;}
  // Particles animate in both play and menu.
  if(weatherFx==='rain'||weatherFx==='storm'){for(const d of rainDrops){d.y+=d.spd*dt;d.x-=d.spd*0.28*dt;
    if(d.y>=WY){if(d.x>=0&&d.x<=CW&&rainSplashes.length<55&&Math.random()<0.6)rainSplashes.push({wx:d.x+camX,t:0});d.y=-10;d.x=Math.random()*(CW*1.3);}
    if(d.x<-20)d.x+=CW+40;}}
  for(let i=rainSplashes.length-1;i>=0;i--){rainSplashes[i].t+=dt;if(rainSplashes[i].t>0.45)rainSplashes.splice(i,1);}
}
function drawWeather(){
  if(weatherAmt<0.01)return;const a=weatherAmt;
  if(weatherFx==='rain'||weatherFx==='storm'){
    const storm=weatherFx==='storm';
    ctx.fillStyle=storm?`rgba(20,28,48,${0.36*a})`:`rgba(40,55,80,${0.18*a})`;ctx.fillRect(0,0,CW,CH);
    ctx.strokeStyle=storm?`rgba(198,212,236,${0.6*a})`:`rgba(185,208,232,${0.5*a})`;ctx.lineWidth=storm?1.5:1.2;ctx.beginPath();
    for(const d of rainDrops){if(d.y>=WY)continue;const ey=Math.min(d.y+d.len,WY);ctx.moveTo(d.x,d.y);ctx.lineTo(d.x-(ey-d.y)*0.28,ey);}ctx.stroke();
    // surface impact splashes
    for(const s of rainSplashes){const sx=s.wx-camX;if(sx<-8||sx>CW+8)continue;const p=s.t/0.45,rr=1+p*5,al=(1-p)*0.55*a;ctx.strokeStyle=`rgba(210,228,245,${al})`;ctx.lineWidth=1;ctx.beginPath();ctx.arc(sx,WY,rr,Math.PI,Math.PI*2);ctx.stroke();}
    // lightning: brief flash, then a visible bolt on top
    if(storm){
      if(lightningFlash>0){ctx.fillStyle=`rgba(232,240,255,${Math.min(1,lightningFlash)*0.5*a})`;ctx.fillRect(0,0,CW,CH);}
      if(lightningBolt){const bl=Math.min(1,lightningBolt.life/0.16);ctx.save();ctx.strokeStyle=`rgba(236,243,255,${0.95*bl*a})`;ctx.lineWidth=2.2;ctx.shadowColor='rgba(190,215,255,0.9)';ctx.shadowBlur=14;const p=lightningBolt.pts;ctx.beginPath();ctx.moveTo(p[0][0],p[0][1]);for(let i=1;i<p.length;i++)ctx.lineTo(p[i][0],p[i][1]);ctx.stroke();if(lightningBolt.branch){const b2=lightningBolt.branch;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(b2[0][0],b2[0][1]);ctx.lineTo(b2[1][0],b2[1][1]);ctx.stroke();}ctx.restore();}
    }
  }else if(weatherFx==='fog'){
    // light haze over the near scene
    ctx.fillStyle=`rgba(226,231,236,${0.30*a})`;ctx.fillRect(0,0,CW,WY);
    // slight murk tint in the water
    ctx.fillStyle=`rgba(202,215,223,${0.20*a})`;ctx.fillRect(0,WY,CW,CH-WY);
  }
}
function devSetWeather(w){if(w==='auto'){devWeatherLock=false;setMsg('Weather: auto');return;}devWeatherLock=true;weather=w;setMsg('Weather forced: '+w);}
function hexToRgb(h){return {r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)};}
let waterRGB=null;
function currentWaterColor(nightOv){const w=waterRGB||hexToRgb(zoneAt(boat.x).waterColor);const fr=1-nightOv*0.6,fg=1-nightOv*0.6,fb=1-nightOv*0.4;return `rgb(${Math.round(w.r*fr)},${Math.round(w.g*fg)},${Math.round(w.b*fb)})`;}
function getNightOverlay(){
  // 0=full day, 1=full night
  const d=DAY_DUR,n=NIGHT_DUR,fc=FULL_CYCLE;
  const t=timeOfDay;
  if(t<d*0.7)return 0;
  if(t<d)return(t-d*0.7)/(d*0.3); // dusk fade in
  if(t<d+n*0.8)return 1;           // full night
  return 1-(t-(d+n*0.8))/(n*0.2);  // dawn fade out
}
function getTimeLabel(){
  const ov=getNightOverlay();
  if(ov<0.15)return{icon:'☀️',label:'Day'};
  if(ov<0.5)return{icon:'🌅',label:'Dusk'};
  if(ov<0.85)return{icon:'🌙',label:'Night'};
  return{icon:'🌄',label:'Dawn'};
}

// ── Upgrade defs ──
const UPG_DEFS={
  rod:  {label:'Better rod',   desc:'Wider reel zone',        cost:[30,80,180], max:3,icon:'🎣'},
  bait: {label:'Premium bait', desc:'Fish bite faster',       cost:[25,70,150], max:3,icon:'🪱'},
  depth:{label:'Deep-sea line',desc:'Increases max depth',    cost:[50,130,280],max:3,icon:'⚓'},
};
const BOAT_DEFS=[
  {id:'trawler',  label:'Trawler',   desc:'Slow · huge hold', speed:105,hold:24,cost:250},
  {id:'skiff',    label:'Skiff',     desc:'Balanced',         speed:170,hold:12,cost:0},
  {id:'speedboat',label:'Speedboat', desc:'Fast · tiny hold', speed:280,hold:5, cost:400},
];
let ownedBoats={skiff:true,trawler:false,speedboat:false};
let hasAutopilot=false;let autoTravelTarget=null;let autoTravelActive=false;let travelDests=[];let travelIdx=0;
let weather='clear',weatherFx='clear',weatherAmt=0,weatherTimer=80+Math.random()*80,devWeatherLock=false;
let stormActive=false,lightningFlash=0,lightningTimer=0,lightningNext=0,lightningBolt=null;
let tutorialSeen={},activeHint=null,hintTimeout=null,pendingIntro=false,introOpen=false;
let devUnlocked=false,devSeq='',devSeqT=0;
// ---- Harbor scene ----
const HARBOR_W=1600,HARBOR_MIN=120,HARBOR_MAX=1540,HARBOR_WATER='#3f7fa8';
const HARBOR_BUILDINGS=[
  {id:'shop', wx:300, w:84, h:96, wall:'#E4A94E',roof:'#8a3b2e',flag:'#d98a3a',sign:'SHOP', label:'Supply Shop'},
  {id:'ships',wx:560, w:98, h:112,wall:'#4E9BB0',roof:'#2e5a6a',flag:'#3a7d94',sign:'SHIPS',label:'Shipwright'},
  {id:'nav',  wx:940, w:74, h:146,wall:'#C65D57',roof:'#6a2e2e',flag:'#d0473e',sign:'NAV',  label:'Harbormaster'},
  {id:'fish', wx:1300,w:126,h:116,wall:'#5BB08A',roof:'#2e6a4f',flag:'#39b07f',sign:'FISH', label:'Fishmonger',big:true}
]
let harborNear=null,harborAtExit=false,sceneFade=0,fadePhase=null,fadeAction=null;
const rainDrops=Array.from({length:90},()=>({x:Math.random()*CW,y:Math.random()*WY,len:8+Math.random()*10,spd:430+Math.random()*260}));
const rainSplashes=[];
let activeBoat='skiff';
function boatDef(){return BOAT_DEFS.find(b=>b.id===activeBoat)||BOAT_DEFS[1];}
const ZONE_DEFS=[
  {id:'shallow',label:'Shallow Bay', wx:LW,  endWx:2000,fishMult:1.0,waterColor:'#2a7cbf',skyTint:'#cce8f8',cost:0,  reqLv:1},
  {id:'deep',   label:'Deep Sea',    wx:2000,endWx:4000,fishMult:2.5,waterColor:'#185FA5',skyTint:'#b8d4ee',cost:80, reqLv:5},
  {id:'reef',   label:'Coral Reef',  wx:4000,endWx:6000,fishMult:4.0,waterColor:'#1a6e55',skyTint:'#b8e8d8',cost:200,reqLv:10},
  {id:'abyss',  label:'The Abyss',   wx:6000,endWx:WW,  fishMult:8.0,waterColor:'#042C53',skyTint:'#8aaccc',cost:500,reqLv:18},
];

// ── Fish defs (day + night) ──
const FISH_DEFS=[
  // Day fish
  {name:'Minnow',       emoji:'🐟',sizeLabel:'Tiny',    cmRange:[4,8],    rarity:.35,speed:.28,baseVal:3,  xpMult:1,  color:'#85B7EB',len:15,zones:['shallow','deep','reef'],reelBehavior:'normal', legendary:false,night:false,desc:'A small silvery fish that darts through shallows.'},
  {name:'Bass',         emoji:'🐠',sizeLabel:'Medium',  cmRange:[20,35],  rarity:.25,speed:.48,baseVal:8,  xpMult:1.5,color:'#F0997B',len:23,zones:['shallow','deep','reef'],reelBehavior:'normal', legendary:false,night:false,desc:'A prized game fish with a strong fight.'},
  {name:'Carp',         emoji:'🎣',sizeLabel:'Large',   cmRange:[30,60],  rarity:.18,speed:.62,baseVal:14, xpMult:2,  color:'#C0DD97',len:27,zones:['shallow','deep'],       reelBehavior:'normal', legendary:false,night:false,desc:'A bottom-feeder with surprising bulk.'},
  {name:'Catfish',      emoji:'🐡',sizeLabel:'Large',   cmRange:[35,70],  rarity:.14,speed:.60,baseVal:24, xpMult:2.5,color:'#AFA9EC',len:33,zones:['deep','reef'],          reelBehavior:'tank',   legendary:false,night:false,desc:'A whiskered bruiser of the deep.'},
  {name:'Swordfish',    emoji:'🦈',sizeLabel:'XLarge',  cmRange:[80,150], rarity:.10,speed:1.3,baseVal:35, xpMult:3,  color:'#378ADD',len:38,zones:['deep','abyss'],         reelBehavior:'zigzag', legendary:false,night:false,desc:'A razor-billed speedster that zigzags violently.'},
  {name:'Clownfish',    emoji:'🤿',sizeLabel:'Small',   cmRange:[8,14],   rarity:.20,speed:.42,baseVal:18, xpMult:2,  color:'#EF9F27',len:18,zones:['reef'],                 reelBehavior:'normal', legendary:false,night:false,desc:'Bright stripes hide in the reef.'},
  {name:'Parrotfish',   emoji:'🦜',sizeLabel:'Medium',  cmRange:[25,45],  rarity:.14,speed:.72,baseVal:40, xpMult:3,  color:'#97C459',len:28,zones:['reef'],                 reelBehavior:'zigzag', legendary:false,night:false,desc:'A reef grazier with a hard beak and erratic dashes.'},
  {name:'Lionfish',     emoji:'🦁',sizeLabel:'Large',   cmRange:[30,55],  rarity:.08,speed:.95,baseVal:65, xpMult:4,  color:'#D4537E',len:34,zones:['reef','abyss'],         reelBehavior:'burst',  legendary:false,night:false,desc:'Venomous spines and explosive bursts of speed.'},
  {name:'Anglerfish',   emoji:'👾',sizeLabel:'XLarge',  cmRange:[50,90],  rarity:.12,speed:.85,baseVal:100,xpMult:5,  color:'#3C3489',len:40,zones:['abyss'],                reelBehavior:'tank',   legendary:false,night:false,desc:'A nightmare from the deep. Its lure light draws prey.'},
  {name:'Giant Squid',  emoji:'🦑',sizeLabel:'Huge',    cmRange:[100,300],rarity:.08,speed:1.4,baseVal:150,xpMult:6,  color:'#533AB7',len:45,zones:['abyss'],                reelBehavior:'zigzag', legendary:false,night:false,desc:'Tentacles everywhere. Pulls violently side to side.'},
  {name:'Sea Monster',  emoji:'🐉',sizeLabel:'Colossal',cmRange:[200,500],rarity:.04,speed:1.7,baseVal:300,xpMult:8,  color:'#26215C',len:55,zones:['abyss'],                reelBehavior:'burst',  legendary:false,night:false,desc:'Ancient and massive. Bursts of raw power.'},
  // Legendaries
  {name:'Golden Koi',   emoji:'✨',sizeLabel:'Large',   cmRange:[40,70],  rarity:.03,speed:1.0,baseVal:200,xpMult:10, color:'#FAC775',len:38,zones:['shallow'],              reelBehavior:'zigzag', legendary:true, night:false,desc:'A mythic golden fish said to grant luck.'},
  {name:'Azure Marlin', emoji:'💙',sizeLabel:'Huge',    cmRange:[120,200],rarity:.02,speed:1.5,baseVal:400,xpMult:12, color:'#0C447C',len:50,zones:['deep'],                 reelBehavior:'burst',  legendary:true, night:false,desc:'The pride of the deep sea. Explosive bursts.'},
  {name:'Phantom Ray',  emoji:'👻',sizeLabel:'XLarge',  cmRange:[80,140], rarity:.02,speed:1.2,baseVal:600,xpMult:15, color:'#533AB7',len:48,zones:['reef'],                 reelBehavior:'tank',   legendary:true, night:false,desc:'Glides silently through the reef.'},
  {name:'Leviathan',    emoji:'🌊',sizeLabel:'Colossal',cmRange:[500,999],rarity:.01,speed:1.9,baseVal:1500,xpMult:25,color:'#042C53',len:60,zones:['abyss'],               reelBehavior:'burst',  legendary:true, night:false,desc:'A creature of legend. The ocean itself resists.'},
  // Night-only fish (replace daytime spawns when night)
  {name:'Moonfish',     emoji:'🌙',sizeLabel:'Medium',  cmRange:[18,32],  rarity:.30,speed:.55,baseVal:22, xpMult:3,  color:'#c8d8f5',len:22,zones:['shallow','deep'],       reelBehavior:'normal', legendary:false,night:true, desc:'A pale, iridescent fish that only surfaces after dark.'},
  {name:'Gloweel',      emoji:'🌟',sizeLabel:'Large',   cmRange:[40,80],  rarity:.22,speed:.70,baseVal:45, xpMult:4,  color:'#8be8c8',len:32,zones:['deep','reef'],          reelBehavior:'zigzag', legendary:false,night:true, desc:'A bioluminescent eel that streaks through dark waters.'},
  {name:'Void Crab',    emoji:'🦀',sizeLabel:'Large',   cmRange:[20,40],  rarity:.18,speed:.80,baseVal:70, xpMult:5,  color:'#6644bb',len:30,zones:['abyss','reef'],         reelBehavior:'tank',   legendary:false,night:true, desc:'Armored and furious. Drags sideways against the line.'},
  {name:'Starjelly',    emoji:'⭐',sizeLabel:'Small',   cmRange:[8,16],   rarity:.15,speed:.35,baseVal:55, xpMult:4,  color:'#ffd580',len:20,zones:['shallow','reef'],        reelBehavior:'normal', legendary:false,night:true, desc:'A bioluminescent jellyfish that pulses like a star.'},
  {name:'Shadow Drake', emoji:'🐲',sizeLabel:'Colossal',cmRange:[300,600],rarity:.05,speed:1.8,baseVal:800,xpMult:20, color:'#1a0a3a',len:58,zones:['abyss'],                reelBehavior:'burst',  legendary:true, night:true, desc:'A nightmarish serpent glimpsed only by moonlight. Extraordinarily rare.'},
  // Deep-dwelling species (fill the lower water)
  {name:'Bluefin Tuna', emoji:'🐟',sizeLabel:'Huge',    cmRange:[150,300],rarity:.13,speed:1.4,baseVal:120,xpMult:5,  color:'#2E6DB4',len:74,zones:['deep'],         reelBehavior:'burst',  legendary:false,night:false,desc:'A colossal open-water torpedo that explodes into long runs.'},
  {name:'Giant Halibut',emoji:'🐡',sizeLabel:'Huge',    cmRange:[100,250],rarity:.12,speed:.5, baseVal:90, xpMult:4,  color:'#8A8370',len:72,zones:['deep'],         reelBehavior:'tank',   legendary:false,night:false,desc:'An enormous flatfish that hugs the seabed like dead weight.'},
  {name:'Giant Grouper',emoji:'🐠',sizeLabel:'Huge',    cmRange:[120,270],rarity:.11,speed:.55,baseVal:130,xpMult:5,  color:'#6B7A4A',len:78,zones:['reef'],         reelBehavior:'tank',   legendary:false,night:false,desc:'A massive reef-wall predator: slow, stubborn and immense.'},
  {name:'Moray Eel',    emoji:'🐍',sizeLabel:'Large',   cmRange:[80,150], rarity:.16,speed:.8, baseVal:70, xpMult:3.5,color:'#5F7D3A',len:56,zones:['reef'],         reelBehavior:'zigzag', legendary:false,night:false,desc:'A muscular eel that thrashes out of deep reef crevices.'},
  {name:'Frilled Shark',emoji:'🦈',sizeLabel:'XLarge',  cmRange:[120,200],rarity:.12,speed:.9, baseVal:180,xpMult:6,  color:'#4A4038',len:72,zones:['abyss'],        reelBehavior:'tank',   legendary:false,night:false,desc:'A serpentine living-fossil shark from the lightless deep.'},
  {name:'Gulper Eel',   emoji:'🐊',sizeLabel:'Large',   cmRange:[60,180], rarity:.14,speed:1.0,baseVal:150,xpMult:5.5,color:'#2B2540',len:62,zones:['abyss'],        reelBehavior:'burst',  legendary:false,night:false,desc:'All mouth and shadow, ballooning open to swallow the dark.'},
  {name:'Gloommaw',     emoji:'🐙',sizeLabel:'Colossal',cmRange:[250,450],rarity:.05,speed:1.6,baseVal:550,xpMult:14, color:'#0D0A1E',len:104,zones:['abyss'],        reelBehavior:'burst',  legendary:false,night:true, desc:'A nightmare that unfolds from the trench floor. Few glimpse its maw and return.'},
  // Storm-only fish (appear only during storms; off-model shapes)
  {name:'Squall Ribbon',    emoji:'🎏',sizeLabel:'Long',  cmRange:[60,95],  rarity:.16,speed:.9, baseVal:120,xpMult:6, color:'#7FD4E8',len:26,wr:1.55,hr:0.45,zones:['shallow'],reelBehavior:'zigzag',legendary:false,night:false,stormFish:true,desc:'A ribbon of a fish that only rides in on shallow squalls.'},
  {name:'Gale Puffer',      emoji:'🐡',sizeLabel:'Small', cmRange:[18,30],  rarity:.18,speed:.5, baseVal:95, xpMult:5, color:'#F5C86B',len:16,wr:1.0, hr:1.85,zones:['shallow'],reelBehavior:'burst', legendary:false,night:false,stormFish:true,desc:'Puffs up fat and round when the wind picks up.'},
  {name:'Thunder Lancet',   emoji:'🗡️',sizeLabel:'Long',  cmRange:[80,130], rarity:.13,speed:1.4,baseVal:220,xpMult:7, color:'#9FB0FF',len:30,wr:1.7, hr:0.4, zones:['deep'],   reelBehavior:'burst', legendary:false,night:false,stormFish:true,desc:'A needle-thin hunter that streaks through storm currents.'},
  {name:'Gale Sunfish',     emoji:'🌕',sizeLabel:'Big',   cmRange:[70,110], rarity:.12,speed:.35,baseVal:260,xpMult:8, color:'#C9D2E0',len:30,wr:0.85,hr:1.7, zones:['deep'],   reelBehavior:'tank',  legendary:false,night:false,stormFish:true,desc:'A great pale disc that drifts up from the deep during storms.'},
  {name:'Tempest Angel',    emoji:'🐠',sizeLabel:'Tall',  cmRange:[35,60],  rarity:.14,speed:.75,baseVal:240,xpMult:7, color:'#FF9AD5',len:24,wr:0.8, hr:1.65,zones:['reef'],   reelBehavior:'zigzag',legendary:false,night:false,stormFish:true,desc:'Its tall fins flare like sails in a tempest.'},
  {name:'Voltfin Eel',      emoji:'⚡',sizeLabel:'Long',  cmRange:[90,140], rarity:.11,speed:1.1,baseVal:300,xpMult:8, color:'#8CE0C4',len:32,wr:1.6, hr:0.5, zones:['reef'],   reelBehavior:'zigzag',legendary:false,night:false,stormFish:true,desc:'Crackles with static as reef storms roll through.'},
  {name:'Maelstrom Serpent',emoji:'🐉',sizeLabel:'Colossal',cmRange:[140,220],rarity:.07,speed:.9,baseVal:520,xpMult:16,color:'#6E7BE0',len:44,wr:1.45,hr:0.6, zones:['abyss'],  reelBehavior:'tank',  legendary:true, night:false,stormFish:true,desc:'A colossal serpent said to rise only in the fiercest abyssal storms.'},
  {name:'Stormgulper',      emoji:'🐡',sizeLabel:'Big',   cmRange:[60,100], rarity:.10,speed:.55,baseVal:340,xpMult:9, color:'#9AA6C8',len:28,wr:1.05,hr:1.7, zones:['abyss'],  reelBehavior:'tank',  legendary:false,night:false,stormFish:true,desc:'A bloated deep-sea maw that swells in the dark storm water.'},
];
// Depth bands: surface dwellers up top, heavy/rare fish deep. Derived from value, with explicit tags.
const DEEP_ONLY=['Anglerfish','Giant Squid','Sea Monster','Leviathan','Shadow Drake','Void Crab','Bluefin Tuna','Giant Halibut','Giant Grouper','Moray Eel','Frilled Shark','Gulper Eel','Gloommaw'];
const SURFACE_ONLY=['Minnow','Clownfish','Starjelly'];
for(const f of FISH_DEFS){
  const lmin=Math.log(4),lmax=Math.log(1501);
  let db=0.1+((Math.log(f.baseVal+1)-lmin)/(lmax-lmin))*0.8;
  if(SURFACE_ONLY.includes(f.name))db=0.10;
  if(DEEP_ONLY.includes(f.name))db=Math.max(db,0.80);
  f.db=Math.max(0.06,Math.min(0.96,db));
  f.dbSpread=SURFACE_ONLY.includes(f.name)?0.09:(DEEP_ONLY.includes(f.name)?0.11:0.16);
}
function fishSpawnWy(ft){const frac=Math.max(0.02,Math.min(0.97,ft.db+(Math.random()-0.5)*2*ft.dbSpread));return WY+frac*WATER_DEPTH;}

function makeQuests(){return[
  {id:'catch5shallow', title:'Early Haul',     desc:'Catch 5 fish in Shallow Bay',  type:'catch_zone',zone:'shallow',target:5, reward:{xp:40,gold:15}},
  {id:'catch3bass',    title:'Bass Master',    desc:'Catch 3 Bass',                 type:'catch_fish',fish:'Bass',   target:3, reward:{xp:35,gold:20}},
  {id:'catch1legend',  title:'Legend Hunter',  desc:'Catch any legendary fish',     type:'catch_fish_legendary',   target:1, reward:{xp:150,gold:0}},
  {id:'earn100g',      title:'First Fortune',  desc:'Earn 100g from selling',       type:'earn_gold',               target:100,reward:{xp:50,gold:0}},
  {id:'catch10any',    title:'Seasoned Fisher',desc:'Catch 10 fish total',          type:'catch_total',             target:10,reward:{xp:60,gold:25}},
  {id:'catch3deep',    title:'Into the Deep',  desc:'Catch 3 fish in Deep Sea',     type:'catch_zone',zone:'deep',  target:3, reward:{xp:70,gold:30}},
  {id:'catch1night',   title:'Night Owl',      desc:'Catch 3 night fish',           type:'catch_night',             target:3, reward:{xp:90,gold:40}},
  {id:'catch1swordfish',title:'Sword Seeker',  desc:'Catch a Swordfish',            type:'catch_fish',fish:'Swordfish',target:1,reward:{xp:80,gold:35}},
  {id:'catch5reef',    title:'Reef Explorer',  desc:'Catch 5 fish in Coral Reef',   type:'catch_zone',zone:'reef',  target:5, reward:{xp:100,gold:50}},
  {id:'catch3abyss',   title:'Abyss Diver',    desc:'Catch 3 fish from the Abyss',  type:'catch_zone',zone:'abyss', target:3, reward:{xp:200,gold:100}},
  {id:'catch20any',    title:'Veteran Fisher', desc:'Catch 20 fish total',          type:'catch_total',             target:20,reward:{xp:120,gold:50}},
  {id:'earn500g',      title:'Getting Wealthy',desc:'Earn 500g from selling',       type:'earn_gold',               target:500,reward:{xp:100,gold:0}},
  {id:'perfectDepth5', title:'Precision Caster',desc:'Land 5 perfect-depth casts', type:'perfect_depth',           target:5, reward:{xp:80,gold:30}},
  {id:'catch1moonfish',title:'Moonchaser',     desc:'Catch a Moonfish',             type:'catch_fish',fish:'Moonfish',target:1,reward:{xp:70,gold:25}},
  {id:'catch1shadowdrake',title:'Nightmare',   desc:'Catch a Shadow Drake',         type:'catch_fish',fish:'Shadow Drake',target:1,reward:{xp:500,gold:200}},
  {id:'catch2gloweel', title:'Neon Hunter',    desc:'Catch 2 Gloweels',             type:'catch_fish',fish:'Gloweel',target:2,reward:{xp:110,gold:45}},
];}
const QUEST_POOL=makeQuests();

// ── State ──
let gold=0,inventory=[],upgLevels={rod:0,bait:0,boat:0,hold:0,depth:0};
let zoneUnlocked={shallow:true,deep:false,reef:false,abyss:false};
let playerXP=0,playerLevel=1,totalCaught=0,totalEarned=0,saveTimestamp=null;
let seenFish={},activeQuests=[],completedQuestIds=[],questEarnedGold=0,perfectCasts=0;

function xpForLevel(lv){return Math.floor(100*Math.pow(1.35,lv-1));}
function addXP(n){
  playerXP+=n;let needed=xpForLevel(playerLevel);
  while(playerXP>=needed){playerXP-=needed;playerLevel++;needed=xpForLevel(playerLevel);lvUpTimer=3;setMsg(`🎉 Level ${playerLevel}!`);}
  updateHUD();
}
function holdCap(){return boatDef().hold;}
function boatSpd(){return boatDef().speed;}
function reelZW(){return 0.20+upgLevels.rod*0.05;}
function biteDur(){let d=Math.max(1.2,3.5-upgLevels.bait*0.7);if(weatherFx==='rain'||weatherFx==='storm')d*=0.6;return d;}
function maxDepth(){return 150+upgLevels.depth*180;}

function generateSideQuest(){
  const zones=ZONE_DEFS.filter(z=>zoneUnlocked[z.id]);
  const id='q'+(Date.now()%100000)+'_'+Math.floor(Math.random()*10000);
  const roll=Math.random();
  if(roll<0.28){const n=8+Math.floor(Math.random()*13);return {id,title:'Daily Haul',desc:`Catch ${n} fish`,type:'catch_total',target:n,reward:{xp:n*5,gold:n*3},progress:0,completed:false};}
  if(roll<0.52){const z=zones[Math.floor(Math.random()*zones.length)];const n=3+Math.floor(Math.random()*6);return {id,title:`${z.label} Trip`,desc:`Catch ${n} fish in ${z.label}`,type:'catch_zone',zone:z.id,target:n,reward:{xp:n*8,gold:n*5},progress:0,completed:false};}
  if(roll<0.74){const names=[...new Set([].concat(...zones.map(z=>fishForZone(z.id,true).map(f=>f.name))))];const name=names[Math.floor(Math.random()*names.length)]||'Bass';const n=1+Math.floor(Math.random()*3);return {id,title:"Angler's Order",desc:`Catch ${n} ${name}`,type:'catch_fish',fish:name,target:n,reward:{xp:45*n,gold:22*n},progress:0,completed:false};}
  if(roll<0.88){const n=(1+Math.floor(Math.random()*4))*100;return {id,title:'Market Day',desc:`Earn ${n}g from selling`,type:'earn_gold',target:n,start:questEarnedGold,reward:{xp:Math.round(n*0.4),gold:0},progress:0,completed:false};}
  const n=3+Math.floor(Math.random()*6);return {id,title:'Precision Caster',desc:`Land ${n} perfect-depth casts`,type:'perfect_depth',target:n,reward:{xp:n*15,gold:n*6},progress:0,completed:false};
}
function getMainGoal(){
  for(const id of ['deep','reef','abyss']){
    if(!zoneUnlocked[id]){const z=ZONE_DEFS.find(zz=>zz.id===id);return {title:`Unlock the ${z.label}`,hint:`Reach Level ${z.reqLv} and pay ${z.cost}g at the market`,cur:Math.min(playerLevel,z.reqLv),max:z.reqLv,pct:Math.min(1,playerLevel/z.reqLv),unit:'Lv'};}
  }
  const total=FISH_DEFS.length,caught=Object.keys(seenFish).length;
  return {title:'Complete the Fish Journal',hint:`Discover every species — ${caught}/${total} found`,cur:caught,max:total,pct:Math.min(1,caught/total),unit:''};
}
function pickNewQuests(){
  let guard=0;
  while(activeQuests.length<3&&guard<60){const q=generateSideQuest();guard++;if(activeQuests.some(a=>a.type===q.type&&a.fish===q.fish&&a.zone===q.zone))continue;q._fresh=true;activeQuests.push(q);}
}
let questToastQueue=[],questToastActive=false;
function queueQuestProgress(q){
  questToastQueue.push({title:q.title,desc:q.desc,progress:q.progress,target:q.target});
  if(!questToastActive)nextQuestToast();
}
function nextQuestToast(){
  const el=document.getElementById('quest-toast');
  if(!questToastQueue.length){questToastActive=false;return;}
  questToastActive=true;
  const t=questToastQueue.shift();
  document.getElementById('qt-title').textContent=t.title;
  document.getElementById('qt-desc').textContent=t.desc||'';
  document.getElementById('qt-prog').textContent=t.progress+' / '+t.target;
  el.classList.remove('hidden');
  setTimeout(()=>{el.classList.add('hidden');setTimeout(nextQuestToast,420);},1800);
}
function updateQuestProgress(ev,data){
  let changed=false;
  for(const q of activeQuests){
    if(q.completed)continue;let inc=0;
    if(ev==='catch'&&q.type==='catch_total')inc=1;
    if(ev==='catch'&&q.type==='catch_zone'&&data.zoneId===q.zone)inc=1;
    if(ev==='catch'&&q.type==='catch_fish'&&data.fishName===q.fish)inc=1;
    if(ev==='catch'&&q.type==='catch_fish_legendary'&&data.legendary)inc=1;
    if(ev==='catch'&&q.type==='catch_night'&&data.night)inc=1;
    if(ev==='perfect_depth'&&q.type==='perfect_depth')inc=1;
    if(ev==='earn'&&q.type==='earn_gold'){const old=q.progress;q.progress=Math.min(q.target,questEarnedGold-(q.start||0));if(q.progress>=q.target){q.completed=true;changed=true;showToast('✅ Quest complete — claim it in Quests!');}else if(q.progress>old){queueQuestProgress(q);}continue;}
    if(inc>0){q.progress=Math.min(q.target,q.progress+inc);if(q.progress>=q.target){q.completed=true;changed=true;showToast('✅ Quest complete — claim it in Quests!');}else{queueQuestProgress(q);}}
  }
  if(changed)renderQuestBar();
}
function claimQuest(id){
  const q=activeQuests.find(a=>a.id===id);if(!q||!q.completed)return;
  if(q.reward.xp)addXP(q.reward.xp);
  if(q.reward.gold){gold+=q.reward.gold;floatCoins.push({x:CW/2,y:WY-20,alpha:1,label:'+'+q.reward.gold+'g'});}
  showToast(`✅ ${q.title} +${q.reward.xp}XP${q.reward.gold?` +${q.reward.gold}g`:''}`);
  const card=document.querySelector(`.quest-card[data-qid="${id}"]`);
  const finish=()=>{activeQuests=activeQuests.filter(a=>a.id!==id);pickNewQuests();updateHUD();buildShopUI();renderQuestPanel();};
  if(card){card.classList.add('claiming');setTimeout(finish,520);}else finish();
}
function renderQuestBar(){}
function renderInventoryBar(){}

let ZONES=[];
function syncZones(){ZONES=ZONE_DEFS.map(z=>({...z,unlocked:zoneUnlocked[z.id]||false}));}
syncZones();
function zoneAt(wx){return ZONES.find(z=>wx>=z.wx&&wx<z.endWx)||ZONES[0];}
function fishForZone(zid,night){
  const stormOn=(weather==='storm');
  const pool=FISH_DEFS.filter(f=>f.zones.includes(zid)&&(stormOn||!f.stormFish));
  if(!night)return pool.filter(f=>!f.night);
  // At night: replace ~40% of day fish with night fish
  const nightPool=pool.filter(f=>f.night);
  const dayPool=pool.filter(f=>!f.night);
  // Mix: all night fish + 60% of day fish
  return [...nightPool,...dayPool.filter(()=>Math.random()<0.6)];
}
function weightedPick(pool){let r=Math.random(),acc=0,tot=pool.reduce((s,f)=>s+f.rarity,0);for(const f of pool){acc+=f.rarity/tot;if(r<acc)return f;}return pool[pool.length-1]||FISH_DEFS[0];}

// ── Boat ──
const boat={x:600,y:WY-20,vx:0,facing:1}; // facing: 1=right, -1=left
function maxBoatX(){let mx=ZONES[0].endWx;for(const z of ZONES){if(z.unlocked)mx=z.endWx;else break;}return mx-30;}
function minBoatX(){return LW+50;}

let atMarket=false;
let hookState='idle'; // idle charging released sinking waiting biting reeling_ready reeling retrieving
let hookWorldX=0,hookY=0,hookTargetY=0;
let biteTimer=0,biteWait=3,biteAlertTimer=0,currentFish=null,reelTimeout=null;
let reelFishPos=.5,reelFishDir=1,reelFishSpd=0,catchDepthY=0,reelGrace=0;
let reelIndPos=.5,reelIndVel=0,reelZonePos=.3,reelZoneW=.22,reelProgress=0,reelHolding=false,reelBurstTimer=0,reelHint='';

// ── Depth charge meter ──
let charging=false, chargeVal=0; // 0..1
let setDepthFrac=0.5; // target cast depth as fraction of maxDepth (set with W/S)
let setDepthVel=0;
let rulerActiveT=0;
let rulerAlpha=0;
let chargeDir=1; // 1=filling, -1=emptying
const CHARGE_SPEED=1.0; // fills 0→1 in 1s
const CHARGE_DECAY=1.4; // empties faster after peak
// Perfect zone: 0.75-0.9
const PERFECT_LO=0.75, PERFECT_HI=0.90;
let chargeReleased=false;

const worldFish=[];
function spawnStormFish(){
  for(const z of ZONES){if(!z.unlocked)continue;
    const defs=FISH_DEFS.filter(f=>f.stormFish&&f.zones.includes(z.id));
    for(const ft of defs){if(Math.random()<0.6){const wx=z.wx+60+Math.random()*(z.endWx-z.wx-120);
      worldFish.push({wx,wy:fishSpawnWy(ft),vx:(0.2+Math.random()*.5)*(Math.random()>.5?1:-1),type:ft,state:'swim',yOff:Math.random()*Math.PI*2,t:Math.random()*100,approachSpd:50+Math.random()*65,zoneId:z.id,storm:true});}}}
  setMsg('⚡ A storm rolls in — strange fish surface!');
}
function despawnStormFish(){for(let i=worldFish.length-1;i>=0;i--){const f=worldFish[i];if(f.storm&&f.state!=='hooked')worldFish.splice(i,1);}}
function spawnFish(count,zid){
  const zone=ZONES.find(z=>z.id===zid);if(!zone)return;
  const pool=fishForZone(zid,getNightOverlay()>0.5);
  for(let i=0;i<count;i++){
    const wx=zone.wx+50+Math.random()*(zone.endWx-zone.wx-100);
    const ft=weightedPick(pool);
    worldFish.push({wx,wy:fishSpawnWy(ft),vx:(0.2+Math.random()*.5)*(Math.random()>.5?1:-1),type:ft,state:'swim',yOff:Math.random()*Math.PI*2,t:Math.random()*100,approachSpd:50+Math.random()*65,zoneId:zid});
  }
}
spawnFish(30,'shallow');spawnFish(28,'deep');spawnFish(26,'reef');spawnFish(22,'abyss');
spawnDeep(12,'deep');spawnDeep(12,'reef');spawnDeep(14,'abyss');
const deadFish=[];const RESPAWN=14;

const bubbles=Array.from({length:120},()=>({wx:LW+20+Math.random()*(WW-LW-20),wy:WY+Math.random()*WATER_DEPTH,r:1+Math.random()*2.5,spd:.15+Math.random()*.45,alpha:.18+Math.random()*.32,wob:Math.random()*Math.PI*2}));
const motes=Array.from({length:110},()=>({wx:LW+20+Math.random()*(WW-LW-20),wy:WY+10+Math.random()*(WATER_DEPTH-20),r:0.6+Math.random()*1.6,vx:(Math.random()-0.5)*0.25,vy:(Math.random()-0.5)*0.12,alpha:0.1+Math.random()*0.22,t:Math.random()*Math.PI*2}));
const shafts=Array.from({length:6},(_,i)=>({wx:LW+200+i*1300+Math.random()*400,w:30+Math.random()*50,p:0.3+Math.random()*0.2}));
const seaDecor=Array.from({length:90},()=>({wx:LW+20+Math.random()*(WW-LW-20),type:Math.floor(Math.random()*3),h:16+Math.random()*36,w:3+Math.random()*7}));
const clouds=Array.from({length:8},(_,i)=>({wx:i*900+Math.random()*300,wy:HUD_H+18+Math.random()*40,cw:70+Math.random()*60,p:.18+Math.random()*.25}));
// Parallax background scenery (per-zone)
// Mountains anchored to world positions, weighted to the coast; 1-2 at the deep-sea start, none beyond
const mountainsFar=[{wx:140,h:165,w:250},{wx:380,h:120,w:210},{wx:620,h:200,w:290},{wx:870,h:140,w:230},{wx:1120,h:185,w:265},{wx:1380,h:130,w:215},{wx:1650,h:175,w:255},{wx:1930,h:150,w:235},{wx:2260,h:120,w:200}];
const mountainsNear=[{wx:220,h:110,w:170},{wx:470,h:150,w:200},{wx:730,h:90,w:150},{wx:1000,h:135,w:185},{wx:1270,h:105,w:160},{wx:1560,h:155,w:205},{wx:1850,h:120,w:175},{wx:2150,h:80,w:140}];
const reefIslets=Array.from({length:14},(_,i)=>({wx:950+i*140+Math.random()*50,h:12+Math.random()*14,w:55+Math.random()*45}));
// Vibrant tropical reef decor on the seabed (reef zone 4000-6000)
const REEF_PALETTE=['#FF6B9D','#FF9F40','#FFD23F','#4ECDC4','#5AC8FA','#A66CFF','#FF5E5B','#3BCEAC'];
const reefDecor=(function(){const a=[];let x=4040;const P=REEF_PALETTE;const pc=()=>P[Math.floor(Math.random()*P.length)];
  while(x<5960){const r=Math.random();
    if(r<0.40){a.push({wx:x,type:'coral',variant:Math.floor(Math.random()*3),h:38+Math.random()*66,w:22+Math.random()*26,color:pc(),color2:pc(),ph:Math.random()*6.28});x+=46+Math.random()*60;}
    else if(r<0.66){a.push({wx:x,type:'kelp',h:80+Math.random()*140,blades:2+Math.floor(Math.random()*3),ph:Math.random()*6.28,color:Math.random()<0.5?'#3BCEAC':'#2FA98C'});x+=26+Math.random()*44;}
    else{const d=['starfish','shell','urchin','anemone','sanddollar'];a.push({wx:x,type:d[Math.floor(Math.random()*d.length)],color:pc(),color2:pc(),rot:(Math.random()-0.5)*0.8,sz:0.8+Math.random()*0.6,ph:Math.random()*6.28});x+=24+Math.random()*40;}
  }return a;})();
// Title screen
const TITLE_LIFT=232;
let gameMode='title';// title | descending | play | ascending
function canPlay(){return gameMode==='play'&&!introOpen;}
let titleLift=TITLE_LIFT,titleTargetLift=TITLE_LIFT,uiAlpha=0;
let zoneAnnounceId=null,zoneTitleT=0,zoneTitleName='';
let hudPulse=0,_hudG=-1,_hudH=-1,_hudX=-1,_hudL=-1;
let questNews=false,journalNews=false,fishNews={};
const birds=Array.from({length:7},()=>({wx:Math.random()*(CW+80)-40,wy:-150+Math.random()*215,spd:7+Math.random()*17,flap:Math.random()*Math.PI*2,size:5+Math.random()*5}));
const stars=Array.from({length:80},()=>({x:Math.random()*CW,y:-180+Math.random()*(WY*0.85+180),r:Math.random()*1.5+0.3,twinkle:Math.random()*Math.PI*2}));
let floatCoins=[],sparkles=[],wake=[],camX=0,camY=0,lvUpTimer=0,catchPopupTimer=0,wakeSpawn=0;

let lastT=0;
function loop(ts){const dt=Math.min((ts-lastT)/1000,.05);lastT=ts;try{update(dt,ts);render(ts);}catch(e){console.error('GAME ERROR:',e);ctx.clearRect(0,0,CW,CH);ctx.fillStyle='#111';ctx.fillRect(0,0,CW,CH);ctx.fillStyle='#f44';ctx.font='14px sans-serif';ctx.textAlign='center';ctx.fillText('Error: '+e.message,CW/2,CH/2);return;}requestAnimationFrame(loop);}

function update(dt,ts){
  // Title screen / transition: camera lift + UI fade + birds
  titleLift+=(titleTargetLift-titleLift)*Math.min(1,dt*1.05);
  uiAlpha+=((((gameMode==='play'||gameMode==='harbor')&&!introOpen)?1:0)-uiAlpha)*Math.min(1,dt*3);
  for(const b of birds){b.wx+=b.spd*dt;b.flap+=dt*6.5;if(b.wx>CW+45)b.wx=-45;}
  if(gameMode==='descending'&&titleLift<1.5){titleLift=0;gameMode='play';if(pendingIntro){pendingIntro=false;if(!tutorialSeen.intro)openTutorial('intro');}}
  if(gameMode==='ascending'&&titleLift>TITLE_LIFT-1.5){titleLift=TITLE_LIFT;gameMode='title';showTitleOverlay();}
  {const d=document.getElementById('drawer');if(d){const dh=gameMode==='harbor';d.style.opacity=dh?0:uiAlpha;d.style.pointerEvents=(!dh&&uiAlpha>0.6)?'auto':'none';if(gameMode!=='play'&&drawerOpen)closeMenuAll();}}
  const playing=gameMode==='play';
  if(fadePhase==='out'){sceneFade=Math.min(1,sceneFade+dt*3.2);if(sceneFade>=1){if(fadeAction){fadeAction();fadeAction=null;}fadePhase='in';}}
  else if(fadePhase==='in'){sceneFade=Math.max(0,sceneFade-dt*3.2);if(sceneFade<=0)fadePhase=null;}
  // HUD readout: pulse/brighten when a tracked value changes, else idle-fade
  if(gold!==_hudG||inventory.length!==_hudH||playerXP!==_hudX||playerLevel!==_hudL){if(_hudG!==-1)hudPulse=2.2;_hudG=gold;_hudH=inventory.length;_hudX=playerXP;_hudL=playerLevel;}
  if(hudPulse>0)hudPulse-=dt;
  {const tgt=hexToRgb(gameMode==='harbor'?HARBOR_WATER:zoneAt(boat.x).waterColor);if(!waterRGB)waterRGB={...tgt};const k=Math.min(1,dt*2.5);waterRGB.r+=(tgt.r-waterRGB.r)*k;waterRGB.g+=(tgt.g-waterRGB.g)*k;waterRGB.b+=(tgt.b-waterRGB.b)*k;}
  updateWeather(dt);
  // Time of day (paused on the title screen)
  if(playing||gameMode==='harbor')timeOfDay=(timeOfDay+dt)%FULL_CYCLE;
  const tl=getTimeLabel();

  // Boat
  const sailing=playing||gameMode==='harbor';
  const canMove=sailing&&((hookState==='idle'&&!charging)||hookState==='retrieving');
  const maxV=boatSpd(),accel=maxV*3.2;
  if(canMove){
    const mL=keys['ArrowLeft']||keys['a']||keys['A'],mR=keys['ArrowRight']||keys['d']||keys['D'];
    if(autoTravelTarget!==null){
      const dx=autoTravelTarget-boat.x;
      if(Math.abs(dx)<4){boat.x=autoTravelTarget;boat.vx=0;autoTravelTarget=null;autoTravelActive=false;setMsg('Arrived.');}
      else{const desired=Math.max(-maxV,Math.min(maxV,dx*3));boat.vx+=(desired-boat.vx)*Math.min(1,dt*4);boat.facing=dx<0?-1:1;}
    }else if(mL){boat.vx-=accel*dt;boat.facing=-1;}
    else if(mR){boat.vx+=accel*dt;boat.facing=1;}
    else boat.vx*=(1-Math.min(1,dt*2.2));
    boat.vx=Math.max(-maxV,Math.min(maxV,boat.vx));
  }else boat.vx*=(1-Math.min(1,dt*3.5));
  if(Math.abs(boat.vx)>20) boat.facing=boat.vx>0?1:-1;
  const _minX=gameMode==='harbor'?HARBOR_MIN:minBoatX(),_maxX=gameMode==='harbor'?HARBOR_MAX:maxBoatX();
  boat.x=Math.max(_minX,Math.min(_maxX,boat.x+boat.vx*dt));
  if(gameMode==='play')for(const z of ZONES)if(!z.unlocked&&boat.x>=z.wx-10){boat.x=z.wx-10;boat.vx=Math.min(0,boat.vx);}
  camX+=(boat.x-CW/2-camX)*Math.min(1,dt*7);
  const _worldW=gameMode==='harbor'?HARBOR_W:WW;camX=Math.max(0,Math.min(_worldW-CW,camX));
  let camYTarget=0;
  if(hookState==='sinking'||hookState==='waiting'||hookState==='biting'||hookState==='reeling'||hookState==='reeling_ready'){
    camYTarget=Math.max(0,Math.min(SEA_BOTTOM+16-CH, hookY-WY-110));
  }
  camY+=(camYTarget-camY)*Math.min(1,dt*3);
  atMarket=playing&&boat.x<LW+80&&hookState==='idle';
  if(gameMode==='harbor'){harborNear=null;let best=72;for(const b of HARBOR_BUILDINGS){const d=Math.abs(boat.x-b.wx);if(d<best){best=d;harborNear=b;}}harborAtExit=boat.x>HARBOR_W-150;}else{harborNear=null;harborAtExit=false;}
  // Zone-entry title flourish
  if(playing){const cz0=zoneAt(boat.x);if(cz0.id!==zoneAnnounceId){if(zoneAnnounceId!==null){zoneTitleName=cz0.label;zoneTitleT=2.8;}zoneAnnounceId=cz0.id;}}
  if(zoneTitleT>0)zoneTitleT-=dt;

  // Depth charge
  if(charging&&hookState==='idle'){
    if(chargeDir===1){
      chargeVal+=CHARGE_SPEED*dt;
      if(chargeVal>=1){chargeVal=1;chargeDir=-1;}
    }else{
      chargeVal-=CHARGE_DECAY*dt;
      if(chargeVal<=0){chargeVal=0;}
    }
  }

  // Set-depth aim (W/S or Up/Down), continuous while held, only when the line is idle
  if(playing&&hookState==='idle'){
    let dir=0;
    if(keys['w']||keys['W']||keys['ArrowUp'])dir-=1;
    if(keys['s']||keys['S']||keys['ArrowDown'])dir+=1;
    if(dir!==0){setDepthVel+=dir*2.5*dt;const mv=0.38;setDepthVel=Math.max(-mv,Math.min(mv,setDepthVel));rulerActiveT=2.2;}
    else{setDepthVel*=(1-Math.min(1,dt*5));if(Math.abs(setDepthVel)<0.0004)setDepthVel=0;}
    setDepthFrac+=setDepthVel*dt;
    if(setDepthFrac<0.02){setDepthFrac=0.02;setDepthVel=0;}
    if(setDepthFrac>1){setDepthFrac=1;setDepthVel=0;}
  }else setDepthVel=0;
  if(rulerActiveT>0)rulerActiveT-=dt;
  {const showRuler=playing&&hookState==='idle'&&!atMarket&&(rulerActiveT>0||charging)&&!(weatherFx==='fog'&&weatherAmt>0.4);rulerAlpha+=((showRuler?1:0)-rulerAlpha)*Math.min(1,dt*4.5);}

  // Hook states
  if(hookState==='sinking'){hookY+=150*dt;if(hookY>=hookTargetY){hookY=hookTargetY;hookState='waiting';biteTimer=0;biteWait=biteDur()+Math.random()*2;}}
  if(hookState==='retrieving'){hookY-=200*dt;if(hookY<=boat.y){hookY=boat.y;hookState='idle';setMsg('Hook retrieved.');}}
  if(hookState==='waiting'){
    biteTimer+=dt;
    if(biteTimer>=biteWait){
      const z=zoneAt(hookWorldX);const night=getNightOverlay()>0.5;
      const pool=fishForZone(z.id,night);
      const reach=worldFish.filter(f=>f.state==='swim'&&pool.includes(f.type)&&f.wy<=hookTargetY+20&&Math.abs(f.wx-hookWorldX)<420&&Math.abs(f.wy-hookY)<220&&f.wx>=z.wx&&f.wx<z.endWx);
      if(reach.length){let cl=null,cd=9999;for(const f of reach){const d=Math.hypot(f.wx-hookWorldX,f.wy-hookY);if(d<cd){cd=d;cl=f;}}cl.state='approach';currentFish=cl;biteAlertTimer=2.5;hookState='biting';}
      else{biteTimer=0;biteWait=biteDur()+Math.random()*1.5;}
    }
  }
  if(hookState==='biting'){biteAlertTimer-=dt;if(biteAlertTimer<=0){hideOnlinePopup();if(currentFish){currentFish.state='swim';currentFish=null;}hookState='waiting';biteTimer=0;biteWait=biteDur()+Math.random()*2;setMsg('It swam off…');}}

  // Fish AI
  for(const f of worldFish){
    if(f.state==='hooked')continue;f.t+=dt;
    const fz=ZONES.find(z=>z.id===f.zoneId);
    if(f.state==='swim'){
      if(f.vy===undefined)f.vy=0;
      f.wx+=f.vx*dt*55;f.wy+=f.vy*dt*55+Math.sin(f.t*1.3+f.yOff)*.3;
      const zL=fz.wx+25,zR=fz.endWx-25;
      if(f.wx<zL){f.wx=zL;f.vx=Math.abs(f.vx)+.1;}if(f.wx>zR){f.wx=zR;f.vx=-(Math.abs(f.vx)+.1);}
      if(Math.random()<dt*1.2)f.vx+=(Math.random()-0.5)*0.7;
      if(Math.random()<dt*0.6)f.vy+=(Math.random()-0.5)*0.28;
      f.vy*=0.95;f.vy=Math.max(-0.45,Math.min(0.45,f.vy));
      f.vx+=((fz.wx+fz.endWx)/2-f.wx)*.000012*dt*60;f.vx=Math.max(-2.4,Math.min(2.4,f.vx));f.wy=Math.max(WY+15,Math.min(SEA_BOTTOM-18,f.wy));
      if((hookState==='waiting'||hookState==='biting')&&f!==currentFish){const dx=hookWorldX-f.wx,dy=hookY-f.wy,d=Math.hypot(dx,dy);if(d<160){f.vx+=(dx/d)*.3*dt*55;f.vy+=(dy/d)*.06*dt*55;}}
    }else if(f.state==='approach'){
      const dx=hookWorldX-f.wx,dy=hookY-f.wy,d=Math.hypot(dx,dy);
      if(d<11){f.state='hooked';hookState='reeling_ready';biteAlertTimer=99;showOnlinePopup(f.type);setMsg('');reelTimeout=setTimeout(()=>{if(hookState==='reeling_ready'){hideOnlinePopup();missedBite();}},3000);}
      else{f.vx=(dx>=0?1:-1)*Math.max(0.4,Math.abs(f.vx));f.wx+=(dx/d)*f.approachSpd*dt;f.wy+=(dy/d)*f.approachSpd*dt;}
    }
  }

  const exp=deadFish.filter(d=>{d.timer-=dt;return d.timer<=0;});for(const d of exp)spawnOne(d.zoneId);while(deadFish.length&&deadFish[0].timer<=0)deadFish.shift();
  for(const b of bubbles){b.wy-=b.spd*dt*55;b.wob+=dt*2;if(b.wy<WY){b.wy=SEA_BOTTOM-5;b.wx=LW+20+Math.random()*(WW-LW-20);}}
  for(const m of motes){m.t+=dt;m.wx+=m.vx*dt*55;m.wy+=(m.vy+Math.sin(m.t*0.7)*0.15)*dt*55;if(m.wx<LW+10){m.wx=LW+10;m.vx=Math.abs(m.vx);}if(m.wx>WW-10){m.wx=WW-10;m.vx=-Math.abs(m.vx);}if(m.wy<WY+8){m.wy=WY+8;m.vy=Math.abs(m.vy);}if(m.wy>SEA_BOTTOM-18){m.wy=SEA_BOTTOM-18;m.vy=-Math.abs(m.vy);}}
  for(const s of stars)s.twinkle+=dt*1.5;
  floatCoins=floatCoins.filter(c=>{c.y-=34*dt;c.alpha-=dt*.9;return c.alpha>0;});
  sparkles=sparkles.filter(s=>{s.life-=dt;s.x+=s.vx*dt;s.y+=s.vy*dt;return s.life>0;});
  // Boat wake: spawn foam at the stern while moving
  wakeSpawn-=dt;
  if(Math.abs(boat.vx)>25&&wakeSpawn<=0){
    const dir=boat.vx>0?1:-1;
    wake.push({wx:boat.x-dir*30+(Math.random()-0.5)*8,wy:WY+(Math.random()-0.5)*4,r:1.5+Math.random()*2,vx:-dir*(8+Math.random()*14),life:1,maxlife:0.7+Math.random()*0.5});
    wakeSpawn=0.04;
  }
  wake=wake.filter(w=>{w.life-=dt/w.maxlife;w.wx+=w.vx*dt;w.r+=dt*5;return w.life>0;});
  if(hookState==='reeling')updateReel(dt);
  if(lvUpTimer>0)lvUpTimer-=dt;
  if(catchPopupTimer>0){catchPopupTimer-=dt;if(catchPopupTimer<=0)document.getElementById('catch-popup').classList.add('hidden');}
  if(msgTimer>0)msgTimer-=dt;
  updateHint();
}

function releaseCharge(){
  if(!charging||hookState!=='idle')return;
  charging=false;
  const cv=chargeVal;
  chargeVal=0;chargeDir=1;
  const z=zoneAt(boat.x);
  if(!z.unlocked){setMsg(`Unlock ${z.label} at the 🏪 market!`);return;}
  // Cast accuracy: deviation from the perfect zone offsets landing depth from the SET depth
  let dev=0;
  if(cv<PERFECT_LO)dev=cv-PERFECT_LO;        // undershoot -> shallower than intended
  else if(cv>PERFECT_HI)dev=cv-PERFECT_HI;   // overshoot -> deeper than intended
  const landFrac=Math.max(0.02,Math.min(1,setDepthFrac+dev*0.8));
  hookTargetY=WY+Math.max(10,landFrac*maxDepth());
  hookWorldX=boat.x+(boat.facing===1?-42:42);
  hookY=boat.y;hookState='sinking';
  // XP scales with how close the release was to perfect; dead-on gives max + quest credit
  const isPerfect=(dev===0);
  const accuracy=Math.max(0,1-Math.abs(dev)/0.4);
  const fullBonus=Math.max(15,Math.round(xpForLevel(playerLevel)*0.025));
  const bonusXP=Math.round(accuracy*fullBonus);
  if(bonusXP>0)addXP(bonusXP);
  if(isPerfect){
    perfectCasts++;
    floatCoins.push({x:wx2sx(hookWorldX),y:boat.y-30,alpha:1,label:`⭐ Perfect! +${bonusXP}XP`});
    updateQuestProgress('perfect_depth',{});
    setMsg('⭐ Perfect cast — landed right on target!');
  }else{
    if(bonusXP>0)floatCoins.push({x:wx2sx(hookWorldX),y:boat.y-30,alpha:1,label:`+${bonusXP}XP`});
    setMsg('Hook sinking… R to retrieve.');
  }
}

function spawnDeep(count,zid){
  const zone=ZONES.find(z=>z.id===zid);if(!zone)return;
  const pool=fishForZone(zid,getNightOverlay()>0.5).filter(f=>f.db>=0.55);
  if(!pool.length)return;
  for(let i=0;i<count;i++){
    const wx=zone.wx+50+Math.random()*(zone.endWx-zone.wx-100);
    const ft=weightedPick(pool);
    worldFish.push({wx,wy:fishSpawnWy(ft),vx:(0.2+Math.random()*.5)*(Math.random()>.5?1:-1),type:ft,state:'swim',yOff:Math.random()*Math.PI*2,t:Math.random()*100,approachSpd:50+Math.random()*65,zoneId:zid});
  }
}
function spawnOne(zid){
  const zone=ZONES.find(z=>z.id===zid);if(!zone)return;
  let pool=fishForZone(zid,getNightOverlay()>0.5);
  if(zid!=='shallow'&&Math.random()<0.4){const deep=pool.filter(f=>f.db>=0.55);if(deep.length)pool=deep;}
  const wx=zone.wx+60+Math.random()*(zone.endWx-zone.wx-120);
  const ft=weightedPick(pool);
  worldFish.push({wx,wy:fishSpawnWy(ft),vx:(0.2+Math.random()*.5)*(Math.random()>.5?1:-1),type:ft,state:'swim',yOff:Math.random()*Math.PI*2,t:Math.random()*100,approachSpd:50+Math.random()*65,zoneId:zid});
}

function showOnlinePopup(ft){
  const banner=document.getElementById('online-banner');const action=document.getElementById('online-action');
  document.getElementById('online-emoji').textContent=ft.emoji;
  document.getElementById('online-name').textContent=(ft.legendary?'⭐ ':ft.night?'🌙 ':'')+ft.name;
  const hint={normal:'on the line!',zigzag:'zigzagging!',tank:'pulling hard!',burst:'ready to burst!'}[ft.reelBehavior]||'on the line!';
  document.getElementById('online-sub').textContent=`${ft.sizeLabel} · ${hint}`;
  banner.className=ft.legendary?'legendary-banner':ft.night?'night-banner':'';
  action.className=ft.legendary?'legendary-action':ft.night?'night-action':'';
  document.getElementById('online-popup').classList.remove('hidden');
}
function hideOnlinePopup(){document.getElementById('online-popup').classList.add('hidden');}

function startReel(){if(!canPlay())return;
  clearTimeout(reelTimeout);if(hookState!=='reeling_ready')return;
  hideOnlinePopup();hookState='reeling';
  reelFishPos=.3+Math.random()*.4;reelIndPos=.5;reelIndVel=0;reelZoneW=reelZW();reelZonePos=reelIndPos-reelZoneW/2;
  reelFishSpd=currentFish?currentFish.type.speed:.6;reelFishDir=Math.random()>.5?1:-1;reelProgress=0;reelBurstTimer=0;
  catchDepthY=hookY;reelGrace=0;
  const hints={normal:'Keep the zone on the fish!',zigzag:'It zigzags — stay sharp!',tank:'Slow & strong — hold steady!',burst:'It bursts! Be ready!'};
  reelHint=(hints[currentFish?.type.reelBehavior||'normal'])+'  ·  hold SPACE  ·  R to retrieve';
}
function updateReel(dt){
  const beh=currentFish?currentFish.type.reelBehavior:'normal';
  const inZone=reelFishPos>=reelZonePos&&reelFishPos<=reelZonePos+reelZoneW;
  let effSpd=inZone?reelFishSpd*.35:reelFishSpd;
  if(beh==='zigzag'){if(Math.random()<dt*4)reelFishDir*=-1;effSpd=inZone?reelFishSpd*.4:reelFishSpd*1.1;}
  else if(beh==='tank'){effSpd=inZone?reelFishSpd*.7:reelFishSpd*.85;}
  else if(beh==='burst'){reelBurstTimer+=dt;if(reelBurstTimer>2.5+Math.random()*1.5){reelFishSpd=Math.min(reelFishSpd*1.8,2.5);reelBurstTimer=0;setTimeout(()=>{if(currentFish)reelFishSpd=currentFish.type.speed;},800);}effSpd=inZone?reelFishSpd*.35:reelFishSpd;}
  reelFishPos+=reelFishDir*effSpd*dt*.9;
  if(reelFishPos<=.02){reelFishPos=.02;reelFishDir=1;}if(reelFishPos>=.98){reelFishPos=.98;reelFishDir=-1;}
  if(beh!=='zigzag'&&Math.random()<(inZone?dt*effSpd*.3:dt*reelFishSpd*.7))reelFishDir*=-1;
  // Stardew-style momentum: gravity pulls left, holding thrusts right
  const GRAV=3.8, THRUST=7.0, DAMP=0.86;
  reelIndVel+=(reelHolding?(THRUST-GRAV):-GRAV)*dt;
  reelIndVel*=DAMP;
  reelIndPos+=reelIndVel*dt;
  // clamp by the zone's edges so the whole pill stays inside the bar
  const halfZ=reelZoneW/2;
  if(reelIndPos<=halfZ){reelIndPos=halfZ;reelIndVel*=-0.35;}
  if(reelIndPos>=1-halfZ){reelIndPos=1-halfZ;reelIndVel*=-0.35;}
  reelZonePos=reelIndPos-reelZoneW/2;
  // heavier, slower reel the deeper the fish was hooked
  const depthFrac=Math.min(1,Math.max(0,(catchDepthY-WY)/WATER_DEPTH));
  const heavy=1-depthFrac*0.55;
  reelProgress=inZone?Math.min(1,reelProgress+dt*.28*heavy):Math.max(0,reelProgress-dt*.18*heavy);
  // hook (and hooked fish) physically rise toward the surface with progress
  hookY=catchDepthY+(boat.y-catchDepthY)*reelProgress;
  // grace buffer: brief window at the bottom before the fish escapes
  if(reelProgress<=0){reelGrace+=dt;if(reelGrace>=1.5){fishEscaped();return;}}else reelGrace=0;
  if(reelProgress>=1)fishCaught();
}
function updateReelUI(){}
function fishWeight(cm){return Math.max(0.1,+(cm*cm*0.0006).toFixed(1));}
function fishCaught(){
  reelHolding=false;
  const ft=currentFish.type;const z=zoneAt(hookWorldX);
  if(inventory.length>=holdCap()){setMsg('Hold full! Sell at market.');retrieveHook();return;}
  // Roll size first; size (0.8x-2x) drives BOTH value and XP
  const cm=ft.cmRange[0]+Math.floor(Math.random()*(ft.cmRange[1]-ft.cmRange[0]+1));
  const sizeT=ft.cmRange[1]>ft.cmRange[0]?(cm-ft.cmRange[0])/(ft.cmRange[1]-ft.cmRange[0]):0.5;
  const sizeMult=0.8+sizeT*1.2;
  const val=Math.max(1,Math.round(ft.baseVal*z.fishMult*sizeMult));
  const isNew=!seenFish[ft.name];
  const prevBest=isNew?0:(seenFish[ft.name].bestCm||0);
  const isRecord=!isNew&&cm>prevBest;
  // Base XP scales with size; milestone bonus scales with level (new species OR record, not both)
  const baseXP=Math.max(1,Math.round((5+ft.baseVal*ft.xpMult*0.15)*sizeMult));
  let bonusXP=0,bonusLabel='';
  if(isNew){bonusXP=Math.max(30,Math.round(xpForLevel(playerLevel)*0.05));bonusLabel='New species';}
  else if(isRecord){bonusXP=Math.max(20,Math.round(xpForLevel(playerLevel)*0.03));bonusLabel='Record size';}
  const xpGained=baseXP+bonusXP;addXP(xpGained);totalCaught++;
  if(!seenFish[ft.name])seenFish[ft.name]={count:0,bestCm:0,soldN:0,soldSum:0,soldMin:null,soldMax:null};seenFish[ft.name].count++;
  inventory.push({type:ft,typeName:ft.name,value:val,cm,weight:fishWeight(cm)});
  if(cm>seenFish[ft.name].bestCm)seenFish[ft.name].bestCm=cm;
  // Catch popup
  const el=document.getElementById('catch-popup');
  if(isNew)fishNews[ft.name]='new';else if(isRecord)fishNews[ft.name]='record';
  document.getElementById('cp-badge').textContent=isNew?'✨ New species!':(isRecord?'🏆 New record size!':'');
  document.getElementById('cp-emoji').textContent=ft.emoji;
  document.getElementById('cp-name').textContent=(ft.legendary?'⭐ ':ft.night?'🌙 ':'')+ft.name;
  document.getElementById('cp-size').textContent=`${ft.sizeLabel} · ${cm}cm`;
  document.getElementById('cp-desc').textContent=ft.desc;
  document.getElementById('cp-val').textContent=`+${val}g`;
  document.getElementById('cp-xp').textContent=`+${xpGained} XP`;
  el.className=ft.legendary?'legendary-popup':ft.night?'night-popup':'';
  el.classList.remove('hidden');catchPopupTimer=3.5;
  updateQuestProgress('catch',{zoneId:currentFish.zoneId,fishName:ft.name,legendary:ft.legendary,night:ft.night});
  if(ft.legendary||ft.night)for(let i=0;i<(ft.legendary?18:10);i++)sparkles.push({x:wx2sx(hookWorldX),y:hookY,vx:(Math.random()-.5)*60,vy:(Math.random()-.5)*60,life:1.2,color:ft.color});
  deadFish.push({zoneId:currentFish.zoneId,timer:RESPAWN+Math.random()*10});
  const idx=worldFish.indexOf(currentFish);if(idx>-1)worldFish.splice(idx,1);
  currentFish=null;hookState='idle';hookY=0;updateHUD();renderInventoryBar();
}
function fishEscaped(){reelHolding=false;hideOnlinePopup();if(currentFish){currentFish.state='swim';currentFish=null;}hookState='retrieving';setMsg('It got away!');}
function missedBite(){reelHolding=false;hideOnlinePopup();if(currentFish){currentFish.state='swim';currentFish=null;}hookState='retrieving';setMsg('It got away!');}
function retrieveHook(){if(!canPlay())return;if(hookState==='idle')return;clearTimeout(reelTimeout);if(currentFish){currentFish.state='swim';currentFish=null;}reelHolding=false;hideOnlinePopup();charging=false;chargeVal=0;chargeDir=1;hookState='retrieving';setMsg('Retrieving…');}

let hudMsg='';
let hudHint='';
let msgTimer=0;
function updateHUD(){
  document.getElementById('shop-gold-val').textContent=gold;
  document.getElementById('shop-lv-val').textContent=playerLevel;
}
let journalView=null,journalFish=null;
function journalCats(){
  const cats=[{id:'shallow',label:'Shallow Bay',icon:'🐚'},{id:'deep',label:'Deep Sea',icon:'🌊'},{id:'reef',label:'Coral Reef',icon:'🪸'},{id:'abyss',label:'The Abyss',icon:'🌑'},{id:'wanderers',label:'Wanderers',icon:'🧭'}];
  for(const c of cats){c.fish=FISH_DEFS.filter(f=>c.id==='wanderers'?f.zones.length>1:(f.zones.length===1&&f.zones[0]===c.id));c.fish.sort((a,b2)=>a.baseVal-b2.baseVal);c.total=c.fish.length;c.seen=c.fish.filter(f=>seenFish[f.name]).length;}
  return cats;
}
function openJournal(v){journalView=(v===undefined?null:v);journalFish=null;renderJournal();document.getElementById('journal-overlay').classList.add('open');}
function openFishDetail(name){journalFish=name||null;renderJournal();}
function renderJournal(){
  const grid=document.getElementById('journal-grid');grid.innerHTML='';
  const sub=document.getElementById('journal-sub');const cats=journalCats();
  document.getElementById('journal-count').textContent='';
  if(!journalView){
    grid.style.display='flex';grid.style.gridTemplateColumns='';grid.style.overflowX='auto';grid.style.gap='12px';grid.style.paddingBottom='8px';
    grid.classList.add('hscroll');grid.tabIndex=0;
    grid.onwheel=(e)=>{if(e.deltaY!==0){grid.scrollLeft+=e.deltaY;e.preventDefault();}};
    const totalSeen=Object.keys(seenFish).length;
    sub.innerHTML=`<span>${totalSeen}/${FISH_DEFS.length} species discovered</span><span class="jscroll"><button aria-label="Scroll left" onclick="document.getElementById('journal-grid').scrollBy({left:-160,behavior:'smooth'})">‹</button><button aria-label="Scroll right" onclick="document.getElementById('journal-grid').scrollBy({left:160,behavior:'smooth'})">›</button></span>`;
    for(const c of cats){const pct=c.total?Math.round(c.seen/c.total*100):0;
      const card=document.createElement('div');card.className='zone-card';
      const zdot=c.fish.some(f=>fishNews[f.name])?'<span class="znew-dot"></span>':'';
      card.innerHTML=`${zdot}<div class="zc-icon">${c.icon}</div><div class="zc-name">${c.label}</div><div class="zc-count">${c.seen}/${c.total}</div><div class="zone-bar"><div class="zone-fill" style="width:${pct}%"></div></div>`;
      card.onclick=()=>openJournal(c.id);grid.appendChild(card);}
  }else if(!journalFish){
    grid.onwheel=null;grid.classList.remove('hscroll');grid.style.display='grid';grid.style.overflowX='';grid.style.paddingBottom='';grid.style.gridTemplateColumns='repeat(4,1fr)';
    const c=cats.find(x=>x.id===journalView)||cats[0];
    sub.innerHTML=`<button class="jback" onclick="openJournal(null)">‹ Zones</button> <strong style="color:#5c4326;">${c.label}</strong> · ${c.seen}/${c.total}`;
    for(const ft of c.fish){
      const card=document.createElement('div');const s=seenFish[ft.name];
      card.className='journal-card'+(ft.legendary?' legendary-card':ft.night?' night-card':'')+(s?'':' unseen');
      const pre=ft.night?'🌙 ':ft.legendary?'⭐ ':'';
      if(s){card.innerHTML=(fishNews[ft.name]?'<span class="jnew-dot"></span>':'')+`<span class="jemoji">${ft.emoji}</span><div class="jname">${pre}${ft.name}</div><span class="jcount">🐟 ${s.count}</span>`;card.style.cursor='pointer';card.onclick=()=>openFishDetail(ft.name);}
      else{card.innerHTML=`<span class="jemoji">❓</span><div class="jname">???</div>`;}
      grid.appendChild(card);
    }
  }else{
    grid.onwheel=null;grid.classList.remove('hscroll');grid.style.display='grid';grid.style.overflowX='';grid.style.paddingBottom='';grid.style.gridTemplateColumns='1fr';
    const ft=FISH_DEFS.find(f=>f.name===journalFish);const s=seenFish[ft.name];
    const c=cats.find(x=>x.id===journalView);
    sub.innerHTML=`<button class="jback" onclick="openFishDetail(null)">‹ ${c?c.label:'Back'}</button>`;
    const pre=ft.legendary?'⭐ ':ft.night?'🌙 ':'';
    const zones=ft.zones.map(z=>ZONE_DEFS.find(zd=>zd.id===z)?.label||z).join(', ');
    const bestCm=s?s.bestCm:0;const bestKg=s?Math.round(fishWeight(bestCm)*10)/10:0;
    const recDot=(fishNews[ft.name]==='record')?'<span class="jnew-dot"></span>':'';
    const wrap=document.createElement('div');wrap.className='fish-detail';
    wrap.innerHTML=`<div class="fd-top"><span class="fd-emoji">${ft.emoji}</span><div><div class="fd-name">${pre}${ft.name}</div><div class="fd-zones">${zones}</div></div></div>`
      +`<div class="fd-desc">${ft.desc}</div>`
      +`<div class="fd-stats"><div class="fd-stat"><div class="k">Times caught</div><div class="v">${s?s.count:0}</div></div>`
      +`<div class="fd-stat">${recDot}<div class="k">Biggest catch</div><div class="v">${bestCm} cm · ${bestKg} kg</div></div>`
      +`<div class="fd-stat"><div class="k">Typical size</div><div class="v">${ft.cmRange[0]}–${ft.cmRange[1]} cm</div></div>`
      +`<div class="fd-stat"><div class="k">Found in</div><div class="v">${zones}</div></div>`
      +`<div class="fd-stat"><div class="k">Avg. sale value</div><div class="v">${(s&&s.soldN)?Math.round(s.soldSum/s.soldN)+'g':'—'}</div></div>`
      +`<div class="fd-stat"><div class="k">Sold range</div><div class="v">${(s&&s.soldN)?s.soldMin+'–'+s.soldMax+'g':'—'}</div></div></div>`;
    grid.appendChild(wrap);
    delete fishNews[ft.name];
  }
}
function closeJournal(){document.getElementById('journal-overlay').classList.remove('open');}
function openCargo(){buildCargoUI();document.getElementById('cargo-overlay').classList.add('open');}
function closeCargo(){document.getElementById('cargo-overlay').classList.remove('open');}
function buildCargoUI(){
  document.getElementById('cargo-cap').textContent=inventory.length+'/'+holdCap();
  const counts={};let totVal=0,totWt=0;
  for(const it of inventory){const n=it.type.name;const w=(it.weight!=null?it.weight:fishWeight((it.type.cmRange[0]+it.type.cmRange[1])/2));if(!counts[n])counts[n]={t:it.type,count:0,val:0,wt:0};counts[n].count++;counts[n].val+=it.value;counts[n].wt+=w;totVal+=it.value;totWt+=w;}
  const sum=document.getElementById('cargo-summary');
  const card=(lbl,v)=>`<div style="flex:1;background:#f1f3f5;border-radius:8px;padding:8px 10px;"><div style="font-size:10px;color:#888;">${lbl}</div><div style="font-size:17px;font-weight:600;color:#222;">${v}</div></div>`;
  sum.innerHTML=card('Total value',totVal+'g')+card('Total weight',(Math.round(totWt*10)/10)+' kg')+card('Fish',inventory.length);
  const list=document.getElementById('cargo-list');list.innerHTML='';
  if(!inventory.length){list.innerHTML='<div style="font-size:12px;color:#888;padding:8px 0;">Your cargo hold is empty. Cast a line and catch something!</div>';return;}
  const entries=Object.values(counts).sort((a,b)=>b.val-a.val);
  for(const v of entries){
    const ft=v.t;const pre=ft.legendary?'⭐ ':ft.night?'🌙 ':'';
    const row=document.createElement('div');row.className='shop-item';
    row.innerHTML=`<div style="font-size:22px;flex-shrink:0;">${ft.emoji}</div>`
      +`<div class="item-info"><div class="item-name">${pre}${ft.name} <small style="color:#888;">×${v.count}</small></div>`
      +`<div class="item-desc">${ft.sizeLabel} · ${ft.desc}</div></div>`
      +`<div style="text-align:right;flex-shrink:0;"><div style="font-size:12px;color:#1D9E75;font-weight:500;">${v.val}g</div><div style="font-size:10px;color:#888;">${Math.round(v.wt*10)/10} kg</div></div>`;
    list.appendChild(row);
  }
}
function openQuests(){renderQuestPanel();document.getElementById('quest-overlay').classList.add('open');}
function renderQuestPanel(){
  const mg=getMainGoal();const mgEl=document.getElementById('main-goal');
  if(mgEl)mgEl.innerHTML=`<div class="mg-label">⭐ Main Goal</div><div class="mg-title">${mg.title}</div><div class="mg-bar"><div class="mg-fill" style="width:${Math.round(mg.pct*100)}%"></div></div><div class="mg-hint">${mg.hint}</div>`;
  const ql=document.getElementById('quest-list-overlay');ql.innerHTML='';
  if(!activeQuests.length){ql.innerHTML='<div style="grid-column:1/-1;font-size:15px;color:#8a7050;padding:8px 0;">No active quests right now.</div>';}
  for(const q of activeQuests){
    const card=document.createElement('div');card.className='quest-card'+(q.completed?' done-card':'')+(q._fresh?' quest-enter':'');
    card.dataset.qid=q.id;if(q.completed)card.dataset.done='1';
    if(q.completed){
      card.innerHTML=`<div class="qtitle">✓ ${q.title}</div><div class="qdesc">${q.desc}</div>`
        +`<div class="qreward">Reward: +${q.reward.xp}XP${q.reward.gold?' +'+q.reward.gold+'g':''}</div>`
        +`<button class="claim-btn" onclick="claimQuest('${q.id}')">Complete</button>`;
    }else{
      const pct=Math.round(q.progress/q.target*100);
      card.innerHTML=`<div class="qtitle">${q.title}</div><div class="qdesc">${q.desc}</div>`
        +`<div class="quest-progress-bar"><div class="quest-progress-fill" style="width:${pct}%"></div></div>`
        +`<div class="qreward">+${q.reward.xp}XP${q.reward.gold?' +'+q.reward.gold+'g':''} · ${q.progress}/${q.target}</div>`;
    }
    delete q._fresh;ql.appendChild(card);
  }
}
function closeQuests(){document.getElementById('quest-overlay').classList.remove('open');}
const VENDOR_TITLES={fish:'\ud83d\udc1f Fishmonger',shop:'\ud83d\uded2 Supply Shop',ships:'\u2693 Shipwright',nav:'\ud83e\udded Harbormaster'};
function openShop(vendor){buildShopUI();const v=vendor||'fish';
  const t=document.getElementById('shop-title');if(t)t.textContent=VENDOR_TITLES[v]||'\ud83c\udfea Harbor';
  document.querySelectorAll('#shop-overlay .vsec').forEach(el=>{el.style.display=(el.dataset.v===v)?'':'none';});
  document.getElementById('shop-overlay').classList.add('open');}
function closeShop(){document.getElementById('shop-overlay').classList.remove('open');}
async function sellAll(){
  const total=inventory.reduce((s,i)=>s+i.value,0);if(!total)return;
  gold+=total;totalEarned+=total;questEarnedGold+=total;
  for(const it of inventory){const s=seenFish[it.type.name];if(!s)continue;if(s.soldN==null){s.soldN=0;s.soldSum=0;s.soldMin=null;s.soldMax=null;}s.soldN++;s.soldSum+=it.value;s.soldMin=(s.soldMin==null?it.value:Math.min(s.soldMin,it.value));s.soldMax=(s.soldMax==null?it.value:Math.max(s.soldMax,it.value));}
  floatCoins.push({x:wx2sx(LW-30),y:WY-20,alpha:1,label:'+'+total+'g'});
  inventory=[];updateHUD();renderInventoryBar();buildShopUI();updateQuestProgress('earn',{});setMsg(`Sold all for ${total}g!`);await saveGame();
}
function buyUpgrade(key){const def=UPG_DEFS[key];const lv=upgLevels[key];if(lv>=def.max)return;const cost=def.cost[lv];if(gold<cost)return;gold-=cost;upgLevels[key]++;updateHUD();buildShopUI();}
function buyZone(zid){const zdef=ZONE_DEFS.find(z=>z.id===zid);if(!zdef||zoneUnlocked[zid])return;if(playerLevel<zdef.reqLv){setMsg(`Need Level ${zdef.reqLv}!`);return;}if(gold<zdef.cost){setMsg(`Need ${zdef.cost}g!`);return;}gold-=zdef.cost;zoneUnlocked[zid]=true;syncZones();updateHUD();buildShopUI();setMsg(`${zdef.label} unlocked!`);}
function travelDestForZone(zid){
  if(zid==='market')return minBoatX();
  const z=ZONE_DEFS.find(x=>x.id===zid);if(!z)return null;
  if(boat.x<z.wx)return z.wx+30;           // approaching from the left -> just inside the left border
  if(boat.x>z.endWx)return Math.min(z.endWx-30,maxBoatX()); // from the right -> just inside the right border
  return null; // already inside this zone
}
function buildTravelDests(){
  const here=zoneAt(boat.x).id;
  const list=[{id:'market',label:'Harbor Market',x:minBoatX()}];
  for(const z of ZONE_DEFS){if(!zoneUnlocked[z.id])continue;if(z.id===here)continue; // skip the zone we're already in
    const x=travelDestForZone(z.id);if(x===null)continue;list.push({id:z.id,label:z.label,x});}
  return list;
}
function toggleTravel(){
  if(!hasAutopilot)return;
  if(autoTravelActive){deactivateTravel('Autopilot off.');return;}
  if(!(hookState==='idle'||hookState==='retrieving')){setMsg('Finish your line first!');return;}
  travelDests=buildTravelDests();travelIdx=0;autoTravelActive=true;autoTravelTarget=travelDests[0].x;
  setDrawerOpen(false);closeShop();
}
function cycleTravel(dir){
  if(!autoTravelActive||!travelDests.length)return;
  travelIdx=Math.max(0,Math.min(travelDests.length-1,travelIdx+dir));
  autoTravelTarget=travelDests[travelIdx].x;
}
function deactivateTravel(msg){autoTravelActive=false;autoTravelTarget=null;if(msg)setMsg(msg);}
function updateAutopilotUI(){const t=document.getElementById('ic-travel');if(t)t.style.display=hasAutopilot?'':'none';}
function buyAutopilot(){if(hasAutopilot)return;if(!zoneUnlocked.deep){setMsg('Unlocks after the Deep Sea!');return;}if(gold<150){setMsg('Need 150g!');return;}gold-=150;hasAutopilot=true;updateHUD();updateAutopilotUI();buildShopUI();setMsg('Autopilot installed! Press T to auto-sail.');}
function buildNavUI(){const el=document.getElementById('nav-list');if(!el)return;
  if(!zoneUnlocked.deep){el.innerHTML='<div class="item-desc" style="padding:4px 2px;">Unlocks after you reach the Deep Sea.</div>';return;}
  if(hasAutopilot){el.innerHTML='<div class="item-desc" style="padding:4px 2px;">✓ Autopilot installed — press T to auto-sail, then ← → to change destination.</div>';return;}
  el.innerHTML='';const row=document.createElement('div');row.className='shop-item';
  row.innerHTML='<div class="item-info"><div class="item-name">Autopilot</div><div class="item-desc">Auto-sail to the market or any unlocked zone</div></div>';
  const btn=document.createElement('button');btn.className='sbtn';btn.textContent='150g';btn.disabled=gold<150;btn.onclick=buyAutopilot;row.appendChild(btn);el.appendChild(row);
}
function buyBoat(id){const b=BOAT_DEFS.find(x=>x.id===id);if(!b||ownedBoats[id])return;if(gold<b.cost){setMsg(`Need ${b.cost}g!`);return;}gold-=b.cost;ownedBoats[id]=true;updateHUD();buildShopUI();setMsg(`${b.label} purchased!`);}
function equipBoat(id){const b=BOAT_DEFS.find(x=>x.id===id);if(!b||!ownedBoats[id]||activeBoat===id)return;if(inventory.length>b.hold){setMsg(`The ${b.label} only holds ${b.hold} — sell some fish first!`);return;}activeBoat=id;updateHUD();renderInventoryBar();buildShopUI();setMsg(`Now sailing the ${b.label}.`);}
function buildBoatUI(){
  const bl=document.getElementById('boat-list');if(!bl)return;bl.innerHTML='';
  for(const b of BOAT_DEFS){
    const owned=ownedBoats[b.id],active=activeBoat===b.id;
    const div=document.createElement('div');div.className='shop-item';
    const cv=document.createElement('canvas');cv.width=160;cv.height=100;cv.style.width='76px';cv.style.height='48px';cv.style.flexShrink='0';
    const cc=cv.getContext('2d');cc.scale(2,2);cc.translate(32,26);cc.scale(0.72,0.72);drawBoatShape(cc,b.id,0);
    div.appendChild(cv);
    const info=document.createElement('div');info.className='item-info';
    info.innerHTML=`<div class="item-name">${b.label}${active?' <small style=\"color:#1D9E75\">✓ sailing</small>':''}</div><div class="item-desc">${b.desc} · Hold ${b.hold}</div>`;
    div.appendChild(info);
    const btn=document.createElement('button');btn.className='sbtn';
    if(active){btn.textContent='Active';btn.disabled=true;}
    else if(owned){btn.textContent='Switch';btn.onclick=()=>equipBoat(b.id);}
    else{btn.textContent=b.cost+'g';btn.disabled=gold<b.cost;btn.onclick=()=>buyBoat(b.id);}
    div.appendChild(btn);bl.appendChild(div);
  }
}
function buildShopUI(){
  document.getElementById('shop-gold-val').textContent=gold;document.getElementById('shop-lv-val').textContent=playerLevel;
  const sl=document.getElementById('sell-list');sl.innerHTML='';
  if(!inventory.length)sl.innerHTML='<div style="font-size:11px;color:var(--color-text-secondary);">No fish in hold</div>';
  const counts={};for(const it of inventory){const n=it.type.name;if(!counts[n])counts[n]={count:0,val:0,emoji:it.type.emoji};counts[n].count++;counts[n].val+=it.value;}
  for(const [k,v] of Object.entries(counts)){const row=document.createElement('div');row.className='sell-row';row.innerHTML=`<span class="sn">${v.emoji} ${k} ×${v.count}</span><span class="sp">${v.val}g</span>`;sl.appendChild(row);}
  const hp=Math.round(inventory.length/holdCap()*100);sl.innerHTML+=`<div style="font-size:10px;color:var(--color-text-secondary);margin-top:3px;">Hold: ${inventory.length}/${holdCap()}</div><div class="hold-bar"><div class="hold-fill" style="width:${hp}%"></div></div>`;
  document.getElementById('sell-all-btn').disabled=!inventory.length;
  const ul=document.getElementById('upgrade-list');ul.innerHTML='';
  for(const [k,def] of Object.entries(UPG_DEFS)){const lv=upgLevels[k],maxed=lv>=def.max,cost=maxed?null:def.cost[lv];const div=document.createElement('div');div.className='shop-item';div.innerHTML=`<div class="item-info"><div class="item-name">${def.icon} ${def.label} <small style="color:var(--color-text-tertiary)">Lv${lv}/${def.max}</small></div><div class="item-desc">${def.desc}</div></div><button class="sbtn" ${maxed||gold<cost?'disabled':''} onclick="buyUpgrade('${k}')">${maxed?'Max':cost+'g'}</button>`;ul.appendChild(div);}
  const zl=document.getElementById('zone-list');zl.innerHTML='';
  buildBoatUI();buildNavUI();
  for(const zdef of ZONE_DEFS){const unlocked=zoneUnlocked[zdef.id];const canLv=playerLevel>=zdef.reqLv;const canGold=gold>=zdef.cost;const div=document.createElement('div');div.className='shop-item';const fishList=fishForZone(zdef.id,false).map(f=>f.emoji).join(' ');const nightList=fishForZone(zdef.id,true).filter(f=>f.night).map(f=>f.emoji).join('');if(unlocked){div.innerHTML=`<div class="item-info"><div class="item-name">${zdef.label}</div><div class="item-desc">Unlocked · ${zdef.fishMult}× · ${fishList}${nightList?' · 🌙'+nightList:''}</div></div><span style="font-size:11px;color:#1D9E75">✓</span>`;}else{div.innerHTML=`<div class="item-info"><div class="item-name">${zdef.label}</div><div class="item-desc">Lv${zdef.reqLv} + ${zdef.cost}g · ${zdef.fishMult}× · ${fishList}</div></div><button class="sbtn" ${(!canLv||!canGold)?'disabled':''} onclick="buyZone('${zdef.id}')">${!canLv?`Need Lv${zdef.reqLv}`:`${zdef.cost}g`}</button>`;}zl.appendChild(div);}
  const ql=document.getElementById('quest-list-shop');ql.innerHTML='';
  if(!activeQuests.length){ql.innerHTML='<div style="font-size:11px;color:var(--color-text-secondary);">No active quests</div>';}
  for(const q of activeQuests){const card=document.createElement('div');card.className='quest-card'+(q.completed?' done-card':'');const pct=Math.round(q.progress/q.target*100);card.innerHTML=`<div class="qtitle">${q.title}</div><div class="qdesc">${q.desc}</div><div class="quest-progress-bar"><div class="quest-progress-fill" style="width:${pct}%"></div></div><div class="qreward">+${q.reward.xp}XP${q.reward.gold?` +${q.reward.gold}g`:''} · ${q.progress}/${q.target}</div>`;ql.appendChild(card);}
  document.getElementById('save-info').textContent=saveTimestamp?`Saved ${new Date(saveTimestamp).toLocaleTimeString()} · Lv${playerLevel} · ${totalCaught} caught`:'Not saved yet.';
}
async function saveGame(){try{const d={gold,inventory:inventory.map(i=>({typeName:i.type.name,value:i.value,cm:i.cm,weight:i.weight})),upgLevels,zoneUnlocked,playerXP,playerLevel,totalCaught,totalEarned,seenFish,activeQuests,completedQuestIds,questEarnedGold,perfectCasts,timeOfDay,questNews,journalNews,fishNews,ownedBoats,activeBoat,hasAutopilot,tutorialSeen,savedAt:Date.now()};await window.storage.set(SAVE_KEY,JSON.stringify(d));saveTimestamp=d.savedAt;showToast('💾 Saved');}catch(e){showToast('⚠️ Failed');}}
async function loadGame(){try{const res=await window.storage.get(SAVE_KEY);if(!res)return false;const d=JSON.parse(res.value);gold=d.gold||0;inventory=(d.inventory||[]).map(it=>({type:FISH_DEFS.find(f=>f.name===it.typeName)||FISH_DEFS[0],typeName:it.typeName,value:it.value||0,cm:it.cm,weight:it.weight}));upgLevels={...{rod:0,bait:0,boat:0,hold:0,depth:0},...(d.upgLevels||{})};zoneUnlocked={...{shallow:true,deep:false,reef:false,abyss:false},...(d.zoneUnlocked||{})};playerXP=d.playerXP||0;playerLevel=d.playerLevel||1;totalCaught=d.totalCaught||0;totalEarned=d.totalEarned||0;seenFish=d.seenFish||{};activeQuests=(d.activeQuests||[]);completedQuestIds=d.completedQuestIds||[];questEarnedGold=d.questEarnedGold||0;perfectCasts=d.perfectCasts||0;timeOfDay=d.timeOfDay||0;questNews=!!d.questNews;journalNews=!!d.journalNews;fishNews=d.fishNews||{};ownedBoats={...{skiff:true,trawler:false,speedboat:false},...(d.ownedBoats||{})};activeBoat=d.activeBoat||'skiff';if(!ownedBoats[activeBoat])activeBoat='skiff';hasAutopilot=!!d.hasAutopilot;updateAutopilotUI();tutorialSeen=d.tutorialSeen||{};saveTimestamp=d.savedAt||null;return true;}catch(e){return false;}}
async function confirmReset(){if(confirm('Reset all progress?'))resetGame();}
async function resetGame(){try{await window.storage.delete(SAVE_KEY);}catch(e){}gold=0;inventory=[];upgLevels={rod:0,bait:0,boat:0,hold:0,depth:0};zoneUnlocked={shallow:true,deep:false,reef:false,abyss:false};playerXP=0;playerLevel=1;totalCaught=0;totalEarned=0;seenFish={};activeQuests=[];completedQuestIds=[];questEarnedGold=0;perfectCasts=0;timeOfDay=0;fishNews={};ownedBoats={skiff:true,trawler:false,speedboat:false};activeBoat='skiff';hasAutopilot=false;autoTravelTarget=null;updateAutopilotUI();saveTimestamp=null;boat.x=600;boat.vx=0;syncZones();pickNewQuests();renderQuestBar();updateHUD();renderInventoryBar();buildShopUI();showToast('🗑 Reset');}
let toastTimer=null;
function showToast(msg){const t=document.getElementById('save-toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2200);}
function setMsg(m){hudMsg=m;msgTimer=3;}
function updateHint(){
  if(gameMode==='harbor'){hudHint=harborNear?('press Space / tap to visit the '+harborNear.label):(harborAtExit?'press Space / tap to sail out to sea':'sail up to a building to visit · sail right to leave');return;}
  if(atMarket)hudHint='press Space / tap to enter the harbor';
  else if(hookState==='idle'&&charging)hudHint='release in the green zone to land on your set depth · bonus XP';
  else if(hookState==='idle')hudHint='W/S set cast depth · hold to charge, release to cast · sail left to market';
  else if(hookState==='sinking'||hookState==='waiting')hudHint='hook in water · R to retrieve';
  else if(hookState==='biting')hudHint='fish approaching! · SPACE or tap to reel';
  else if(hookState==='reeling_ready')hudHint='SPACE or tap to start reeling!';
  else if(hookState==='reeling')hudHint='hold SPACE to keep zone on fish · R to give up';
  else if(hookState==='retrieving')hudHint='retrieving hook...';
  else hudHint='';
  const drw=document.getElementById('drawer');
  if(drw){const dq=document.getElementById('dot-quests'),dj=document.getElementById('dot-journal');
    const claimable=activeQuests.some(q=>q.completed);const jNews=Object.keys(fishNews).length>0;
    if(dq)dq.classList.toggle('on',claimable);if(dj)dj.classList.toggle('on',jNews);
    drw.classList.toggle('has-news',claimable||jNews);}
}
function wx2sx(wx){return wx-camX;}

// ---- Harbor rendering & flow ----
function dk(hex,f){const c=hexToRgb(hex);return `rgb(${Math.round(c.r*f)},${Math.round(c.g*f)},${Math.round(c.b*f)})`;}
const HARBOR_BG=(()=>{const arr=[];const cols=['#6f8a9a','#7d9488','#9a8f7a','#88808f','#6e8f9c','#8a7f72'];
  const clusters=[[40,4],[350,3],[560,4],[880,2],[1040,4],[1330,3]];let n=0;
  for(const cl of clusters){let wx=cl[0];for(let k=0;k<cl[1];k++){const w=32+((n*23)%30),h=44+((n*57)%84);arr.push({wx:wx+w/2,w,h,col:cols[n%cols.length],chimney:(n%4===1)});wx+=w+6+((n*11)%14);n++;}}
  return arr;})();
function drawHarborBg(nightOv){const baseY=WY-6;for(const b of HARBOR_BG){const sx=wx2sx(b.wx);if(sx<-b.w-10||sx>CW+b.w+10)continue;
  ctx.fillStyle=dk(b.col,0.78-nightOv*0.45);ctx.fillRect(sx-b.w/2,baseY-b.h,b.w,b.h);
  ctx.fillStyle=dk(b.col,0.6-nightOv*0.4);ctx.beginPath();ctx.moveTo(sx-b.w/2-3,baseY-b.h);ctx.lineTo(sx,baseY-b.h-14);ctx.lineTo(sx+b.w/2+3,baseY-b.h);ctx.closePath();ctx.fill();
  if(nightOv>.35){ctx.fillStyle='rgba(255,213,74,0.7)';for(let wy=baseY-b.h+14;wy<baseY-14;wy+=22){ctx.fillRect(sx-b.w*0.28,wy,6,6);ctx.fillRect(sx+b.w*0.10,wy,6,6);}}
  if(b.chimney){const cx=sx+b.w*0.22,cyt=baseY-b.h;ctx.fillStyle=dk('#4f4436',1-nightOv*0.5);ctx.fillRect(cx-3,cyt-10,6,12);const t=Date.now()*0.001;for(let i=0;i<3;i++){const ph=((t*0.4+i*0.55)%1.6);const yy=cyt-12-ph*28,al=(1-ph/1.6)*0.3*(1-nightOv*0.25),rr=3+ph*4;if(al<=0.02)continue;ctx.fillStyle=`rgba(206,208,212,${al})`;ctx.beginPath();ctx.arc(cx+Math.sin(ph*3+b.wx)*4,yy,rr,0,Math.PI*2);ctx.fill();}}
}}
function drawLighthouse(nightOv){const sx=560-camX*0.18;if(sx<-60||sx>CW+60)return;const baseY=WY-6,H=132,topW=20,botW=30;
  if(nightOv>0.3){const lx=sx,ly=baseY-H-7,ang=-Math.PI/2+Math.sin(Date.now()*0.0004)*0.95,sp=0.11,len=300,a=(nightOv-0.3)*0.24;
    const g=ctx.createLinearGradient(lx,ly,lx+Math.cos(ang)*len,ly+Math.sin(ang)*len);g.addColorStop(0,`rgba(255,240,180,${a})`);g.addColorStop(1,'rgba(255,240,180,0)');ctx.fillStyle=g;
    ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(lx+Math.cos(ang-sp)*len,ly+Math.sin(ang-sp)*len);ctx.lineTo(lx+Math.cos(ang+sp)*len,ly+Math.sin(ang+sp)*len);ctx.closePath();ctx.fill();}
  ctx.beginPath();ctx.moveTo(sx-botW/2,baseY);ctx.lineTo(sx-topW/2,baseY-H);ctx.lineTo(sx+topW/2,baseY-H);ctx.lineTo(sx+botW/2,baseY);ctx.closePath();
  ctx.fillStyle=dk('#e9edf0',1-nightOv*0.5);ctx.fill();
  // red bands
  ctx.save();ctx.clip();ctx.fillStyle=dk('#d0473e',1-nightOv*0.5);for(let i=0;i<4;i++){ctx.fillRect(sx-botW,baseY-H+i*H*0.5/2*2*0.5,botW*2,H*0.12);}ctx.restore();
  // lamp room
  ctx.fillStyle=dk('#3a4a58',1-nightOv*0.5);ctx.fillRect(sx-topW/2-3,baseY-H-14,topW+6,14);
  const lamp=nightOv>.3?'#FFE07A':'#bfe6f5';ctx.fillStyle=lamp;ctx.fillRect(sx-topW/2+2,baseY-H-12,topW-4,10);
  if(nightOv>.3){ctx.fillStyle='rgba(255,224,122,0.28)';ctx.beginPath();ctx.arc(sx,baseY-H-7,20,0,Math.PI*2);ctx.fill();}
  ctx.fillStyle=dk('#2a3644',1-nightOv*0.5);ctx.beginPath();ctx.moveTo(sx-topW/2-5,baseY-H-14);ctx.lineTo(sx,baseY-H-26);ctx.lineTo(sx+topW/2+5,baseY-H-14);ctx.closePath();ctx.fill();
}
function pCrate(sx,by,n,s){s=s||16;ctx.fillStyle=dk('#b07f43',1-n*0.5);ctx.fillRect(sx-s/2,by-s,s,s);ctx.strokeStyle=dk('#7a5427',1-n*0.5);ctx.lineWidth=1.5;ctx.strokeRect(sx-s/2,by-s,s,s);ctx.beginPath();ctx.moveTo(sx-s/2,by-s);ctx.lineTo(sx+s/2,by);ctx.moveTo(sx+s/2,by-s);ctx.lineTo(sx-s/2,by);ctx.stroke();}
function pCrateStack(sx,by,n){pCrate(sx-6,by,n,18);pCrate(sx+10,by,n,15);pCrate(sx,by-18,n,14);}
function pBarrel(sx,by,n){const w=14,h=20;ctx.fillStyle=dk('#8a5a33',1-n*0.5);ctx.beginPath();ctx.roundRect(sx-w/2,by-h,w,h,4);ctx.fill();ctx.strokeStyle=dk('#5e3c1f',1-n*0.5);ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(sx-w/2,by-h*0.7);ctx.lineTo(sx+w/2,by-h*0.7);ctx.moveTo(sx-w/2,by-h*0.35);ctx.lineTo(sx+w/2,by-h*0.35);ctx.stroke();}
function pBollard(sx,by,n){ctx.fillStyle=dk('#4a3a28',1-n*0.5);ctx.beginPath();ctx.roundRect(sx-5,by-20,10,20,3);ctx.fill();ctx.beginPath();ctx.arc(sx,by-20,6,Math.PI,0);ctx.fill();ctx.strokeStyle=dk('#8a6a3e',1-n*0.5);ctx.lineWidth=2;ctx.beginPath();ctx.arc(sx,by-9,8,0.15*Math.PI,0.85*Math.PI);ctx.stroke();}
function pLamp(sx,by,n){const on=n>.3;if(on){const rg=ctx.createLinearGradient(sx,WY+2,sx,WY+46);rg.addColorStop(0,'rgba(255,224,122,0.22)');rg.addColorStop(1,'rgba(255,224,122,0)');ctx.fillStyle=rg;ctx.fillRect(sx-4,WY+2,8,44);}ctx.strokeStyle=dk('#2f3b46',1-n*0.4);ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(sx,by);ctx.lineTo(sx,by-46);ctx.stroke();if(on){ctx.fillStyle='rgba(255,224,122,0.22)';ctx.beginPath();ctx.arc(sx,by-50,22,0,Math.PI*2);ctx.fill();}ctx.fillStyle=on?'#FFE08A':dk('#8a97a0',1-n*0.4);ctx.beginPath();ctx.roundRect(sx-5,by-56,10,12,3);ctx.fill();}
function pNet(sx,by,n){ctx.strokeStyle=dk('#cabf94',1-n*0.5);ctx.lineWidth=1;const w=24,h=18;for(let i=-2;i<=2;i++){ctx.beginPath();ctx.moveTo(sx+i*5,by);ctx.lineTo(sx+i*5,by-h);ctx.stroke();}for(let j=0;j<4;j++){ctx.beginPath();ctx.moveTo(sx-w/2,by-j*5);ctx.lineTo(sx+w/2,by-j*5);ctx.stroke();}}
function pRing(sx,by,n){ctx.lineWidth=4;ctx.strokeStyle=dk('#e6e6e6',1-n*0.5);ctx.beginPath();ctx.arc(sx,by-13,9,0,Math.PI*2);ctx.stroke();ctx.strokeStyle=dk('#d0473e',1-n*0.5);ctx.setLineDash([5,5]);ctx.beginPath();ctx.arc(sx,by-13,9,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
function pBasket(sx,by,n){ctx.fillStyle=dk('#c9a05a',1-n*0.5);ctx.beginPath();ctx.moveTo(sx-11,by-14);ctx.lineTo(sx+11,by-14);ctx.lineTo(sx+8,by);ctx.lineTo(sx-8,by);ctx.closePath();ctx.fill();ctx.strokeStyle=dk('#9c7638',1-n*0.5);ctx.lineWidth=1;ctx.stroke();ctx.fillStyle=dk('#8fbfd8',1-n*0.4);ctx.beginPath();ctx.ellipse(sx-3,by-15,5,3,-0.3,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(sx+4,by-16,5,3,0.3,0,Math.PI*2);ctx.fill();}
function pRodBarrel(sx,by,n){pBarrel(sx,by,n);ctx.strokeStyle=dk('#c9a05a',1-n*0.4);ctx.lineWidth=1.6;for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(sx+i*3,by-16);ctx.lineTo(sx+i*7-5,by-46);ctx.stroke();}}
function pBaitTable(sx,by,n){const w=28,h=13;ctx.fillStyle=dk('#8a6a3e',1-n*0.5);ctx.fillRect(sx-w/2,by-h,w,3);ctx.fillStyle=dk('#6e522e',1-n*0.5);ctx.fillRect(sx-w/2+2,by-h,3,h);ctx.fillRect(sx+w/2-5,by-h,3,h);ctx.fillStyle=dk('#4E9BB0',1-n*0.5);ctx.fillRect(sx-11,by-h-8,10,8);ctx.fillStyle=dk('#C65D57',1-n*0.5);ctx.fillRect(sx+1,by-h-7,9,7);ctx.fillStyle=dk('#d9c25a',1-n*0.5);ctx.fillRect(sx-3,by-h-6,6,6);}
function pAnchor(sx,by,n){ctx.strokeStyle=dk('#5a6570',1-n*0.4);ctx.lineWidth=3;const topY=by-34;ctx.beginPath();ctx.moveTo(sx,topY);ctx.lineTo(sx,by-6);ctx.stroke();ctx.beginPath();ctx.arc(sx,topY-4,4,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(sx-9,topY+8);ctx.lineTo(sx+9,topY+8);ctx.stroke();ctx.beginPath();ctx.arc(sx,by-8,12,0.12*Math.PI,0.88*Math.PI);ctx.stroke();ctx.beginPath();ctx.moveTo(sx-11,by-10);ctx.lineTo(sx-16,by-15);ctx.moveTo(sx+11,by-10);ctx.lineTo(sx+16,by-15);ctx.stroke();}
function pSignpost(sx,by,n){ctx.strokeStyle=dk('#6e522e',1-n*0.5);ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(sx,by);ctx.lineTo(sx,by-42);ctx.stroke();const signs=[[-1,by-38,'#4E9BB0'],[1,by-29,'#d98a3a'],[-1,by-20,'#5BB08A']];for(const s of signs){const dir=s[0],yy=s[1],w=18;ctx.fillStyle=dk(s[2],1-n*0.45);ctx.beginPath();if(dir<0){ctx.moveTo(sx,yy-4);ctx.lineTo(sx-w+5,yy-4);ctx.lineTo(sx-w,yy);ctx.lineTo(sx-w+5,yy+4);ctx.lineTo(sx,yy+4);}else{ctx.moveTo(sx,yy-4);ctx.lineTo(sx+w-5,yy-4);ctx.lineTo(sx+w,yy);ctx.lineTo(sx+w-5,yy+4);ctx.lineTo(sx,yy+4);}ctx.closePath();ctx.fill();}}
function pFishCrate(sx,by,n){pCrate(sx,by,n,18);ctx.fillStyle=dk('#cfe6f0',1-n*0.4);ctx.fillRect(sx-9,by-22,18,5);ctx.fillStyle=dk('#8fbfd8',1-n*0.4);ctx.beginPath();ctx.ellipse(sx-4,by-22,5,3,-0.3,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(sx+4,by-23,5,3,0.3,0,Math.PI*2);ctx.fill();ctx.fillStyle=dk('#7fb0d0',1-n*0.4);ctx.beginPath();ctx.moveTo(sx-9,by-22);ctx.lineTo(sx-13,by-25);ctx.lineTo(sx-13,by-19);ctx.closePath();ctx.fill();}
function pRope(sx,by,n){ctx.strokeStyle=dk('#b7a271',1-n*0.5);ctx.lineWidth=2.5;for(let r=9;r>=3;r-=2.5){ctx.beginPath();ctx.ellipse(sx,by-4,r,r*0.5,0,0,Math.PI*2);ctx.stroke();}}
const HARBOR_PROPS=[
  {wx:150,t:'bollard'},{wx:190,t:'lamp'},
  {wx:244,t:'baittable'},{wx:352,t:'rodbarrel'},{wx:368,t:'rope'},{wx:214,t:'ring'},
  {wx:430,t:'crate'},{wx:448,t:'crate'},{wx:466,t:'barrel'},
  {wx:508,t:'lamp'},{wx:620,t:'rope'},{wx:646,t:'net'},{wx:735,t:'bollard'},{wx:600,t:'ring'},
  {wx:800,t:'barrel'},{wx:830,t:'lamp'},{wx:880,t:'bollard'},
  {wx:888,t:'anchor'},{wx:1002,t:'signpost'},{wx:1024,t:'lamp'},{wx:962,t:'bollard'},
  {wx:1120,t:'lamp'},{wx:1200,t:'basket'},{wx:1222,t:'fishcrate'},{wx:1216,t:'basket'},
  {wx:1380,t:'fishcrate'},{wx:1400,t:'basket'},{wx:1370,t:'cratestack'},{wx:1432,t:'barrel'},{wx:1444,t:'lamp'},
  {wx:1490,t:'bollard'},{wx:1520,t:'ring'}
];
function drawHarborProps(nightOv){const by=WY-6;for(const p of HARBOR_PROPS){const sx=wx2sx(p.wx);if(sx<-40||sx>CW+40)continue;
  switch(p.t){case'crate':pCrate(sx,by,nightOv);break;case'cratestack':pCrateStack(sx,by,nightOv);break;case'barrel':pBarrel(sx,by,nightOv);break;case'bollard':pBollard(sx,by,nightOv);break;case'lamp':pLamp(sx,by,nightOv);break;case'net':pNet(sx,by,nightOv);break;case'ring':pRing(sx,by,nightOv);break;case'basket':pBasket(sx,by,nightOv);break;case'rope':pRope(sx,by,nightOv);break;case'rodbarrel':pRodBarrel(sx,by,nightOv);break;case'baittable':pBaitTable(sx,by,nightOv);break;case'anchor':pAnchor(sx,by,nightOv);break;case'signpost':pSignpost(sx,by,nightOv);break;case'fishcrate':pFishCrate(sx,by,nightOv);break;}
}}
function drawMooredShip(sx,y,id,n){ctx.save();ctx.translate(sx,y);ctx.scale(-1,1);const sc=id==='trawler'?0.9:id==='speedboat'?0.86:0.8;ctx.scale(sc,sc);drawBoatShape(ctx,id,n);ctx.restore();}
function drawBuoy(sx,y,n){ctx.strokeStyle=dk('#333',1-n*0.4);ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(sx,y-11);ctx.lineTo(sx,y-19);ctx.stroke();ctx.fillStyle=dk('#333',1-n*0.4);ctx.beginPath();ctx.arc(sx,y-20,2,0,Math.PI*2);ctx.fill();ctx.fillStyle=dk('#d0473e',1-n*0.5);ctx.beginPath();ctx.arc(sx,y-6,6,0,Math.PI*2);ctx.fill();ctx.fillStyle=dk('#efe7d6',1-n*0.5);ctx.fillRect(sx-6,y-7,12,3);}
function drawRowboat(sx,y,n){ctx.fillStyle=dk('#7a4a24',1-n*0.5);ctx.beginPath();ctx.moveTo(sx-16,y-4);ctx.quadraticCurveTo(sx,y+9,sx+16,y-4);ctx.lineTo(sx+13,y-8);ctx.lineTo(sx-13,y-8);ctx.closePath();ctx.fill();ctx.fillStyle=dk('#5e3617',1-n*0.5);ctx.fillRect(sx-13,y-9,26,2);}
const HARBOR_WATER_OBJS=[{wx:665,t:'ship',slot:0},{wx:805,t:'ship',slot:1},{wx:1380,t:'boat'},{wx:1040,t:'buoy'},{wx:415,t:'buoy'}]
const HARBOR_LADDERS=[440,980,1420];
function drawHarborLadders(nightOv){const top=WY-4,bot=WY+30;ctx.strokeStyle=dk('#6e522e',1-nightOv*0.5);ctx.lineWidth=2.5;for(const wx of HARBOR_LADDERS){const sx=wx-camX;if(sx<-20||sx>CW+20)continue;ctx.beginPath();ctx.moveTo(sx-5,top);ctx.lineTo(sx-5,bot);ctx.moveTo(sx+5,top);ctx.lineTo(sx+5,bot);ctx.stroke();ctx.lineWidth=2;for(let y=top+6;y<bot;y+=8){ctx.beginPath();ctx.moveTo(sx-5,y);ctx.lineTo(sx+5,y);ctx.stroke();}ctx.lineWidth=2.5;}}
function drawHarborWaterObjs(nightOv,ts){for(const o of HARBOR_WATER_OBJS){const sx=wx2sx(o.wx);if(sx<-30||sx>CW+30)continue;const bob=Math.sin(ts*0.002+o.wx)*2;if(o.t==='ship'){const others=BOAT_DEFS.filter(b=>b.id!==activeBoat).map(b=>b.id);const id=others[o.slot];if(id)drawMooredShip(sx,WY-13+bob,id,nightOv);}else if(o.t==='boat'){drawRowboat(sx,WY+11+bob,nightOv);}else{drawBuoy(sx,WY+11+bob,nightOv);}}}
function startTransition(cb){if(fadePhase)return;fadePhase='out';fadeAction=cb;}
function enterHarbor(){closeShop();setDrawerOpen(false);startTransition(()=>{gameMode='harbor';boat.x=HARBOR_W-100;boat.vx=0;camX=Math.max(0,Math.min(HARBOR_W-CW,boat.x-CW/2));harborNear=null;setMsg('Welcome to the harbor. Sail right to head out to sea.');});}
function exitHarbor(){closeShop();startTransition(()=>{gameMode='play';boat.x=LW+170;boat.vx=0;camX=Math.max(0,Math.min(WW-CW,boat.x-CW/2));setMsg('Out to the open sea!');});}
function harborInteract(){if(harborNear){openShop(harborNear.id);}else if(harborAtExit){exitHarbor();}}
function drawHarborDock(nightOv){const y=WY-6,deckH=8;
  ctx.fillStyle=dk('#8a6a3e',1-nightOv*0.5);ctx.fillRect(0,y,CW,deckH);
  ctx.fillStyle=dk('#6e522e',1-nightOv*0.5);const s0=Math.floor(camX/18)*18;for(let wx=s0;wx<camX+CW+18;wx+=18)ctx.fillRect(wx-camX,y,2,deckH);
  ctx.fillStyle=dk('#5b431f',1-nightOv*0.5);const p0=Math.floor(camX/90)*90;for(let wx=p0;wx<camX+CW+90;wx+=90)ctx.fillRect(wx-camX-3,y+deckH,6,CH-(y+deckH));
  ctx.fillStyle='rgba(255,255,255,0.13)';for(let wx=p0;wx<camX+CW+90;wx+=90){ctx.beginPath();ctx.ellipse(wx-camX,WY+3,8,2.5,0,0,Math.PI*2);ctx.fill();}
}
function drawHarborBuilding(b,nightOv,hl){const sx=wx2sx(b.wx);if(sx<-b.w-20||sx>CW+b.w+20)return;const baseY=WY-6;
  ctx.fillStyle=dk(b.wall,1-nightOv*0.55);ctx.fillRect(sx-b.w/2,baseY-b.h,b.w,b.h);
  ctx.fillStyle=dk(b.roof,1-nightOv*0.55);ctx.beginPath();ctx.moveTo(sx-b.w/2-6,baseY-b.h);ctx.lineTo(sx-b.w*0.18,baseY-b.h-26);ctx.lineTo(sx+b.w*0.18,baseY-b.h-26);ctx.lineTo(sx+b.w/2+6,baseY-b.h);ctx.closePath();ctx.fill();
  ctx.fillStyle=dk('#5C3410',1-nightOv*0.4);ctx.beginPath();ctx.roundRect(sx-9,baseY-26,18,26,2);ctx.fill();
  const win=nightOv>.3?'#FFD54A':'#bfe6f5';[[-b.w*0.30,-b.h+16],[b.w*0.30-12,-b.h+16]].forEach(w=>{ctx.fillStyle=win;ctx.fillRect(sx+w[0],baseY+w[1],12,12);if(nightOv>.3){ctx.fillStyle='rgba(255,213,74,0.28)';ctx.beginPath();ctx.arc(sx+w[0]+6,baseY+w[1]+6,10,0,Math.PI*2);ctx.fill();}});
  if(b.big){const ay=baseY-b.h+14;for(let i=0;i<Math.ceil(b.w/14);i++){ctx.fillStyle=i%2?'#efe7d6':'#c94a3f';ctx.fillRect(sx-b.w/2+i*14,ay,14,10);}
    const fy=baseY-b.h+30,fc=['#c96b4a','#8fbfd8','#d9c25a','#9ac0a0'];for(let i=0;i<4;i++){const fx=sx-30+i*20;ctx.strokeStyle=dk('#555',1-nightOv*0.4);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(fx,fy-6);ctx.lineTo(fx,fy);ctx.stroke();ctx.fillStyle=dk(fc[i],1-nightOv*0.4);ctx.beginPath();ctx.ellipse(fx,fy+5,4,7,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.moveTo(fx,fy+11);ctx.lineTo(fx-3,fy+15);ctx.lineTo(fx+3,fy+15);ctx.closePath();ctx.fill();}}
  ctx.fillStyle='#5C3410';ctx.fillRect(sx-24,baseY-b.h-4,48,14);ctx.fillStyle='#FAC775';ctx.font='bold 9px sans-serif';ctx.textAlign='center';ctx.fillText(b.sign,sx,baseY-b.h+6);ctx.textAlign='left';
  if(b.flag){const peakY=baseY-b.h-26,poleTop=peakY-20;ctx.strokeStyle=dk('#6b5233',1-nightOv*0.4);ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(sx,peakY);ctx.lineTo(sx,poleTop);ctx.stroke();const fw=Math.sin(Date.now()*0.004+b.wx)*3;ctx.fillStyle=dk(b.flag,1-nightOv*0.45);ctx.beginPath();ctx.moveTo(sx,poleTop);ctx.lineTo(sx+16,poleTop+4+fw);ctx.lineTo(sx,poleTop+9);ctx.closePath();ctx.fill();}
  if(hl){ctx.strokeStyle='#1D9E75';ctx.lineWidth=2;ctx.setLineDash([5,3]);ctx.beginPath();ctx.roundRect(sx-b.w/2-5,baseY-b.h-30,b.w+10,b.h+34,6);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='rgba(0,0,0,0.55)';ctx.beginPath();ctx.roundRect(sx-52,baseY-b.h-54,104,18,6);ctx.fill();ctx.fillStyle='#7fe8c0';ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.fillText('\u25b2 '+b.label,sx,baseY-b.h-41);ctx.textAlign='left';}
}
function drawHarborExit(nightOv){const sx=wx2sx(HARBOR_W-30);if(sx<-60||sx>CW+80)return;ctx.fillStyle='rgba(0,0,0,0.42)';ctx.beginPath();ctx.roundRect(sx-54,WY-72,108,18,6);ctx.fill();ctx.fillStyle=harborAtExit?'#7fe8c0':'#cfe6f0';ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.fillText('\u2192 Out to sea',sx,WY-59);ctx.textAlign='left';if(harborAtExit){ctx.strokeStyle='#1D9E75';ctx.lineWidth=2;ctx.setLineDash([5,3]);ctx.beginPath();ctx.roundRect(sx-34,WY-48,68,50,6);ctx.stroke();ctx.setLineDash([]);}}
function drawHarborWorld(nightOv,ts){
  ctx.fillStyle='#a9dcf0';ctx.fillRect(0,-320,CW,CH+TITLE_LIFT*2+320);
  if(nightOv>0){ctx.fillStyle=`rgba(5,8,30,${nightOv*0.82})`;ctx.fillRect(0,-320,CW,WY+320);for(const s of stars){const a=nightOv*(.4+.6*Math.abs(Math.sin(s.twinkle)));ctx.globalAlpha=a;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;}
  {const horizonY=WY-10,peakY=HUD_H+10,arcH=horizonY-peakY,arcL=CW*0.08,arcR=CW*0.92,ef=(p)=>Math.max(0,Math.min(1,Math.min(p,1-p)/0.07));
   if(timeOfDay<DAY_DUR){const p=timeOfDay/DAY_DUR,x=arcL+(arcR-arcL)*p,y=horizonY-Math.sin(Math.PI*p)*arcH;ctx.globalAlpha=ef(p);ctx.fillStyle='rgba(255,215,0,0.22)';ctx.beginPath();ctx.arc(x,y,26,0,Math.PI*2);ctx.fill();ctx.fillStyle='#FFD700';ctx.beginPath();ctx.arc(x,y,16,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
   else{const p=(timeOfDay-DAY_DUR)/NIGHT_DUR,x=arcL+(arcR-arcL)*p,y=horizonY-Math.sin(Math.PI*p)*arcH,mR=15;ctx.globalAlpha=ef(p);const dg=ctx.createRadialGradient(x-mR*0.32,y-mR*0.32,mR*0.2,x,y,mR);dg.addColorStop(0,'#fbf6de');dg.addColorStop(1,'#e4daac');ctx.fillStyle=dg;ctx.beginPath();ctx.arc(x,y,mR,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}}
  const wc=currentWaterColor(nightOv);ctx.fillStyle=wc;ctx.fillRect(0,WY,CW,CH-WY);
  const wg=ctx.createLinearGradient(0,WY,0,CH);wg.addColorStop(0,'rgba(255,255,255,0.06)');wg.addColorStop(1,'rgba(0,20,40,0.28)');ctx.fillStyle=wg;ctx.fillRect(0,WY,CW,CH-WY);
  drawLighthouse(nightOv);
  drawHarborBg(nightOv);
  drawHarborDock(nightOv);
  drawHarborLadders(nightOv);
  for(const b of HARBOR_BUILDINGS)drawHarborBuilding(b,nightOv,harborNear===b);
  drawHarborProps(nightOv);
  drawHarborWaterObjs(nightOv,ts);
  drawHarborExit(nightOv);
  drawBoat(wx2sx(boat.x),boat.y+5,boat.facing,nightOv);
}
function renderHarbor(ts){const nightOv=getNightOverlay();ctx.save();ctx.translate(0,-camY+titleLift);drawHarborWorld(nightOv,ts);ctx.restore();if(uiAlpha>0.01){ctx.globalAlpha=uiAlpha;drawCanvasHUD(nightOv);ctx.globalAlpha=1;}}
// ── Render ──
function render(ts){
  ctx.clearRect(0,0,CW,CH);
  if(gameMode==='harbor'){renderHarbor(ts);if(sceneFade>0){ctx.fillStyle=`rgba(0,0,0,${sceneFade})`;ctx.fillRect(0,0,CW,CH);}return;}
  const cz=zoneAt(boat.x);const nightOv=getNightOverlay();

  ctx.save();ctx.translate(0,-camY+titleLift);
  // Sky base
  ctx.fillStyle=cz.skyTint;ctx.fillRect(0,-320,CW,CH+TITLE_LIFT*2+320);

  // Night overlay (darkness + stars)
  if(nightOv>0){
    ctx.fillStyle=`rgba(5,8,30,${nightOv*0.82})`;ctx.fillRect(0,-320,CW,WY+320);
    for(const s of stars){const a=nightOv*(.4+.6*Math.abs(Math.sin(s.twinkle)));ctx.globalAlpha=a;ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=1;
  }
  // Sun & moon share one arc across the sky (left -> right), each on its half of the cycle
  {
    const horizonY=WY-10,peakY=HUD_H+10,arcH=horizonY-peakY,arcL=CW*0.08,arcR=CW*0.92;
    const ef=(p)=>Math.max(0,Math.min(1,Math.min(p,1-p)/0.07));
    if(timeOfDay<DAY_DUR){
      const p=timeOfDay/DAY_DUR,x=arcL+(arcR-arcL)*p,y=horizonY-Math.sin(Math.PI*p)*arcH;
      ctx.globalAlpha=ef(p);
      ctx.fillStyle='rgba(255,215,0,0.22)';ctx.beginPath();ctx.arc(x,y,26,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#FFD700';ctx.beginPath();ctx.arc(x,y,16,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=1;
    }else{
      const p=(timeOfDay-DAY_DUR)/NIGHT_DUR,x=arcL+(arcR-arcL)*p,y=horizonY-Math.sin(Math.PI*p)*arcH,moonR=15;
      ctx.globalAlpha=ef(p);
      // soft glow
      const mg=ctx.createRadialGradient(x,y,moonR*0.5,x,y,moonR+12);mg.addColorStop(0,'rgba(240,235,205,0.30)');mg.addColorStop(1,'rgba(240,235,205,0)');ctx.fillStyle=mg;ctx.beginPath();ctx.arc(x,y,moonR+12,0,Math.PI*2);ctx.fill();
      // full moon disc with a little soft shading
      const dg=ctx.createRadialGradient(x-moonR*0.32,y-moonR*0.32,moonR*0.2,x,y,moonR);dg.addColorStop(0,'#fbf6de');dg.addColorStop(1,'#e4daac');
      ctx.fillStyle=dg;ctx.beginPath();ctx.arc(x,y,moonR,0,Math.PI*2);ctx.fill();
      // craters
      ctx.fillStyle='rgba(196,186,148,0.5)';
      [[-0.34,0.30,2.6],[0.30,-0.28,1.9],[0.06,0.46,1.5],[-0.5,-0.12,1.3],[0.44,0.20,1.2],[-0.1,-0.42,1.1]].forEach(cr=>{ctx.beginPath();ctx.arc(x+cr[0]*moonR,y+cr[1]*moonR,cr[2],0,Math.PI*2);ctx.fill();});
      ctx.globalAlpha=1;
    }
  }

  // ── Parallax background scenery (per zone, faded by world position) ──
  const viewX=camX+CW/2;
  // Coast mountains (none anchored past the deep-sea boundary; the last may bleed into the sea)
  for(const m of mountainsFar){if(m.wx>=2000)continue;const sx=m.wx-camX*0.7;if(sx<-m.w||sx>CW+m.w)continue;ctx.fillStyle=nightOv>.5?'#3e4f6a':'#9fb8cf';ctx.beginPath();ctx.moveTo(sx-m.w/2,WY);ctx.lineTo(sx,WY-m.h);ctx.lineTo(sx+m.w/2,WY);ctx.closePath();ctx.fill();}
  for(const m of mountainsNear){if(m.wx>=2000)continue;const sx=m.wx-camX*0.82;if(sx<-m.w||sx>CW+m.w)continue;ctx.fillStyle=nightOv>.5?'#30405c':'#7d97b2';ctx.beginPath();ctx.moveTo(sx-m.w/2,WY);ctx.lineTo(sx,WY-m.h);ctx.lineTo(sx+m.w/2,WY);ctx.closePath();ctx.fill();ctx.fillStyle=nightOv>.5?'#52648a':'#bcd2e3';ctx.beginPath();ctx.moveTo(sx,WY-m.h);ctx.lineTo(sx-m.w*0.13,WY-m.h*0.68);ctx.lineTo(sx+m.w*0.13,WY-m.h*0.68);ctx.closePath();ctx.fill();}
  if(weatherFx==='fog'&&weatherAmt>0.01){ctx.fillStyle=`rgba(228,233,238,${0.7*weatherAmt})`;ctx.fillRect(0,-320,CW,WY+320);}
  if(weatherFx==='storm'&&weatherAmt>0.01){ctx.fillStyle=`rgba(26,34,54,${0.4*weatherAmt})`;ctx.fillRect(0,-320,CW,WY+320);}
  // Coral Reef distant islets fading in/out
  const reefA=Math.max(0,Math.min(1,Math.min((viewX-3500)/500,(6300-viewX)/500)))*(1-nightOv*0.4);
  if(reefA>0.01){
    ctx.globalAlpha=reefA*0.7;ctx.fillStyle=nightOv>.5?'#1e3328':'#3f7d5a';
    for(const m of reefIslets){const sx=m.wx-camX*0.3;if(sx<-m.w||sx>CW+m.w)continue;ctx.beginPath();ctx.ellipse(sx,WY,m.w/2,m.h,0,Math.PI,0,true);ctx.fill();}
    ctx.globalAlpha=1;
  }
  // The Abyss: ominous darkening of the horizon
  const abyssA=Math.max(0,Math.min(1,(viewX-5800)/500));
  if(abyssA>0.01){const gg=ctx.createLinearGradient(0,-320,0,WY);gg.addColorStop(0,`rgba(8,6,24,${abyssA*0.55})`);gg.addColorStop(1,`rgba(20,12,40,${abyssA*0.28})`);ctx.fillStyle=gg;ctx.fillRect(0,-320,CW,WY+320);}

  // Birds drifting in the sky (flapping silhouettes)
  for(const b of birds){const lift=Math.sin(b.flap)*b.size*0.6,s=b.size;ctx.strokeStyle=nightOv>.5?'rgba(205,215,235,0.55)':'rgba(55,72,96,0.6)';ctx.lineWidth=1.6;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(b.wx-s,b.wy-lift);ctx.lineTo(b.wx,b.wy+s*0.18);ctx.lineTo(b.wx+s,b.wy-lift);ctx.stroke();}
  ctx.lineCap='butt';
  // Clouds (hidden at night)
  if(nightOv<0.8)for(const c of clouds){const sx=((c.wx-camX*c.p)%(WW+CW)+WW+CW)%(WW+CW)-80;ctx.globalAlpha=1-nightOv*.7;ctx.fillStyle='rgba(255,255,255,0.72)';ctx.beginPath();ctx.ellipse(sx,c.wy,c.cw*.5,16,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(sx-c.cw*.18,c.wy+6,c.cw*.35,12,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(sx+c.cw*.22,c.wy+5,c.cw*.28,11,0,0,Math.PI*2);ctx.fill();}
  ctx.globalAlpha=1;

  // Land (coastal island: sky above, grass strip, dirt ledge into deep water)
  const lE=wx2sx(LW);
  if(lE>0){const lx=Math.max(0,wx2sx(0)),lw=Math.min(lE,CW)-lx;if(lw>0){
    const LEDGE=80;
    // water beneath the ledge, matching the main water for a seamless join
    let lwc=currentWaterColor(nightOv);
    ctx.fillStyle=lwc;ctx.fillRect(lx,WY,lw,SEA_BOTTOM-WY);
    const lwg=ctx.createLinearGradient(0,WY,0,SEA_BOTTOM);lwg.addColorStop(0,'rgba(4,44,83,0)');lwg.addColorStop(0.35,`rgba(3,32,62,${0.45+nightOv*.2})`);lwg.addColorStop(0.7,`rgba(2,18,40,${0.8+nightOv*.15})`);lwg.addColorStop(1,'rgba(1,7,20,0.97)');ctx.fillStyle=lwg;ctx.fillRect(lx,WY,lw,SEA_BOTTOM-WY);
    // dirt ledge below the waterline
    ctx.fillStyle=nightOv>.5?'#3a2a18':'#7a5732';ctx.fillRect(lx,WY,lw,LEDGE);
    ctx.fillStyle='rgba(0,0,0,0.10)';for(let i=0;i<Math.ceil(lw/24);i++)ctx.fillRect(lx+i*24+8,WY+10,3,LEDGE-18);
    ctx.fillStyle=nightOv>.5?'#241a0e':'#5e451f';ctx.fillRect(lx,WY+LEDGE-5,lw,5);
    // grass strip on the surface
    ctx.fillStyle=nightOv>.5?'#2a3a1a':'#6a9a3a';ctx.fillRect(lx,WY-10,lw,12);
    ctx.fillStyle=nightOv>.5?'#3a4a2a':'#8fae5a';ctx.fillRect(lx,WY-10,lw,5);
    ctx.fillStyle=nightOv>.5?'#1e2e0e':'#5c7e2e';ctx.fillRect(lE-7,WY-10,7,12);
    // trees on the grass (scroll cohesively with the island)
    [{wx:16,h:42},{wx:104,h:34},{wx:120,h:38}].forEach(tr=>{const tx=wx2sx(tr.wx);if(tx<-30||tx>lE+4)return;ctx.fillStyle=nightOv>.5?'#3a2a14':'#5C3410';ctx.fillRect(tx-3,WY-tr.h*.35,6,tr.h*.35);ctx.fillStyle=nightOv>.5?'#1a3a12':'#3a6b28';ctx.beginPath();ctx.arc(tx,WY-tr.h*.8,tr.h*.35,0,Math.PI*2);ctx.fill();ctx.fillStyle=nightOv>.5?'#102808':'#2d5520';ctx.beginPath();ctx.arc(tx-4,WY-tr.h*.9,tr.h*.25,0,Math.PI*2);ctx.fill();});
    const msx=wx2sx(65);ctx.fillStyle='#DEB887';ctx.fillRect(msx-26,WY-65,52,55);ctx.fillStyle='#8B4513';ctx.beginPath();ctx.moveTo(msx-32,WY-65);ctx.lineTo(msx,WY-92);ctx.lineTo(msx+32,WY-65);ctx.closePath();ctx.fill();
    ctx.fillStyle='#7B4A1E';ctx.beginPath();ctx.roundRect(msx-9,WY-28,18,28,2);ctx.fill();
    const winColor=nightOv>.3?'#FFD700':'#aaddf5';ctx.fillStyle=winColor;ctx.fillRect(msx-22,WY-58,13,13);ctx.fillRect(msx+9,WY-58,13,13);
    if(nightOv>.3){ctx.fillStyle='rgba(255,215,0,0.3)';ctx.beginPath();ctx.ellipse(msx-16,WY-52,10,10,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(msx+16,WY-52,10,10,0,0,Math.PI*2);ctx.fill();}
    ctx.strokeStyle='#7B4A1E';ctx.lineWidth=1;ctx.strokeRect(msx-22,WY-58,13,13);ctx.strokeRect(msx+9,WY-58,13,13);
    ctx.fillStyle='#5C3410';ctx.fillRect(msx-18,WY-76,36,11);ctx.fillStyle='#FAC775';ctx.font='bold 8px sans-serif';ctx.textAlign='center';ctx.fillText('⚓ HARBOR',msx,WY-68);ctx.textAlign='left';
    if(atMarket){ctx.strokeStyle='#1D9E75';ctx.lineWidth=2;ctx.setLineDash([4,3]);ctx.beginPath();ctx.roundRect(wx2sx(65)-30,WY-98,60,98,6);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='rgba(0,0,0,0.5)';ctx.beginPath();ctx.roundRect(wx2sx(65)-28,WY-112,56,14,5);ctx.fill();ctx.fillStyle='#7fe8c0';ctx.font='10px sans-serif';ctx.textAlign='center';ctx.fillText('Enter Harbor',wx2sx(65),WY-102);ctx.textAlign='left';}
  }}


  // Water
  const wSX=Math.max(0,wx2sx(LW));
  let wc=currentWaterColor(nightOv);
  ctx.fillStyle=wc;ctx.fillRect(wSX,WY,CW-wSX,SEA_BOTTOM-WY);
  const wg=ctx.createLinearGradient(0,WY,0,SEA_BOTTOM);wg.addColorStop(0,'rgba(4,44,83,0)');wg.addColorStop(0.35,`rgba(3,32,62,${0.45+nightOv*.2})`);wg.addColorStop(0.7,`rgba(2,18,40,${0.8+nightOv*.15})`);wg.addColorStop(1,'rgba(1,7,20,0.97)');ctx.fillStyle=wg;ctx.fillRect(wSX,WY,CW-wSX,SEA_BOTTOM-WY);
  for(let i=0;i<10;i++){const sx=((i*79+ts*.013-camX*.4)%CW+CW)%CW;if(sx<wSX)continue;ctx.fillStyle='rgba(255,255,255,0.05)';ctx.fillRect(sx,WY,32+i*4,2.5);}
  // Moon reflection
  if(nightOv>.3){ctx.fillStyle=`rgba(200,200,255,${nightOv*.06})`;ctx.fillRect(wSX,WY,CW-wSX,CH-WY);}


  // Seabed
  ctx.fillStyle='rgba(8,18,34,0.97)';ctx.fillRect(0,SEA_BOTTOM-16,CW,40);
  for(const d of seaDecor){const sx=wx2sx(d.wx);if(sx<-20||sx>CW+20||sx<wSX)continue;ctx.strokeStyle=nightOv>.5?'rgba(100,200,255,0.28)':'rgba(29,158,117,0.42)';ctx.lineWidth=d.w*.35;ctx.beginPath();if(d.type===0){ctx.moveTo(sx,SEA_BOTTOM-16);ctx.bezierCurveTo(sx-7,SEA_BOTTOM-16-d.h*.4,sx+7,SEA_BOTTOM-16-d.h*.7,sx,SEA_BOTTOM-16-d.h);}else if(d.type===1){ctx.moveTo(sx,SEA_BOTTOM-16);ctx.bezierCurveTo(sx+9,SEA_BOTTOM-16-d.h*.5,sx-5,SEA_BOTTOM-16-d.h*.8,sx+3,SEA_BOTTOM-16-d.h);}else{ctx.fillStyle='rgba(90,50,15,0.32)';ctx.ellipse(sx,SEA_BOTTOM-11,d.w*1.4,5,0,0,Math.PI*2);ctx.fill();continue;}ctx.stroke();}
  drawReefDecor(nightOv);

  // Light shafts (god rays from surface)
  const shaftBot=WY+WATER_DEPTH*0.42;
  for(const sh of shafts){const sx=wx2sx(sh.wx);if(sx<wSX-60||sx>CW+60)continue;const topW=sh.w*0.35,botW=sh.w;ctx.beginPath();ctx.moveTo(sx-topW/2,WY);ctx.lineTo(sx+topW/2,WY);ctx.lineTo(sx+botW/2,shaftBot);ctx.lineTo(sx-botW/2,shaftBot);ctx.closePath();const sa=(nightOv>.5?0.04:0.09)*sh.p;ctx.fillStyle=nightOv>.5?`rgba(150,200,255,${sa})`:`rgba(255,255,240,${sa})`;ctx.fill();}
  // Drifting motes (plankton/particles)
  for(const m of motes){const sx=wx2sx(m.wx);if(sx<wSX||sx>CW)continue;ctx.globalAlpha=m.alpha*(nightOv>.5?1.3:1);ctx.fillStyle=nightOv>.5?'#9fd4ff':'#dff2ff';ctx.beginPath();ctx.arc(sx,m.wy,m.r,0,Math.PI*2);ctx.fill();}
  ctx.globalAlpha=1;
  // Bubbles
  for(const b of bubbles){const sx=wx2sx(b.wx)+Math.sin(b.wob)*1.5;if(sx<wSX||sx>CW)continue;ctx.beginPath();ctx.arc(sx,b.wy,b.r,0,Math.PI*2);ctx.strokeStyle=`rgba(255,255,255,${b.alpha})`;ctx.lineWidth=.8;ctx.stroke();}

  // Fish
  for(const f of worldFish){
    if(f.state==='hooked')continue;const sx=wx2sx(f.wx);if(sx<-80||sx>CW+80)continue;
    const len=f.type.len,dir=f.vx>=0?1:-1,wr=f.type.wr||1,hr=f.type.hr||1;
    ctx.save();ctx.translate(sx,f.wy+Math.sin(f.t*3+f.yOff)*2);ctx.scale(dir,1);
    if(f.type.legendary||f.type.night){ctx.shadowColor=f.type.color;ctx.shadowBlur=f.type.night?14:10;}
    ctx.fillStyle=f.type.color+'cc';ctx.beginPath();ctx.ellipse(0,0,len*.5*wr,len*.22*hr,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=f.type.color+'88';ctx.beginPath();ctx.moveTo(-len*.5*wr,0);ctx.lineTo(-len*.8*wr,-len*.18*hr);ctx.lineTo(-len*.8*wr,len*.18*hr);ctx.closePath();ctx.fill();
    // Bioluminescence pulse for night fish
    if(f.type.night){const pulse=.3+.3*Math.sin(f.t*3);ctx.globalAlpha=pulse;ctx.fillStyle=f.type.color+'66';ctx.beginPath();ctx.ellipse(0,0,len*.7*wr,len*.35*hr,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
    ctx.shadowBlur=0;
    if(f.type.legendary){ctx.font=`${Math.max(8,len*.3)}px sans-serif`;ctx.textAlign='center';ctx.fillText('⭐',0,-len*.35);ctx.textAlign='left';}
    if(f===currentFish){ctx.strokeStyle='rgba(250,199,117,0.7)';ctx.lineWidth=0.7;ctx.beginPath();ctx.ellipse(0,0,len*.52*wr,len*.24*hr,0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(-len*.5*wr,0);ctx.lineTo(-len*.82*wr,-len*.2*hr);ctx.lineTo(-len*.82*wr,len*.2*hr);ctx.closePath();ctx.stroke();}
    ctx.restore();
    if(f.state==='approach'){ctx.strokeStyle='rgba(250,199,117,0.55)';ctx.lineWidth=1.2;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(sx,f.wy);ctx.lineTo(wx2sx(hookWorldX),hookY);ctx.stroke();ctx.setLineDash([]);}
  }

  // Zone boundaries
  for(const z of ZONES){if(z.id==='shallow')continue;const bsx=wx2sx(z.wx);if(bsx<-10||bsx>CW+10)continue;ctx.strokeStyle=z.unlocked?'rgba(29,158,117,0.45)':'rgba(226,75,74,0.5)';ctx.lineWidth=z.unlocked?1:2;ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(bsx,WY);ctx.lineTo(bsx,CH);ctx.stroke();ctx.setLineDash([]);if(!z.unlocked){ctx.fillStyle='rgba(226,75,74,0.1)';ctx.fillRect(bsx,WY,18,CH-WY);}ctx.fillStyle='rgba(0,0,0,0.38)';ctx.beginPath();ctx.roundRect(bsx-38,WY+8,76,18,4);ctx.fill();ctx.fillStyle=z.unlocked?'rgba(120,240,190,0.9)':'rgba(255,160,160,0.9)';ctx.font='9px sans-serif';ctx.textAlign='center';ctx.fillText(z.unlocked?z.label:`🔒 Lv${ZONE_DEFS.find(zd=>zd.id===z.id).reqLv}+${ZONE_DEFS.find(zd=>zd.id===z.id).cost}g`,bsx,WY+20);ctx.textAlign='left';}

  // Hook & line
  const bsx=wx2sx(boat.x);
  const _rt=boatRodTip();const rodTipX=bsx+boat.facing*_rt.lx,rodTipY=boat.y+_rt.ly;
  if(hookState!=='idle'&&hookState!=='charging'){
    const hsx=wx2sx(hookWorldX);
    ctx.strokeStyle='rgba(200,200,200,0.8)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(rodTipX,rodTipY);ctx.quadraticCurveTo((rodTipX+hsx)/2,(rodTipY+hookY)/2+8,hsx,hookY);ctx.stroke();
    ctx.strokeStyle='#aaa';ctx.lineWidth=2;ctx.beginPath();ctx.arc(hsx,hookY+5,5,0,Math.PI);ctx.stroke();ctx.beginPath();ctx.moveTo(hsx,hookY);ctx.lineTo(hsx,hookY+5);ctx.stroke();
    if(hookState==='biting'&&biteAlertTimer>0){ctx.font='15px sans-serif';ctx.textAlign='center';ctx.fillText('❗',hsx,hookY-10+Math.sin(Date.now()*.022)*4);ctx.textAlign='left';}
    // Hooked fish stays attached to the hook while reeling
    if((hookState==='reeling_ready'||hookState==='reeling')&&currentFish){
      const ft=currentFish.type,len=ft.len,wr=ft.wr||1,hr=ft.hr||1;
      const wig=Math.sin(Date.now()*0.02)*0.5;
      ctx.save();ctx.translate(hsx,hookY+6);ctx.rotate(wig);
      if(ft.legendary||ft.night){ctx.shadowColor=ft.color;ctx.shadowBlur=ft.night?14:10;}
      ctx.fillStyle=ft.color+'cc';ctx.beginPath();ctx.ellipse(0,0,len*.5*wr,len*.22*hr,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=ft.color+'88';ctx.beginPath();ctx.moveTo(-len*.5*wr,0);ctx.lineTo(-len*.8*wr,-len*.18*hr);ctx.lineTo(-len*.8*wr,len*.18*hr);ctx.closePath();ctx.fill();
      if(ft.night){const pulse=.3+.3*Math.sin(Date.now()*0.006);ctx.globalAlpha=pulse;ctx.fillStyle=ft.color+'66';ctx.beginPath();ctx.ellipse(0,0,len*.7*wr,len*.35*hr,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
      ctx.shadowBlur=0;
      if(ft.legendary){ctx.font=`${Math.max(8,len*.3)}px sans-serif`;ctx.textAlign='center';ctx.fillText('⭐',0,-len*.35);ctx.textAlign='left';}
      ctx.strokeStyle='rgba(250,199,117,0.7)';ctx.lineWidth=0.7;ctx.beginPath();ctx.ellipse(0,0,len*.52*wr,len*.24*hr,0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(-len*.5*wr,0);ctx.lineTo(-len*.82*wr,-len*.2*hr);ctx.lineTo(-len*.82*wr,len*.2*hr);ctx.closePath();ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle='rgba(255,255,255,0.12)';ctx.lineWidth=1;ctx.setLineDash([2,6]);ctx.beginPath();ctx.moveTo(hsx,WY);ctx.lineTo(hsx,hookY);ctx.stroke();ctx.setLineDash([]);
    if(hookState==='waiting'||hookState==='biting'){ctx.fillStyle='rgba(0,0,0,0.35)';ctx.beginPath();ctx.roundRect(8,HUD_H+6,70,16,5);ctx.fill();ctx.fillStyle='rgba(255,255,255,0.5)';ctx.font='9px sans-serif';ctx.textAlign='left';ctx.fillText('R = retrieve',14,HUD_H+17);ctx.textAlign='left';}
  }

  // ── Depth charge meter ──
  if(charging&&hookState==='idle'){
    const mx=bsx,my=boat.y-50;
    const mw=54,mh=10,mr=5;
    // Background
    ctx.fillStyle='rgba(0,0,0,0.55)';ctx.beginPath();ctx.roundRect(mx-mw/2-4,my-4,mw+8,mh+8,mr+2);ctx.fill();
    // Track
    ctx.fillStyle='rgba(255,255,255,0.15)';ctx.beginPath();ctx.roundRect(mx-mw/2,my,mw,mh,mr);ctx.fill();
    // Fill color: green → yellow → red based on charge
    let fillColor;
    if(chargeVal<PERFECT_LO)fillColor=`hsl(${120-chargeVal*80},90%,55%)`;
    else if(chargeVal<=PERFECT_HI)fillColor='#7fe8c0';
    else fillColor=`hsl(${Math.max(0,30-(chargeVal-PERFECT_HI)*200)},90%,55%)`;
    ctx.fillStyle=fillColor;ctx.beginPath();ctx.roundRect(mx-mw/2,my,mw*chargeVal,mh,mr);ctx.fill();
    // Perfect zone markers
    ctx.strokeStyle='rgba(127,232,192,0.7)';ctx.lineWidth=1.5;ctx.setLineDash([]);
    const pLx=mx-mw/2+mw*PERFECT_LO,pRx=mx-mw/2+mw*PERFECT_HI;
    ctx.beginPath();ctx.moveTo(pLx,my-1);ctx.lineTo(pLx,my+mh+1);ctx.stroke();
    ctx.beginPath();ctx.moveTo(pRx,my-1);ctx.lineTo(pRx,my+mh+1);ctx.stroke();
    // Label
    const lbl=chargeVal>=PERFECT_LO&&chargeVal<=PERFECT_HI?'⭐ Perfect!':chargeVal>PERFECT_HI?'Too far!':'Hold…';
    ctx.fillStyle='rgba(255,255,255,0.85)';ctx.font='9px sans-serif';ctx.textAlign='center';ctx.fillText(lbl,mx,my-6);ctx.textAlign='left';
    // Depth preview
    const depthPrev=Math.round(setDepthFrac*maxDepth());
    ctx.fillStyle='rgba(255,255,255,0.5)';ctx.font='8px sans-serif';ctx.textAlign='center';ctx.fillText(`~${depthPrev}m`,mx,my+mh+12);ctx.textAlign='left';
  }

  // Boat wake (foam trail on the surface)
  for(const w of wake){const wsx=wx2sx(w.wx);if(wsx<wSX-20||wsx>CW+20)continue;ctx.globalAlpha=w.life*(nightOv>.5?0.45:0.6);ctx.fillStyle=nightOv>.5?'#bcd6f0':'#ffffff';ctx.beginPath();ctx.ellipse(wsx,w.wy,w.r,w.r*0.5,0,0,Math.PI*2);ctx.fill();}
  ctx.globalAlpha=1;
  // Boat
  drawBoat(bsx,boat.y,boat.facing,nightOv);
  // Bite alert: red ! above the boat when a fish is on and ready to reel
  if(hookState==='reeling_ready'){
    const bob=Math.sin(Date.now()*0.012)*4;
    const ay=boat.y-54+bob;
    ctx.fillStyle='#E24B4A';ctx.beginPath();ctx.arc(bsx,ay,12,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff';ctx.font='bold 17px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('!',bsx,ay+1);ctx.textBaseline='alphabetic';ctx.textAlign='left';
  }

  // Sparkles
  for(const s of sparkles){ctx.globalAlpha=s.life;ctx.fillStyle=s.color;ctx.beginPath();ctx.arc(s.x,s.y,2+s.life*3,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
  // Float coins
  for(const c of floatCoins){ctx.globalAlpha=c.alpha;ctx.font='bold 11px sans-serif';ctx.fillStyle='#FAC775';ctx.textAlign='center';ctx.fillText(c.label,c.x,c.y);ctx.textAlign='left';ctx.globalAlpha=1;}
  ctx.restore();
  drawWeather();
  // Depth indicator while hook is in water
  if(hookState!=='idle'&&hookState!=='retrieving'){const depth=Math.round(hookY-WY),maxD=maxDepth();ctx.fillStyle='rgba(0,0,0,0.5)';ctx.beginPath();ctx.roundRect(CW-90,HUD_H+6,82,20,5);ctx.fill();ctx.fillStyle=depth>=maxD*.8?'rgba(250,199,117,0.95)':'rgba(255,255,255,0.85)';ctx.font='10px sans-serif';ctx.textAlign='right';ctx.fillText(`Depth: ${depth}/${maxD}m`,CW-12,HUD_H+20);ctx.textAlign='left';}
  if(lvUpTimer>0){ctx.globalAlpha=Math.min(1,lvUpTimer);ctx.font='bold 16px sans-serif';ctx.fillStyle='#FAC775';ctx.textAlign='center';ctx.fillText(`⭐ Level ${playerLevel}!`,CW/2,HUD_H+40);ctx.textAlign='left';ctx.globalAlpha=1;}

  // In-canvas HUD (fades in from the title screen)
  if(uiAlpha>0.01){ctx.globalAlpha=uiAlpha;drawCanvasHUD(nightOv);if(hookState==='reeling')drawReelBar();drawDepthRuler();drawTravelCue();ctx.globalAlpha=1;}
  // Zone-entry title flourish (centered, playful, gently swaying, fades out)
  if(zoneTitleT>0&&uiAlpha>0.5){
    let a=1;if(zoneTitleT>2.5)a=(2.8-zoneTitleT)/0.3;else if(zoneTitleT<0.8)a=zoneTitleT/0.8;
    a*=uiAlpha;
    const t=Date.now()*0.001;const cx=CW/2,cy=HUD_H+62+Math.sin(t*1.6)*3;
    ctx.save();ctx.globalAlpha=a;ctx.translate(cx,cy);ctx.rotate(Math.sin(t*0.9)*0.025);
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='800 32px "Trebuchet MS","Segoe UI",sans-serif';
    ctx.fillStyle='rgba(0,0,0,0.35)';ctx.fillText(zoneTitleName,2,3);
    const g=ctx.createLinearGradient(-110,0,110,0);g.addColorStop(0,'#fff7e8');g.addColorStop(0.55,'#FAC775');g.addColorStop(1,'#7fe8c0');ctx.fillStyle=g;ctx.fillText(zoneTitleName,0,0);
    ctx.restore();ctx.globalAlpha=1;ctx.textBaseline='alphabetic';ctx.textAlign='left';
  }
  if(sceneFade>0){ctx.fillStyle=`rgba(0,0,0,${sceneFade})`;ctx.fillRect(0,0,CW,CH);}
}

function drawReelBar(){
  const tw=280,tx=(CW-tw)/2,th=11,ty=CH-30;
  // subtle backing
  ctx.fillStyle='rgba(8,16,30,0.7)';ctx.beginPath();ctx.roundRect(tx-9,ty-6,tw+18,th+17,8);ctx.fill();
  // track
  ctx.fillStyle='#c8ccd2';ctx.beginPath();ctx.roundRect(tx,ty,tw,th,5);ctx.fill();
  // target zone
  const zx=tx+reelZonePos*tw,zw=reelZoneW*tw;
  ctx.fillStyle=`rgba(29,158,117,${0.35+reelProgress*0.5})`;ctx.beginPath();ctx.roundRect(zx,ty,zw,th,5);ctx.fill();
  // fish icon
  const fx=tx+reelFishPos*tw;
  ctx.font='12px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('🐟',fx,ty+th/2);ctx.textBaseline='alphabetic';ctx.textAlign='left';
  // landing progress
  const py=ty+th+4;
  ctx.fillStyle='rgba(255,255,255,0.18)';ctx.beginPath();ctx.roundRect(tx,py,tw,3,1.5);ctx.fill();
  ctx.fillStyle='#7fe8c0';ctx.beginPath();ctx.roundRect(tx,py,Math.max(0,tw*reelProgress),3,1.5);ctx.fill();
}
function drawTravelCue(){
  if(!autoTravelActive)return;const d=travelDests[travelIdx];if(!d)return;
  const base=ctx.globalAlpha;
  ctx.font='bold 13px sans-serif';const txt='Auto-sailing to: '+d.label;
  const tw=ctx.measureText(txt).width, pad=16, iconW=18, w=tw+pad*2+iconW, x=CW/2-w/2, y=12, h=28;
  ctx.fillStyle='rgba(11,21,38,0.86)';ctx.beginPath();ctx.roundRect(x,y,w,h,14);ctx.fill();
  ctx.strokeStyle='rgba(250,199,117,0.5)';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(x,y,w,h,14);ctx.stroke();
  ctx.textBaseline='middle';ctx.font='13px sans-serif';ctx.fillText('🧭',x+pad-2,y+h/2+1);
  ctx.fillStyle='#fff';ctx.font='bold 13px sans-serif';ctx.textAlign='left';ctx.fillText(txt,x+pad+iconW,y+h/2);
  ctx.textBaseline='alphabetic';
  ctx.fillStyle='rgba(255,255,255,0.6)';ctx.font='9px sans-serif';ctx.textAlign='center';ctx.fillText('← → change destination  ·  T / Esc to stop',CW/2,y+h+11);
  ctx.textAlign='left';
}
function drawDepthRuler(){
  if(rulerAlpha<=0.01)return;
  const rx=12,rw=5,rtop=WY+4,rh=132,rbot=rtop+rh;
  const md=maxDepth(),reachFrac=Math.min(1,md/WATER_DEPTH),reachH=rh*reachFrac;
  ctx.save();ctx.globalAlpha*=rulerAlpha;
  // full-column track
  ctx.fillStyle='rgba(8,16,30,0.72)';ctx.beginPath();ctx.roundRect(rx,rtop,rw,rh,3);ctx.fill();
  // reachable region
  const grad=ctx.createLinearGradient(0,rtop,0,rtop+reachH);grad.addColorStop(0,'rgba(140,212,246,0.9)');grad.addColorStop(1,'rgba(60,128,198,0.9)');
  ctx.fillStyle=grad;ctx.beginPath();ctx.roundRect(rx,rtop,rw,reachH,3);ctx.fill();
  // locked region hatch
  ctx.strokeStyle='rgba(255,255,255,0.16)';ctx.lineWidth=1;
  for(let y=rtop+reachH+3;y<rbot;y+=4){ctx.beginPath();ctx.moveTo(rx,y);ctx.lineTo(rx+rw,y);ctx.stroke();}
  // border
  ctx.strokeStyle='rgba(255,255,255,0.4)';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(rx,rtop,rw,rh,3);ctx.stroke();
  // caption
  ctx.shadowColor='rgba(0,0,0,0.65)';ctx.shadowBlur=3;
  ctx.fillStyle='rgba(255,255,255,0.7)';ctx.font='7px sans-serif';ctx.textAlign='left';ctx.fillText('DEPTH',rx-1,rtop-5);
  // set-depth marker
  const setM=setDepthFrac*md,my=rtop+Math.min(reachH,(setM/WATER_DEPTH)*rh);
  ctx.strokeStyle='#FAC775';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(rx-1,my);ctx.lineTo(rx+rw+1,my);ctx.stroke();
  ctx.fillStyle='#FAC775';ctx.beginPath();ctx.moveTo(rx+rw+3,my);ctx.lineTo(rx+rw+9,my-4);ctx.lineTo(rx+rw+9,my+4);ctx.closePath();ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.95)';ctx.font='8px sans-serif';ctx.fillText(`~${Math.round(setM)}m`,rx+rw+12,my+3);
  ctx.shadowBlur=0;ctx.restore();
}
function drawCanvasHUD(nightOv){
  const base=ctx.globalAlpha; // uiAlpha applied by caller
  // Clustered, idle-fading readout (top-left): level ring + gold + cargo
  const idle=0.34,act=0.97;
  const ca=hudPulse>0.7?act:idle+(act-idle)*Math.max(0,hudPulse/0.7);
  ctx.globalAlpha=base*ca;
  ctx.shadowColor='rgba(0,0,0,0.55)';ctx.shadowBlur=3;ctx.shadowOffsetY=0.5;
  const cx=28,cy=27,r=15;
  // XP ring around the level
  ctx.strokeStyle='rgba(255,255,255,0.22)';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();
  const needed=xpForLevel(playerLevel);const xpPct=Math.min(1,playerXP/needed);
  ctx.strokeStyle='#FAC775';ctx.lineWidth=2.5;ctx.lineCap='round';ctx.beginPath();ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+xpPct*Math.PI*2);ctx.stroke();ctx.lineCap='butt';
  // Level number in the ring
  ctx.fillStyle='#fff7e8';ctx.font='bold 15px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(playerLevel,cx,cy+0.5);ctx.textBaseline='alphabetic';
  // Gold + cargo, stacked to the right of the ring
  ctx.textAlign='left';ctx.font='bold 12px sans-serif';
  ctx.fillStyle='#FAC775';ctx.fillText('💰 '+gold,cx+r+10,23);
  ctx.fillStyle='rgba(255,255,255,0.92)';ctx.fillText('🐟 '+inventory.length+'/'+holdCap(),cx+r+10,39);
  ctx.shadowBlur=0;ctx.shadowOffsetY=0;ctx.globalAlpha=base;

  // Hint text (centered near bottom)
  const bottomMsg=(msgTimer>0&&hudMsg)?hudMsg:hudHint;
  if(bottomMsg){
    ctx.font='10px sans-serif';
    const hw=ctx.measureText(bottomMsg).width;
    const hx=CW/2,hy=CH-44;
    const isEvent=msgTimer>0&&hudMsg;
    ctx.fillStyle=isEvent?'rgba(0,0,0,0.6)':'rgba(0,0,0,0.45)';
    ctx.beginPath();ctx.roundRect(hx-hw/2-9,hy-12,hw+18,16,6);ctx.fill();
    ctx.fillStyle=isEvent?'rgba(127,232,192,0.95)':'rgba(255,255,255,0.45)';ctx.textAlign='center';
    ctx.fillText(bottomMsg,hx,hy);ctx.textAlign='left';
  }
}

function drawReefDecor(nightOv){
  const FB=SEA_BOTTOM-14; // floor line
  const t=Date.now()*0.001;
  const dim=nightOv>.5?0.5:1; // scene darkens via overlay; keep colors a touch calmer at night
  for(const d of reefDecor){
    const sx=wx2sx(d.wx);if(sx<-60||sx>CW+60)continue;
    ctx.save();ctx.translate(sx,FB);ctx.globalAlpha=dim;
    if(d.type==='coral'){
      if(d.variant===0){ // branching staghorn
        ctx.strokeStyle=d.color;ctx.lineCap='round';
        const drawBranch=(x,y,ang,len,wd)=>{if(len<6)return;const x2=x+Math.cos(ang)*len,y2=y+Math.sin(ang)*len;ctx.lineWidth=wd;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.stroke();drawBranch(x2,y2,ang-0.5,len*0.66,wd*0.7);drawBranch(x2,y2,ang+0.4,len*0.6,wd*0.7);};
        drawBranch(0,0,-1.57,d.h*0.5,5);drawBranch(-6,0,-1.4,d.h*0.4,4);drawBranch(6,0,-1.75,d.h*0.42,4);
        ctx.lineCap='butt';
      }else if(d.variant===1){ // brain coral (stacked lobes)
        ctx.fillStyle=d.color;for(let i=0;i<4;i++){const yy=-i*d.h*0.16-6,rr=d.w*0.5*(1-i*0.16);ctx.beginPath();ctx.arc((i%2?4:-4),yy,rr,0,Math.PI*2);ctx.fill();}
        ctx.strokeStyle='rgba(255,255,255,0.25)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(-2,-d.h*0.24,d.w*0.28,0.2,2.6);ctx.stroke();
      }else{ // sea fan
        ctx.strokeStyle=d.color2;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-d.h*0.35);ctx.stroke();
        ctx.fillStyle=d.color;ctx.beginPath();ctx.moveTo(0,-d.h*0.3);for(let a2=-1.1;a2<=1.1;a2+=0.22){ctx.lineTo(Math.sin(a2)*d.w*0.7,-d.h*0.3-Math.cos(a2)*d.h*0.55);}ctx.closePath();ctx.globalAlpha=dim*0.85;ctx.fill();ctx.globalAlpha=dim;
      }
    }else if(d.type==='kelp'){
      ctx.strokeStyle=d.color;ctx.lineCap='round';
      for(let b=0;b<d.blades;b++){const off=(b-(d.blades-1)/2)*5;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(off,0);const seg=6,sw=Math.sin(t*1.1+d.ph+b)*0.5;for(let s=1;s<=seg;s++){const fy=-d.h*(s/seg);const fx=off+Math.sin(t*0.9+d.ph+s*0.5+b)*s*1.4+sw*s;ctx.lineTo(fx,fy);}ctx.stroke();}
      ctx.lineCap='butt';
    }else if(d.type==='starfish'){
      ctx.translate(0,-4);ctx.rotate(d.rot);ctx.fillStyle=d.color;const R=7*d.sz,r=3*d.sz;ctx.beginPath();for(let i=0;i<10;i++){const ang=Math.PI/5*i-Math.PI/2,rad=i%2?r:R;ctx.lineTo(Math.cos(ang)*rad,Math.sin(ang)*rad);}ctx.closePath();ctx.fill();
    }else if(d.type==='shell'){
      ctx.translate(0,-3);ctx.rotate(d.rot);ctx.fillStyle=d.color;ctx.beginPath();ctx.moveTo(0,4);for(let a2=-1.3;a2<=1.3;a2+=0.26)ctx.lineTo(Math.sin(a2)*8*d.sz,4-Math.cos(a2)*9*d.sz);ctx.closePath();ctx.fill();ctx.strokeStyle='rgba(255,255,255,0.35)';ctx.lineWidth=0.8;for(let a2=-1.0;a2<=1.0;a2+=0.5){ctx.beginPath();ctx.moveTo(0,4);ctx.lineTo(Math.sin(a2)*7*d.sz,4-Math.cos(a2)*8*d.sz);ctx.stroke();}
    }else if(d.type==='urchin'){
      ctx.translate(0,-4);ctx.strokeStyle=d.color;ctx.lineWidth=1.4;for(let i=0;i<12;i++){const ang=Math.PI*2/12*i;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(ang)*9*d.sz,Math.sin(ang)*9*d.sz);ctx.stroke();}ctx.fillStyle=d.color;ctx.beginPath();ctx.arc(0,0,3.5*d.sz,0,Math.PI*2);ctx.fill();
    }else if(d.type==='anemone'){
      ctx.strokeStyle=d.color;ctx.lineCap='round';ctx.lineWidth=2.4;for(let i=0;i<7;i++){const bx=(i-3)*2.4;const sway=Math.sin(t*1.6+d.ph+i)*2.5;ctx.beginPath();ctx.moveTo(bx,0);ctx.quadraticCurveTo(bx+sway,-7,bx+sway*1.4,-13);ctx.stroke();}ctx.lineCap='butt';ctx.fillStyle=d.color2;ctx.beginPath();ctx.ellipse(0,0,7,3.5,0,0,Math.PI*2);ctx.fill();
    }else{ // sanddollar
      ctx.translate(0,-2);ctx.fillStyle=d.color;ctx.beginPath();ctx.arc(0,0,6*d.sz,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(255,255,255,0.4)';ctx.lineWidth=0.8;for(let i=0;i<5;i++){const ang=Math.PI*2/5*i-Math.PI/2;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(ang)*4*d.sz,Math.sin(ang)*4*d.sz);ctx.stroke();}
    }
    ctx.restore();
  }
  ctx.globalAlpha=1;
}
function boatRodTip(){
  if(activeBoat==='trawler')return {lx:-54,ly:-30};
  if(activeBoat==='speedboat')return {lx:-40,ly:-9};
  return {lx:-42,ly:-26};
}
function drawBoat(sx,sy,facing,nightOv){
  ctx.save();ctx.translate(sx,sy);ctx.scale(facing,1);
  drawBoatShape(ctx,activeBoat,nightOv);
  // Wake (world only)
  if(Math.abs(boat.vx)>15){ctx.strokeStyle='rgba(255,255,255,0.28)';ctx.lineWidth=1.2;for(let i=0;i<3;i++){const lx=-(32+i*12),ly=12+i*4;ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(lx-(7+i*2),ly);ctx.stroke();}}
  ctx.restore();
}
function drawBoatShape(c,id,nightOv){
  const win=nightOv>.3?'#FFD700':'#87CEEB';
  if(id==='trawler'){
    // Bulky working trawler
    c.fillStyle='#34506e';c.beginPath();c.moveTo(-46,-2);c.lineTo(46,-2);c.lineTo(36,22);c.lineTo(-40,22);c.closePath();c.fill();
    c.fillStyle='#41618a';c.fillRect(-44,-9,88,8);
    c.fillStyle='#e8e3d6';c.fillRect(-24,-32,28,26);
    c.fillStyle='#cfc8b6';c.fillRect(-26,-36,32,5);
    c.fillStyle=win;c.fillRect(-20,-28,8,8);c.fillRect(-8,-28,8,8);
    c.fillStyle='#E24B4A';c.fillRect(8,-30,8,11);
    c.strokeStyle='#2b1c0e';c.lineWidth=2;c.beginPath();c.moveTo(-26,-10);c.lineTo(-54,-30);c.stroke();
    if(nightOv>.3){c.globalAlpha=nightOv*.7;c.fillStyle='rgba(255,200,50,0.3)';c.beginPath();c.arc(-10,-36,17,0,Math.PI*2);c.fill();c.globalAlpha=1;}
  }else if(id==='speedboat'){
    // Sleek low speedboat, pointed bow at +x
    c.fillStyle='#d64545';c.beginPath();c.moveTo(-34,4);c.lineTo(30,4);c.lineTo(46,12);c.lineTo(30,20);c.lineTo(-34,20);c.closePath();c.fill();
    c.fillStyle='#f4f4f2';c.beginPath();c.moveTo(-34,4);c.lineTo(30,4);c.lineTo(40,8);c.lineTo(-34,8);c.closePath();c.fill();
    c.fillStyle='#2b3a4f';c.beginPath();c.moveTo(-8,4);c.lineTo(8,4);c.lineTo(4,-8);c.lineTo(-3,-8);c.closePath();c.fill();
    c.fillStyle=win;c.beginPath();c.moveTo(-5,2);c.lineTo(5,2);c.lineTo(2,-6);c.lineTo(-2,-6);c.closePath();c.fill();
    c.strokeStyle='#2b1c0e';c.lineWidth=2;c.beginPath();c.moveTo(-16,2);c.lineTo(-40,-9);c.stroke();
    if(nightOv>.3){c.globalAlpha=nightOv*.7;c.fillStyle='rgba(255,200,50,0.3)';c.beginPath();c.arc(0,-7,12,0,Math.PI*2);c.fill();c.globalAlpha=1;}
  }else{
    // Skiff (classic)
    c.fillStyle='#8B4513';c.beginPath();c.moveTo(-38,0);c.lineTo(38,0);c.lineTo(28,20);c.lineTo(-28,20);c.closePath();c.fill();
    c.fillStyle='#A0522D';c.fillRect(-32,-6,64,8);
    c.fillStyle='#DEB887';c.fillRect(-14,-22,28,16);
    c.fillStyle=win;c.fillRect(-10,-20,8,9);c.fillRect(2,-20,8,9);
    c.strokeStyle='#5C3A1E';c.lineWidth=2.5;c.beginPath();c.moveTo(20,-6);c.lineTo(20,-36);c.stroke();
    c.fillStyle='#E24B4A';c.beginPath();c.moveTo(20,-36);c.lineTo(33,-30);c.lineTo(20,-24);c.closePath();c.fill();
    c.strokeStyle='#412402';c.lineWidth=2;c.beginPath();c.moveTo(-20,-8);c.lineTo(-42,-28);c.stroke();
    if(nightOv>.3){c.globalAlpha=nightOv*.7;c.fillStyle='rgba(255,200,50,0.3)';c.beginPath();c.arc(20,-36,18,0,Math.PI*2);c.fill();c.globalAlpha=1;}
  }
}

// ── Input ──
const keys={};
window.addEventListener('keydown',e=>{
  if(introOpen){
    if(e.key==='ArrowRight'||e.key==='Enter'){e.preventDefault();if(tutorialPage>=TUTORIAL_PAGES.length-1)finishTutorial();else tutorialGo(1);}
    else if(e.key==='ArrowLeft'){e.preventDefault();tutorialGo(-1);}
    else if(e.key==='Escape'&&tutorialMode==='review'){e.preventDefault();closeTutorialReview();}
    else{e.preventDefault();}
    return;
  }
  keys[e.key]=true;
  {const pm=document.getElementById('pause-menu');const paused=pm&&!pm.classList.contains('hidden');
   if(paused&&!devUnlocked&&e.key&&e.key.length===1&&/[a-zA-Z]/.test(e.key)){const now=performance.now();if(now-devSeqT>1000)devSeq='';devSeqT=now;devSeq=(devSeq+e.key.toLowerCase()).slice(-3);if(devSeq==='dev'){devUnlocked=true;const dv=document.getElementById('dev-tools');if(dv)dv.classList.remove('locked');setMsg('\ud83d\udee0 Dev tools unlocked');}}}
  if(e.code==='Space'){e.preventDefault();if(gameMode==='harbor'){harborInteract();return;}if(!canPlay())return;if(hookState==='reeling_ready')startReel();else if(hookState==='reeling')reelHolding=true;else if(hookState==='idle'&&!charging)beginCharge();}
  if((e.key==='r'||e.key==='R')&&canPlay())retrieveHook();
  if((e.key==='t'||e.key==='T')&&hasAutopilot&&gameMode==='play'){e.preventDefault();toggleTravel();}
  if(autoTravelActive&&!e.repeat){if(e.key==='ArrowLeft'||e.key==='a'||e.key==='A'){e.preventDefault();cycleTravel(-1);}else if(e.key==='ArrowRight'||e.key==='d'||e.key==='D'){e.preventDefault();cycleTravel(1);}}
  if(e.code==='Escape'&&autoTravelActive){deactivateTravel('Autopilot off.');return;}
  if(e.code==='Escape'){const anyOpen=document.querySelector('.overlay.open');if(anyOpen){closeShop();closeMenuAll();}else if(drawerOpen){closeMenuAll();}else if(gameMode==='play'){document.getElementById('pause-menu').classList.toggle('hidden');}}
});
window.addEventListener('keyup',e=>{keys[e.key]=false;if(e.code==='Space'){reelHolding=false;if(charging)releaseCharge();}});

function startCharge(ex,ey){
  if(hookState!=='idle')return;
  const rect=canvas.getBoundingClientRect(),sc=CW/rect.width;
  const cey=ey*sc;
  if(cey<WY)return; // only water clicks
  beginCharge();
}
function beginCharge(){if(!canPlay())return;autoTravelTarget=null;
  if(hookState!=='idle'||charging)return;
  if(atMarket){enterHarbor();return;}
  if(inventory.length>=holdCap()){setMsg('Your cargo is full! Sail to the market to sell your fish and free up space.');return;}
  const z=zoneAt(boat.x);if(!z.unlocked){setMsg(`Unlock ${z.label} at the 🏪 market!`);return;}
  charging=true;chargeVal=0;chargeDir=1;
  setMsg('Hold to charge depth… release to cast!');
}
function endCharge(){
  if(charging)releaseCharge();
}

canvas.addEventListener('mousedown',e=>{
  if(gameMode==='harbor'){harborInteract();return;}
  const rect=canvas.getBoundingClientRect(),sc=CW/rect.width;
  const ex=(e.clientX-rect.left)*sc,ey=(e.clientY-rect.top)*sc;
  if(hookState==='reeling_ready'){startReel();return;}
  startCharge(ex,ey);
});
canvas.addEventListener('mouseup',endCharge);
canvas.addEventListener('mouseleave',endCharge);

canvas.addEventListener('touchstart',e=>{
  e.preventDefault();
  const rect=canvas.getBoundingClientRect(),sc=CW/rect.width;
  for(const t of e.touches){
    const ex=(t.clientX-rect.left)*sc,ey=(t.clientY-rect.top)*sc;
    if(hookState==='reeling_ready'){startReel();continue;}
    if(hookState==='reeling'&&canPlay()){reelHolding=true;continue;}
    if(ey>=WY)startCharge(ex,ey);
    const tx=ex/CW;if(ey<WY*.85&&!atMarket){if(tx<.35){keys['ArrowLeft']=true;keys['ArrowRight']=false;}else if(tx>.65){keys['ArrowRight']=true;keys['ArrowLeft']=false;}}
  }
},{passive:false});
canvas.addEventListener('touchend',()=>{reelHolding=false;keys['ArrowLeft']=false;keys['ArrowRight']=false;endCharge();},{passive:false});

let drawerOpen=false,activeView=null;
function setDrawerOpen(o){const d=document.getElementById('drawer'),di=document.getElementById('drawer-icons');drawerOpen=o;if(o){d.classList.add('open');di.classList.remove('collapsed');}else{d.classList.remove('open');di.classList.add('collapsed');}}
function clearMenuActive(){document.querySelectorAll('.drawer-icon').forEach(b=>b.classList.remove('active'));activeView=null;}
function dismissActivePanel(){closeQuests();closeJournal();closeCargo();clearMenuActive();}
function closeMenuAll(){dismissActivePanel();setDrawerOpen(false);}
function toggleDrawer(){if(drawerOpen)closeMenuAll();else setDrawerOpen(true);}
function selectView(v){
  closeQuests();closeJournal();closeCargo();clearMenuActive();
  if(activeView===v){activeView=null;return;}
  if(v==='quests')openQuests();else if(v==='journal')openJournal();else if(v==='cargo')openCargo();
  activeView=v;document.querySelectorAll('.drawer-icon').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
  setDrawerOpen(true);
}
function showTitleOverlay(){const ov=document.getElementById('title-overlay');ov.classList.remove('hide');cancelTitleConfirm();}
function hideTitleOverlay(){document.getElementById('title-overlay').classList.add('hide');}
function startDescent(){hideTitleOverlay();gameMode='descending';titleTargetLift=0;zoneAnnounceId=null;zoneTitleT=0;}
function continueGame(){if(gameMode!=='title')return;startDescent();}
function onNewGame(){if(gameMode!=='title')return;if(saveTimestamp)showTitleConfirm();else startFreshGame();}
function startFreshGame(){resetNewGame();pendingIntro=true;startDescent();}
function showTitleConfirm(){document.getElementById('title-confirm').classList.add('show');const bc=document.getElementById('btn-continue'),bn=document.getElementById('btn-newgame');bc.style.display='';bc.textContent='No';bc.onclick=cancelTitleConfirm;bn.textContent='Yes';bn.onclick=confirmNewGame;}
function cancelTitleConfirm(){document.getElementById('title-confirm').classList.remove('show');const bc=document.getElementById('btn-continue'),bn=document.getElementById('btn-newgame');bc.textContent='Continue';bc.onclick=continueGame;bc.style.display=saveTimestamp?'':'none';bn.textContent='New Game';bn.onclick=onNewGame;}
function confirmNewGame(){cancelTitleConfirm();startFreshGame();}
function resetNewGame(){gold=0;inventory=[];upgLevels={rod:0,bait:0,boat:0,hold:0,depth:0};zoneUnlocked={shallow:true,deep:false,reef:false,abyss:false};playerXP=0;playerLevel=1;totalCaught=0;totalEarned=0;seenFish={};activeQuests=[];completedQuestIds=[];questEarnedGold=0;perfectCasts=0;timeOfDay=0;questNews=false;journalNews=false;fishNews={};ownedBoats={skiff:true,trawler:false,speedboat:false};activeBoat='skiff';hasAutopilot=false;autoTravelTarget=null;updateAutopilotUI();tutorialSeen={};activeHint=null;saveTimestamp=null;syncZones();pickNewQuests();updateHUD();renderInventoryBar();renderQuestBar();boat.x=LW+30;boat.vx=0;}
function resumeGame(){document.getElementById('pause-menu').classList.add('hidden');}
function saveFromPause(){saveGame();}
function saveAndExit(){document.getElementById('pause-menu').classList.add('hidden');saveGame();gameMode='ascending';titleTargetLift=TITLE_LIFT;}
// Click the dimmed backdrop (outside the panel) to close it
['quest-overlay','journal-overlay','cargo-overlay'].forEach(id=>{const el=document.getElementById(id);if(el)el.addEventListener('mousedown',e=>{if(e.target===el)dismissActivePanel();});});
{const sh=document.getElementById('shop-overlay');if(sh)sh.addEventListener('mousedown',e=>{if(e.target===sh)closeShop();});}
(async()=>{
  try{
  const loaded=await loadGame();syncZones();pickNewQuests();updateHUD();renderInventoryBar();renderQuestBar();
  // Fresh load always starts at the title with the boat moored at the market
  boat.x=LW+30;boat.vx=0;camX=0;gameMode='title';titleLift=TITLE_LIFT;titleTargetLift=TITLE_LIFT;uiAlpha=0;
  showTitleOverlay();
  requestAnimationFrame(t=>{lastT=t;requestAnimationFrame(loop);});
  }catch(e){console.error('INIT ERROR:',e);const c=document.getElementById('canvas');const x=c.getContext('2d');x.fillStyle='#111';x.fillRect(0,0,680,360);x.fillStyle='#f66';x.font='13px sans-serif';x.textAlign='center';x.fillText('Init error: '+e.message,340,180);x.fillText(e.stack&&e.stack.split('\n')[1]||'',340,200);}
})();
