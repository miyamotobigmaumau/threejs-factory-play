/* =========================================================================
 * TMLavaHop — ようがんホッピング（旧：ようがんけんけんぱ）
 * 【再設計】左右/両タップのコマンド入力を全廃。長押しでタメ→離してジャンプ
 *   のワンアクション型（とびいし方式）。岩は乗った瞬間から沈むので立ち止まれない。
 *   近い岩＝安全低得点／遠い岩＝高得点＋コンボ、中心着地で「ピタ跳ね」ボーナス。
 *   予兆ありの間欠泉を跳んでかわす。溶岩に落ちたら終了。
 * 操作: 長押しで ため → 左右にずらして ねらう → 離してジャンプ
 * スコア: 跳んだ回数＋距離・ピタ跳ね・コンボボーナス / コンティニュー可
 * けんけんぱの足場配置は「ルート分岐」として継承（岩が左右に振れる）。
 * ========================================================================= */
(function () {
  'use strict';

  var ROCK_POOL   = 10;      // 画面内に必要な岩の数
  var SINK_DELAY  = 1.1;     // 着地から沈み始めるまで（余裕を持たせる）
  var SINK_DUR    = 1.1;     // 沈み切るまでの秒数
  var CHAR_Y      = 0.55;    // 岩の上でのキャラ底Y
  var GEYSER_POOL = 4;

  var chara, charBunny, marker;
  var rocks = [];            // { mesh, index, x0, z, r, sinkT, landed, sunk }
  var geysers = [];          // { mesh, glow, x, z, t, state } state: 0=idle 1=予兆 2=噴出
  var powerBar, powerBarBg;
  var charging, power, aimX;
  var jumping, jumpT, jumpDur, fromX, fromZ, toX, toZ;
  var charIndex;             // いま乗っている岩の番号
  var combo;                 // 連続ボーナス数
  var sinking, sinkT, ended, gracePeriod;
  var lavaPlane, lavaTex;
  var _camT, _cp;
  var floatPool = [];        // 得点フロート（+N スプライト）プール {spr, tex, cv, t, baseY}
  var ringPool = [];         // ピタ跳ね金色リング波紋プール {mesh, t}

  /* ---- 「+N」フローティング表示（CanvasTexture スプライトのプール再利用） ---- */
  function showFloat(text, x, y, z, color) {
    for (var i = 0; i < floatPool.length; i++) {
      var f = floatPool[i];
      if (f.t < 0.9) continue;          // 使用中はスキップ
      var c = f.cv.getContext('2d');
      c.clearRect(0, 0, 128, 64);
      c.font = 'bold 44px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineWidth = 8;
      c.strokeStyle = 'rgba(40,10,0,0.85)';
      c.strokeText(text, 64, 32);
      c.fillStyle = color;
      c.fillText(text, 64, 32);
      f.tex.needsUpdate = true;
      f.t = 0;
      f.baseY = y;
      f.spr.position.set(x, y, z);
      f.spr.material.opacity = 1;
      f.spr.visible = true;
      return;
    }
  }

  /* ---- ピタ跳ね時の金色リング波紋 ---- */
  function showRing(x, z) {
    for (var i = 0; i < ringPool.length; i++) {
      if (ringPool[i].t < 1) continue;
      ringPool[i].t = 0;
      ringPool[i].mesh.position.set(x, 0.08, z);
      ringPool[i].mesh.scale.setScalar(1);
      ringPool[i].mesh.visible = true;
      return;
    }
  }

  /* ---- 溶岩床テクスチャ（暗い岩皮＋光る割れ目） ---- */
  function makeLavaTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    var c = cv.getContext('2d');
    c.fillStyle = '#8a2400'; c.fillRect(0, 0, 256, 256);
    for (var lb = 0; lb < 12; lb++) {
      var g = c.createRadialGradient(0, 0, 2, 0, 0, 26 + Math.random() * 22);
      g.addColorStop(0, '#ffd23f'); g.addColorStop(0.5, '#ff7a1a'); g.addColorStop(1, 'rgba(255,90,0,0)');
      c.save(); c.translate(Math.random() * 256, Math.random() * 256);
      c.fillStyle = g; c.fillRect(-50, -50, 100, 100); c.restore();
    }
    c.strokeStyle = 'rgba(30,8,0,0.85)'; c.lineWidth = 5;
    for (var lk = 0; lk < 9; lk++) {
      c.beginPath();
      var lx = Math.random() * 256, ly = Math.random() * 256;
      c.moveTo(lx, ly);
      for (var seg = 0; seg < 4; seg++) { lx += (Math.random() - 0.5) * 90; ly += (Math.random() - 0.5) * 90; c.lineTo(lx, ly); }
      c.stroke();
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 14);
    return tex;
  }

  /* ---- 岩(index番)のパラメータ。けんけんぱ由来の左右分岐配置 ---- */
  function setupRock(r, index, random) {
    r.index = index;
    r.z = -index * 2.7 - random() * 0.8;   // 間隔を少し詰めて届きやすく
    // ルート分岐は控えめに（横ズレを小さく＝まっすぐ跳んでも当たりやすい）
    if (index < 2) r.x0 = 0;
    else if (index % 2 === 0) r.x0 = (random() * 2 - 1) * 0.5;
    else r.x0 = (random() < 0.5 ? -1 : 1) * (0.6 + random() * 0.7);
    r.rad = Math.max(0.8, 1.2 - index * 0.012);   // 大きめの岩
    r.sinkT = 0; r.landed = false; r.sunk = false;
    r.mesh.scale.set(r.rad, 1, r.rad);
    r.mesh.position.set(r.x0, -0.2, r.z);
    r.mesh.visible = true;
  }

  function rockByIndex(index) {
    for (var i = 0; i < rocks.length; i++) if (rocks[i].index === index) return rocks[i];
    return null;
  }

  function placeCharOnRock(index) {
    var r = rockByIndex(index);
    if (r) { chara.position.set(r.x0, CHAR_Y, r.z); return r; }
    return null;
  }

  /* ---- 手前を通り過ぎた岩を前方へ回す ---- */
  function recycleRocks(random) {
    var maxIndex = 0;
    for (var i = 0; i < rocks.length; i++) if (rocks[i].index > maxIndex) maxIndex = rocks[i].index;
    for (var j = 0; j < rocks.length; j++) {
      if (rocks[j].index < charIndex - 1) { maxIndex++; setupRock(rocks[j], maxIndex, random); }
    }
  }

  /* ---- 間欠泉を前方のランダムな溶岩面に配置 ---- */
  function setupGeyser(g, baseZ, random) {
    g.x = (random() * 2 - 1) * 3.2;
    g.z = baseZ - (4 + random() * 20);
    g.t = random() * 2.6;
    g.state = 0;
    g.mesh.visible = false;
    g.glow.visible = false;
    g.glow.position.set(g.x, 0.02, g.z);
  }

  Shell.registerGame({
    id: 'TMLavaHop',
    title: { en: 'Lava Hop', ja: 'ようがんホッピング', es: 'Salto de Lava', 'pt-BR': 'Pulo de Lava', fr: 'Saut de Lave', de: 'Lava-Hopsen', it: 'Salto di Lava', ko: '용암 호핑', 'zh-Hans': '熔岩跳跳', tr: 'Lav Zıplama' },
    howto: { en: 'Hold to charge → release to jump!\nRocks sink when landed on. Far rocks = more points!', ja: 'ながおしで ため、はなして ジャンプ！\nいわは のると しずむ。とおくの いわほど 高とくてん！', es: '¡Mantén pulsado para cargar → suelta para saltar!\n¡Las rocas se hunden al aterrizarlas. Rocas lejanas = más puntos!', 'pt-BR': 'Segure para carregar → solte para pular!\nAs rochas afundam ao pousar. Rochas distantes = mais pontos!', fr: 'Maintenez pour charger → relâchez pour sauter!\nLes rochers coulent à l\'atterrissage. Rochers lointains = plus de points!', de: 'Halten zum Aufladen → loslassen zum Springen!\nSteine sinken beim Landen. Weite Steine = mehr Punkte!', it: 'Tieni premuto per caricare → rilascia per saltare!\nLe rocce affondano all\'atterraggio. Rocce lontane = più punti!', ko: '길게 누르기로 충전 → 놓기로 점프!\n착지하면 바위가 가라앉는다. 먼 바위 = 고득점!', 'zh-Hans': '长按蓄力→松开跳跃！\n落地后岩石下沉。远处的岩石=高分！', tr: 'Şarj etmek için basılı tut → atlamak için bırak!\nKayalar inince batar. Uzak kayalar = daha fazla puan!' },
    scoreLabel: { en: 'score', ja: 'スコア', es: 'puntaje', 'pt-BR': 'pontos', fr: 'score', de: 'Punkte', it: 'punteggio', ko: '점수', 'zh-Hans': '分数', tr: 'skor' },
    bg: 0x1a0500,
    fogNear: 16, fogFar: 34,
    cameraFov: 58,
    allowContinue: true,

    init: function (ctx) {
      var THREE = ctx.THREE;
      var scene = ctx.scene;
      _camT = new THREE.Vector3();
      _cp = new THREE.Vector3();

      // 溶岩床（キャラ追従）
      lavaTex = makeLavaTexture(THREE);
      lavaPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 200),
        new THREE.MeshBasicMaterial({ map: lavaTex }));
      lavaPlane.rotation.x = -Math.PI / 2;
      lavaPlane.position.y = -0.55;
      scene.add(lavaPlane);

      // 装飾の岩柱
      var pillarMat = Style.mat(0x3a1a00);
      var pillarGeo = new THREE.CylinderGeometry(0.5, 0.9, 4.5, 8);
      var pillarPos = [[-6.5,-2,-20],[7,-2,-35],[-5.5,-2,-50],[6.5,-2,-12],[-8,-2,-30],[9,-2,-44]];
      for (var p = 0; p < pillarPos.length; p++) {
        var pl = new THREE.Mesh(pillarGeo, pillarMat);
        pl.position.set(pillarPos[p][0], pillarPos[p][1], pillarPos[p][2]);
        scene.add(pl);
      }

      // 岩プール（黒い岩皮＋赤熱した縁）
      var rockGeo = new THREE.CylinderGeometry(1, 1.15, 0.42, 12);
      var rockMat = Style.mat(0x4a4038);
      for (var i = 0; i < ROCK_POOL; i++) {
        var grp = new THREE.Group();
        var body = new THREE.Mesh(rockGeo, rockMat);
        grp.add(body);
        var rim = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.08, 8, 18),
          new THREE.MeshBasicMaterial({ color: 0xff6a1a }));
        rim.rotation.x = Math.PI / 2; rim.position.y = 0.2;
        grp.add(rim);
        grp.visible = false;
        scene.add(grp);
        rocks.push({ mesh: grp, index: i, x0: 0, z: 0, rad: 1, sinkT: 0, landed: false, sunk: false });
      }

      // 間欠泉プール（噴き上がる溶岩の柱＋足元の予兆リング）
      for (var q = 0; q < GEYSER_POOL; q++) {
        var col = new THREE.Mesh(
          new THREE.CylinderGeometry(0.34, 0.5, 3.2, 10),
          new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, opacity: 0.92 }));
        col.visible = false;
        scene.add(col);
        var glow = new THREE.Mesh(
          new THREE.RingGeometry(0.4, 0.75, 20),
          new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.0, depthWrite: false }));
        glow.rotation.x = -Math.PI / 2;
        glow.visible = false;
        scene.add(glow);
        geysers.push({ mesh: col, glow: glow, x: 0, z: 0, t: 0, state: 0 });
      }

      // キャラ（うさぎ）
      charBunny = GameBunny.make(THREE, { scale: 0.62 });
      chara = charBunny.group;
      scene.add(chara);

      // 照準マーカー（着地予定地）
      marker = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.72, 24),
        new THREE.MeshBasicMaterial({ color: 0xffee58, transparent: true, opacity: 0.9 }));
      marker.rotation.x = -Math.PI / 2;
      marker.visible = false;
      scene.add(marker);

      // 得点フロート「+N」スプライトプール
      for (var fp = 0; fp < 6; fp++) {
        var fcv = document.createElement('canvas');
        fcv.width = 128; fcv.height = 64;
        var ftex = new THREE.CanvasTexture(fcv);
        var fspr = new THREE.Sprite(new THREE.SpriteMaterial({ map: ftex, transparent: true, depthWrite: false }));
        fspr.scale.set(1.7, 0.85, 1);
        fspr.visible = false;
        scene.add(fspr);
        floatPool.push({ spr: fspr, tex: ftex, cv: fcv, t: 1, baseY: 0 });
      }

      // ピタ跳ね金色リング波紋プール
      for (var rp = 0; rp < 3; rp++) {
        var rgm = new THREE.Mesh(
          new THREE.RingGeometry(0.55, 0.72, 24),
          new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0, depthWrite: false }));
        rgm.rotation.x = -Math.PI / 2;
        rgm.visible = false;
        scene.add(rgm);
        ringPool.push({ mesh: rgm, t: 1 });
      }

      // パワーゲージ
      powerBarBg = document.createElement('div');
      powerBarBg.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);' +
        'width:56vw;height:12px;background:rgba(0,0,0,.3);border-radius:6px;z-index:11;display:none;';
      powerBar = document.createElement('div');
      powerBar.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#ffd23f,#ff5a1a);border-radius:6px;';
      powerBarBg.appendChild(powerBar);
      document.body.appendChild(powerBarBg);
    },

    start: function (ctx) {
      charging = false; jumping = false; sinking = false; ended = false;
      power = 0; aimX = 0; charIndex = 0; combo = 0; gracePeriod = 1.4; // 開始時は少し猶予
      for (var i = 0; i < rocks.length; i++) setupRock(rocks[i], i, ctx.random);
      for (var g = 0; g < geysers.length; g++) setupGeyser(geysers[g], -8 - g * 8, ctx.random);
      chara.rotation.set(0, Math.PI, 0);
      chara.scale.set(1, 1, 1);
      placeCharOnRock(0);
      rockByIndex(0).landed = true;
      marker.visible = false;
      powerBarBg.style.display = 'none';
      powerBar.style.width = '0%';
      for (var fi = 0; fi < floatPool.length; fi++) { floatPool[fi].t = 1; floatPool[fi].spr.visible = false; }
      for (var ri = 0; ri < ringPool.length; ri++) { ringPool[ri].t = 1; ringPool[ri].mesh.visible = false; }
      ctx.camera.position.set(0, 6.5, 9);
      ctx.camera.lookAt(0, 0.4, -3.5);
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Hold to charge → release!', ja: 'ながおしで ため → はなす！', es: '¡Mantén para cargar → suelta!', 'pt-BR': 'Segure para carregar → solte!', fr: 'Maintenez pour charger → relâchez!', de: 'Halten zum Aufladen → loslassen!', it: 'Tieni per caricare → rilascia!', ko: '길게 눌러 충전 → 놓기!', 'zh-Hans': '长按蓄力→松开！', tr: 'Basılı tut → bırak!' }));
    },

    onContinue: function (ctx) {
      sinking = false; jumping = false; charging = false; ended = false;
      power = 0; combo = 0; gracePeriod = 2.5;
      chara.rotation.set(0, Math.PI, 0);
      chara.scale.set(1, 1, 1);
      powerBarBg.style.display = 'none';
      marker.visible = false;
      var r = rockByIndex(charIndex);
      if (!r) { setupRock(rocks[0], charIndex, ctx.random); r = rocks[0]; }
      r.sinkT = 0; r.sunk = false; r.landed = true;
      r.mesh.position.y = -0.2;
      placeCharOnRock(charIndex);
      ctx.setHint(ctx.t({ en: 'Continue!', ja: 'つづきから！', es: '¡Continuar!', 'pt-BR': 'Continuar!', fr: 'Continuer!', de: 'Weitermachen!', it: 'Continua!', ko: '이어서!', 'zh-Hans': '继续！', tr: 'Devam et!' }));
    },

    onPointerDown: function (ctx, p) {
      if (jumping || sinking || ended) return;
      charging = true;
      power = 0;
      aimX = chara.position.x;
      powerBarBg.style.display = '';
      marker.visible = true;
    },

    onPointerMove: function (ctx, p) {
      if (!charging) return;
      aimX = p.nx * 3.2;
    },

    onPointerUp: function (ctx, p) {
      if (!charging || jumping || sinking || ended) return;
      charging = false;
      powerBarBg.style.display = 'none';
      marker.visible = false;
      var dist = 1.4 + power * 6.6;
      fromX = chara.position.x; fromZ = chara.position.z;
      toX = aimX; toZ = chara.position.z - dist;
      jumping = true; jumpT = 0;
      jumpDur = 0.5 + power * 0.2;
      ctx.sfx.tap();
      ctx.vibrate(15);
    },

    update: function (ctx, dt) {
      if (ended) return;
      var time = ctx.elapsed, i, r;

      // 溶岩床追従＋明滅
      lavaPlane.position.z = chara.position.z;
      lavaPlane.position.x = chara.position.x * 0.5;
      lavaTex.offset.y += dt * 0.02;
      var lp = 0.86 + 0.14 * Math.sin(time * 2.4);
      lavaPlane.material.color.setRGB(lp, lp, lp);

      if (gracePeriod > 0) gracePeriod = Math.max(0, gracePeriod - dt);

      // 間欠泉の予兆→噴出サイクル
      for (var gi = 0; gi < geysers.length; gi++) {
        var g = geysers[gi];
        g.t += dt;
        if (g.state === 0 && g.t > 2.2) { g.state = 1; g.t = 0; g.glow.visible = true; }   // 予兆へ
        else if (g.state === 1) {
          g.glow.material.opacity = 0.35 + 0.4 * Math.abs(Math.sin(time * 12));
          var sc = 1 + 0.3 * Math.sin(time * 12);
          g.glow.scale.set(sc, sc, 1);
          if (g.t > 0.75) { g.state = 2; g.t = 0; g.mesh.visible = true; g.mesh.position.set(g.x, 1.0, g.z); }
        } else if (g.state === 2) {                                                          // 噴出中
          var h = Math.sin(Math.min(1, g.t / 0.6) * Math.PI);
          g.mesh.scale.set(1, 0.4 + h * 1.4, 1);
          g.mesh.position.y = 0.2 + h * 1.5;
          if (g.t > 0.6) { g.state = 0; g.t = 0; g.mesh.visible = false; g.glow.visible = false; }
        }
        // キャラより後方に流れたら前方へ回す
        if (g.z > chara.position.z + 8) setupGeyser(g, chara.position.z - 40, ctx.random);
      }

      // ため中: パワー＆マーカー
      if (charging) {
        power = Math.min(1, power + dt * 0.82);
        powerBar.style.width = (power * 100) + '%';
        var d = 1.4 + power * 6.6;
        marker.position.set(aimX, 0.06, chara.position.z - d);
      }

      // ジャンプ（放物線）
      if (jumping) {
        jumpT += dt;
        var t = Math.min(jumpT / jumpDur, 1);
        chara.position.x = fromX + (toX - fromX) * t;
        chara.position.z = fromZ + (toZ - fromZ) * t;
        chara.position.y = CHAR_Y + Math.sin(t * Math.PI) * 2.5;
        chara.rotation.z = Math.sin(t * Math.PI) * 0.18;

        if (t >= 1) {
          jumping = false;
          chara.rotation.z = 0;
          // 着地判定（最寄りの岩に吸着＝寛容なランディングアシスト）
          var landed = null, bestDx = 0, bestD = 1e9;
          for (i = 0; i < rocks.length; i++) {
            r = rocks[i];
            if (r.sunk) continue;
            var dx = chara.position.x - r.x0;
            var dz = chara.position.z - r.z;
            var d = dx * dx + dz * dz;
            var tol = r.rad + 0.55;               // 岩の縁＋アシスト分
            if (d <= tol * tol && d < bestD) { bestD = d; landed = r; bestDx = Math.abs(dx); }
          }
          if (landed) {   // 吸着スナップ
            chara.position.x = landed.x0;
            chara.position.z = landed.z;
          }
          // 噴出中の間欠泉に触れたら失敗
          var hitGeyser = false;
          for (var k = 0; k < geysers.length; k++) {
            var gg = geysers[k];
            if (gg.state !== 2) continue;
            var gdx = chara.position.x - gg.x, gdz = chara.position.z - gg.z;
            if (gdx * gdx + gdz * gdz < 0.85 * 0.85) { hitGeyser = true; break; }
          }

          if (landed && !hitGeyser) {
            chara.position.set(landed.x0, CHAR_Y, landed.z);
            var skip = Math.max(1, landed.index - charIndex);   // 遠い岩ほど高得点
            var gain = skip;
            var center = bestDx < landed.rad * 0.3;              // ピタ跳ね
            if (center) { gain += 2; combo++; }
            else if (skip >= 2) { combo++; }
            else combo = 0;
            if (combo >= 2) gain += combo;                      // コンボ加点
            ctx.addScore(gain);
            // 着地点に得点を可視化（ピタ跳ねは金色＋リング波紋）
            showFloat('+' + gain, landed.x0, CHAR_Y + 1.15, landed.z, center ? '#ffd54f' : '#ffffff');
            if (center) showRing(landed.x0, landed.z);
            landed.landed = true; landed.sinkT = 0; landed.sunk = false;
            charIndex = landed.index;
            recycleRocks(ctx.random);
            if (center) { ctx.sfx.success(); ctx.vibrate(30); ctx.setHint(combo >= 2 ? (ctx.t({ en: 'Perfect bounce! x', ja: 'ピタ跳ね！ x', es: '¡Bote perfecto! x', 'pt-BR': 'Salto perfeito! x', fr: 'Rebond parfait! x', de: 'Perfekter Abprall! x', it: 'Rimbalzo perfetto! x', ko: '완벽한 점프! x', 'zh-Hans': '完美弹跳！x', tr: 'Mükemmel zıplama! x' }) + combo) : ctx.t({ en: 'Perfect bounce!', ja: 'ピタ跳ね！', es: '¡Bote perfecto!', 'pt-BR': 'Salto perfeito!', fr: 'Rebond parfait!', de: 'Perfekter Abprall!', it: 'Rimbalzo perfetto!', ko: '완벽한 점프!', 'zh-Hans': '完美弹跳！', tr: 'Mükemmel zıplama!' })); }
            else { ctx.sfx.bounce(); ctx.setHint(''); }
          } else {
            combo = 0;
            sinking = true; sinkT = 0;
            ctx.sfx.fail(); ctx.vibrate(80);
            ctx.setHint(hitGeyser ? ctx.t({ en: 'Hit by a geyser!', ja: '間欠泉に やられた！', es: '¡Golpeado por géiser!', 'pt-BR': 'Atingido pelo gêiser!', fr: 'Touché par un geyser!', de: 'Vom Geysir getroffen!', it: 'Colpito dal geyser!', ko: '간헐천에 당했다!', 'zh-Hans': '被间歇泉击中！', tr: 'Gayzerden vuruldu!' }) : ctx.t({ en: 'Fell into lava!', ja: '溶岩に おちた！', es: '¡Caíste en la lava!', 'pt-BR': 'Caiu na lava!', fr: 'Tombé dans la lave!', de: 'In Lava gefallen!', it: 'Caduto nella lava!', ko: '용암에 빠졌다!', 'zh-Hans': '掉进熔岩！', tr: 'Lavaya düştü!' }));
          }
        }
      } else if (!sinking) {
        // 乗っている岩は沈む → 立ち止まれない
        var cur = rockByIndex(charIndex);
        if (cur && cur.landed && gracePeriod <= 0) {
          cur.sinkT += dt;
          if (cur.sinkT > SINK_DELAY) {
            var sp = Math.min(1, (cur.sinkT - SINK_DELAY) / SINK_DUR);
            cur.mesh.position.y = -0.2 - sp * 1.6;
            chara.position.y = CHAR_Y - sp * 1.6;
            if (sp >= 1) {                                       // 沈み切った → 落下
              cur.sunk = true;
              sinking = true; sinkT = 0;
              ctx.sfx.fail(); ctx.vibrate(80);
              ctx.setHint(ctx.t({ en: 'Sinking!', ja: 'しずんだ！', es: '¡Te hundiste!', 'pt-BR': 'Afundou!', fr: 'Coulé!', de: 'Versunken!', it: 'Affondato!', ko: '가라앉았다!', 'zh-Hans': '沉下去了！', tr: 'Battı!' }));
            }
          }
        }
        if (!sinking) charBunny.flop(time);
      }

      // 落下演出 → ゲームオーバー
      if (sinking) {
        sinkT += dt;
        chara.position.y -= 5 * dt;
        chara.rotation.x += 2.5 * dt;
        if (sinkT > 0.7) { ended = true; ctx.gameOver(ctx.score); }
      }

      // 得点フロート/リング波紋のアニメ（プール走査のみ・生成なし）
      for (i = 0; i < floatPool.length; i++) {
        var fl = floatPool[i];
        if (fl.t >= 0.9) continue;
        fl.t += dt;
        fl.spr.position.y = fl.baseY + fl.t * 1.6;
        fl.spr.material.opacity = Math.max(0, 1 - fl.t / 0.9);
        if (fl.t >= 0.9) fl.spr.visible = false;
      }
      for (i = 0; i < ringPool.length; i++) {
        var rg = ringPool[i];
        if (rg.t >= 1) continue;
        rg.t += dt * 1.8;
        var rk = Math.min(1, rg.t);
        rg.mesh.scale.setScalar(1 + rk * 3.2);
        rg.mesh.material.opacity = (1 - rk) * 0.9;
        if (rg.t >= 1) rg.mesh.visible = false;
      }

      // カメラ追従（キャラの後ろ上）
      _cp.set(chara.position.x, chara.position.y, chara.position.z);
      _camT.set(_cp.x * 0.35, 6.5, _cp.z + 9);
      ctx.camera.position.lerp(_camT, Math.min(dt * 5, 1));
      ctx.camera.lookAt(_cp.x * 0.35, 0.4, _cp.z - 3.5);
    }
  });
})();
