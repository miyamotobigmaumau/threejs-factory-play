/* =========================================================================
 * TMHanabiShoku — はなびしょくにん
 * コンセプト: 花火職人として花火大会を「演出」する。
 *   大会は4ウェーブ構成: 序盤1発ずつ → 中盤2〜3発同時 → 最後はクライマックスで
 *   大量連発。玉が頂点に来た瞬間タップで大輪。タイミング精度で得点が変わる。
 *   成功で川辺の観客が跳ねて盛り上がりゲージUP、タップ漏らし（落下）でしょんぼり＆DOWN。
 *   ゲージMAXでボーナス演出（全員ジャンプ＋色とりどりの花火＋ボーナス点）。
 * 操作: 画面タップ（タップx座標に近い玉を開花）
 * スコア: 総得点
 * ========================================================================= */

(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // 定数
  // -----------------------------------------------------------------------
  var GRAVITY = 16;           // 重力加速度（ゲーム用に大きめ）
  var SHELL_RADIUS = 0.15;    // 花火玉の半径
  var PARTICLE_RADIUS = 0.34; // バーストパーティクルの半径
  var NUM_SHELLS = 10;        // 花火玉プール数（クライマックスの物量に対応）
  var NUM_PARTICLES = 48;     // バースト1回あたりのパーティクル数
  var APEX_HOLD = 0.2;        // 頂点ステートの保持時間（秒）
  var BURST_LIFE = 1.2;       // バーストの生存時間（秒）
  var PARTICLE_SPEED_MIN = 5;
  var PARTICLE_SPEED_MAX = 12;

  // 得点判定閾値（|vel.y| が小さい = 頂点に近い）
  var THRESH_PERFECT = 1.0;
  var THRESH_GOOD    = 3.0;
  var SCORE_PERFECT  = 300;
  var SCORE_GOOD     = 100;
  var SCORE_OK       = 30;
  var TAP_RANGE_X    = 3.5;  // タップ近接判定の最大距離（ワールドX）

  // 盛り上がりゲージ
  var HYPE_MAX     = 100;
  var HYPE_START   = 20;
  var HYPE_PERFECT = 16;
  var HYPE_GOOD    = 9;
  var HYPE_OK      = 4;
  var HYPE_MISS    = 15;   // ミスで減る量
  var BONUS_SCORE  = 500;  // ゲージMAXボーナス点

  // 花火大会の構成（ウェーブ）: 序盤ゆったり → クライマックスは大量連発
  var WAVES = [
    { count: 4,  interval: 2.2,  maxActive: 1 },
    { count: 6,  interval: 1.5,  maxActive: 2 },
    { count: 7,  interval: 1.05, maxActive: 3 },
    { count: 10, interval: 0.45, maxActive: 6 }   // クライマックス
  ];
  var TOTAL_SHOTS = 27; // WAVES の count 合計

  var NUM_SPARKS  = 6;
  var SMOKE_COUNT = 10;
  var SMOKE_LIFE  = 0.55;
  var CROWD_COUNT = 9;

  // -----------------------------------------------------------------------
  // ゲーム内部状態
  // -----------------------------------------------------------------------
  var scene, camera, renderer;

  var shells = [];          // 花火玉プール
  var particleMeshes = [];  // [slot][idx]
  var particleVels = [];    // [slot][idx]
  var particleDirs = [];    // 方向ベクトル（init時に1回計算）
  var particleTimers = [];  // [slot]

  var totalScore = 0;
  var comboCount = 0;
  var hype = HYPE_START;    // 盛り上がりゲージ 0..100
  var waveIdx = 0;
  var launchedInWave = 0;
  var shotsLaunched = 0;
  var wavePause = 0;        // ウェーブ間の小休止
  var launchTimer = 0;
  var finishTimer = 0;      // 全弾消化後の余韻
  var gameRunning = false;
  var _ctx = null;

  // 演出プール
  var mortars = [];
  var targetRings = [];
  var sparkMeshes = [];
  var selectRing = null;
  var selectRingTimer = 0;
  var smokeMeshes = [];
  var smokeVels = [];
  var smokeTimer = 0;
  var cueClock = 0;
  var _tapVec = null;

  // 観客（川辺のシルエット）
  var crowd = [];           // {g, baseY, phase, dot}
  var crowdClock = 0;
  var joyT = 0;             // 歓喜ジャンプ残り秒
  var sadT = 0;             // しょんぼり残り秒
  var bonusT = 0;           // ボーナス演出残り秒

  // DOM
  var hypeBarBg = null, hypeBarEl = null, remainingEl = null;

  // -----------------------------------------------------------------------
  // Shell.registerGame
  // -----------------------------------------------------------------------
  Shell.registerGame({
    id: 'TMHanabiShoku',
    title: { en: 'Fireworks Master', ja: 'はなびしょくにん', es: 'Maestro de Fuegos', 'pt-BR': 'Mestre dos Fogos', fr: 'Maître Feux d\'Artifice', de: 'Feuerwerk-Meister', it: 'Maestro Fuochi', ko: '불꽃 장인', 'zh-Hans': '烟花工匠', tr: 'Havai Fişek Ustası' },
    howto: {
      en: 'Run the fireworks show!\nTap each shell at its peak — miss none!\nHype up the crowd to the grand finale!',
      ja: '花火大会を演出しよう！\n玉が頂点に来た瞬間にタップ、うちもらし注意！\n観客を盛り上げてクライマックスへ！',
      es: '¡Dirige el show de fuegos!\n¡Toca cada cohete en su cima, sin fallar!\n¡Anima al público hasta el gran final!',
      'pt-BR': 'Comande o show de fogos!\nToque cada foguete no pico — não perca nenhum!\nAnime a plateia até o grande final!',
      fr: 'Dirigez le spectacle pyrotechnique !\nTouchez chaque fusée à son sommet, sans en rater !\nChauffez la foule jusqu\'au grand final !',
      de: 'Leite die Feuerwerksshow!\nTippe jede Rakete am Gipfel — keine verpassen!\nBring das Publikum bis zum großen Finale in Stimmung!',
      it: 'Dirigi lo spettacolo pirotecnico!\nTocca ogni razzo al suo picco, senza perderne!\nScalda il pubblico fino al gran finale!',
      ko: '불꽃축제를 연출하자!\n정점에 오른 순간 탭, 놓치지 마세요!\n관객을 달아오르게 해 피날레로!',
      'zh-Hans': '来导演一场烟花大会！\n烟花升到顶点的瞬间点击，一个都别漏！\n点燃观众情绪迎接压轴高潮！',
      tr: 'Havai fişek gösterisini yönet!\nHer roketi zirvesinde tıkla — hiçbirini kaçırma!\nSeyirciyi coşturup büyük finale taşı!'
    },
    scoreLabel: { en: 'pts', ja: 'てん', es: 'pts', 'pt-BR': 'pts', fr: 'pts', de: 'Pkt', it: 'pts', ko: '점', 'zh-Hans': '分', tr: 'puan' },
    bg: 0x0a0a1a,

    // ------------------------------------------------------------------
    // init: シーン構築。new THREE.* はここだけ（プール方式）
    // ------------------------------------------------------------------
    init: function (ctx) {
      _ctx = ctx;
      scene    = ctx.scene;
      camera   = ctx.camera;
      renderer = ctx.renderer;

      camera.position.set(0, 10, 20);
      camera.lookAt(0, 8, 0);
      if (camera.fov !== undefined) {
        camera.fov = 60;
        camera.updateProjectionMatrix();
      }
      scene.background = new THREE.Color(0x0a0a1a);

      // ---- 星 ----
      var starGeo = new THREE.SphereGeometry(0.06, 4, 4);
      var starMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      for (var s = 0; s < 60; s++) {
        var star = new THREE.Mesh(starGeo, starMat);
        star.position.set(
          (Math.random() - 0.5) * 40,
          5 + Math.random() * 25,
          -20 - Math.random() * 10
        );
        scene.add(star);
      }

      // ---- 街のシルエット ----
      var silhouetteMat = new THREE.MeshBasicMaterial({ color: 0x0d1117 });
      var buildingDefs = [
        [-9, 2.0, 2.5], [-6.5, 1.5, 3.8], [-4.5, 2.2, 2.0], [-2.5, 1.8, 4.5],
        [-0.5, 2.5, 3.0], [2.0, 1.6, 5.0], [4.0, 2.0, 2.8], [6.0, 1.8, 3.5],
        [8.0, 2.4, 2.2], [10, 1.2, 4.0]
      ];
      for (var b = 0; b < buildingDefs.length; b++) {
        var bd = buildingDefs[b];
        var bMesh = new THREE.Mesh(Style.roundedBox(bd[1], bd[2], 1.5), silhouetteMat);
        bMesh.position.set(bd[0], -4 + bd[2] / 2, -5);
        scene.add(bMesh);
      }

      // ---- 月 ----
      var moonMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
      var moon = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), moonMat);
      moon.position.set(8, 24, -28);
      scene.add(moon);
      var moonHaloMat = new THREE.MeshBasicMaterial({
        color: 0xfff2c0, transparent: true, opacity: 0.15,
        blending: THREE.AdditiveBlending, depthWrite: false });
      var moonHalo = new THREE.Mesh(new THREE.SphereGeometry(3.1, 16, 12), moonHaloMat);
      moonHalo.position.copy(moon.position);
      scene.add(moonHalo);

      // ---- 川（観客の手前に暗い水面。花火が映える舞台）----
      var riverMat = new THREE.MeshBasicMaterial({ color: 0x101d33 });
      var river = new THREE.Mesh(new THREE.PlaneGeometry(50, 8), riverMat);
      river.rotation.x = -Math.PI / 2;
      river.position.set(0, -4.45, -1.0);
      scene.add(river);
      // 水面の淡い反射帯（加算の細い板）
      var glintMat = new THREE.MeshBasicMaterial({
        color: 0x3a5a8a, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false });
      var glint = new THREE.Mesh(new THREE.PlaneGeometry(30, 1.6), glintMat);
      glint.rotation.x = -Math.PI / 2;
      glint.position.set(0, -4.4, -1.0);
      scene.add(glint);

      // ---- 観客シルエット（川辺の列。跳ねて盛り上がりを見せる）----
      var crowdMat = new THREE.MeshBasicMaterial({ color: 0x05060f });
      crowd = [];
      for (var cd = 0; cd < CROWD_COUNT; cd++) {
        var cs = 0.85 + Math.random() * 0.35;
        var cx = -6.4 + cd * 1.6 + (Math.random() - 0.5) * 0.4;
        var cz = 2.4 + (cd % 2) * 0.9;
        var g = new THREE.Group();
        var head = new THREE.Mesh(new THREE.SphereGeometry(0.42 * cs, 8, 6), crowdMat);
        head.position.set(0, 0.9 * cs, 0);
        g.add(head);
        var bodyM = new THREE.Mesh(new THREE.SphereGeometry(0.62 * cs, 8, 6), crowdMat);
        bodyM.scale.set(1, 1.25, 0.8);
        bodyM.position.set(0, 0.25 * cs, 0);
        g.add(bodyM);
        // ペンライト風の光点（盛り上がると点灯して揺れる）
        var dotMat = new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.9,
          blending: THREE.AdditiveBlending, depthWrite: false });
        dotMat.color.setHSL((cd / CROWD_COUNT), 0.9, 0.7);
        var dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), dotMat);
        dot.position.set(0.3 * cs, 1.35 * cs, 0);
        dot.visible = false;
        g.add(dot);
        var baseY = -4.85;
        g.position.set(cx, baseY, cz);
        scene.add(g);
        crowd.push({ g: g, baseY: baseY, phase: Math.random() * Math.PI * 2, dot: dot });
      }

      // ---- パーティクル方向ベクトル（事前計算）----
      particleDirs = [];
      for (var i = 0; i < NUM_PARTICLES; i++) {
        var theta = (i / NUM_PARTICLES) * Math.PI * 2;
        var phi   = (Math.random() - 0.5) * Math.PI;
        particleDirs.push({
          x: Math.cos(phi) * Math.cos(theta),
          y: Math.cos(phi) * Math.sin(theta) * 0.8 + 0.5,
          z: Math.sin(phi)
        });
      }

      // ---- 花火玉プール ----
      shells = [];
      for (var si = 0; si < NUM_SHELLS; si++) {
        var shellGeo = new THREE.SphereGeometry(SHELL_RADIUS, 8, 8);
        var shellMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        var shellMesh = new THREE.Mesh(shellGeo, shellMat);
        shellMesh.position.set(0, -10, 0);
        shellMesh.visible = false;
        scene.add(shellMesh);
        shells.push({
          mesh: shellMesh,
          state: 'idle',   // 'idle'|'rising'|'apex'|'falling'|'burst'
          pos: { x: 0, y: -10 },
          vel: { y: 0 },
          apexY: 0,
          apexHoldTimer: 0,
          hue: 0,
          sizeClass: 1,
          scoreMult: 1
        });
      }

      // ---- バーストパーティクルプール ----
      particleMeshes = [];
      particleVels   = [];
      particleTimers = [];
      var pGeo = new THREE.SphereGeometry(PARTICLE_RADIUS, 6, 6);
      for (var pi = 0; pi < NUM_SHELLS; pi++) {
        particleMeshes.push([]);
        particleVels.push([]);
        particleTimers.push(0);
        for (var pj = 0; pj < NUM_PARTICLES; pj++) {
          var pMat = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.95,
            blending: THREE.AdditiveBlending, depthWrite: false });
          var pMesh = new THREE.Mesh(pGeo, pMat);
          pMesh.visible = false;
          pMesh.position.set(0, -10, 0);
          scene.add(pMesh);
          particleMeshes[pi].push(pMesh);
          particleVels[pi].push(0);
        }
      }

      // ---- 発射筒／ターゲットリング／頂点スパーク（スロット別プール）----
      mortars = [];
      targetRings = [];
      sparkMeshes = [];
      var mortarMat = new THREE.MeshBasicMaterial({ color: 0x3a4152 });
      var mortarRimMat = new THREE.MeshBasicMaterial({ color: 0x5a6378 });
      var ringGeo = new THREE.TorusGeometry(0.7, 0.05, 8, 32);
      var sparkGeo = new THREE.SphereGeometry(0.09, 4, 4);
      for (var mi = 0; mi < NUM_SHELLS; mi++) {
        var mortarG = new THREE.Group();
        var tube = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 1.0, 10), mortarMat);
        mortarG.add(tube);
        var rim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 6, 12), mortarRimMat);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = 0.5;
        mortarG.add(rim);
        mortarG.position.set(0, -4.6, 0);
        mortarG.visible = false;
        scene.add(mortarG);
        mortars.push(mortarG);

        var ringMat = new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.3,
          blending: THREE.AdditiveBlending, depthWrite: false });
        var ring = new THREE.Mesh(ringGeo, ringMat);
        ring.visible = false;
        scene.add(ring);
        targetRings.push(ring);

        sparkMeshes.push([]);
        for (var sk = 0; sk < NUM_SPARKS; sk++) {
          var sparkMat = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false });
          var spark = new THREE.Mesh(sparkGeo, sparkMat);
          spark.visible = false;
          scene.add(spark);
          sparkMeshes[mi].push(spark);
        }
      }

      // ---- タップ選択リング ----
      var selMat = new THREE.MeshBasicMaterial({
        color: 0xffff88, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false });
      selectRing = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 8, 24), selMat);
      selectRing.visible = false;
      scene.add(selectRing);

      // ---- 発射煙プール（共有）----
      smokeMeshes = [];
      smokeVels = [];
      var smokeGeo = new THREE.SphereGeometry(0.22, 6, 5);
      for (var sm = 0; sm < SMOKE_COUNT; sm++) {
        var smokeMat = new THREE.MeshBasicMaterial({
          color: 0x8a8a99, transparent: true, opacity: 0.5, depthWrite: false });
        var smoke = new THREE.Mesh(smokeGeo, smokeMat);
        smoke.visible = false;
        scene.add(smoke);
        smokeMeshes.push(smoke);
        smokeVels.push({ x: 0, y: 0 });
      }

      _tapVec = new THREE.Vector3();

      // ---- DOM: 盛り上がりゲージ＋残弾表示（テキストなし・アイコンのみ）----
      hypeBarBg = document.createElement('div');
      hypeBarBg.style.cssText = [
        'position:fixed;top:50px;left:50%;transform:translateX(-50%);',
        'width:46vw;height:12px;background:rgba(255,255,255,.15);',
        'border-radius:6px;z-index:11;pointer-events:none;display:none;'
      ].join('');
      hypeBarEl = document.createElement('div');
      hypeBarEl.style.cssText = [
        'height:100%;width:20%;border-radius:6px;',
        'background:linear-gradient(90deg,#ffd54f,#ff6e9c,#b388ff);',
        'transition:width .15s;'
      ].join('');
      hypeBarBg.appendChild(hypeBarEl);
      document.body.appendChild(hypeBarBg);

      remainingEl = document.createElement('div');
      remainingEl.style.cssText = [
        'position:fixed;top:68px;left:50%;transform:translateX(-50%);',
        'z-index:11;color:#fff;font-weight:bold;font-size:16px;',
        'text-shadow:0 2px 4px #000;pointer-events:none;'
      ].join('');
      document.body.appendChild(remainingEl);
    },

    // ------------------------------------------------------------------
    // start: プレイ開始ごとの状態リセット
    // ------------------------------------------------------------------
    start: function (ctx) {
      _ctx = ctx;
      totalScore = 0;
      comboCount = 0;
      hype = HYPE_START;
      waveIdx = 0;
      launchedInWave = 0;
      shotsLaunched = 0;
      wavePause = 1.0;
      launchTimer = 0;
      finishTimer = 0;
      joyT = 0; sadT = 0; bonusT = 0;
      crowdClock = 0;
      cueClock = 0;
      gameRunning = true;

      for (var si = 0; si < NUM_SHELLS; si++) {
        var sh = shells[si];
        sh.state = 'idle';
        sh.mesh.visible = false;
        sh.pos.x = 0; sh.pos.y = -10;
        sh.vel.y = 0;
        sh.apexHoldTimer = 0;
      }
      for (var pi = 0; pi < NUM_SHELLS; pi++) {
        particleTimers[pi] = 0;
        for (var pj = 0; pj < NUM_PARTICLES; pj++) {
          particleMeshes[pi][pj].visible = false;
          particleMeshes[pi][pj].scale.set(1, 1, 1);
        }
      }
      for (var mi = 0; mi < NUM_SHELLS; mi++) {
        mortars[mi].visible = false;
        targetRings[mi].visible = false;
        for (var sk = 0; sk < NUM_SPARKS; sk++) sparkMeshes[mi][sk].visible = false;
      }
      selectRing.visible = false;
      selectRingTimer = 0;
      smokeTimer = 0;
      for (var sm = 0; sm < SMOKE_COUNT; sm++) smokeMeshes[sm].visible = false;
      for (var cc = 0; cc < CROWD_COUNT; cc++) {
        crowd[cc].g.position.y = crowd[cc].baseY;
        crowd[cc].g.scale.set(1, 1, 1);
        crowd[cc].dot.visible = false;
      }

      ctx.setScore(0);
      hypeBarBg.style.display = '';
      _updateHypeBar();
      _updateRemaining();
      ctx.setHint('');
    },

    // ------------------------------------------------------------------
    // update: 毎フレーム
    // ------------------------------------------------------------------
    update: function (ctx, dt) {
      if (!gameRunning) return;
      _ctx = ctx;
      cueClock += dt;

      // ---- ウェーブ進行 ----
      var wave = waveIdx < WAVES.length ? WAVES[waveIdx] : null;
      var flyingCount = 0;
      for (var fi = 0; fi < NUM_SHELLS; fi++) {
        var st0 = shells[fi].state;
        if (st0 === 'rising' || st0 === 'apex' || st0 === 'falling') flyingCount++;
      }

      if (wavePause > 0) {
        wavePause -= dt;
        if (wavePause <= 0 && wave) {
          // クライマックスは特別な合図（テキスト最小限・記号中心）
          ctx.setHint(waveIdx === WAVES.length - 1 ? '🎇🎇🎇' : '🎆 ' + (waveIdx + 1) + '/' + WAVES.length);
          launchTimer = 0.4;
        }
      } else if (wave) {
        launchTimer -= dt;
        if (launchTimer <= 0 && launchedInWave < wave.count && flyingCount < wave.maxActive) {
          for (var li = 0; li < NUM_SHELLS; li++) {
            if (shells[li].state === 'idle' && particleTimers[li] <= 0) {
              _launchShell(li);
              launchedInWave++;
              launchTimer = wave.interval * (0.8 + Math.random() * 0.4);
              break;
            }
          }
        }
        // ウェーブ完了 → 次ウェーブへ（飛翔中がいなくなったら）
        if (launchedInWave >= wave.count && flyingCount === 0) {
          waveIdx++;
          launchedInWave = 0;
          wavePause = waveIdx < WAVES.length ? 1.3 : 0;
        }
      }

      // ---- 各花火玉の物理更新 ----
      for (var si = 0; si < NUM_SHELLS; si++) {
        var sh = shells[si];
        if (sh.state === 'rising' || sh.state === 'apex' || sh.state === 'falling') {
          sh.vel.y -= GRAVITY * dt;
          sh.pos.y += sh.vel.y * dt;
          if (sh.state === 'rising' && sh.vel.y <= 0) {
            sh.state = 'apex';
            sh.apexHoldTimer = APEX_HOLD;
          } else if (sh.state === 'apex') {
            sh.apexHoldTimer -= dt;
            if (sh.apexHoldTimer <= 0) sh.state = 'falling';
          }
          if (sh.pos.y < -6) _registerMiss(si, ctx);
          sh.mesh.position.set(sh.pos.x, sh.pos.y, 0);
        } else if (sh.state === 'burst') {
          sh.mesh.visible = false;
        }
      }

      // ---- 頂点合図・リング・発射筒 ----
      for (var ci = 0; ci < NUM_SHELLS; ci++) _updateShellCues(ci);

      // ---- 発射煙 ----
      if (smokeTimer > 0) {
        smokeTimer -= dt;
        var smokeRatio = Math.max(0, smokeTimer / SMOKE_LIFE);
        for (var sm = 0; sm < SMOKE_COUNT; sm++) {
          var smk = smokeMeshes[sm];
          if (!smk.visible) continue;
          smk.position.x += smokeVels[sm].x * dt;
          smk.position.y += smokeVels[sm].y * dt;
          var smSc = 1 + (1 - smokeRatio) * 1.8;
          smk.scale.set(smSc, smSc, smSc);
          smk.material.opacity = 0.5 * smokeRatio;
          if (smokeTimer <= 0) smk.visible = false;
        }
      }

      // ---- 選択リング ----
      if (selectRingTimer > 0) {
        selectRingTimer -= dt;
        var selRatio = Math.max(0, selectRingTimer / 0.25);
        var selSc = 1 + (1 - selRatio) * 1.4;
        selectRing.scale.set(selSc, selSc, selSc);
        selectRing.material.opacity = 0.9 * selRatio;
        if (selectRingTimer <= 0) selectRing.visible = false;
      }

      // ---- バーストパーティクル ----
      for (var pi = 0; pi < NUM_SHELLS; pi++) {
        if (particleTimers[pi] <= 0) continue;
        particleTimers[pi] -= dt;
        var lifeRatio = particleTimers[pi] / BURST_LIFE;
        for (var pj = 0; pj < NUM_PARTICLES; pj++) {
          var pm = particleMeshes[pi][pj];
          if (!pm.visible) continue;
          var dir = particleDirs[pj];
          var spd = particleVels[pi][pj];
          pm.position.x += dir.x * spd * dt;
          pm.position.y += dir.y * spd * dt;
          pm.position.z += dir.z * spd * dt;
          var sc = Math.max(0, lifeRatio);
          pm.scale.set(sc, sc, sc);
          if (sc < 0.01 || particleTimers[pi] <= 0) pm.visible = false;
        }
        if (particleTimers[pi] <= 0) {
          for (var pk = 0; pk < NUM_PARTICLES; pk++) {
            particleMeshes[pi][pk].visible = false;
            particleMeshes[pi][pk].scale.set(1, 1, 1);
          }
          if (shells[pi].state === 'burst') shells[pi].state = 'idle';
        }
      }

      // ---- 観客アニメーション（盛り上がりが見える）----
      _updateCrowd(dt);

      // ---- 終了判定（全ウェーブ消化＋余韻）----
      if (waveIdx >= WAVES.length) {
        var busy = false;
        for (var bi = 0; bi < NUM_SHELLS; bi++) {
          if (shells[bi].state !== 'idle' || particleTimers[bi] > 0) { busy = true; break; }
        }
        if (!busy) {
          finishTimer += dt;
          if (finishTimer > 0.8) {
            gameRunning = false;
            hypeBarBg.style.display = 'none';
            ctx.endGame(totalScore);
          }
        }
      }
    },

    // ------------------------------------------------------------------
    // onPointerDown: タップx座標に近い玉を開花（近接判定）
    // ------------------------------------------------------------------
    onPointerDown: function (ctx, p) {
      if (!gameRunning) return;
      _ctx = ctx;

      var tapX = _pointerWorldX(p);
      var bestIdx = -1;
      var bestDist = TAP_RANGE_X;
      for (var si = 0; si < NUM_SHELLS; si++) {
        var sh0 = shells[si];
        if (sh0.state === 'rising' || sh0.state === 'apex' || sh0.state === 'falling') {
          var dist = Math.abs(sh0.pos.x - tapX);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = si;
          }
        }
      }
      if (bestIdx < 0) return;

      var sh = shells[bestIdx];

      selectRing.position.set(sh.pos.x, sh.pos.y, 0);
      selectRing.scale.set(1, 1, 1);
      selectRing.material.opacity = 0.9;
      selectRing.visible = true;
      selectRingTimer = 0.25;

      var absVel = Math.abs(sh.vel.y);
      var multiplier = _getMultiplier();

      // 得点判定（★の数で表現・言語非依存）
      var tierScore, stars, tier;
      if (absVel < THRESH_PERFECT) {
        tierScore = SCORE_PERFECT; stars = '★★★'; tier = 2;
        comboCount++;
        _hypeAdd(HYPE_PERFECT);
        if (ctx.sfx && ctx.sfx.success) ctx.sfx.success();
        ctx.vibrate(50);
      } else if (absVel < THRESH_GOOD) {
        tierScore = SCORE_GOOD; stars = '★★'; tier = 1;
        comboCount++;
        _hypeAdd(HYPE_GOOD);
        if (ctx.sfx && ctx.sfx.score) ctx.sfx.score();
        ctx.vibrate(20);
      } else {
        tierScore = SCORE_OK; stars = '★'; tier = 0;
        comboCount = 0;
        _hypeAdd(HYPE_OK);
        if (ctx.sfx && ctx.sfx.tap) ctx.sfx.tap();
        ctx.vibrate(10);
      }

      var earned = tierScore * multiplier * (sh.scoreMult || 1);
      totalScore += earned;
      ctx.setScore(totalScore);

      // 成功 → 観客が跳ねる
      joyT = Math.max(joyT, tier === 2 ? 0.9 : 0.5);
      sadT = 0;

      var hint = '+' + earned + ' ' + stars;
      if (multiplier > 1) hint += ' ×' + multiplier;
      ctx.setHint(hint);

      sh.state = 'burst';
      sh.mesh.visible = false;
      _triggerBurst(bestIdx, sh.pos.x, sh.pos.y, tier);
      _updateRemaining();
    }
  });

  // -----------------------------------------------------------------------
  // 内部ヘルパー
  // -----------------------------------------------------------------------

  // 花火玉打ち上げ（大きさ・高さ・速度をランダム化）
  //   小玉(30%)=速く低い / 中玉(45%)=標準 / 大玉(25%)=ゆっくり高い・得点2倍
  function _launchShell(si) {
    var sh = shells[si];
    var roll = Math.random();
    var sizeClass = roll < 0.30 ? 0 : (roll < 0.75 ? 1 : 2);
    sh.sizeClass = sizeClass;
    sh.scoreMult = [1, 1, 2][sizeClass];
    var meshScale = [0.75, 1.0, 1.6][sizeClass];
    var vyMin = [11.0, 12.8, 15.5][sizeClass];
    var vyRange = [1.3, 2.0, 2.0][sizeClass];

    sh.pos.x = (Math.random() - 0.5) * 8; // -4 〜 4
    sh.pos.y = -5;
    sh.vel.y = vyMin + Math.random() * vyRange;
    sh.state = 'rising';
    sh.apexHoldTimer = 0;
    sh.mesh.scale.set(meshScale, meshScale, meshScale);
    shotsLaunched++;
    _updateRemaining();

    var hue = (shotsLaunched * 47 + si * 90) % 360 / 360;
    sh.hue = hue;
    sh.mesh.material.color.setHSL(hue, 1.0, 0.6);
    sh.mesh.position.set(sh.pos.x, sh.pos.y, 0);
    sh.mesh.visible = true;

    // 予測頂点にターゲットリング
    sh.apexY = -5 + sh.vel.y * sh.vel.y / (2 * GRAVITY);
    var ring = targetRings[si];
    ring.position.set(sh.pos.x, sh.apexY, 0);
    ring.scale.set(meshScale, meshScale, 1);
    ring.visible = true;

    mortars[si].position.set(sh.pos.x, -4.6, 0);
    mortars[si].visible = true;
    _spawnSmoke(sh.pos.x, -4.0);
  }

  function _spawnSmoke(x, y) {
    smokeTimer = SMOKE_LIFE;
    for (var sm = 0; sm < SMOKE_COUNT; sm++) {
      var smk = smokeMeshes[sm];
      var ang = (sm / SMOKE_COUNT) * Math.PI * 2;
      smk.position.set(x + Math.cos(ang) * 0.15, y + Math.random() * 0.2, 0.2);
      smk.scale.set(1, 1, 1);
      smk.material.opacity = 0.5;
      smk.visible = true;
      smokeVels[sm].x = Math.cos(ang) * (0.8 + Math.random() * 0.8);
      smokeVels[sm].y = 1.2 + Math.random() * 1.6;
    }
  }

  // タップのスクリーン座標(nx,ny)を z=0 平面のワールドXへ変換
  function _pointerWorldX(p) {
    if (!_tapVec || !p) return 0;
    _tapVec.set(p.nx, p.ny, 0.5);
    _tapVec.unproject(camera);
    _tapVec.sub(camera.position);
    if (Math.abs(_tapVec.z) < 1e-6) return 0;
    var t = -camera.position.z / _tapVec.z;
    return camera.position.x + _tapVec.x * t;
  }

  // 頂点合図（白明滅＋スパーク）・リング・発射筒の更新
  function _updateShellCues(si) {
    var sh = shells[si];
    var ring = targetRings[si];
    var flying = (sh.state === 'rising' || sh.state === 'apex' || sh.state === 'falling');

    mortars[si].visible = (sh.state !== 'idle');

    if (!flying) {
      ring.visible = false;
      for (var sk = 0; sk < NUM_SPARKS; sk++) sparkMeshes[si][sk].visible = false;
      return;
    }

    ring.visible = true;
    ring.material.opacity = 0.22 + 0.14 * Math.sin(cueClock * 6 + si);

    var inWindow = (sh.state === 'apex') ||
      ((sh.state === 'rising' || sh.state === 'falling') && Math.abs(sh.vel.y) < THRESH_GOOD);
    if (inWindow) {
      var blink = Math.sin(cueClock * 28) > 0;
      if (blink) {
        sh.mesh.material.color.setHSL(sh.hue, 0.15, 0.97); // ほぼ白
      } else {
        sh.mesh.material.color.setHSL(sh.hue, 1.0, 0.6);
      }
      for (var sk2 = 0; sk2 < NUM_SPARKS; sk2++) {
        var spark = sparkMeshes[si][sk2];
        var sAng = (sk2 / NUM_SPARKS) * Math.PI * 2 + cueClock * 5;
        var sRad = 0.5 + 0.18 * Math.sin(cueClock * 14 + sk2 * 1.7);
        spark.position.set(
          sh.pos.x + Math.cos(sAng) * sRad,
          sh.pos.y + Math.sin(sAng) * sRad,
          0.1
        );
        spark.material.opacity = 0.6 + 0.4 * Math.sin(cueClock * 20 + sk2);
        spark.visible = true;
      }
    } else {
      sh.mesh.material.color.setHSL(sh.hue, 1.0, 0.6);
      for (var sk3 = 0; sk3 < NUM_SPARKS; sk3++) sparkMeshes[si][sk3].visible = false;
    }
  }

  // タップ漏らし: 玉が落下 → 観客しょんぼり＋ゲージ減
  function _registerMiss(si, ctx) {
    var sh = shells[si];
    if (sh.state === 'idle' || sh.state === 'burst') return;

    comboCount = 0;
    _hypeAdd(-HYPE_MISS);
    sadT = 0.9;
    joyT = 0;

    if (ctx.sfx && ctx.sfx.fail) ctx.sfx.fail();
    ctx.vibrate(30);
    ctx.setHint('💧');

    _triggerBurst(si, sh.pos.x, sh.pos.y, -1); // 暗いくすぶりバースト
    sh.state = 'burst';
    sh.mesh.visible = false;
    _updateRemaining();
  }

  function _getMultiplier() {
    if (comboCount >= 6) return 3;
    if (comboCount >= 3) return 2;
    return 1;
  }

  // 盛り上がりゲージ増減。MAXでボーナス演出。
  function _hypeAdd(v) {
    hype = Math.max(0, Math.min(HYPE_MAX, hype + v));
    if (hype >= HYPE_MAX && bonusT <= 0) {
      _triggerBonus();
    }
    _updateHypeBar();
  }

  // ゲージMAXボーナス: 全員ジャンプ＋色とりどりの花火＋ボーナス点
  function _triggerBonus() {
    bonusT = 1.6;
    joyT = 1.6;
    totalScore += BONUS_SCORE;
    if (_ctx) {
      _ctx.setScore(totalScore);
      _ctx.setHint('🎉 +' + BONUS_SCORE);
      if (_ctx.sfx && _ctx.sfx.success) _ctx.sfx.success();
      _ctx.vibrate(60);
    }
    // アイドル中のスロットを最大3つ借りて虹色バーストを夜空に
    var used = 0;
    for (var si = 0; si < NUM_SHELLS && used < 3; si++) {
      if (shells[si].state === 'idle' && particleTimers[si] <= 0) {
        _triggerBurst(si, (Math.random() - 0.5) * 8, 2 + Math.random() * 3, 2);
        used++;
      }
    }
    hype = 25; // 再チャレンジ可能に
  }

  // 観客の毎フレーム更新: 盛り上がりに応じて跳ね、ミスでしょんぼり
  function _updateCrowd(dt) {
    crowdClock += dt;
    if (joyT > 0) joyT -= dt;
    if (sadT > 0) sadT -= dt;
    if (bonusT > 0) bonusT -= dt;

    // 基礎の揺れ幅はゲージに比例（盛り上がるほど常時ぴょこぴょこ）
    var baseAmp = 0.04 + (hype / HYPE_MAX) * 0.16;
    var dotOn = hype >= 60 || bonusT > 0;

    for (var i = 0; i < CROWD_COUNT; i++) {
      var c = crowd[i];
      var y = c.baseY;
      var sy = 1;
      if (bonusT > 0) {
        // ボーナス: 全員大ジャンプ
        y += Math.abs(Math.sin(crowdClock * 9 + c.phase)) * 0.7;
      } else if (joyT > 0) {
        // 成功歓喜: 順に跳ねるウェーブ
        y += Math.abs(Math.sin(crowdClock * 8 + i * 0.6)) * 0.45;
      } else if (sadT > 0) {
        // しょんぼり: 沈んで縮む
        y -= 0.12;
        sy = 0.88;
      } else {
        y += Math.abs(Math.sin(crowdClock * 3 + c.phase)) * baseAmp;
      }
      c.g.position.y = y;
      c.g.scale.y += (sy - c.g.scale.y) * Math.min(dt * 8, 1);
      c.dot.visible = dotOn;
      if (dotOn) {
        c.dot.position.x = 0.3 + Math.sin(crowdClock * 6 + c.phase) * 0.15;
      }
    }
  }

  // バーストパーティクル起動（tier: -1=不発くすぶり / 0=小 / 1=中 / 2=大輪）
  function _triggerBurst(slotIdx, bx, by, tier) {
    var hue = ((shotsLaunched * 55 + slotIdx * 37) % 360) / 360;
    var childCount = tier >= 1 ? 3 + ((Math.random() * 3) | 0) : 0;
    var centralCount = tier >= 2 ? 30 : 36;

    particleTimers[slotIdx] = BURST_LIFE;

    for (var pj = 0; pj < NUM_PARTICLES; pj++) {
      var pm = particleMeshes[slotIdx][pj];
      var spd = PARTICLE_SPEED_MIN + Math.random() * (PARTICLE_SPEED_MAX - PARTICLE_SPEED_MIN);
      if (tier === 0) spd *= 0.55;      // 小玉は控えめ
      if (tier < 0) spd *= 0.3;         // 不発はしょぼく
      particleVels[slotIdx][pj] = spd;

      var ox = 0, oy = 0;
      if (pj >= centralCount && childCount > 0) {
        var child = (pj - centralCount) % childCount;
        var ang = child / childCount * Math.PI * 2;
        ox = Math.cos(ang) * (1.2 + tier * 0.35);
        oy = Math.sin(ang) * (0.9 + tier * 0.25);
        particleVels[slotIdx][pj] = spd * 0.62;
      }

      pm.position.set(bx + ox, by + oy, 0);
      var scale = tier >= 2 && pj < centralCount ? 1.25 : (tier < 0 ? 0.5 : 1);
      pm.scale.set(scale, scale, scale);
      if (tier < 0) {
        pm.material.color.setHex(0x444455);
      } else if (tier >= 2 && pj % 2 === 0) {
        pm.material.color.setHSL(hue + 0.5 + pj * (1 / NUM_PARTICLES), 1.0, 0.7);
      } else {
        pm.material.color.setHSL(hue + pj * (1 / NUM_PARTICLES), 1.0, 0.65);
      }
      pm.visible = true;
    }
  }

  function _updateHypeBar() {
    if (!hypeBarEl) return;
    hypeBarEl.style.width = Math.max(0, Math.min(100, hype)) + '%';
  }

  function _updateRemaining() {
    if (!remainingEl) return;
    remainingEl.textContent = '🎆 × ' + Math.max(0, TOTAL_SHOTS - shotsLaunched);
  }

})();
