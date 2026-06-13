// rooms: { [roomCode]: { G, sockets: {pi: socketId}, names: [str] } }
const rooms = {};

function randCode() {
  return Math.random().toString(36).slice(2,6).toUpperCase();
}

function broadcast(roomCode) {
  const room = rooms[roomCode];
  if(!room) return;
  for(const [pi, sid] of Object.entries(room.sockets)) {
    const sock = io.sockets.sockets.get(sid);
    if(sock) sock.emit('state', projectFor(room.G, parseInt(pi)));
  }
}

function log(room, msg, cls='') {
  room.G.log.unshift({ msg, cls, t: room.G.log.length });
  if(room.G.log.length > 200) room.G.log.pop();
}

// ── card resolution helpers (server-side) ───────────────────
function reshuffle(G) {
  if(G.deck.length > 0) return;
  if(!G.discard.length) return;
  G.deck = sh(G.discard.slice()); G.discard = []; G.pile = 5;
}

let _id = 1000;
const uid = () => ++_id;
const mk  = n => ({ id: uid(), n });

function zoneRat(G, pi) {
  if(G.pile > 0) G.pile--;
  G.players[pi].zone.push({ id: uid(), att: null });
}

function ratToPile(G, pi, zi) {
  const r = G.players[pi].zone.splice(zi, 1)[0];
  if(r && r.att) G.discard.push(r.att.card);
  G.pile++;
  return r;
}

function drawOne(G, pi, room, depth=0) {
  if(depth > 200 || G.over) return;
  reshuffle(G);
  if(!G.deck.length) return;
  const pl = G.players[pi];
  const c  = G.deck.pop();
  if(c.n === 'Rat') {
    G.discard.push(c);
    if(G.mark2) {
      const t = G.mark2.target; G.mark2 = null;
      G.players[t].zone.push({ id: uid(), att: null });
      log(room, `A rat drawn — Mark 2.0 sends it to ${G.players[t].name}.`, 'dmg');
    } else {
      pl.zone.push({ id: uid(), att: null });
      log(room, `${pl.name} draws a RAT — zones it.`, 'dmg');
    }
  } else if(isWD(c.n)) {
    G.discard.push(c);
    log(room, `${pl.name} draws ${c.n} — resolves.`, 'sys');
    resolveWD(G, c.n, pi, room);
  } else {
    pl.hand.push(c);
  }
}

function resolveWD(G, name, pi, room) {
  const alive = G.players.filter(p => p.alive);
  if(name === 'WD: Frenzy') {
    for(const p of alive) drawOne(G, p.i, room);
  } else if(name === 'WD: Blackout') {
    const pl = G.players[pi]; const n = pl.hand.length;
    G.discard.push(...pl.hand); pl.hand = [];
    for(let k=0;k<n;k++) drawOne(G, pi, room);
    log(room, `${pl.name} blacks out — redraws ${n}.`, 'sys');
  } else if(name === 'WD: Rat Run CW' || name === 'WD: Rat Run CCW') {
    const d = name.endsWith('CW') ? 1 : -1;
    const movers = alive.filter(p => p.zone.length).map(p => ({ from: p.i, rat: p.zone[0] }));
    for(const m of movers) {
      const o = G.players[m.from];
      o.zone.splice(o.zone.indexOf(m.rat), 1);
      const nxt = nextAlive(G, m.from, d);
      G.players[nxt].zone.push(m.rat);
    }
    log(room, `Rat Run ${d===1?'CW':'CCW'}.`, 'sys');
  } else if(name === 'WD: Audit') {
    const mx = Math.max(...alive.map(p => p.hand.length));
    for(const p of alive.filter(p => p.hand.length === mx && p.hand.length)) {
      sh(p.hand); G.discard.push(p.hand.pop());
      log(room, `${p.name} discards to Audit.`, 'sys');
    }
  } else if(name === 'WD: Curfew') {
    const mx = Math.max(...alive.map(p => p.zone.length));
    const tops = alive.filter(p => p.zone.length === mx);
    if(tops.length === 1 && tops[0].zone.length) {
      const o = tops[0]; const opps = alive.filter(p => p.i !== o.i);
      if(opps.length) {
        const tgt = opps.sort((a,b) => b.zone.length - a.zone.length)[0];
        tgt.zone.push(o.zone.splice(0,1)[0]);
        log(room, `Curfew — ${o.name} moves a rat to ${tgt.name}.`, 'sys');
      }
    } else log(room, 'Curfew — tied, discarded.', 'sys');
  }
}

