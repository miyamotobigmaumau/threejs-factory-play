/* =========================================================================
 * TMFireSquirt — しょうぼう水でっぽう
 * ルール: 3×3の町に火が燃え広がる。消防車のホースで水をとばして消火！
 * 操作: ドラッグで照準 → 押している間 放水（弾道アークの水流）
 * スコア: 消火した火の数
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------- 定数 ---------- */
  var GRID_SIZE = 3;
  var HOUSE_COUNT = 9;
  var HOUSE_SPACING = 2.8;
  var BURN_TIME = 9.0;           // 燃え尽きるまで（反応猶予を確保）
  var SPAWN_INTERVAL_INIT = 4.5;
  var SPAWN_INTERVAL_MIN = 1.6;
  var MAX_DESTROYED = 3;
  var WATER_MAX = 100;
  var WATER_DRAIN = 12;          // 満タンで火およそ4つ分（1消火あたり放水〜2秒想定）
  var WATER_REFILL = 12.5;       // 非放水2秒で25%回復（仕様: 25%/2s = 12.5/s）
  var STREAM_N = 30;             // 水流の粒数(密にして1本のジェットに見せる)
  var SPLASH_N = 8;              // 着弾しぶきの粒数
  var SMOKE_PER_HOUSE = 3;       // 家ごとの煙/蒸気プール
  var HIT_RADIUS = 1.6;
  var EXTINGUISH_HOLD = 0.55;    // 当て続ける秒数
  var SPREAD_CHANCE = 0.22;   // 全焼時の隣家延焼確率（カスケード暴発を抑制）
  var GAME_DURATION = 60;

  var STATE_OK = 0, STATE_BURNING = 1, STATE_DESTROYED = 2;

  /* ---------- シーンオブジェクト ---------- */
  var houseGroups = [], houseBodies = [], houseRoofs = [], houseWins = [];
  var fireBig = [], fireMid = [], fireInner = [];
  var smokes = [];               // {mesh, houseIdx, t, life, steam}
  var reticle, reticleInner;
  var streamDrops = [], splashDrops = [], splashRing;
  var wetSpot;
  var truckG, nozzleG;

  /* ---------- 状態 ---------- */
  var houseState = new Int32Array(HOUSE_COUNT);
  var houseBlue = new Uint8Array(HOUSE_COUNT);   // 青い炎(強火・+3点)
  var level = 1;                                  // 4消火ごとにレベルUP
  var burnTimer = new Float32Array(HOUSE_COUNT);
  var extinguishProgress = new Float32Array(HOUSE_COUNT);
  var houseWorldX = new Float32Array(HOUSE_COUNT);
  var houseWorldZ = new Float32Array(HOUSE_COUNT);
  var destroyedCount = 0, isSpraying = false, waterTank = WATER_MAX;
  var waterEmpty = false;  // 空になったら離して給水するまで撃てない（ポンプ式）
  var spawnTimer = 0, spawnInterval = SPAWN_INTERVAL_INIT, gameEnded = false;
  var reticleX = 0, reticleZ = 2;
  var splashT = -1, wetT = -1;
  var _raycaster, _pointerVec, _aimPlane, _hitPoint;

  /* 放水ノズルの位置（消防車の上） */
  var NOZ_X = 0, NOZ_Y = 1.35, NOZ_Z = 5.6;

  /* ---------- DOM ---------- */
  var waterBarWrap = null, waterBarFill = null;
  var houseWrap = null, houseEls = [];   // 敗北条件の可視化: 残り家アイコン
  function makeDom() {
    if (waterBarWrap) return;
    houseWrap = document.createElement('div');
    houseWrap.style.cssText = 'position:fixed;top:64px;right:14px;z-index:20;pointer-events:none;' +
      'display:none;font-size:24px;line-height:1;text-shadow:0 2px 4px rgba(0,0,0,0.3);';
    for (var hi = 0; hi < MAX_DESTROYED; hi++) {
      var h = document.createElement('span');
      h.textContent = '🏠';
      h.style.cssText = 'display:inline-block;margin-left:4px;transition:transform 0.25s,filter 0.25s,opacity 0.25s;';
      houseWrap.appendChild(h);
      houseEls.push(h);
    }
    document.body.appendChild(houseWrap);
    waterBarWrap = document.createElement('div');
    waterBarWrap.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);' +
      'width:200px;height:18px;background:rgba(0,0,0,0.4);border-radius:9px;overflow:hidden;z-index:20;pointer-events:none;display:none;';
    var label = document.createElement('div');
    label.textContent = '💧';
    label.style.cssText = 'position:absolute;left:-24px;top:50%;transform:translateY(-50%);font-size:14px;line-height:1;';
    waterBarWrap.appendChild(label);
    waterBarFill = document.createElement('div');
    waterBarFill.style.cssText = 'width:100%;height:100%;background:linear-gradient(90deg,#40b8f5,#80d8ff);border-radius:9px;';
    waterBarWrap.appendChild(waterBarFill);
    document.body.appendChild(waterBarWrap);
  }

  /* 全焼ごとに家アイコンをグレー化＋一瞬拡大（右側から暗転） */
  function updateHouseIcons(popIdx) {
    for (var i = 0; i < houseEls.length; i++) {
      var el = houseEls[i];
      if (i < MAX_DESTROYED - destroyedCount) {
        el.style.filter = 'none';
        el.style.opacity = '1';
      } else {
        el.style.filter = 'grayscale(1) brightness(0.45)';
        el.style.opacity = '0.55';
      }
      if (i === popIdx) {
        el.style.transform = 'scale(1.5)';
        (function (e) { setTimeout(function () { e.style.transform = 'scale(1)'; }, 200); })(el);
      }
    }
  }

  /* ---------- 家 ---------- */
  function makeHouse(THREE, idx) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(Style.roundedBox(1.4, 1.2, 1.4), Style.mat(0xd4a070));
    body.position.y = 0.6;
    g.add(body); houseBodies[idx] = body;
    var roof = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.9, 4), Style.mat(0x8b4513));
    roof.position.y = 1.65; roof.rotation.y = Math.PI / 4;
    g.add(roof); houseRoofs[idx] = roof;
    var win = new THREE.Mesh(Style.roundedBox(0.3, 0.3, 0.05),
      new THREE.MeshLambertMaterial({ color: 0xfff2c8 }));
    win.position.set(0, 0.7, 0.73);
    g.add(win); houseWins[idx] = win;
    var door = new THREE.Mesh(Style.roundedBox(0.3, 0.5, 0.05), Style.mat(0x5a3010));
    door.position.set(0, 0.25, 0.73);
    g.add(door);

    // 3層の炎（外=橙・中=赤橙・芯=黄）。屋根に大きく燃え上がる
    var f1 = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.7, 8),
      new THREE.MeshLambertMaterial({ color: 0xff5a1a, transparent: true, opacity: 0.92 }));
    f1.position.y = 2.5; f1.visible = false; g.add(f1); fireBig[idx] = f1;
    var f2 = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.25, 7),
      new THREE.MeshLambertMaterial({ color: 0xff8c00, transparent: true, opacity: 0.9 }));
    f2.position.set(0.14, 2.35, 0.1); f2.visible = false; g.add(f2); fireMid[idx] = f2;
    var f3 = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.95 }));
    f3.position.set(-0.06, 2.25, -0.04); f3.visible = false; g.add(f3); fireInner[idx] = f3;
    return g;
  }

  /* ---------- 消防車（画面手前・ノズルが照準を追う） ---------- */
  function makeTruck(THREE) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(Style.roundedBox(2.2, 0.75, 1.1), Style.mat(0xd8342c));
    body.position.y = 0.55; g.add(body);
    var cab = new THREE.Mesh(Style.roundedBox(0.75, 0.6, 1.0), Style.mat(0xe8564e));
    cab.position.set(0.85, 1.05, 0); g.add(cab);
    var stripe = new THREE.Mesh(Style.roundedBox(2.21, 0.16, 1.11),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    stripe.position.y = 0.62; g.add(stripe);
    var lamp = new THREE.Mesh(Style.roundedBox(0.22, 0.14, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    lamp.position.set(0.85, 1.42, 0); g.add(lamp);
    g.userData.lamp = lamp;
    var wheelGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.18, 12);
    var wheelMat = Style.mat(0x30302e);
    [[-0.7, 0.26, 0.52], [0.7, 0.26, 0.52], [-0.7, 0.26, -0.52], [0.7, 0.26, -0.52]].forEach(function (p) {
      var w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.x = Math.PI / 2; w.position.set(p[0], p[1], p[2]); g.add(w);
    });
    // 回転ノズル台座＋砲身
    nozzleG = new THREE.Group();
    var base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.25, 10), Style.mat(0x9aa0a8));
    base.position.y = 0;
    nozzleG.add(base);
    var barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.75, 8), Style.mat(0xc4cad2));
    barrel.rotation.x = Math.PI / 2;      // 前方(−Z)へ向ける
    barrel.position.set(0, 0.12, -0.32);
    nozzleG.add(barrel);
    nozzleG.position.set(-0.45, 1.05, 0);
    g.add(nozzleG);
    return g;
  }

  function getNeighbors(idx) {
    var row = (idx / 3) | 0, col = idx % 3, n = [];
    if (row > 0) n.push(idx - 3);
    if (row < 2) n.push(idx + 3);
    if (col > 0) n.push(idx - 1);
    if (col < 2) n.push(idx + 1);
    return n;
  }

  /* ---------- 煙/蒸気（家ごとにプール） ---------- */
  function spawnSmoke(idx, steam) {
    for (var i = 0; i < smokes.length; i++) {
      var s = smokes[i];
      if (s.t >= 0) continue;
      s.t = 0; s.houseIdx = idx; s.steam = steam;
      s.life = steam ? 0.7 : (1.4 + Math.random() * 0.6);
      s.mesh.material.color.setHex(steam ? 0xffffff : 0x6d6d6d);
      s.mesh.position.set(
        houseWorldX[idx] + (Math.random() - 0.5) * 0.5,
        2.3 + Math.random() * 0.3,
        houseWorldZ[idx] + (Math.random() - 0.5) * 0.5);
      s.mesh.scale.set(0.5, 0.5, 0.5);
      s.mesh.visible = true;
      return;
    }
  }

  function igniteHouse(idx, ctx) {
    if (houseState[idx] !== STATE_OK) return;
    houseState[idx] = STATE_BURNING;
    burnTimer[idx] = 0;
    houseBlue[idx] = (level >= 3 && Math.random() < 0.25) ? 1 : 0;
    if (houseBlue[idx]) {
      fireBig[idx].material.color.setHex(0x3a7bff);
      fireMid[idx].material.color.setHex(0x7a5aff);
      fireInner[idx].material.color.setHex(0xd0e8ff);
      ctx.setHint(ctx.t({ en: 'Blue fire! Strong! (+3pts)', ja: '青いほのお！つよいぞ！(+3点)', es: '¡Fuego azul! ¡Fuerte! (+3pts)', 'pt-BR': 'Fogo azul! Forte! (+3pts)', fr: 'Feu bleu! Fort! (+3pts)', de: 'Blaues Feuer! Stark! (+3Pkt)', it: 'Fuoco blu! Forte! (+3pts)', ko: '파란 불꽃! 강하다! (+3점)', 'zh-Hans': '蓝色火焰！很强！(+3分)', tr: 'Mavi ateş! Güçlü! (+3puan)' }));
    } else {
      fireBig[idx].material.color.setHex(0xff5a1a);
      fireMid[idx].material.color.setHex(0xff8c00);
      fireInner[idx].material.color.setHex(0xffe066);
      ctx.setHint(ctx.t({ en: 'Fire!', ja: '火事だ！', es: '¡Fuego!', 'pt-BR': 'Fogo!', fr: 'Au feu!', de: 'Feuer!', it: 'Fuoco!', ko: '불이야!', 'zh-Hans': '着火了！', tr: 'Yangın!' }));
    }
    fireBig[idx].visible = fireMid[idx].visible = fireInner[idx].visible = true;
    houseWins[idx].material.color.setHex(houseBlue[idx] ? 0x9fc4ff : 0xff9540);
    ctx.sfx.tap();
  }

  function extinguishHouse(idx, ctx) {
    if (houseState[idx] !== STATE_BURNING) return;
    // 全焼直前で消したか（間一髪ボーナス判定）: 焼損率75%以上ならボーナス
    var burnEff = Math.max(6.0, BURN_TIME - (level - 1) * 0.8);
    var clutch = (burnTimer[idx] / burnEff) >= 0.75;
    houseState[idx] = STATE_OK;
    burnTimer[idx] = 0;
    fireBig[idx].visible = fireMid[idx].visible = fireInner[idx].visible = false;
    houseRoofs[idx].material.color.setHex(0x8b4513);
    houseBodies[idx].material.color.setHex(0xd4a070);
    houseWins[idx].material.color.setHex(0xfff2c8);
    for (var k = 0; k < 3; k++) spawnSmoke(idx, true); // 白い蒸気シュー
    var pts = houseBlue[idx] ? 3 : 1;
    if (clutch) pts += 2; // 間一髪ボーナス
    ctx.addScore(pts);
    ctx.sfx.success();
    ctx.vibrate(clutch ? 40 : 20);
    ctx.setHint(clutch ? ctx.t({ en: 'Clutch! +', ja: '間一髪！ +', es: '¡Por los pelos! +', 'pt-BR': 'Por um triz! +', fr: 'Juste à temps! +', de: 'Knapp! +', it: 'Per un pelo! +', ko: '아슬아슬! +', 'zh-Hans': '千钧一发！+', tr: 'Kıl payı! +' }) + pts + ctx.t({ en: ' (bonus!)', ja: '（ボーナス）', es: ' (¡bono!)', 'pt-BR': ' (bônus!)', fr: ' (bonus!)', de: ' (Bonus!)', it: ' (bonus!)', ko: ' (보너스!)', 'zh-Hans': '（奖励！）', tr: ' (bonus!)' }) : ctx.t({ en: 'Extinguished! +', ja: 'しょうか！ +', es: '¡Apagado! +', 'pt-BR': 'Apagado! +', fr: 'Éteint! +', de: 'Gelöscht! +', it: 'Estinto! +', ko: '소화! +', 'zh-Hans': '灭火！+', tr: 'Söndürüldü! +' }) + pts);
    // 4消火(点)ごとにレベルUP: 火が強く・出火が早くなる
    // 難度は6点ごとに1段階・上限5（消火が間に合う設計＝緩やかに強化）
    var newLevel = Math.min(5, 1 + Math.floor(ctx.score / 6));
    if (newLevel > level) {
      level = newLevel;
      ctx.sfx.success();
      ctx.setHint(ctx.t({ en: 'Level ', ja: 'レベル', es: 'Nivel ', 'pt-BR': 'Nível ', fr: 'Niveau ', de: 'Level ', it: 'Livello ', ko: '레벨', 'zh-Hans': '等级', tr: 'Seviye ' }) + level + ctx.t({ en: '! Fires are stronger!', ja: '！ 火が つよくなった！', es: '! ¡El fuego es más fuerte!', 'pt-BR': '! O fogo está mais forte!', fr: '! Le feu est plus fort!', de: '! Feuer wird stärker!', it: '! Il fuoco è più forte!', ko: '! 불이 강해졌다!', 'zh-Hans': '！火势更强了！', tr: '! Ateş güçlendi!' }));
    }
  }

  function destroyHouse(idx, ctx) {
    houseState[idx] = STATE_DESTROYED;
    fireBig[idx].visible = fireMid[idx].visible = fireInner[idx].visible = false;
    houseBodies[idx].material.color.setHex(0x3a3a3a);
    houseRoofs[idx].material.color.setHex(0x262626);
    houseWins[idx].material.color.setHex(0x1c1c1c);
    destroyedCount++;
    updateHouseIcons(MAX_DESTROYED - destroyedCount);   // 失った家アイコンを暗転
    ctx.sfx.fail();
    ctx.vibrate(60);
    var n = getNeighbors(idx);
    for (var i = 0; i < n.length; i++) {
      if (houseState[n[i]] === STATE_OK && Math.random() < SPREAD_CHANCE) igniteHouse(n[i], ctx);
    }
  }

  function updateReticleFromPointer(ctx, p) {
    _pointerVec.set(p.nx, p.ny);
    _raycaster.setFromCamera(_pointerVec, ctx.camera);
    if (_raycaster.ray.intersectPlane(_aimPlane, _hitPoint)) {
      reticleX = Math.max(-4.2, Math.min(4.2, _hitPoint.x));
      reticleZ = Math.max(-4.2, Math.min(4.2, _hitPoint.z));
      reticle.position.x = reticleX;
      reticle.position.z = reticleZ;
    }
  }

  /* 弾道アーク: ノズル→照準点。距離に応じて頂点が高くなる放物線 */
  function updateWaterStream(ctx, dt) {
    var show = isSpraying && !waterEmpty && waterTank > 0 && !gameEnded;
    var dx = reticleX - NOZ_X, dz = reticleZ - NOZ_Z;
    var distX = Math.sqrt(dx * dx + dz * dz);
    var apex = 1.2 + distX * 0.22;
    var phase = (ctx.elapsed * 2.2) % 1;
    for (var i = 0; i < STREAM_N; i++) {
      var m = streamDrops[i];
      if (!show) { m.visible = false; continue; }
      var t = (i / STREAM_N + phase) % 1;
      var y = NOZ_Y + (0.15 - NOZ_Y) * t + Math.sin(t * Math.PI) * apex;
      m.position.set(NOZ_X + dx * t, y, NOZ_Z + dz * t);
      var s = 1.1 - t * 0.3;
      m.scale.set(s, s * 1.6, s); // 縦長で「流れ」を出す
      m.visible = true;
    }
    // ノズルを照準へ向ける（親=車体が y に π/2 回転済みなので差し引く）
    if (nozzleG) nozzleG.rotation.y = Math.atan2(-(reticleX - NOZ_X), -(reticleZ - NOZ_Z)) - Math.PI / 2;

    // 着弾しぶき＋濡れ跡
    if (show) {
      if (splashT < 0) splashT = 0;
      splashT += dt;
      for (var j = 0; j < SPLASH_N; j++) {
        var sp = splashDrops[j];
        var st = (splashT * 2.4 + j / SPLASH_N) % 1;
        var ang = j * (Math.PI * 2 / SPLASH_N) + splashT * 1.7;
        sp.position.set(
          reticleX + Math.cos(ang) * st * 0.75,
          0.15 + Math.sin(st * Math.PI) * 0.5,
          reticleZ + Math.sin(ang) * st * 0.75);
        var ss = 0.7 * (1 - st * 0.6);
        sp.scale.set(ss, ss, ss);
        sp.visible = true;
      }
      splashRing.visible = true;
      var rt = (splashT * 2.0) % 1;
      splashRing.position.set(reticleX, 0.05, reticleZ);
      splashRing.scale.set(0.6 + rt * 1.6, 0.6 + rt * 1.6, 1);
      splashRing.material.opacity = 0.55 * (1 - rt);
      wetSpot.visible = true;
      wetSpot.position.set(reticleX, 0.03, reticleZ);
      wetT = 0.8;
    } else {
      splashT = -1;
      for (var k = 0; k < SPLASH_N; k++) splashDrops[k].visible = false;
      splashRing.visible = false;
      if (wetT > 0) {
        wetT -= dt;
        wetSpot.material.opacity = 0.3 * Math.max(0, wetT / 0.8);
        if (wetT <= 0) wetSpot.visible = false;
      }
    }
    if (wetT > 0 && show) wetSpot.material.opacity = 0.3;
  }

  Shell.registerGame({
    id: 'TMFireSquirt',
    title: { en: 'Fire Squirt!', ja: 'しょうぼう水でっぽう', es: '¡Bombero al Agua!', 'pt-BR': 'Bombeiro d\'Água!', fr: 'Lance à Eau!', de: 'Feuerwehrschlauch!', it: 'Pompiere Acqua!', ko: '소방 물총!', 'zh-Hans': '消防水枪', tr: 'İtfaiye Pompası!' },
    howto: { en: 'Drag to aim, hold to spray water!\nExtinguish fires before 3 houses burn down!', ja: 'ドラッグで ねらって おしてる間 ほうすい！\n3けん もえちゃう前に けそう', es: '¡Desliza para apuntar, mantén para rociar agua!\n¡Apaga los fuegos antes de que ardan 3 casas!', 'pt-BR': 'Deslize para mirar, segure para borrifar água!\nApague os incêndios antes de 3 casas pegarem fogo!', fr: 'Glissez pour viser, maintenez pour arroser!\nÉteignez les feux avant que 3 maisons brûlent!', de: 'Wischen zum Zielen, halten zum Spritzen!\nLösche Feuer bevor 3 Häuser brennen!', it: 'Scorri per mirare, tieni per spruzzare acqua!\nSpengi i fuochi prima che 3 case brucino!', ko: '드래그로 조준, 누르는 동안 방수!\n3채 불타기 전에 꺼라!', 'zh-Hans': '拖动瞄准，按住喷水！\n在3栋房子烧毁前灭火！', tr: 'Kaydır nişan al, basılı tut su sıkıştır!\n3 ev yanmadan söndür!' },
    scoreLabel: { en: 'fires', ja: '消火数', es: 'apagados', 'pt-BR': 'extintos', fr: 'extinctions', de: 'gelöscht', it: 'estinti', ko: '진화', 'zh-Hans': '灭火数', tr: 'söndürme' },
    bg: 0xffd9a8,               // 夕焼けの町
    fogColor: 0xffd9a8, fogNear: 26, fogFar: 60,
    cameraFov: 55,
    cameraPos: [0, 10.5, 11.5],  // 斜め見下ろし（奥行きが出る）
    cameraLookAt: [0, 0.4, -0.6],
    fitWidth: 11,              // 縦画面でも全体が収まる

    init: function (ctx) {
      var THREE = ctx.THREE;
      _raycaster = new THREE.Raycaster();
      _pointerVec = new THREE.Vector2();
      _aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      _hitPoint = new THREE.Vector3();

      var ground = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), Style.mat(0xc8a06a));
      ground.rotation.x = -Math.PI / 2;
      ctx.scene.add(ground);
      var roadMat = Style.mat(0xb09060);
      var roadH = new THREE.Mesh(new THREE.PlaneGeometry(34, 0.5), roadMat);
      roadH.rotation.x = -Math.PI / 2; roadH.position.y = 0.01;
      ctx.scene.add(roadH);
      var roadV = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 34), roadMat);
      roadV.rotation.x = -Math.PI / 2; roadV.position.y = 0.01;
      ctx.scene.add(roadV);

      var off = -(GRID_SIZE - 1) * HOUSE_SPACING * 0.5;
      for (var row = 0; row < GRID_SIZE; row++) {
        for (var col = 0; col < GRID_SIZE; col++) {
          var idx = row * GRID_SIZE + col;
          var hg = makeHouse(THREE, idx);
          var wx = off + col * HOUSE_SPACING;
          var wz = off + row * HOUSE_SPACING - 1.2; // 町を少し奥へ
          hg.position.set(wx, 0, wz);
          houseWorldX[idx] = wx; houseWorldZ[idx] = wz;
          ctx.scene.add(hg);
          houseGroups[idx] = hg;
        }
      }

      truckG = makeTruck(THREE);
      truckG.position.set(0, 0, NOZ_Z);
      truckG.rotation.y = Math.PI / 2; // 正面(奥)向き
      ctx.scene.add(truckG);

      // 照準（二重リング・パルス）
      reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.66, 26),
        new THREE.MeshBasicMaterial({ color: 0x28c8ff, transparent: true, opacity: 0.95, depthWrite: false }));
      reticle.rotation.x = -Math.PI / 2;
      reticle.position.set(0, 0.06, 2);
      ctx.scene.add(reticle);
      reticleInner = new THREE.Mesh(
        new THREE.CircleGeometry(0.16, 16),
        new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.9, depthWrite: false }));
      reticleInner.position.z = 0.01;
      reticle.add(reticleInner);

      // 水流・しぶき・波紋・濡れ跡
      // 常時明るい水色(ライト非依存)・大きめ粒を重ねてジェットに見せる
      var dropMat = new THREE.MeshBasicMaterial({ color: 0x6fd4ff, transparent: true, opacity: 0.95 });
      var dropGeo = new THREE.SphereGeometry(0.24, 8, 6);
      for (var i = 0; i < STREAM_N; i++) {
        var d = new THREE.Mesh(dropGeo, dropMat);
        d.visible = false; ctx.scene.add(d); streamDrops.push(d);
      }
      var splMat = new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.85 });
      var splGeo = new THREE.SphereGeometry(0.1, 6, 5);
      for (var j = 0; j < SPLASH_N; j++) {
        var sd = new THREE.Mesh(splGeo, splMat);
        sd.visible = false; ctx.scene.add(sd); splashDrops.push(sd);
      }
      splashRing = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.42, 22),
        new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.5, depthWrite: false }));
      splashRing.rotation.x = -Math.PI / 2;
      splashRing.visible = false;
      ctx.scene.add(splashRing);
      wetSpot = new THREE.Mesh(
        new THREE.CircleGeometry(1.0, 20),
        new THREE.MeshBasicMaterial({ color: 0x7a6540, transparent: true, opacity: 0.3, depthWrite: false }));
      wetSpot.rotation.x = -Math.PI / 2;
      wetSpot.visible = false;
      ctx.scene.add(wetSpot);

      // 煙/蒸気プール（共有）
      var smokeGeo = new THREE.SphereGeometry(0.3, 7, 6);
      for (var s = 0; s < HOUSE_COUNT * SMOKE_PER_HOUSE; s++) {
        var sm = new THREE.Mesh(smokeGeo,
          new THREE.MeshLambertMaterial({ color: 0x6d6d6d, transparent: true, opacity: 0.55 }));
        sm.visible = false;
        ctx.scene.add(sm);
        smokes.push({ mesh: sm, houseIdx: 0, t: -1, life: 1, steam: false });
      }
      makeDom();
    },

    start: function (ctx) {
      destroyedCount = 0; isSpraying = false; waterTank = WATER_MAX; waterEmpty = false;
      level = 1;
      for (var hb = 0; hb < HOUSE_COUNT; hb++) houseBlue[hb] = 0;
      spawnTimer = 0; spawnInterval = SPAWN_INTERVAL_INIT; gameEnded = false;
      reticleX = 0; reticleZ = 2; splashT = -1; wetT = -1;
      for (var i = 0; i < HOUSE_COUNT; i++) {
        houseState[i] = STATE_OK; burnTimer[i] = 0; extinguishProgress[i] = 0;
        fireBig[i].visible = fireMid[i].visible = fireInner[i].visible = false;
        houseBodies[i].material.color.setHex(0xd4a070);
        houseRoofs[i].material.color.setHex(0x8b4513);
        houseWins[i].material.color.setHex(0xfff2c8);
      }
      for (var j = 0; j < streamDrops.length; j++) streamDrops[j].visible = false;
      for (var k = 0; k < splashDrops.length; k++) splashDrops[k].visible = false;
      for (var s = 0; s < smokes.length; s++) { smokes[s].t = -1; smokes[s].mesh.visible = false; }
      splashRing.visible = false; wetSpot.visible = false;
      reticle.position.set(reticleX, 0.06, reticleZ);
      reticle.visible = true;
      if (waterBarWrap) { waterBarWrap.style.display = 'block'; waterBarFill.style.width = '100%'; }
      if (houseWrap) houseWrap.style.display = 'block';
      updateHouseIcons(-1);
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Drag to aim!', ja: 'ドラッグで ねらえ！', es: '¡Desliza para apuntar!', 'pt-BR': 'Deslize para mirar!', fr: 'Glissez pour viser!', de: 'Wischen zum Zielen!', it: 'Scorri per mirare!', ko: '드래그로 조준하라!', 'zh-Hans': '拖动瞄准！', tr: 'Nişan almak için kaydır!' }));
      igniteHouse(4, ctx);
    },

    onPointerDown: function (ctx, p) {
      if (gameEnded) return;
      isSpraying = true;
      updateReticleFromPointer(ctx, p);
    },
    onPointerMove: function (ctx, p) {
      if (gameEnded) return;
      updateReticleFromPointer(ctx, p);
    },
    onPointerUp: function () { isSpraying = false; },

    update: function (ctx, dt) {
      if (gameEnded) return;
      var i, elapsed = ctx.elapsed;

      if (elapsed >= GAME_DURATION) {
        gameEnded = true;
        if (waterBarWrap) waterBarWrap.style.display = 'none';
        if (houseWrap) houseWrap.style.display = 'none';
        ctx.setHint(ctx.t({ en: 'Town saved!', ja: 'まちをまもった！', es: '¡Ciudad salvada!', 'pt-BR': 'Cidade salva!', fr: 'Ville sauvée!', de: 'Stadt gerettet!', it: 'Città salvata!', ko: '마을을 지켰다!', 'zh-Hans': '小镇得救了！', tr: 'Kasaba kurtarıldı!' }));
        ctx.endGame(ctx.score);
        return;
      }

      // 水タンク（ポンプ式: 空になったら指を離して給水）
      if (isSpraying && !waterEmpty && waterTank > 0) {
        waterTank = Math.max(0, waterTank - WATER_DRAIN * dt);
        if (waterTank <= 0) {
          waterEmpty = true;
          ctx.sfx.tap();
          ctx.setHint(ctx.t({ en: 'Out of water! Release to refill!', ja: 'みずぎれ！ ゆびをはなして きゅうすい！', es: '¡Sin agua! ¡Suelta para recargar!', 'pt-BR': 'Sem água! Solte para recarregar!', fr: 'Plus d\'eau! Relâchez pour recharger!', de: 'Kein Wasser! Loslassen zum Nachfüllen!', it: 'Acqua esaurita! Rilascia per ricaricare!', ko: '물 없음! 놓아서 보충하라!', 'zh-Hans': '没水了！松开重新补水！', tr: 'Su bitti! Bırak doldurmak için!' }));
        }
      } else if (!isSpraying) {
        waterTank = Math.min(WATER_MAX, waterTank + WATER_REFILL * dt);
        if (waterEmpty && waterTank >= WATER_MAX * 0.35) {
          waterEmpty = false;
          ctx.setHint(ctx.t({ en: 'Refilled! OK!', ja: 'きゅうすいOK！', es: '¡Recargado! ¡OK!', 'pt-BR': 'Recarregado! OK!', fr: 'Rechargé! OK!', de: 'Nachgefüllt! OK!', it: 'Ricaricato! OK!', ko: '보충 완료! OK!', 'zh-Hans': '补水完毕！OK！', tr: 'Dolduruldu! Tamam!' }));
        }
      }
      if (waterBarFill) {
        waterBarFill.style.width = (waterTank / WATER_MAX * 100).toFixed(1) + '%';
        waterBarFill.style.background = waterEmpty
          ? 'linear-gradient(90deg,#ff6b5e,#ffa08e)'
          : 'linear-gradient(90deg,#40b8f5,#80d8ff)';
      }

      updateWaterStream(ctx, dt);

      // 消火判定（当て続けでゲージ）
      for (i = 0; i < HOUSE_COUNT; i++) {
        if (houseState[i] !== STATE_BURNING) { extinguishProgress[i] = 0; continue; }
        if (isSpraying && !waterEmpty && waterTank > 0) {
          var hdx = reticleX - houseWorldX[i], hdz = reticleZ - houseWorldZ[i];
          if (hdx * hdx + hdz * hdz < HIT_RADIUS * HIT_RADIUS) {
            extinguishProgress[i] += dt;
            burnTimer[i] = Math.max(0, burnTimer[i] - dt * 0.8);
            // 消火に要する当て続け時間は最大2秒まで（仕様: 消火所要≦2秒）
            var needHold = Math.min(2.0, EXTINGUISH_HOLD * (1 + (level - 1) * 0.25) * (houseBlue[i] ? 1.8 : 1));
            // 当たっている間、炎が縮んでいく＝効いてる感
            var shrink = Math.max(0.25, 1 - extinguishProgress[i] / EXTINGUISH_HOLD * 0.7);
            fireBig[i].scale.multiplyScalar(0.0); // 下のアニメで上書きされるためフラグ的に使わない
            fireBig[i].userData.shrink = shrink;
            if (extinguishProgress[i] >= needHold) {
              extinguishProgress[i] = 0;
              extinguishHouse(i, ctx);
            }
          } else {
            extinguishProgress[i] = Math.max(0, extinguishProgress[i] - dt);
            fireBig[i].userData.shrink = 1;
          }
        } else {
          fireBig[i].userData.shrink = 1;
        }
      }

      // 炎アニメ＋煙
      var t = elapsed;
      for (i = 0; i < HOUSE_COUNT; i++) {
        if (houseState[i] !== STATE_BURNING) continue;
        var sh = (fireBig[i].userData.shrink || 1) * (1 + (level - 1) * 0.15) * (houseBlue[i] ? 1.25 : 1);
        var sy = (0.85 + 0.35 * Math.sin(t * 6.0 + i * 1.3)) * sh;
        var sx = (0.8 + 0.25 * Math.cos(t * 7.5 + i * 0.9)) * sh;
        fireBig[i].scale.set(sx, sy, sx);
        fireBig[i].position.y = 2.5 + 0.12 * Math.sin(t * 5.0 + i);
        fireBig[i].rotation.y = t * 1.5 + i;
        var s2 = (0.75 + 0.4 * Math.sin(t * 8.0 + i * 2.1 + 1.0)) * sh;
        fireMid[i].scale.set(s2, s2, s2);
        fireMid[i].position.y = 2.35 + 0.18 * Math.cos(t * 6.5 + i * 1.7);
        var s3 = (0.8 + 0.3 * Math.sin(t * 10.0 + i * 2.9)) * sh;
        fireInner[i].scale.set(s3, s3, s3);
        // ときどき煙を上げる
        if (Math.random() < dt * 2.2) spawnSmoke(i, false);
      }

      // 煙/蒸気の上昇・フェード
      for (i = 0; i < smokes.length; i++) {
        var sm = smokes[i];
        if (sm.t < 0) continue;
        sm.t += dt;
        var k2 = sm.t / sm.life;
        if (k2 >= 1) { sm.t = -1; sm.mesh.visible = false; continue; }
        sm.mesh.position.y += dt * (sm.steam ? 1.6 : 0.9);
        var g2 = 0.5 + k2 * (sm.steam ? 1.6 : 2.2);
        sm.mesh.scale.set(g2, g2, g2);
        sm.mesh.material.opacity = (sm.steam ? 0.75 : 0.55) * (1 - k2);
      }

      // 燃焼進行
      for (i = 0; i < HOUSE_COUNT; i++) {
        if (houseState[i] !== STATE_BURNING) continue;
        burnTimer[i] += dt;
        // 出火→全焼までの猶予は最低6秒を確保（仕様: 延焼猶予≧6秒）
        var burnEff = Math.max(6.0, BURN_TIME - (level - 1) * 0.8);
        var br = burnTimer[i] / burnEff;
        var r = Math.floor(0xd4 + (0xff - 0xd4) * br);
        var gv = Math.floor(0xa0 * (1 - br * 0.6));
        var bv = Math.floor(0x70 * (1 - br * 0.8));
        houseBodies[i].material.color.setRGB(r / 255, gv / 255, bv / 255);
        if (burnTimer[i] >= burnEff) {
          destroyHouse(i, ctx);
          if (destroyedCount >= MAX_DESTROYED) {
            gameEnded = true;
            if (waterBarWrap) waterBarWrap.style.display = 'none';
            if (houseWrap) houseWrap.style.display = 'none';
            ctx.setHint(ctx.t({ en: '3 houses burned down...', ja: '3けん もえちゃった…', es: '3 casas ardieron...', 'pt-BR': '3 casas queimaram...', fr: '3 maisons ont brûlé...', de: '3 Häuser abgebrannt...', it: '3 case bruciate...', ko: '3채가 타버렸다…', 'zh-Hans': '3栋房子烧毁了…', tr: '3 ev yandı...' }));
            ctx.gameOver(ctx.score);
            return;
          }
          ctx.setHint(ctx.t({ en: 'Fully burned! Left: ', ja: 'ぜんしょう！のこり', es: '¡Totalmente quemada! Quedan: ', 'pt-BR': 'Totalmente queimada! Restam: ', fr: 'Totalement brûlée! Reste: ', de: 'Abgebrannt! Noch: ', it: 'Completamente bruciata! Restano: ', ko: '전소! 남은 ', 'zh-Hans': '全烧了！剩余', tr: 'Tamamen yandı! Kalan: ' }) + (MAX_DESTROYED - destroyedCount) + ctx.t({ en: ' houses', ja: 'けん', es: ' casas', 'pt-BR': ' casas', fr: ' maisons', de: ' Häuser', it: ' case', ko: '채', 'zh-Hans': '栋', tr: ' ev' }));
        }
      }

      // 発火スポーン
      spawnInterval = Math.max(Math.max(1.1, SPAWN_INTERVAL_MIN - (level - 1) * 0.15),
        SPAWN_INTERVAL_INIT - elapsed * 0.045 - (level - 1) * 0.4);
      // 開始30秒は「ならし」区間: 出火間隔を広めに保つ
      if (elapsed < 30) spawnInterval = Math.max(spawnInterval, 3.2);

      // 同時火災数の上限 = 処理可能数+1（時間経過で処理可能数が増える）
      // 処理可能数: 序盤2 → 25秒ごとに+1（残存家数は超えない）
      var burningNow = 0;
      for (i = 0; i < HOUSE_COUNT; i++) if (houseState[i] === STATE_BURNING) burningNow++;
      var capacity = 2 + Math.floor(elapsed / 25);
      var maxConcurrent = Math.min(HOUSE_COUNT - destroyedCount, capacity + 1);

      spawnTimer += dt;
      if (spawnTimer >= spawnInterval) {
        spawnTimer = 0;
        if (burningNow < maxConcurrent) {
          var cand = [];
          for (i = 0; i < HOUSE_COUNT; i++) if (houseState[i] === STATE_OK) cand.push(i);
          if (cand.length > 0) igniteHouse(cand[(Math.random() * cand.length) | 0], ctx);
        }
      }

      // 照準パルス＋消防車ランプ点滅
      var pk = 1 + Math.sin(t * 6) * 0.08;
      reticle.scale.set(pk, pk, 1);
      if (truckG.userData.lamp) truckG.userData.lamp.material.color.setHex(
        (t % 0.8) < 0.4 ? 0xff3b30 : 0x8a1a14);
    }
  });
})();
