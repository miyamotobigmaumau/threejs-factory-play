/* =========================================================================
 * TFWhackMole — モグラたたき
 * ルール: 3×3 の穴から出てくるモグラをタップでたたく。
 *         ハリネズミをたたくと -5点＋1秒しびれ。45秒タイムアタック。
 * 操作: タップ
 * スコア: たたいた数 - ペナルティ (ひき)
 * ========================================================================= */
(function () {
  'use strict';

  var GAME_TIME = 45;      // 制限時間(秒)
  var GRID = 3;            // 3×3
  var SPACING_X = 2.1, SPACING_Z = 2.3;

  // 穴の状態
  var ST_HIDDEN = 0, ST_RISING = 1, ST_UP = 2, ST_HIDING = 3, ST_HIT = 4;

  var holes = [];          // { pivot, mole, hedge, body状態… }
  var hitMeshes = [];      // レイキャスト対象(各穴の当たり判定球)
  var raycaster, tapVec;   // init で1個だけ作って使い回す
  var hammer, hammerT;     // ハンマー演出
  var particles = [], redFlash;
  var spawnTimer, hits, penalty, stunLeft, ended;

  /* モグラ本体(頭を丸めた円柱+目+鼻)を作る */
  function makeMole(THREE) {
    var g = new THREE.Group();
    var mat = Style.mat(0x8d6446);
    var cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.72, 18), mat);
    cyl.position.y = 0.36;
    var dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.52, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      mat
    );
    dome.position.y = 0.72;
    g.add(cyl, dome);
    var whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    var eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    var eyeWhiteGeo = new THREE.SphereGeometry(0.11, 8, 6);
    var eyeBlackGeo = new THREE.SphereGeometry(0.055, 6, 6);
    var wL = new THREE.Mesh(eyeWhiteGeo, whiteMat);
    wL.position.set(-0.18, 0.96, 0.42);
    var wR = new THREE.Mesh(eyeWhiteGeo, whiteMat);
    wR.position.set(0.18, 0.96, 0.42);
    var eL = new THREE.Mesh(eyeBlackGeo, eyeMat);
    eL.position.set(-0.18, 0.96, 0.5);
    var eR = new THREE.Mesh(eyeBlackGeo, eyeMat);
    eR.position.set(0.18, 0.96, 0.5);
    var nose = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xf08080 })
    );
    nose.scale.set(1.35, 0.85, 0.9);
    nose.position.set(0, 0.78, 0.53);
    g.add(wL, wR, eL, eR, nose);
    return g;
  }

  /* ハリネズミ(同じ丸頭円柱+トゲのコーン) */
  function makeHedge(THREE) {
    var g = new THREE.Group();
    var mat = Style.mat(0x9a9a8e);
    var cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.7, 18), mat);
    cyl.position.y = 0.35;
    var dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      mat
    );
    dome.position.y = 0.7;
    g.add(cyl, dome);
    var spikeMat = Style.mat(0x55524a);
    var spikeGeo = new THREE.ConeGeometry(0.1, 0.42, 6);
    for (var i = 0; i < 12; i++) {
      var a = (i / 12) * Math.PI * 2;
      var s = new THREE.Mesh(spikeGeo, spikeMat);
      s.position.set(Math.cos(a) * 0.38, 0.78 + Math.sin(i * 2.3) * 0.16, Math.sin(a) * 0.38);
      s.lookAt(s.position.x * 3, 2.6, s.position.z * 3);
      s.rotateX(Math.PI / 2);
      g.add(s);
    }
    var whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    var eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    var eyeWhiteGeo = new THREE.SphereGeometry(0.095, 8, 6);
    var eyeBlackGeo = new THREE.SphereGeometry(0.048, 6, 6);
    var wL = new THREE.Mesh(eyeWhiteGeo, whiteMat);
    wL.position.set(-0.16, 0.9, 0.42);
    var wR = new THREE.Mesh(eyeWhiteGeo, whiteMat);
    wR.position.set(0.16, 0.9, 0.42);
    var eL = new THREE.Mesh(eyeBlackGeo, eyeMat);
    eL.position.set(-0.16, 0.9, 0.5);
    var eR = new THREE.Mesh(eyeBlackGeo, eyeMat);
    eR.position.set(0.16, 0.9, 0.5);
    var nose = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xf4a0aa }));
    nose.scale.set(1.35, 0.85, 0.9);
    nose.position.set(0, 0.73, 0.52);
    g.add(wL, wR, eL, eR, nose);
    return g;
  }

  /* 出現保持時間・出現間隔(時間経過で短く) */
  function upDuration(elapsed) { return Math.max(0.55, 1.15 - elapsed * 0.012); }
  function spawnInterval(elapsed) { return Math.max(0.38, 1.0 - elapsed * 0.013); }

  function hideAll() {
    for (var i = 0; i < holes.length; i++) {
      var h = holes[i];
      h.state = ST_HIDDEN;
      h.t = 0;
      h.pivot.position.y = -2.0;
      h.mole.visible = false;
      h.hedge.visible = false;
    }
  }

  function spawnOne(random) {
    // 隠れている穴からランダムに選ぶ
    var idle = [];
    for (var i = 0; i < holes.length; i++) if (holes[i].state === ST_HIDDEN) idle.push(holes[i]);
    if (idle.length === 0) return;
    var h = idle[Math.floor(random() * idle.length)];
    h.isHedge = random() < 0.22;
    h.mole.visible = !h.isHedge;
    h.hedge.visible = h.isHedge;
    h.state = ST_RISING;
    h.t = 0;
    h.pivot.scale.set(1, 1, 1);
  }

  Shell.registerGame({
    id: 'TFWhackMole',
    title: { en: 'Whack-a-Mole', ja: 'モグラたたき', es: 'Golpea al Topo', 'pt-BR': 'Bate-Toupeira', fr: 'Tape-Taupe', de: 'Maulwurf Hauen', it: 'Acchiappa la Talpa', ko: '두더지 잡기', 'zh-Hans': '打地鼠', tr: 'Köstebek Vur' },
    howto: { en: 'Tap the moles that pop up!\nDon\'t hit the hedgehog (-5 pts)!', ja: 'でてきたモグラをタップでたたこう！\nハリネズミはたたいちゃダメ(-5てん)', es: '¡Golpea los topos que salen!\n¡No golpees al erizo (-5 pts)!', 'pt-BR': 'Bata nas toupeiras que aparecem!\nNão bata no ouriço (-5 pts)!', fr: 'Tapez les taupes qui sortent!\nNe frappez pas le hérisson (-5 pts)!', de: 'Maulwürfe antippen die auftauchen!\nIgel nicht schlagen (-5 Pkt)!', it: 'Tocca le talpe che compaiono!\nNon colpire il riccio (-5 pts)!', ko: '나온 두더지를 탭해서 잡아라!\n고슴도치는 치면 안 돼 (-5점)!', 'zh-Hans': '点击冒出来的地鼠！\n别打刺猬 (-5分)！', tr: 'Çıkan köstebeklere dokun!\nKirpiye vurma (-5 puan)!' },
    scoreLabel: { en: 'hit', ja: 'ひき', es: 'golpe', 'pt-BR': 'acerto', fr: 'touche', de: 'Treffer', it: 'colpo', ko: '개', 'zh-Hans': '个', tr: 'isabet' },
    bg: 0x9adcf0,
    cameraFov: 55,
    cameraPos: [0, 8.6, 6.4],
    cameraLookAt: [0, 0, -0.4],

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 芝生の庭
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        Style.mat(0x7ec850)
      );
      ground.rotation.x = -Math.PI / 2;
      ctx.scene.add(ground);

      // まわりの木(幹+葉)を数本
      var trunkGeo = new THREE.CylinderGeometry(0.18, 0.24, 1.4, 8);
      var trunkMat = Style.mat(0x8a5a2b);
      var leafGeo = new THREE.SphereGeometry(0.9, 10, 8);
      var leafMat = Style.mat(0x4caf50);
      for (var t = 0; t < 6; t++) {
        var a = (t / 6) * Math.PI * 2 + 0.4;
        var trunk = new THREE.Mesh(trunkGeo, trunkMat);
        var leaf = new THREE.Mesh(leafGeo, leafMat);
        trunk.position.set(Math.cos(a) * 7.5, 0.7, Math.sin(a) * 7.5 - 2);
        leaf.position.set(trunk.position.x, 1.9, trunk.position.z);
        ctx.scene.add(trunk, leaf);
      }

      // 花壇（彩りの小花を散らす）
      var flowerCols = [0xe84545, 0xf0c020, 0xe86ab0, 0x9a6ae0];
      for (var fl = 0; fl < 14; fl++) {
        var fa = Math.random() * Math.PI * 2, frd = 4.5 + Math.random() * 3;
        var petal = new THREE.Mesh(new THREE.CircleGeometry(0.22, 6),
          new THREE.MeshBasicMaterial({ color: flowerCols[fl % flowerCols.length], side: THREE.DoubleSide }));
        petal.rotation.x = -Math.PI / 2;
        petal.position.set(Math.cos(fa) * frd, 0.03, Math.sin(fa) * frd - 2);
        ctx.scene.add(petal);
        var center = new THREE.Mesh(new THREE.CircleGeometry(0.08, 6),
          new THREE.MeshBasicMaterial({ color: 0xfff0a0, side: THREE.DoubleSide }));
        center.rotation.x = -Math.PI / 2;
        center.position.set(petal.position.x, 0.04, petal.position.z);
        ctx.scene.add(center);
      }

      // 3×3 の穴とキャラクター
      var holeGeo = new THREE.CircleGeometry(0.85, 24);
      var holeMat = new THREE.MeshBasicMaterial({ color: 0x3a2415 });
      var rimGeo = new THREE.RingGeometry(0.85, 1.02, 24);
      var rimMat = Style.mat(0x6b4a26);
      var hitGeo = new THREE.SphereGeometry(0.85, 8, 6); // 当たり判定用(不可視)
      var hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

      for (var gz = 0; gz < GRID; gz++) {
        for (var gx = 0; gx < GRID; gx++) {
          var x = (gx - 1) * SPACING_X;
          var z = (gz - 1) * SPACING_Z;
          var circle = new THREE.Mesh(holeGeo, holeMat);
          circle.rotation.x = -Math.PI / 2;
          circle.position.set(x, 0.01, z);
          var rim = new THREE.Mesh(rimGeo, rimMat);
          rim.rotation.x = -Math.PI / 2;
          rim.position.set(x, 0.02, z);
          ctx.scene.add(circle, rim);

          // pivot が上下してキャラが穴から出入りする(地面平面が下を隠す)
          var pivot = new THREE.Group();
          pivot.position.set(x, -2.0, z);
          var mole = makeMole(THREE);
          var hedge = makeHedge(THREE);
          mole.visible = false;
          hedge.visible = false;
          pivot.add(mole, hedge);
          ctx.scene.add(pivot);

          var hit = new THREE.Mesh(hitGeo, hitMat);
          hit.position.y = 0.7;
          pivot.add(hit);
          hit.userData.holeIndex = holes.length;
          hitMeshes.push(hit);

          holes.push({ pivot: pivot, mole: mole, hedge: hedge, hit: hit,
                       state: ST_HIDDEN, t: 0, isHedge: false });
        }
      }

      // ハンマー(演出用に1本だけ)
      hammer = new THREE.Group();
      var handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 1.6, 8),
        Style.mat(0xc9932f)
      );
      handle.position.y = 0.8;
      var head = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.34, 0.8, 12),
        Style.mat(0xd84f43)
      );
      head.rotation.z = Math.PI / 2;
      head.position.y = 1.6;
      hammer.add(handle, head);
      hammer.visible = false;
      ctx.scene.add(hammer);

      // 汎用パーティクルプール（叩き星＝金 / 出現土＝茶。色を都度差し替え）
      var partGeo = new THREE.SphereGeometry(0.1, 5, 4);
      for (var pt2 = 0; pt2 < 20; pt2++) {
        var pm = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color: 0xffe082, transparent: true, opacity: 0 }));
        pm.visible = false;
        ctx.scene.add(pm);
        particles.push({ mesh: pm, vx: 0, vy: 0, vz: 0, life: 0 });
      }

      // ハリネズミ被弾の赤フラッシュ（DOMオーバーレイ）
      redFlash = document.createElement('div');
      redFlash.style.cssText = 'position:fixed;inset:0;background:radial-gradient(circle,rgba(255,0,0,0) 40%,rgba(255,0,0,0.5) 100%);' +
        'opacity:0;z-index:13;pointer-events:none;transition:opacity 0.1s;';
      document.body.appendChild(redFlash);

      // レイキャスターは1個だけ作って使い回す
      raycaster = new ctx.THREE.Raycaster();
      tapVec = new ctx.THREE.Vector2();
    },

    _burst: function (x, y, z, col, up) {
      var n = 0;
      for (var i = 0; i < particles.length && n < 8; i++) {
        if (particles[i].life > 0) continue;
        var a = Math.random() * Math.PI * 2;
        particles[i].life = 0.45;
        particles[i].vx = Math.cos(a) * (2 + Math.random() * 2);
        particles[i].vy = up + Math.random() * 2;
        particles[i].vz = Math.sin(a) * (2 + Math.random() * 2);
        particles[i].mesh.material.color.setHex(col);
        particles[i].mesh.position.set(x, y, z);
        particles[i].mesh.material.opacity = 1;
        particles[i].mesh.visible = true;
        n++;
      }
    },

    start: function (ctx) {
      hits = 0;
      penalty = 0;
      stunLeft = 0;
      spawnTimer = 0.4;
      hammerT = -1;
      ended = false;
      hammer.visible = false;
      hideAll();
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Time: ', ja: 'のこり ', es: 'Tiempo: ', 'pt-BR': 'Tempo: ', fr: 'Temps: ', de: 'Zeit: ', it: 'Tempo: ', ko: '남은 시간: ', 'zh-Hans': '剩余: ', tr: 'Süre: ' }) + GAME_TIME + ctx.t({ en: ' sec', ja: ' びょう', es: ' seg', 'pt-BR': ' seg', fr: ' sec', de: ' Sek', it: ' sec', ko: ' 초', 'zh-Hans': ' 秒', tr: ' sn' }));
    },

    onPointerDown: function (ctx, p) {
      if (stunLeft > 0) return; // しびれ中は操作不能

      tapVec.set(p.nx, p.ny);
      raycaster.setFromCamera(tapVec, ctx.camera);
      var hitsArr = raycaster.intersectObjects(hitMeshes, false);
      if (hitsArr.length === 0) return;
      var h = holes[hitsArr[0].object.userData.holeIndex];
      if (h.state !== ST_RISING && h.state !== ST_UP) return;

      // ハンマー振り下ろし演出
      hammer.position.copy(h.pivot.position);
      hammer.position.y = 1.2;
      hammer.rotation.z = -1.1;
      hammer.visible = true;
      hammerT = 0;

      var hp = h.pivot.position;
      if (h.isHedge) {
        // ハリネズミ: -5点 + 1秒しびれ ＋ 赤フラッシュ
        penalty += 5;
        ctx.setScore(Math.max(0, hits - penalty));
        stunLeft = 1.0;
        redFlash.style.opacity = '1';
        this._burst(hp.x, 0.9, hp.z, 0xff5252, 2.5);
        ctx.sfx.fail();
        ctx.vibrate(120);
        ctx.setHint(ctx.t({ en: 'Ouch!! Stunned!', ja: 'ビリビリ！！', es: '¡¡Electrocutado!!', 'pt-BR': 'Levou um choque!!', fr: 'Électrocuté!!', de: 'Schock!!', it: 'Elettroshock!!', ko: '따끔!! 기절!', 'zh-Hans': '被刺了！！', tr: 'Çarpıldı!!' }));
      } else {
        hits++;
        ctx.setScore(Math.max(0, hits - penalty));
        this._burst(hp.x, 0.9, hp.z, 0xffe082, 3);
        ctx.sfx.score();
        ctx.vibrate(25);
      }
      h.state = ST_HIT;
      h.t = 0;
    },

    update: function (ctx, dt) {
      if (ended) return;
      var remain = Math.max(0, GAME_TIME - ctx.elapsed);

      // 赤フラッシュのフェード
      if (redFlash.style.opacity === '1' && stunLeft < 0.85) redFlash.style.opacity = '0';
      // パーティクル更新
      for (var pi = 0; pi < particles.length; pi++) {
        var pp = particles[pi];
        if (pp.life <= 0) continue;
        pp.life -= dt;
        pp.mesh.position.x += pp.vx * dt;
        pp.mesh.position.y += pp.vy * dt;
        pp.mesh.position.z += pp.vz * dt;
        pp.vy -= 8 * dt;
        pp.mesh.material.opacity = Math.max(0, pp.life / 0.45);
        if (pp.life <= 0) pp.mesh.visible = false;
      }

      if (stunLeft > 0) {
        stunLeft -= dt;
        if (stunLeft <= 0) ctx.setHint(ctx.t({ en: 'Time: ', ja: 'のこり ', es: 'Tiempo: ', 'pt-BR': 'Tempo: ', fr: 'Temps: ', de: 'Zeit: ', it: 'Tempo: ', ko: '남은 시간: ', 'zh-Hans': '剩余: ', tr: 'Süre: ' }) + Math.ceil(remain) + ctx.t({ en: ' sec', ja: ' びょう', es: ' seg', 'pt-BR': ' seg', fr: ' sec', de: ' Sek', it: ' sec', ko: ' 초', 'zh-Hans': ' 秒', tr: ' sn' }));
      } else {
        ctx.setHint(ctx.t({ en: 'Time: ', ja: 'のこり ', es: 'Tiempo: ', 'pt-BR': 'Tempo: ', fr: 'Temps: ', de: 'Zeit: ', it: 'Tempo: ', ko: '남은 시간: ', 'zh-Hans': '剩余: ', tr: 'Süre: ' }) + Math.ceil(remain) + ctx.t({ en: ' sec', ja: ' びょう', es: ' seg', 'pt-BR': ' seg', fr: ' sec', de: ' Sek', it: ' sec', ko: ' 초', 'zh-Hans': ' 秒', tr: ' sn' }));
      }

      // 出現タイマー
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnOne(ctx.random);
        spawnTimer = spawnInterval(ctx.elapsed);
      }

      // 穴ごとの状態遷移
      for (var i = 0; i < holes.length; i++) {
        var h = holes[i];
        h.t += dt;
        if (h.state === ST_RISING) {
          var r = Math.min(h.t / 0.18, 1);
          h.pivot.position.y = -2.0 + r * 2.0;
          if (r >= 1) { h.state = ST_UP; h.t = 0; }
        } else if (h.state === ST_UP) {
          if (h.t >= upDuration(ctx.elapsed)) { h.state = ST_HIDING; h.t = 0; }
        } else if (h.state === ST_HIDING) {
          var q = Math.min(h.t / 0.22, 1);
          h.pivot.position.y = -q * 2.0;
          if (q >= 1) { h.state = ST_HIDDEN; h.t = 0; }
        } else if (h.state === ST_HIT) {
          // たたかれてぺしゃんこ→引っ込む
          var s = Math.max(0.25, 1 - h.t * 6);
          h.pivot.scale.y = s;
          if (h.t >= 0.25) {
            h.pivot.scale.y = 1;
            h.pivot.position.y = -2.0;
            h.state = ST_HIDDEN;
            h.t = 0;
          }
        }
      }

      // ハンマー演出
      if (hammerT >= 0) {
        hammerT += dt;
        hammer.rotation.z = -1.1 + Math.min(hammerT / 0.1, 1) * 1.1;
        if (hammerT > 0.3) { hammer.visible = false; hammerT = -1; }
      }

      // タイムアップ
      if (remain <= 0) {
        ended = true;
        ctx.endGame(Math.max(0, hits - penalty));
      }
    }
  });
})();