function nextAlive(G, from, dir) {
  let i = from;
  for(let k=0;k<G.np;k++) { i=(i+dir+G.np)%G.np; if(G.players[i].alive) return i; }
  return from;
}

function damage(G, pi, src, room) {
  const pl = G.players[pi]; pl.hp--;
  log(room, `${pl.name} loses 1 HP (${src}). ${pl.hp} HP left.`, 'dmg');
  if(pl.hp <= 0) eliminate(G, pi, room);
}

function eliminate(G, pi, room) {
  const pl = G.players[pi]; pl.alive = false;
  while(pl.zone.length) { G.pile++; pl.zone.pop(); }
  G.discard.push(...pl.hand); pl.hand = [];
  G.fusions = G.fusions.filter(f => f.placer !== pi && f.target !== pi);
  G.chillis  = G.chillis.filter(c => c.target !== pi && c.placer !== pi);
  if(G.mark  && (G.mark.placer===pi||G.mark.target===pi))   G.mark  = null;
  if(G.mark2 && (G.mark2.placer===pi||G.mark2.target===pi)) G.mark2 = null;
  log(room, `☠ ${pl.name} is ELIMINATED.`, 'dmg');
  const alive = G.players.filter(p => p.alive);
  if(alive.length === 1) { G.over = true; G.winner = alive[0].i; log(room, `🏆 ${alive[0].name} wins!`, 'me'); }
}

function advanceTurn(G) {
  let i = G.cur;
  do { i=(i+1)%G.np; if(i===0) G.round++; } while(!G.players[i].alive);
  G.cur = i; G.touchedZones = [];
}

function startTriggers(G, pi, room) {
  const pl = G.players[pi]; pl.fortify = false;
  if(G.mark  && G.mark.placer===pi)  G.mark  = null;
  if(G.mark2 && G.mark2.placer===pi) G.mark2 = null;
  G.fusions = G.fusions.filter(f => f.placer !== pi);
  // Rat Away
  for(let i=pl.zone.length-1;i>=0;i--) {
    if(pl.zone[i].att?.card?.n === 'Rat Away') { pl.zone.splice(i,1); G.pile++; }
  }
  // Pregnant Rat
  const preg = pl.zone.filter(r => r.att?.card?.n === 'Pregnant Rat');
  for(const r of preg) { r.att = null; pl.zone.push({id:uid(),att:null}); }
  // Debt removed from game
}

function endTriggers(G, pi, room) {
  const det = [];
  const remaining = [];
  for(const c of G.chillis) {
    if(c.placer === pi) { if(c.fresh) { c.fresh=false; remaining.push(c); } else det.push(c); }
    else remaining.push(c);
  }
  G.chillis = remaining;
  for(const c of det) {
    if(G.over) return;
    const tgt = G.players[c.target];
    if(tgt.alive && tgt.zone.length) {
      tgt.zone.splice(0,1); G.pile++;
      log(room, `🌶 Chilli detonates in ${tgt.name}'s zone!`, 'dmg');
      damage(G, c.target, 'Chilli', room);
    }
  }
}

function fusionBlocked(G, atk, tgt) {
  return G.fusions.some(f => f.placer===tgt && f.target===atk);
}
function canHI(G, atk, tgt) {
  return tgt.alive && tgt.i!==atk && tgt.zone.length>0 && !tgt.fortify
    && !fusionBlocked(G,atk,tgt.i) && !G.touchedZones.includes(tgt.i);
}
function canHR(G, atk, tgt) {
  return tgt.alive && tgt.i!==atk && !tgt.fortify
    && !fusionBlocked(G,atk,tgt.i) && !G.touchedZones.includes(tgt.i);
}

