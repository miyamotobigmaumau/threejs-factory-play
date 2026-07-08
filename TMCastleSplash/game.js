/* =========================================================================
 * TMCastleSplash — みずふうせん城せめ
 * ルール: 城壁から かおを出す見張り兵に水ふうせんを当てて びしょぬれに！
 *        まんなかの櫓(やぐら)の兵は 2倍点。60秒タイムアタック。
 * 操作: 下に引っぱる→点線の弾道が出る→離すと その通りに飛ぶ
 * スコア: ぬらした兵の数（櫓は2点）
 * ========================================================================= */
(function () {
  'use strict';

  var GAME_TIME = 60;
  var WALL_W = 8;            // 城壁の幅（fitWidth 10 で縦画面に収まる）
  var WALL_H = 3.2;
  var SLOT_N = 4;            // 壁上の兵スロット
  var THROW_ORIGIN_Y = 1.1, THROW_ORIGIN_Z = 6.2;
  var SPLASH_RADIUS = 1.75;  // しぶきを大きく＝当てた気持ちよさUP
  var DOTS = 11;             // 弾道プレビューの点数

  /* ---- シーン ---- */
  var guards = [];           // {g, x, upY, hidY, tower, state:'hidden'|'up'|'soaked', t, showFor}
  var balloonHand;           // 手元のふうせん
  var balloonFly;            // 飛んでいくふうせん
  var dots = [];             // 弾道プレビュー点
  var landRing;              // 着弾予告リング
  var splashParts = [];      // しぶき粒
  var wetMarks = [];         // 壁の濡れあと {mesh, t}
  var wallTopY;

  /* ---- 状態 ---- */
  var aiming, aimPull, aimX; // 引き量(0-1)と横ずれ(-1..1)
  var lives;                 // 城のHP（見逃した兵の反撃で減る）
  var flying, flyT, flyDur, fromV, targetV, apexH;
  var splashT = -1;
  var gameEnded;
  var _v1;

  /* ---- 城HP表示（DOMハート）＋反撃演出 ---- */
  var heartsWrap = null, heartEls = [];
  var flashEl = null;        // 画面端の赤フラッシュ
  var arrows = [];           // 反撃の矢プール {mesh, t, from, to}

  function makeDom() {
    if (heartsWrap) return;
    heartsWrap = document.createElement('div');
    heartsWrap.style.cssText = 'position:fixed;top:64px;right:14px;z-index:20;pointer-events:none;' +
      'display:none;font-size:26px;line-height:1;text-shadow:0 2px 4px rgba(0,0,0,0.35);';
    for (var i = 0; i < 3; i++) {
      var h = document.createElement('span');
      h.textContent = '❤';
      h.style.cssText = 'display:inline-block;margin-left:4px;transition:transform 0.25s,filter 0.25s,opacity 0.25s;';
      heartsWrap.appendChild(h);
      heartEls.push(h);
    }
    document.body.appendChild(heartsWrap);
    flashEl = document.createElement('div');
    flashEl.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:19;pointer-events:none;opacity:0;' +
      'box-shadow:inset 0 0 70px 24px rgba(255,40,40,0.85);';
    document.body.appendChild(flashEl);
  }

  function updateHearts(popIdx) {
    for (var i = 0; i < heartEls.length; i++) {
      var el = heartEls[i];
      if (i < lives) {
        el.style.filter = 'none';
        el.style.opacity = '1';
      } else {
        el.style.filter = 'grayscale(1) brightness(0.6)';
        el.style.opacity = '0.55';
      }
      if (i === popIdx) {
        el.style.transform = 'scale(1.6)';
        (function (e) { setTimeout(function () { e.style.transform = 'scale(1)'; }, 180); })(el);
      }
    }
  }

  function redFlash() {
    if (!flashEl) return;
    flashEl.style.transition = 'none';
    flashEl.style.opacity = '1';
    void flashEl.offsetWidth;   // 強制リフロー→フェード開始
    flashEl.style.transition = 'opacity 0.45s';
    flashEl.style.opacity = '0';
  }

  /* 兵の位置からカメラ方向へ矢を放つ（因果の可視化） */
  function launchArrow(gd) {
    for (var i = 0; i < arrows.length; i++) {
      if (arrows[i].t >= 0) continue;
      var a = arrows[i];
      a.t = 0;
      a.from.set(gd.x, gd.g.position.y + 0.3, 0);
      a.to.set(gd.x * 0.25, THROW_ORIGIN_Y + 1.4, THROW_ORIGIN_Z + 1.5);
      a.mesh.visible = true;
      a.mesh.position.copy(a.from);
      return;
    }
  }

  /* 兵士: 判別できるちび見張り兵（体・顔・兜・目） */
  function makeGuard(THREE, tower) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(Style.roundedBox(0.5, 0.55, 0.34), Style.mat(tower ? 0x8a4fb0 : 0x3f6fd8));
    body.position.y = -0.42;
    g.add(body);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), Style.mat(0xffd9b0));
    head.position.y = 0;
    g.add(head);
    var helm = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      Style.mat(tower ? 0xd8b64a : 0x9aa4b2));
    helm.position.y = 0.06;
    g.add(helm);
    var tuft = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 6), Style.mat(0xe05050));
    tuft.position.y = 0.36;
    g.add(tuft);
    var eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    var eyeGeo = new THREE.SphereGeometry(0.045, 6, 6);
    var eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(-0.09, 0.02, 0.23);
    var eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(0.09, 0.02, 0.23);
    g.add(eL, eR);
    g.userData.body = body; g.userData.head = head; g.userData.helm = helm;
    return g;
  }

  function makeBalloon(THREE, color) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12),
      new THREE.MeshPhongMaterial({ color: color, shininess: 70, specular: 0xbbddff, transparent: true, opacity: 0.95 }));
    m.scale.set(1, 1.15, 1); // ぷにっと縦長
    return m;
  }

  /* 弾道: from→target の直線 + sin 山なり。プレビューと実弾で共通(=予告どおりに飛ぶ) */
  function arcPos(out, t) {
    out.x = fromV.x + (targetV.x - fromV.x) * t;
    out.y = fromV.y + (targetV.y - fromV.y) * t + Math.sin(t * Math.PI) * apexH;
    out.z = fromV.z + (targetV.z - fromV.z) * t;
    return out;
  }

  /* 引き量から狙い点を決める（壁面 z=0 上: 引くほど高く=櫓に届く） */
  function computeTarget() {
    targetV.x = aimX * (WALL_W / 2 - 0.4);
    targetV.y = 1.2 + aimPull * 3.6;   // 壁の下部〜櫓の頭上
    targetV.z = 0;
    apexH = 1.6 + aimPull * 1.4;
  }

  function showTrajectory(show) {
    for (var i = 0; i < dots.length; i++) dots[i].visible = show;
    landRing.visible = show;
    if (!show) return;
    computeTarget();
    for (var d = 0; d < DOTS; d++) {
      var t = (d + 1) / (DOTS + 1);
      arcPos(_v1, t);
      dots[d].position.copy(_v1);
      var s = 1 - t * 0.35;
      dots[d].scale.set(s, s, s);
    }
    landRing.position.set(targetV.x, targetV.y, 0.15);
  }

  function spawnSplash(x, y, ctx) {
    splashT = 0;
    for (var i = 0; i < splashParts.length; i++) {
      var p = splashParts[i];
      p.visible = true;
      p.material.opacity = 0.9;
      p.position.set(x, y, 0.1);
      var a = (i / splashParts.length) * Math.PI * 2;
      p.userData.vx = Math.cos(a) * (1.5 + Math.random());
      p.userData.vy = 1.5 + Math.random() * 2;
      p.userData.vz = 0.5 + Math.random() * 0.5;
    }
    // 壁の濡れあと（最も古いものを転用）
    var w = wetMarks[0];
    for (var k = 1; k < wetMarks.length; k++) if (wetMarks[k].t > w.t) w = wetMarks[k];
    w.t = 0;
    w.mesh.visible = true;
    w.mesh.position.set(x, Math.min(y, wallTopY - 0.3), 0.08);
    w.mesh.material.opacity = 0.55;
    ctx.sfx.bounce();
    ctx.vibrate(20);
  }

  Shell.registerGame({
    id: 'TMCastleSplash',
    title: { en: 'Castle Splash!', ja: 'みずふうせん城せめ', es: '¡Asalto al Castillo!', 'pt-BR': 'Ataque ao Castelo!', fr: 'Assaut du Château!', de: 'Burgbelagerung!', it: 'Assalto al Castello!', ko: '성 물폭탄', 'zh-Hans': '水球攻城', tr: 'Kale Saldırısı!' },
    howto: { en: 'Drag down to charge → release to throw!\nHit guards peaking over the wall!\nMiss too many and the castle falls!', ja: '下にひっぱってチャージ→離して投げる！\nかおを出した兵に当ててびしょぬれに！\n当てそこねると反撃される（城のHPに注意）', es: '¡Arrastra abajo para cargar → suelta para lanzar!\n¡Golpea a los guardias que asoman!\n¡Si fallas, el castillo caerá!', 'pt-BR': 'Arraste para baixo para carregar → solte para arremessar!\nAtinja os guardas que aparecem!\nErre demais e o castelo cai!', fr: 'Tirez vers le bas pour charger → relâchez pour lancer!\nTouchez les gardes qui apparaissent!\nRatez trop et le château tombera!', de: 'Nach unten ziehen zum Aufladen → loslassen zum Werfen!\nTriff die Wachen die auftauchen!\nVerfehle zu viele und die Burg fällt!', it: 'Trascina in basso per caricare → rilascia per lanciare!\nColpisci le guardie che si affacciano!\nManca troppo e il castello cadrà!', ko: '아래로 드래그하여 충전 → 놓아서 던지기!\n성벽 위로 얼굴을 내민 병사를 맞춰라!\n너무 많이 빗나가면 성이 함락된다!', 'zh-Hans': '向下拖动蓄力→松开投掷！\n击中探出头来的卫兵！\n失误太多城堡就会陷落！', tr: 'Aşağı sürükle şarj et → bırak fırlat!\nMazgaldan çıkan muhafızları vur!\nÇok kaçırırsan kale düşer!' },
    scoreLabel: { en: 'hits', ja: 'たい', es: 'imp.', 'pt-BR': 'acertos', fr: 'touches', de: 'Treffer', it: 'colpi', ko: '적중', 'zh-Hans': '命中', tr: 'isabet' },
    bg: 0xbfe3f2,
    fogNear: 30, fogFar: 70,
    cameraFov: 52,
    cameraPos: [0, 4.6, 10.4],
    cameraLookAt: [0, 2.4, 0],
    fitWidth: 10,              // 縦画面でも城壁全体が必ず収まる

    init: function (ctx) {
      var THREE = ctx.THREE;
      _v1 = new THREE.Vector3();
      fromV = new THREE.Vector3(); targetV = new THREE.Vector3();

      // 地面（芝生と手前の土の道）
      var ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), Style.mat(0x9fd08a));
      ground.rotation.x = -Math.PI / 2;
      ctx.scene.add(ground);
      var path = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 12), Style.mat(0xd9c49a));
      path.rotation.x = -Math.PI / 2;
      path.position.set(0, 0.01, 4);
      ctx.scene.add(path);

      // 城壁（白しっくい＋石の土台＋狭間ブロック）
      wallTopY = WALL_H;
      var wall = new THREE.Mesh(Style.roundedBox(WALL_W, WALL_H, 1.2), Style.mat(0xf2ede2));
      wall.position.set(0, WALL_H / 2, -0.6);
      ctx.scene.add(wall);
      var base = new THREE.Mesh(Style.roundedBox(WALL_W + 0.5, 0.7, 1.5), Style.mat(0x8d9aa8));
      base.position.set(0, 0.35, -0.6);
      ctx.scene.add(base);
      for (var b = 0; b < 5; b++) {
        var crenel = new THREE.Mesh(Style.roundedBox(0.7, 0.5, 0.9), Style.mat(0xe8e2d4));
        crenel.position.set(-WALL_W / 2 + 0.55 + b * (WALL_W - 1.1) / 4, WALL_H + 0.25, -0.6);
        ctx.scene.add(crenel);
      }
      // 中央の櫓（2倍点の的。屋根と金の的マークで目立たせる）
      var towerBody = new THREE.Mesh(Style.roundedBox(1.6, 2.2, 1.4), Style.mat(0xefe8da));
      towerBody.position.set(0, WALL_H + 1.1, -0.8);
      ctx.scene.add(towerBody);
      var towerRoof = new THREE.Mesh(new THREE.ConeGeometry(1.45, 1.0, 4), Style.mat(0x4a5f7a));
      towerRoof.rotation.y = Math.PI / 4;
      towerRoof.position.set(0, WALL_H + 2.75, -0.8);
      ctx.scene.add(towerRoof);
      var x2mark = new THREE.Mesh(
        new THREE.CircleGeometry(0.34, 18),
        new THREE.MeshBasicMaterial({ color: 0xffd21c }));
      x2mark.position.set(0, WALL_H + 1.35, -0.09);
      ctx.scene.add(x2mark);
      // 旗
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), Style.mat(0xeeeeee));
      pole.position.set(0, WALL_H + 3.8, -0.8);
      ctx.scene.add(pole);
      var flagGeo = new THREE.BufferGeometry();
      flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.7, -0.15, 0, 0, -0.3, 0], 3));
      flagGeo.computeVertexNormals();
      var flag = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ color: 0xe05050, side: THREE.DoubleSide }));
      flag.position.set(0.04, WALL_H + 4.3, -0.8);
      ctx.scene.add(flag);

      // 兵士: 壁上4スロット + 櫓1（2倍）
      for (var i = 0; i < SLOT_N; i++) {
        var gx = -WALL_W / 2 + 1.15 + i * (WALL_W - 2.3) / (SLOT_N - 1);
        var gm = makeGuard(THREE, false);
        gm.position.set(gx, WALL_H - 0.9, -0.45);
        ctx.scene.add(gm);
        guards.push({ g: gm, x: gx, upY: WALL_H + 0.55, hidY: WALL_H - 0.9, tower: false,
                      state: 'hidden', t: 1 + Math.random() * 2, showFor: 0 });
      }
      var tg = makeGuard(THREE, true);
      tg.position.set(0, WALL_H + 0.6, -0.7);
      ctx.scene.add(tg);
      guards.push({ g: tg, x: 0, upY: WALL_H + 2.2, hidY: WALL_H + 0.6, tower: true,
                    state: 'hidden', t: 2.5 + Math.random() * 2, showFor: 0 });

      // 手元のふうせん＋水風船が入ったカゴ（編み目の縁＋予備風船が覗く）
      var basketG = new THREE.Group();
      var basketBody = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.38, 0.36, 12), Style.mat(0xb08050));
      basketBody.position.y = 0.18;
      basketG.add(basketBody);
      var basketRim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 16), Style.mat(0x8a5f38));
      basketRim.rotation.x = Math.PI / 2;
      basketRim.position.y = 0.37;
      basketG.add(basketRim);
      // 編み目（横帯2本）
      var band1 = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.03, 6, 16), Style.mat(0x8a5f38));
      band1.rotation.x = Math.PI / 2; band1.position.y = 0.24;
      basketG.add(band1);
      var band2 = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 6, 16), Style.mat(0x8a5f38));
      band2.rotation.x = Math.PI / 2; band2.position.y = 0.12;
      basketG.add(band2);
      // 予備の水風船（赤・黄が覗く）
      var spare1 = makeBalloon(THREE, 0xf56262);
      spare1.scale.multiplyScalar(0.62); spare1.position.set(-0.14, 0.42, 0.05);
      basketG.add(spare1);
      var spare2 = makeBalloon(THREE, 0xf5d062);
      spare2.scale.multiplyScalar(0.55); spare2.position.set(0.16, 0.40, -0.08);
      basketG.add(spare2);
      basketG.position.set(0.95, 0, THROW_ORIGIN_Z);
      ctx.scene.add(basketG);
      balloonHand = makeBalloon(THREE, 0x62c4f5);
      balloonHand.position.set(0, THROW_ORIGIN_Y, THROW_ORIGIN_Z);
      ctx.scene.add(balloonHand);
      balloonFly = makeBalloon(THREE, 0x62c4f5);
      balloonFly.visible = false;
      ctx.scene.add(balloonFly);

      // 弾道プレビュー（点線）＋着弾リング
      var dotGeo = new THREE.SphereGeometry(0.11, 6, 6);
      var dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
      for (var d = 0; d < DOTS; d++) {
        var dm = new THREE.Mesh(dotGeo, dotMat);
        dm.visible = false;
        ctx.scene.add(dm);
        dots.push(dm);
      }
      landRing = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 22),
        new THREE.MeshBasicMaterial({ color: 0x28c8ff, transparent: true, opacity: 0.95, depthWrite: false }));
      landRing.visible = false;
      ctx.scene.add(landRing);

      // しぶき＋濡れあと
      var spGeo = new THREE.SphereGeometry(0.09, 6, 5);
      for (var s = 0; s < 10; s++) {
        var sp = new THREE.Mesh(spGeo,
          new THREE.MeshBasicMaterial({ color: 0x9fdcf5, transparent: true, opacity: 0.9 }));
        sp.visible = false;
        ctx.scene.add(sp);
        splashParts.push(sp);
      }
      for (var w = 0; w < 4; w++) {
        var wm = new THREE.Mesh(new THREE.CircleGeometry(0.7, 16),
          new THREE.MeshBasicMaterial({ color: 0x74b8dc, transparent: true, opacity: 0, depthWrite: false }));
        wm.visible = false;
        ctx.scene.add(wm);
        wetMarks.push({ mesh: wm, t: 99 });
      }

      // 反撃の矢（プール・カメラ方向へ飛んで拡大する）
      for (var a = 0; a < 3; a++) {
        var am = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.55, 6),
          new THREE.MeshBasicMaterial({ color: 0x5a4630 }));
        am.visible = false;
        ctx.scene.add(am);
        arrows.push({ mesh: am, t: -1, from: new THREE.Vector3(), to: new THREE.Vector3() });
      }
      makeDom();
    },

    start: function (ctx) {
      gameEnded = false; aiming = false; flying = false;
      aimPull = 0; aimX = 0; splashT = -1; lives = 3;
      balloonHand.visible = true;
      balloonFly.visible = false;
      showTrajectory(false);
      for (var i = 0; i < guards.length; i++) {
        var gd = guards[i];
        gd.state = 'hidden'; gd.t = 0.6 + Math.random() * 2;
        gd.g.position.y = gd.hidY;
        gd.g.rotation.z = 0;
        gd.g.userData.body.material.color.setHex(gd.tower ? 0x8a4fb0 : 0x3f6fd8);
        gd.g.userData.head.material.color.setHex(0xffd9b0);
      }
      for (var s = 0; s < splashParts.length; s++) splashParts[s].visible = false;
      for (var w = 0; w < wetMarks.length; w++) { wetMarks[w].t = 99; wetMarks[w].mesh.visible = false; }
      for (var a = 0; a < arrows.length; a++) { arrows[a].t = -1; arrows[a].mesh.visible = false; }
      if (heartsWrap) heartsWrap.style.display = 'block';
      updateHearts(-1);
      if (flashEl) { flashEl.style.transition = 'none'; flashEl.style.opacity = '0'; }
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Drag down to aim!', ja: '下にひっぱって ねらえ！', es: '¡Arrastra abajo para apuntar!', 'pt-BR': 'Arraste para baixo para mirar!', fr: 'Tirez vers le bas pour viser!', de: 'Nach unten ziehen zum Zielen!', it: 'Trascina in basso per mirare!', ko: '아래로 드래그하여 조준하라!', 'zh-Hans': '向下拖动瞄准！', tr: 'Nişan almak için aşağı sürükle!' }));
    },

    onPointerDown: function (ctx, p) {
      if (gameEnded || flying) return;
      aiming = true;
      aimPull = 0; aimX = 0;
      fromV.set(0, THROW_ORIGIN_Y, THROW_ORIGIN_Z);
    },

    onPointerMove: function (ctx, p) {
      if (!aiming) return;
      // 下に引くほど強く（高く）、左右で狙いをずらす
      aimPull = Math.max(0, Math.min(1, aimPull - p.dy * -0.004));
      aimX = Math.max(-1, Math.min(1, aimX + p.dx * 0.004));
      showTrajectory(aimPull > 0.06);
      balloonHand.position.z = THROW_ORIGIN_Z + aimPull * 0.7;
      balloonHand.scale.set(1 + aimPull * 0.15, 1.15 - aimPull * 0.2, 1 + aimPull * 0.15);
    },

    onPointerUp: function (ctx, p) {
      if (!aiming) return;
      aiming = false;
      showTrajectory(false);
      balloonHand.position.set(0, THROW_ORIGIN_Y, THROW_ORIGIN_Z);
      balloonHand.scale.set(1, 1.15, 1);
      if (aimPull <= 0.06 || gameEnded) return;
      computeTarget();
      flying = true;
      flyT = 0;
      flyDur = 0.42 + (1 - aimPull) * 0.22;   // 強チャージほど速く飛ぶ＝爽快
      balloonHand.visible = false;
      balloonFly.visible = true;
      arcPos(balloonFly.position, 0);
      ctx.sfx.tap();
    },

    update: function (ctx, dt) {
      if (gameEnded) return;
      var i, gd;
      var remain = GAME_TIME - ctx.elapsed;
      if (remain <= 0) {
        gameEnded = true;
        showTrajectory(false);
        if (heartsWrap) heartsWrap.style.display = 'none';
        ctx.endGame(ctx.score);
        return;
      }
      if (remain < 10) ctx.setHint(ctx.t({ en: 'Left: ', ja: 'のこり ', es: 'Quedan: ', 'pt-BR': 'Restam: ', fr: 'Reste: ', de: 'Noch: ', it: 'Rimane: ', ko: '남은 ', 'zh-Hans': '剩余 ', tr: 'Kalan: ' }) + Math.ceil(remain) + ctx.t({ en: 's!', ja: ' びょう！', es: 's!', 'pt-BR': 's!', fr: 's!', de: 's!', it: 's!', ko: '초!', 'zh-Hans': '秒！', tr: 's!' }));

      // 兵の出入り
      for (i = 0; i < guards.length; i++) {
        gd = guards[i];
        if (gd.state === 'hidden') {
          gd.t -= dt;
          gd.g.position.y += (gd.hidY - gd.g.position.y) * Math.min(1, dt * 8);
          if (gd.t <= 0) {
            gd.state = 'up';
            gd.showFor = 1.6 + Math.random() * 1.6;
            gd.g.userData.body.material.color.setHex(gd.tower ? 0x8a4fb0 : 0x3f6fd8); // 色を戻す
            ctx.sfx.tap();
          }
        } else if (gd.state === 'up') {
          gd.g.position.y += (gd.upY - gd.g.position.y) * Math.min(1, dt * 10);
          gd.g.rotation.y = Math.sin(ctx.elapsed * 2 + i) * 0.2; // キョロキョロ
          gd.showFor -= dt;
          if (gd.showFor <= 0) {
            // レベル(経過時間)が上がると、当てられず引っ込む兵が反撃してくる
            var lvl = Math.floor(ctx.elapsed / 15);   // 0,1,2,...
            if (lvl >= 1 && Math.random() < Math.min(0.75, 0.3 + lvl * 0.15)) {
              lives--;
              gd.g.userData.body.material.color.setHex(0xff5252);
              launchArrow(gd);          // 兵が矢を投げる→着弾で赤フラッシュ（因果の可視化）
              updateHearts(lives);      // 失ったハートをグレー化＋一瞬拡大
              ctx.sfx.fail();
              ctx.vibrate(60);
              ctx.setHint(ctx.t({ en: '⚔ Counter attack! HP ', ja: '⚔ 反撃をうけた！ HP ', es: '⚔ ¡Contraataque! HP ', 'pt-BR': '⚔ Contra-ataque! HP ', fr: '⚔ Contre-attaque! PV ', de: '⚔ Gegenangriff! HP ', it: '⚔ Contrattacco! PV ', ko: '⚔ 반격을 받았다! HP ', 'zh-Hans': '⚔ 遭到反击！HP ', tr: '⚔ Karşı saldırı! HP ' }) + '❤'.repeat(Math.max(0, lives)));
              if (lives <= 0) {
                gameEnded = true;
                showTrajectory(false);
                redFlash();             // 最後の一撃は即フラッシュ
                if (heartsWrap) heartsWrap.style.display = 'none';
                ctx.gameOver(ctx.score, ctx.t({ en: 'The castle has fallen...', ja: '城がおとされた…', es: 'El castillo ha caído...', 'pt-BR': 'O castelo caiu...', fr: 'Le château est tombé...', de: 'Die Burg ist gefallen...', it: 'Il castello è caduto...', ko: '성이 함락되었다…', 'zh-Hans': '城堡沦陷了…', tr: 'Kale düştü...' }));
                return;
              }
            }
            gd.state = 'hidden';
            gd.t = 0.8 + Math.random() * 2.4;
          }
        } else if (gd.state === 'soaked') {
          gd.g.position.y += (gd.hidY - 0.4 - gd.g.position.y) * Math.min(1, dt * 5);
          gd.g.rotation.z += dt * 2.4; // くたっと沈む
          gd.t -= dt;
          if (gd.t <= 0) {
            gd.state = 'hidden';
            gd.t = 1.2 + Math.random() * 2;
            gd.g.rotation.z = 0;
            gd.g.userData.body.material.color.setHex(gd.tower ? 0x8a4fb0 : 0x3f6fd8);
            gd.g.userData.head.material.color.setHex(0xffd9b0);
          }
        }
      }

      // 手元ふうせんのぷにぷに待機
      if (!flying && !aiming) {
        var wob = 1 + Math.sin(ctx.elapsed * 3) * 0.04;
        balloonHand.scale.set(wob, 1.15 * (2 - wob), wob);
      }

      // 飛行 → 着弾
      if (flying) {
        flyT += dt;
        var t = Math.min(flyT / flyDur, 1);
        arcPos(balloonFly.position, t);
        balloonFly.rotation.z += dt * 6;
        if (t >= 1) {
          flying = false;
          balloonFly.visible = false;
          balloonHand.visible = true;
          spawnSplash(targetV.x, targetV.y, ctx);
          var hits = 0, pts = 0;
          for (i = 0; i < guards.length; i++) {
            gd = guards[i];
            if (gd.state !== 'up') continue;
            var dx = gd.x - targetV.x;
            var dy = gd.g.position.y - targetV.y;
            if (dx * dx + dy * dy < SPLASH_RADIUS * SPLASH_RADIUS) {
              gd.state = 'soaked';
              gd.t = 1.4;
              gd.g.userData.body.material.color.setHex(0x2a5f8a); // ずぶぬれ色
              gd.g.userData.head.material.color.setHex(0x9fc4e0);
              hits++;
              pts += gd.tower ? 2 : 1;
            }
          }
          if (hits > 0) {
            ctx.addScore(pts);
            ctx.sfx.success();
            ctx.vibrate(30);
            ctx.setHint(ctx.t({ en: 'Soaked! +', ja: 'びしょぬれ！ +', es: '¡Empapado! +', 'pt-BR': 'Encharcado! +', fr: 'Trempé! +', de: 'Durchnässt! +', it: 'Inzuppato! +', ko: '흠뻑! +', 'zh-Hans': '湿透了！+', tr: 'Islandı! +' }) + pts + (pts > hits ? ctx.t({ en: ' (tower ×2!)', ja: '（やぐら2ばい！）', es: ' (¡Torre ×2!)', 'pt-BR': ' (Torre ×2!)', fr: ' (Tour ×2!)', de: ' (Turm ×2!)', it: ' (Torre ×2!)', ko: ' (망루 2배!)', 'zh-Hans': '（了望塔×2！）', tr: ' (Kule ×2!)' }) : ''));
          } else {
            ctx.setHint(ctx.t({ en: 'Missed! Throw when guards appear!', ja: 'はずれ… へいしが出たら なげろ！', es: '¡Fallado! ¡Lanza cuando salgan los guardias!', 'pt-BR': 'Errou! Arremesse quando os guardas aparecerem!', fr: 'Raté! Lancez quand les gardes apparaissent!', de: 'Verfehlt! Wirf wenn Wachen erscheinen!', it: 'Mancato! Lancia quando le guardie appaiono!', ko: '빗나갔다! 병사가 나오면 던져라!', 'zh-Hans': '失误！卫兵出现时投掷！', tr: 'Iskaladı! Muhafızlar çıkınca fırlat!' }));
          }
        }
      }

      // しぶき
      if (splashT >= 0) {
        splashT += dt;
        for (i = 0; i < splashParts.length; i++) {
          var sp = splashParts[i];
          if (!sp.visible) continue;
          sp.userData.vy -= 7 * dt;
          sp.position.x += sp.userData.vx * dt;
          sp.position.y += sp.userData.vy * dt;
          sp.position.z += sp.userData.vz * dt;
          sp.material.opacity = Math.max(0, 0.9 - splashT * 1.6);
        }
        if (splashT > 0.7) {
          splashT = -1;
          for (i = 0; i < splashParts.length; i++) splashParts[i].visible = false;
        }
      }
      // 濡れあとフェード
      for (i = 0; i < wetMarks.length; i++) {
        var wmk = wetMarks[i];
        if (wmk.t >= 99) continue;
        wmk.t += dt;
        wmk.mesh.material.opacity = Math.max(0, 0.55 * (1 - wmk.t / 2.2));
        if (wmk.t > 2.2) { wmk.t = 99; wmk.mesh.visible = false; }
      }

      // 反撃の矢: 兵→カメラ方向へ飛来し拡大、着弾で画面端が赤フラッシュ
      for (i = 0; i < arrows.length; i++) {
        var ar = arrows[i];
        if (ar.t < 0) continue;
        ar.t += dt / 0.5;
        if (ar.t >= 1) {
          ar.t = -1;
          ar.mesh.visible = false;
          redFlash();
          ctx.vibrate(30);
          continue;
        }
        ar.mesh.position.lerpVectors(ar.from, ar.to, ar.t);
        ar.mesh.position.y += Math.sin(ar.t * Math.PI) * 1.2;   // 山なり
        var asc = 1 + ar.t * 1.5;                               // 近づくほど大きく
        ar.mesh.scale.set(asc, asc, asc);
        ar.mesh.lookAt(ar.to);
        ar.mesh.rotateX(Math.PI / 2);   // Coneの先端(+Y)を進行方向(+Z)へ
      }

      // 着弾リングのパルス
      if (landRing.visible) {
        var pk = 1 + Math.sin(ctx.elapsed * 7) * 0.12;
        landRing.scale.set(pk, pk, 1);
      }
    }
  });
})();