// ── action handler ───────────────────────────────────────────
function handleAction(roomCode, pi, action) {
  const room = rooms[roomCode];
  if(!room) return;
  const G = room.G;
  if(G.over) return broadcast(roomCode);
  if(G.cur !== pi) return; // not your turn (reactions handled separately)

  const pl = G.players[pi];

  function spend(cardId) {
    const i = pl.hand.findIndex(c => c.id === cardId);
    if(i >= 0) G.discard.push(pl.hand.splice(i,1)[0]);
  }
  function spendFood() {
    const i = pl.hand.findIndex(c => c.n === 'Food');
    if(i >= 0) G.discard.push(pl.hand.splice(i,1)[0]);
  }
  function hasFood() { return pl.hand.some(c => c.n === 'Food'); }

  const { type, cardId, target, ratZi, boost, dist, cardName, count } = action;

  if(type === 'END_TURN') {
    endTriggers(G, pi, room);
    drawOne(G, pi, room);
    advanceTurn(G);
    if(!G.over) startTriggers(G, G.cur, room);
    return broadcast(roomCode);
  }

  if(type === 'PLAY_HEALTH_INSPECTION') {
    const T = G.players[target];
    if(!canHI(G, pi, T)) return;
    spend(cardId);
    // Mark redirect
    let tgtI = target, tgtZi = ratZi || 0;
    if(G.mark) { tgtI = G.mark.target; tgtZi = 0; G.mark = null; }
    log(room, `${pl.name} fires a Health Inspection at ${G.players[tgtI].name}.`);
    G.touchedZones.push(tgtI);
    // check reaction — set pending, broadcast, wait
    const tgt = G.players[tgtI];
    const canBlock = tgt.hand.some(c => c.n === 'Block');
    if(canBlock) {
      G.pendingReaction = { kind:'HI', from:pi, to:tgtI, ratZi:tgtZi };
      return broadcast(roomCode);
    }
    resolveHI(G, pi, tgtI, tgtZi, room);
    broadcast(roomCode);
  }

  if(type === 'PLAY_HOT_RATATO') {
    if(!pl.zone.length) return;
    spend(cardId); if(boost) spendFood();
    const cwIdx = getCWTarget(G, pi, dist||1);
    if(cwIdx === -1) return;
    log(room, `${pl.name} plays Hot Ratato — ${dist||1} seat(s) clockwise to ${G.players[cwIdx].name}.`);
    G.touchedZones.push(cwIdx);
    const tgt = G.players[cwIdx];
    const canBlock = tgt.hand.some(c=>c.n==='Block') || tgt.hand.some(c=>c.n==='Redirect CW') || tgt.hand.some(c=>c.n==='Redirect CCW');
    const ratIdx = ratZi ?? 0;
    if(canBlock) {
      G.pendingReaction = { kind:'HR', from:pi, to:cwIdx, ratZi:ratIdx, boost:!!boost };
      return broadcast(roomCode);
    }
    resolveHR(G, pi, cwIdx, ratIdx, boost, room);
    broadcast(roomCode);
  }

  if(type === 'PLAY_HELD_RAT') {
    if(G.pile <= 0) return;
    spend(cardId); zoneRat(G, target);
    if(target !== pi) G.touchedZones.push(target);
    log(room, `${pl.name} drops a Held Rat into ${G.players[target].name}'s zone.`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_INFESTATION') {
    spend(cardId);
    if(boost && pl.zone.length) {
      spendFood(); ratToPile(G, pi, pl.zone.length-1);
      G.deck.push(mk('Rat'));
      log(room, `${pl.name} plays Infestation (boost) — own rat tops the deck.`);
    } else if(G.pile > 0) {
      G.pile--; G.deck.push(mk('Rat'));
      log(room, `${pl.name} plays Infestation — pile rat tops the deck.`);
    }
    broadcast(roomCode);
  }

  if(type === 'PLAY_PLAGUE') {
    spend(cardId); const n = Math.min(count||1, G.pile);
    for(let k=0;k<n;k++) { G.pile--; G.deck.push(mk('Rat')); }
    log(room, `${pl.name} plays Plague — ${n} rat(s) atop the deck.`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_SETUP') {
    spend(cardId); if(boost) spendFood();
    const n = boost ? 3 : 2;
    for(let k=0;k<n;k++) drawOne(G, pi, room);
    // discard handled client-side via DISCARD_FROM_HAND
    log(room, `${pl.name} plays Setup — draws ${n}.`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_FORTIFY') {
    spend(cardId); pl.fortify = true;
    log(room, `${pl.name} Fortifies their zone.`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_EXTERMINATOR') {
    if(!pl.zone.length) return;
    spend(cardId); const n = boost ? 2 : 1; if(boost) spendFood();
    for(let k=0;k<n&&pl.zone.length;k++) ratToPile(G, pi, pl.zone.length-1);
    log(room, `${pl.name} calls the Exterminator — ${n} rat(s) gone.`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_MARK') {
    spend(cardId); G.mark = { placer:pi, target };
    log(room, `${pl.name} Marks ${G.players[target].name}.`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_MARK2') {
    spend(cardId); G.mark2 = { placer:pi, target };
    log(room, `${pl.name} plays Mark 2.0 on ${G.players[target].name}.`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_KITCHEN_FUSION') {
    spend(cardId); G.fusions.push({placer:pi, target});
    G.touchedZones.push(target);
    log(room, `${pl.name} Kitchen Fusions with ${G.players[target].name}.`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_CHILLI') {
    const tgt = G.players[target];
    if(!tgt || !tgt.zone.length || tgt.fortify) return;
    const card = pl.hand.find(c => c.id === cardId);
    if(!card) return;
    pl.hand.splice(pl.hand.indexOf(card),1);
    G.touchedZones.push(target);
    const canBlock = tgt.hand.some(c=>c.n==='Block');
    if(canBlock) {
      G.pendingReaction = { kind:'CHILLI', from:pi, to:target, ratZi: ratZi||0, chilli:card };
      return broadcast(roomCode);
    }
    attachChilli(G, pi, target, ratZi||0, card, room);
    broadcast(roomCode);
  }

  if(type === 'PLAY_PREGNANT_RAT') {
    const tgt = G.players[target];
    if(!tgt || !tgt.zone.length || tgt.fortify) return;
    const card = pl.hand.find(c => c.id === cardId);
    if(!card) return;
    pl.hand.splice(pl.hand.indexOf(card),1);
    tgt.zone[ratZi||0].att = { card, placer:pi };
    G.touchedZones.push(target);
    log(room, `${pl.name} attaches a Pregnant Rat in ${tgt.name}'s zone.`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_RAT_AWAY') {
    if(!pl.zone.length) return;
    const card = pl.hand.find(c => c.id === cardId);
    if(!card) return;
    pl.hand.splice(pl.hand.indexOf(card),1);
    pl.zone[ratZi||0].att = { card, placer:pi };
    log(room, `${pl.name} attaches Rat Away.`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_RATTATOULI') {
    if(!pl.zone.length) return;
    spend(cardId); ratToPile(G, pi, ratZi||0); pl.hand.push(mk('Food'));
    log(room, `${pl.name} plays Rattatouli — a rat becomes Food.`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_RAT_DIVIDEND') {
    if(!pl.zone.length) return;
    spend(cardId); const n = pl.zone.length;
    for(let k=0;k<n;k++) drawOne(G, pi, room);
    log(room, `${pl.name} plays Rat Dividend — ${n} draw(s).`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_LAUNDERING') {
    spend(cardId);
    // client sends which cards to discard via cardIds
    const { cardIds } = action;
    const n = cardIds?.length || 0;
    for(const cid of (cardIds||[])) {
      const i = pl.hand.findIndex(c=>c.id===cid);
      if(i>=0) G.discard.push(pl.hand.splice(i,1)[0]);
    }
    for(let k=0;k<n;k++) drawOne(G, pi, room);
    log(room, `${pl.name} plays Laundering (${n}).`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_SURGE') {
    spend(cardId);
    if(target === pi) { drawOne(G,pi,room); drawOne(G,pi,room); log(room,`${pl.name} Surges — draws 2.`); }
    else { drawOne(G,target,room); log(room,`${pl.name} Surges — forces ${G.players[target].name} to draw.`); }
    broadcast(roomCode);
  }

  if(type === 'PLAY_BOUNTY') {
    spend(cardId); if(boost) spendFood();
    G.bounties = (G.bounties||[]);
    G.bounties.push({placer:pi, target, keep: boost?4:2});
    log(room, `${pl.name} puts a Bounty on ${G.players[target].name}.`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_SHAKEDOWN') {
    spend(cardId); if(boost) spendFood();
    const tgt = G.players[target];
    const i = tgt.hand.findIndex(c=>c.n===cardName);
    if(i>=0) { pl.hand.push(tgt.hand.splice(i,1)[0]); log(room,`${pl.name} shakes down ${tgt.name} — takes a ${cardName}.`); }
    else log(room,`${pl.name} shakes down ${tgt.name} for ${cardName} — miss.`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_STAKEOUT') {
    spend(cardId);
    // Stakeout: server sends target's full hand only to the acting player
    const tgt = G.players[target];
    const sock = io.sockets.sockets.get(room.sockets[pi]);
    if(sock) sock.emit('stakeout', { target, hand: tgt.hand, handCount: tgt.hand.length });
    log(room, `${pl.name} stakes out ${tgt.name}.`);
    broadcast(roomCode);
  }

  if(type === 'PLAY_SCOUT') {
    spend(cardId); reshuffle(G);
    const top = G.deck.slice(-3).reverse();
    const sock = io.sockets.sockets.get(room.sockets[pi]);
    if(sock) sock.emit('scout', { top });
    // keep selection pending
    G.pendingModal = { kind:'SCOUT', pi, top };
    broadcast(roomCode);
  }

  if(type === 'SCOUT_KEEP') {
    if(!G.pendingModal || G.pendingModal.kind !== 'SCOUT') return;
    G.pendingModal = null;
    const i = G.deck.findIndex(c=>c.id===cardId);
    if(i>=0) { const kept=G.deck.splice(i,1)[0]; pl.hand.push(kept); }
    broadcast(roomCode);
  }

  if(type === 'PLAY_RUSSIAN_ROULETTE') {
    if(!pl.zone.length) return;
    spend(cardId);
    const poolRat = pl.zone.splice(pl.zone.length-1,1)[0]; G.pile++;
    const pool = [{ rat:true }];
    for(const o of G.players.filter(p=>p.alive&&p.i!==pi)) {
      if(o.hand.length) { sh(o.hand); pool.push({card:o.hand.pop()}); }
    }
    sh(pool);
    const drawers = G.players.filter(p=>p.alive);
    log(room, 'Russian Roulette — everyone draws blind...','sys');
    for(const o of drawers) {
      const item = pool.pop();
      if(!item) continue;
      if(item.rat) { o.zone.push({id:uid(),att:null}); log(room,`${o.name} draws the RAT.`,'dmg'); }
      else { o.hand.push(item.card); }
    }
    for(const item of pool) { if(item.card) G.discard.push(item.card); if(item.rat) G.pile++; }
    broadcast(roomCode);
  }

  if(type === 'DISCARD_FROM_HAND') {
    const i = pl.hand.findIndex(c=>c.id===cardId);
    if(i>=0) G.discard.push(pl.hand.splice(i,1)[0]);
    broadcast(roomCode);
  }
}

function getCWTarget(G, pi, dist) {
  let steps=0, i=pi;
  for(let k=0;k<G.np;k++) { i=(i+1)%G.np; if(G.players[i].alive){steps++;if(steps===dist)return i;} }
  return -1;
}

function resolveHI(G, atk, tgtI, ratZi, room) {
  const T = G.players[tgtI];
  if(!T.zone.length) { log(room,'No rat left — inspection fizzles.','sys'); return; }
  const zi = Math.min(ratZi, T.zone.length-1);
  ratToPile(G, tgtI, zi);
  log(room, `Inspection hits — rat fired from ${T.name}'s zone.`);
  damage(G, tgtI, 'Health Inspection', room);
}

function resolveHR(G, atk, tgtI, ratZi, boost, room) {
  const A = G.players[atk], T = G.players[tgtI];
  const count = boost ? 2 : 1;
  for(let k=0;k<count&&A.zone.length;k++) {
    const rat = A.zone.splice(Math.min(ratZi,A.zone.length-1),1)[0];
    T.zone.push(rat);
  }
  log(room, `${count} rat(s) move from ${A.name} to ${T.name}.`);
}

function attachChilli(G, pi, tgtI, ratZi, card, room) {
  const T = G.players[tgtI];
  if(!T.zone[ratZi]) return;
  T.zone[ratZi].att = { card, placer:pi };
  G.chillis.push({ placer:pi, target:tgtI, fresh:true });
  log(room, `🌶 Chilli attached to a rat in ${T.name}'s zone.`);
}

// ── reaction handler ─────────────────────────────────────────
function handleReaction(roomCode, pi, action) {
  const room = rooms[roomCode];
  if(!room) return;
  const G = room.G;
  const pr = G.pendingReaction;
  if(!pr || pr.to !== pi) return; // only the target reacts
  G.pendingReaction = null;
  const T = G.players[pi];
  const A = G.players[pr.from];

  if(action.type === 'REACT_NONE') {
    if(pr.kind==='HI') resolveHI(G, pr.from, pi, pr.ratZi, room);
    else if(pr.kind==='HR') resolveHR(G, pr.from, pi, pr.ratZi, pr.boost, room);
    else if(pr.kind==='CHILLI') attachChilli(G, pr.from, pi, pr.ratZi, pr.chilli, room);
  }
  if(action.type === 'REACT_BLOCK') {
    const i = T.hand.findIndex(c=>c.n==='Block');
    if(i<0) return;
    G.discard.push(T.hand.splice(i,1)[0]);
    log(room, `${T.name} BLOCKS the attack.`);
    if(pr.kind==='CHILLI') G.discard.push(pr.chilli);
  }
  if(action.type === 'REACT_BLOCK_BOOST') {
    const bi = T.hand.findIndex(c=>c.n==='Block');
    const fi = T.hand.findIndex(c=>c.n==='Food');
    if(bi<0||fi<0) return;
    G.discard.push(T.hand.splice(bi,1)[0]);
    G.discard.push(T.hand.splice(T.hand.findIndex(c=>c.n==='Food'),1)[0]);
    log(room, `${T.name} blocks and REDIRECTS.`);
    // redirect to action.redirectTo
    const newPr = { ...pr, to: action.redirectTo };
    const newT = G.players[action.redirectTo];
    const canBlock2 = newT.hand.some(c=>c.n==='Block');
    if(canBlock2) { G.pendingReaction = newPr; return broadcast(roomCode); }
    if(pr.kind==='HI') resolveHI(G, pr.from, action.redirectTo, 0, room);
    else if(pr.kind==='HR') resolveHR(G, pr.from, action.redirectTo, 0, pr.boost, room);
  }
  if(action.type === 'REACT_REDIRECT_CW' || action.type === 'REACT_REDIRECT_CCW') {
    if(pr.kind !== 'HR') return;
    const cardName = action.type==='REACT_REDIRECT_CW' ? 'Redirect CW' : 'Redirect CCW';
    const i = T.hand.findIndex(c=>c.n===cardName);
    if(i<0) return;
    G.discard.push(T.hand.splice(i,1)[0]);
    const dir = action.type==='REACT_REDIRECT_CW' ? 1 : -1;
    const nxt = nextAlive(G, pi, dir);
    const rat = A.zone.splice(Math.min(pr.ratZi,A.zone.length-1),1)[0];
    if(G.players[nxt].fortify || nxt===pr.from) { T.zone.push(rat); log(room,`Redirect blocked by Fortify — rat stays with ${T.name}.`); }
    else { G.players[nxt].zone.push(rat); log(room,`${T.name} redirects — rat goes to ${G.players[nxt].name}.`); }
  }
  if(action.type === 'REACT_AMBUSH') {
    if(pr.kind !== 'HR') return;
    const i = T.hand.findIndex(c=>c.n==='Ambush');
    if(i<0) return;
    G.discard.push(T.hand.splice(i,1)[0]);
    T.hand.push(mk('Hot Ratato'));
    log(room, `${T.name} AMBUSHES — Hot Ratato stolen.`);
  }
  broadcast(roomCode);
}

// ── socket.io ────────────────────────────────────────────────
io.on('connection', socket => {
  socket.on('create_room', ({ name, np }) => {
    const code = randCode();
    rooms[code] = { G: null, sockets: {}, names: [name], np: parseInt(np) };
    rooms[code].sockets[0] = socket.id;
    socket.join(code);
    socket.emit('room_created', { code, pi: 0 });
  });

  socket.on('join_room', ({ code, name }) => {
    const room = rooms[code];
    if(!room) return socket.emit('error', 'Room not found.');
    if(Object.keys(room.sockets).length >= room.np) return socket.emit('error', 'Room is full.');
    const pi = room.names.length;
    room.names.push(name);
    room.sockets[pi] = socket.id;
    socket.join(code);
    socket.emit('room_joined', { code, pi });
    io.to(code).emit('lobby', { names: room.names, np: room.np });
    if(room.names.length === room.np) {
      room.G = newGame(room.np, room.names);
      startTriggers(room.G, 0, room);
      log(room, `Game started — ${room.np} players.`, 'sys');
      broadcast(code);
    }
  });

  socket.on('action', ({ code, pi, action }) => {
    handleAction(code, pi, action);
  });

  socket.on('reaction', ({ code, pi, action }) => {
    handleReaction(code, pi, action);
  });

  socket.on('disconnect', () => {
    for(const [code, room] of Object.entries(rooms)) {
      for(const [pi, sid] of Object.entries(room.sockets)) {
        if(sid === socket.id) {
          io.to(code).emit('player_disconnected', { pi: parseInt(pi), name: room.names[pi] });
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Turf Wars server running on :${PORT}`));
