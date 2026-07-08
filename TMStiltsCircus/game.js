/* =========================================================================
 * TMStiltsCircus — サーカスたけうま
 * ルール: 竹馬で綱渡り。画面下部40%（ステップゾーン）を左右交互タップで
 *         一歩ずつ前進（リズムが崩れるとぐらつき増加）。
 *         画面上部60%のドラッグで倒立振子の傾きを補正。
 *         風船や客席フラッシュが外乱。落ちたら終了。
 * 操作: 下部ゾーン左右交互タップで前進 ＋ 上部ドラッグで傾き補正
 * スコア: 歩いた距離m
 * allowContinue: true（その場から再開）
 * ========================================================================= */
(function () {
  'use strict';

  /* ---- 物理定数 ---- */
  var TILT_GRAVITY = 3.5;  // 倒立振子の重力係数
  var TILT_DAMP    = 0.92; // 角速度減衰
  var TILT_DRAG_K  = 2.5;  // ドラッグによる補正力
  var STEP_SPEED   = 1.8;  // 1歩の前進量(m)
  var FALL_ANGLE   = 0.85; // 倒れる閾値(ラジアン)

  /* ---- リズム判定 ---- */
  var RHYTHM_WINDOW = 0.55; // 理想ステップ間隔(秒)
  var RHYTHM_TOL    = 0.25; // 許容ズレ

  /* ---- 入力ゾーン ---- */
  var STEP_ZONE_NY = -0.2; // ny がこれ未満＝画面下部40%（ステップゾーン）

  /* ---- シーンオブジェクト ---- */
  var stiltsMesh;       // 竹馬キャラ（グループ）
  var ropeMesh;         // 綱
  var ropeSegments = []; // 綱のセグメント
  var balloonMeshes = []; // 風船（外乱）
  var spotlightMeshes = []; // スポットライト
  var tentMesh;

  /* ---- DOM UI ---- */
  var tiltBar, tiltMarker, tiltBg;
  var distDiv;
  var footLDiv, footRDiv;   // ステップゾーンの足跡マーク（左右）
  var pulseDiv;             // リズムメトロノーム円パルス

  /* ---- 状態変数 ---- */
  var tiltAngle;     // 傾き(rad, 正=右)
  var tiltVel;       // 角速度
  var stepCount;     // 合計歩数
  var lastStep;      // 最後にタップした側 ('L'/'R'/null)
  var lastStepTime;  // 最後のステップ時刻
  var posZ;          // X位置（歩数連動）
  var windForce;     // 風の外乱強さ（ロープごとに変化）
  var distGoal;      // 現在ロープの目標歩数
  var distDone;      // 現在ロープで歩いた歩数
  var ropeLevel;     // ロープレベル（難易度）
  var dragDX;        // ドラッグDX（イベントが無いフレームは減衰）
  var dragActive;    // 上部ゾーンで開始したバランス補正ドラッグ中か
  var balloonTimer;  // 風船外乱タイマー
  var flashTimer;    // フラッシュ外乱タイマー
  var flashActive;   // フラッシュ中フラグ
  var footFlashTimer; // 同側タップ警告フラッシュ残り時間
  var footFlashSide;  // 警告フラッシュ対象 ('L'/'R')
  var falling;        // 転落アニメ中フラグ
  var fallTimer;      // 転落アニメ残り時間
  var fallDir;        // 転落方向 (+1=右/-1=左)

  /* ---- 位置更新 ---- */
  function syncMeshes() {
    stiltsMesh.position.x = 0;
    stiltsMesh.position.z = posZ;   // 手前(0)→奥(-)へ進む
    stiltsMesh.rotation.z = tiltAngle;
  }

  /* ---- ロープ開始 ---- */
  function startRope(ctx, level) {
    ropeLevel = level;
    distGoal = 20 + level * 10;
    distDone = 0;
    windForce = 0.3 + level * 0.15;
    // posZ は継続（テレポートしない）
    ctx.setHint(ctx.t({ en: 'Tap left·right·left·right!', ja: '左・右・左・右でタップ！', es: '¡Toca izq·der·izq·der!', 'pt-BR': 'Toque esq·dir·esq·dir!', fr: 'Touchez gauche·droite·gauche·droite !', de: 'Tippe links·rechts·links·rechts!', it: 'Tocca sin·des·sin·des!', ko: '좌·우·좌·우 탭!', 'zh-Hans': '点击左·右·左·右！', tr: 'Sol·sağ·sol·sağa dokun!' }));
  }

  /* ---- DOM UI 作成 ---- */
  function buildDOM() {
    // 傾きゲージ
    tiltBg = document.createElement('div');
    tiltBg.style.cssText = [
      'position:fixed;bottom:55px;left:50%;transform:translateX(-50%);',
      'width:60vw;height:16px;background:#555;border-radius:8px;',
      'z-index:11;display:none;overflow:hidden;'
    ].join('');
    // 緑ゾーン（中央）
    var gz = document.createElement('div');
    gz.style.cssText = [
      'position:absolute;top:0;height:100%;left:35%;width:30%;',
      'background:#43a047;border-radius:4px;'
    ].join('');
    tiltBg.appendChild(gz);
    // マーカー
    tiltMarker = document.createElement('div');
    tiltMarker.style.cssText = [
      'position:absolute;top:-2px;width:6px;height:20px;',
      'background:#fff;border-radius:3px;transform:translateX(-50%);left:50%;'
    ].join('');
    tiltBg.appendChild(tiltMarker);
    document.body.appendChild(tiltBg);

    // 距離表示
    distDiv = document.createElement('div');
    distDiv.style.cssText = [
      'position:fixed;top:10px;right:14px;font-size:18px;font-weight:bold;',
      'color:#fff;text-shadow:0 1px 4px #000;z-index:11;display:none;'
    ].join('');
    document.body.appendChild(distDiv);

    // ステップゾーンの足跡マーク（画面下部40%の左右に常時表示）
    function makeFoot(isLeft) {
      var d = document.createElement('div');
      d.style.cssText = [
        'position:fixed;bottom:8%;height:30%;width:44%;',
        (isLeft ? 'left:2%;' : 'right:2%;'),
        'display:none;z-index:11;pointer-events:none;',
        'border:2px dashed rgba(255,255,255,0.25);border-radius:18px;',
        'text-align:center;'
      ].join('');
      var foot = document.createElement('div');
      foot.style.cssText = [
        'position:absolute;top:50%;left:50%;',
        'transform:translate(-50%,-50%)' + (isLeft ? ' scaleX(-1)' : '') + ';',
        'font-size:52px;line-height:1;opacity:0.35;'
      ].join('');
      foot.textContent = '🦶';
      d.appendChild(foot);
      document.body.appendChild(d);
      d._foot = foot;
      return d;
    }
    footLDiv = makeFoot(true);
    footRDiv = makeFoot(false);

    // リズムメトロノーム（画面中央下の脈動する円パルス）
    pulseDiv = document.createElement('div');
    pulseDiv.style.cssText = [
      'position:fixed;bottom:42%;left:50%;',
      'width:30px;height:30px;margin-left:-15px;',
      'border-radius:50%;background:#888;',
      'z-index:11;display:none;pointer-events:none;',
      'box-shadow:0 0 12px rgba(0,0,0,0.4);'
    ].join('');
    document.body.appendChild(pulseDiv);
  }

  Shell.registerGame({
    id: 'TMStiltsCircus',
    title: { en: 'Circus Stilts', ja: 'サーカスたけうま', es: 'Zancos de Circo', 'pt-BR': 'Pernas de Pau', fr: 'Cirque Échasses', de: 'Zirkus Stelzen', it: 'Trampoli da Circo', ko: '서커스 죽마', 'zh-Hans': '马戏竹马', tr: 'Sirk Cambazı' },
    howto: { en: 'Tap the 🦶 marks below alternately to walk!\nDrag the upper screen to balance!', ja: '下の🦶マークを左右こうごにタップで前進！\n画面の上のほうをドラッグでバランス！', es: '¡Toca los 🦶 de abajo alternando para andar!\n¡Arrastra la parte superior para equilibrar!', 'pt-BR': 'Toque nos 🦶 abaixo alternadamente para andar!\nArraste a parte de cima para equilibrar!', fr: 'Touchez les 🦶 en bas en alternance pour marcher !\nGlissez en haut de l\'écran pour équilibrer !', de: 'Tippe unten abwechselnd auf die 🦶-Marken!\nZiehe oben am Bildschirm für die Balance!', it: 'Tocca i 🦶 in basso in alternanza per camminare!\nTrascina la parte alta per equilibrarti!', ko: '아래 🦶 마크를 좌우 교대로 탭해서 전진!\n화면 위쪽을 드래그해서 밸런스!', 'zh-Hans': '交替点击下方的🦶标记前进！\n拖动屏幕上方保持平衡！', tr: 'Yürümek için alttaki 🦶 işaretlerine sırayla dokun!\nDengelemek için ekranın üstünü sürükle!' },
    scoreLabel: 'm',
    bg: 0x1a0a2a,
    allowContinue: true,
    cameraFov: 55,
    cameraPos: [0, 4, 10],
    cameraLookAt: [0, 2, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;
      var scene = ctx.scene;

      /* ---- テント ---- */
      tentMesh = new THREE.Mesh(
        new THREE.ConeGeometry(12, 6, 8),
        Style.mat(0x8b0000)
      );
      tentMesh.position.set(0, 9, -5);
      scene.add(tentMesh);

      // テント縞模様用（白い交互三角）
      var stripeMat = Style.mat(0xffffff);
      for (var si = 0; si < 4; si++) {
        var s = new THREE.Mesh(new THREE.ConeGeometry(1.2, 6, 3), stripeMat);
        s.position.set(0, 9, -5);
        s.rotation.y = si * Math.PI / 4;
        scene.add(s);
      }

      /* ---- 綱（手前→奥へ長く伸びる） ---- */
      ropeMesh = new THREE.Mesh(
        Style.roundedBox(0.12, 0.08, 400),
        Style.mat(0xc8a050)
      );
      ropeMesh.position.set(0, 1.5, -190);
      scene.add(ropeMesh);

      /* ---- 支柱（奥方向に等間隔＝通り過ぎると進行が見える） ---- */
      var poleMat = Style.mat(0x777777);
      var poleGeo = Style.roundedBox(0.2, 3.5, 0.2);
      for (var pz = 0; pz < 28; pz++) {
        var zz = 4 - pz * 8;
        var pL = new THREE.Mesh(poleGeo, poleMat);
        pL.position.set(-1.3, 1.75, zz); scene.add(pL);
        var pR = new THREE.Mesh(poleGeo, poleMat);
        pR.position.set(1.3, 1.75, zz); scene.add(pR);
      }

      /* ---- 竹馬キャラ（うさぎ） ---- */
      stiltsMesh = new THREE.Group();

      // うさぎ（scale=0.6: 全長≈1.2、足裏y=0 → 頭頂y≈1.2）
      var bunnyInner = GameBunny.make(THREE, { scale: 0.6 });
      // うさぎをステップ位置（y=1.2）の上に乗せる
      bunnyInner.group.position.y = 1.2;
      stiltsMesh.add(bunnyInner.group);

      // 蝶ネクタイ（サーカス演出。うさぎの子＝立ち耳と干渉しない）
      var bowMat = Style.mat(0xd23c3c);
      var bowKnot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), bowMat);
      bowKnot.position.set(0, 1.08, 0.42);
      bunnyInner.group.add(bowKnot);
      [-1, 1].forEach(function (bs) {
        var loop = new THREE.Mesh(Style.roundedBox(0.2, 0.12, 0.06), bowMat);
        loop.position.set(0.14 * bs, 1.08, 0.4);
        loop.rotation.z = 0.25 * bs;
        bunnyInner.group.add(loop);
      });

      // 竹馬（左右の棒）
      var stiltsGeo = Style.roundedBox(0.1, 2.5, 0.1);
      var stiltsMat = Style.mat(0x8d6e43);
      var stiltsL = new THREE.Mesh(stiltsGeo, stiltsMat);
      stiltsL.position.set(-0.22, 0.75, 0);
      stiltsMesh.add(stiltsL);
      var stiltsR = new THREE.Mesh(stiltsGeo, stiltsMat);
      stiltsR.position.set(0.22, 0.75, 0);
      stiltsMesh.add(stiltsR);

      // 足場（ステップ）
      var stepGeo = Style.roundedBox(0.3, 0.08, 0.35);
      var stepL = new THREE.Mesh(stepGeo, stiltsMat);
      stepL.position.set(-0.22, 1.2, 0);
      stiltsMesh.add(stepL);
      var stepR = new THREE.Mesh(stepGeo, stiltsMat);
      stepR.position.set(0.22, 1.2, 0);
      stiltsMesh.add(stepR);

      stiltsMesh.position.set(0, 1.5, 0);
      stiltsMesh.rotation.y = Math.PI;
      scene.add(stiltsMesh);

      /* ---- 風船（外乱用）プール ---- */
      var balloonGeo = new THREE.SphereGeometry(0.4, 10, 8);
      var balloonColors = [0xff4444, 0x4488ff, 0xffee22, 0x44cc44];
      for (var bi = 0; bi < 4; bi++) {
        var bm = new THREE.Mesh(balloonGeo, Style.mat(balloonColors[bi]));
        bm.visible = false;
        scene.add(bm);
        balloonMeshes.push({ mesh: bm, x: 0, y: 0, vx: 0, vy: 0, active: false });
      }

      /* ---- スポットライト（外乱フラッシュ演出） ---- */
      var spotGeo = new THREE.ConeGeometry(0.5, 2, 8);
      var spotMat = new THREE.MeshBasicMaterial({ color: 0xffff88, transparent: true, opacity: 0.0 });
      for (var spi = 0; spi < 3; spi++) {
        var spm = new THREE.Mesh(spotGeo, spotMat.clone());
        spm.position.set(-3 + spi * 3, 7, -2);
        spm.rotation.x = Math.PI / 2;
        scene.add(spm);
        spotlightMeshes.push(spm);
      }

      buildDOM();
    },

    start: function (ctx) {
      tiltAngle = 0;
      tiltVel = 0;
      stepCount = 0;
      lastStep = null;
      lastStepTime = 0;
      posZ = 0;
      dragDX = 0;
      dragActive = false;
      balloonTimer = 3;
      flashTimer = 5;
      flashActive = false;
      ropeLevel = 0;
      footFlashTimer = 0;
      footFlashSide = null;
      falling = false;
      fallTimer = 0;
      fallDir = 0;

      for (var bi = 0; bi < balloonMeshes.length; bi++) {
        balloonMeshes[bi].active = false;
        balloonMeshes[bi].mesh.visible = false;
      }
      for (var spi = 0; spi < spotlightMeshes.length; spi++) {
        spotlightMeshes[spi].material.opacity = 0;
      }

      startRope(ctx, 0);

      tiltBg.style.display = '';
      distDiv.style.display = '';
      footLDiv.style.display = '';
      footRDiv.style.display = '';
      pulseDiv.style.display = '';
      footLDiv.style.background = '';
      footRDiv.style.background = '';

      ctx.setScore(0);

      stiltsMesh.position.set(0, 1.5, 0);
      stiltsMesh.rotation.y = Math.PI;
      stiltsMesh.rotation.z = 0;
    },

    onContinue: function (ctx) {
      // その場から再開。傾きを少しリセット
      tiltVel = 0;
      tiltAngle = tiltAngle * 0.5;
      falling = false;
      fallTimer = 0;
      dragDX = 0;
      dragActive = false;
      stiltsMesh.position.y = 1.5;
      // 転落時に隠したUIを復帰
      tiltBg.style.display = '';
      distDiv.style.display = '';
      footLDiv.style.display = '';
      footRDiv.style.display = '';
      pulseDiv.style.display = '';
      ctx.setHint(ctx.t({ en: 'Keep going!', ja: 'がんばれ！', es: '¡Ánimo!', 'pt-BR': 'Vai lá!', fr: 'Courage !', de: 'Weiter so!', it: 'Forza!', ko: '힘내!', 'zh-Hans': '加油！', tr: 'Devam et!' }));
    },

    onPointerDown: function (ctx, p) {
      if (falling) return;
      var now = ctx.elapsed;

      // ゾーン分離: 画面上部60%＝バランス補正ドラッグ専用
      if (p.ny >= STEP_ZONE_NY) {
        dragActive = true;
        return;
      }

      // 画面下部40%＝ステップゾーン（左半分=左足、右半分=右足）
      var side = p.nx < 0 ? 'L' : 'R';

      // 交互チェック
      if (lastStep === side) {
        // 同じ側を連続 → 大きくぐらつく＋該当側の足跡マークを赤フラッシュ
        tiltVel += (side === 'L' ? -1 : 1) * 1.5;
        footFlashTimer = 0.4;
        footFlashSide = side;
        (side === 'L' ? footLDiv : footRDiv).style.background = 'rgba(229,57,53,0.35)';
        ctx.sfx.bounce();
        return;
      }

      // リズムチェック
      var dt2 = now - lastStepTime;
      var rhythmOk = lastStep == null || (dt2 > RHYTHM_WINDOW - RHYTHM_TOL && dt2 < RHYTHM_WINDOW + RHYTHM_TOL * 2);

      if (!rhythmOk) {
        // リズムズレ → 少しぐらつく
        tiltVel += (side === 'L' ? -1 : 1) * 0.6;
      }

      // 一歩前進
      lastStep = side;
      lastStepTime = now;
      stepCount++;
      posZ -= STEP_SPEED * 0.18; // 手前→奥（-Z）へ一歩前進
      distDone++;

      // リズムが良ければぐらつき軽減
      if (rhythmOk) {
        tiltVel *= 0.7;
      }

      ctx.sfx.tap();
      ctx.vibrate(12);

      // スコア更新（歩数→距離m）
      ctx.setScore(Math.floor(stepCount * STEP_SPEED * 10) / 10); // 1歩=1.8m(0.1m丸め)

      // ロープゴール到達
      if (distDone >= distGoal) {
        ctx.sfx.success();
        ctx.vibrate(50);
        // 次ロープへ（難易度アップ・そのまま前進継続）
        startRope(ctx, ropeLevel + 1);
      }
    },

    onPointerMove: function (ctx, p) {
      // 上部ゾーンで開始したドラッグのみ傾き補正（Move毎に更新）
      if (dragActive) dragDX = p.dx;
    },

    onPointerUp: function (ctx, p) {
      dragDX = 0;
      dragActive = false;
    },

    update: function (ctx, dt) {
      // カメラをキャラの後ろから追従（手前→奥へ進む見た目）
      ctx.camera.position.set(0, 4, posZ + 8);
      ctx.camera.lookAt(0, 1.8, posZ - 5);

      /* ---- 転落アニメ（0.5秒）中は演出のみ ---- */
      if (falling) {
        fallTimer -= dt;
        tiltAngle += fallDir * 4 * dt;
        if (Math.abs(tiltAngle) > Math.PI / 2) tiltAngle = fallDir * Math.PI / 2;
        stiltsMesh.position.y = Math.max(-1, stiltsMesh.position.y - 4 * dt);
        stiltsMesh.rotation.z = -tiltAngle;
        stiltsMesh.position.z = posZ;
        if (fallTimer <= 0) {
          ctx.gameOver(ctx.score);
        }
        return;
      }

      // 倒立振子物理
      // 傾き角に比例した重力トルク
      tiltVel += TILT_GRAVITY * Math.sin(tiltAngle) * dt;
      // ドラッグで逆方向の力
      tiltVel -= dragDX * TILT_DRAG_K * 0.01;
      // ドラッグ入力はイベントが無いフレームで減衰（残留補正の防止）
      dragDX *= 0.85;
      // 風の外乱（ロープレベルに応じた強さ）
      tiltVel += (Math.sin(ctx.elapsed * 1.7 + ropeLevel) * windForce * 0.08) * dt;
      // 角速度減衰
      tiltVel *= Math.pow(TILT_DAMP, dt * 60);
      tiltAngle += tiltVel * dt;

      // 傾きゲージUI更新（-FALL_ANGLEからFALL_ANGLEの範囲→0..1）
      var tiltNorm = (tiltAngle / FALL_ANGLE) * 0.5 + 0.5;
      tiltNorm = Math.max(0, Math.min(1, tiltNorm));
      tiltMarker.style.left = (tiltNorm * 100) + '%';

      // キャラメッシュに反映（x=0 固定、z=posZ で奥へ）
      stiltsMesh.rotation.z = -tiltAngle;
      stiltsMesh.position.set(0, stiltsMesh.position.y, posZ);

      // 距離表示
      distDiv.textContent = ctx.score.toFixed(1) + 'm';

      /* ---- リズムメトロノーム（円パルス） ---- */
      var sinceStep = ctx.elapsed - lastStepTime;
      var inWindow = lastStep == null ||
        (sinceStep > RHYTHM_WINDOW - RHYTHM_TOL && sinceStep < RHYTHM_WINDOW + RHYTHM_TOL * 2);
      var pulsePhase = lastStep == null
        ? ctx.elapsed / RHYTHM_WINDOW
        : sinceStep / RHYTHM_WINDOW;
      var pulseScale = 1 + 0.35 * Math.abs(Math.sin(pulsePhase * Math.PI));
      pulseDiv.style.transform = 'scale(' + pulseScale.toFixed(3) + ')';
      pulseDiv.style.background = inWindow ? '#43a047' : '#888888';

      /* ---- 次に踏む側の足跡マークを点滅 ---- */
      var blink = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(ctx.elapsed * 6));
      var nextL = (lastStep !== 'L'); // null または 'R' → 次は左
      footLDiv._foot.style.opacity = nextL ? blink.toFixed(2) : '0.22';
      footRDiv._foot.style.opacity = nextL ? '0.22' : blink.toFixed(2);

      // 同側タップ警告フラッシュの消灯
      if (footFlashTimer > 0) {
        footFlashTimer -= dt;
        if (footFlashTimer <= 0 && footFlashSide) {
          (footFlashSide === 'L' ? footLDiv : footRDiv).style.background = '';
          footFlashSide = null;
        }
      }

      // 転倒判定 → 0.5秒の転落アニメへ
      if (Math.abs(tiltAngle) >= FALL_ANGLE) {
        tiltBg.style.display = 'none';
        distDiv.style.display = 'none';
        footLDiv.style.display = 'none';
        footRDiv.style.display = 'none';
        pulseDiv.style.display = 'none';
        for (var bi = 0; bi < balloonMeshes.length; bi++) {
          balloonMeshes[bi].active = false;
          balloonMeshes[bi].mesh.visible = false;
        }
        ctx.sfx.fail();
        ctx.vibrate(80);
        falling = true;
        fallTimer = 0.5;
        fallDir = tiltAngle >= 0 ? 1 : -1;
        return;
      }

      /* ---- 風船外乱 ---- */
      balloonTimer -= dt;
      if (balloonTimer <= 0) {
        balloonTimer = 4 + Math.random() * 3;
        // 空いている風船を浮かせる
        for (var bfi = 0; bfi < balloonMeshes.length; bfi++) {
          if (!balloonMeshes[bfi].active) {
            var bd = balloonMeshes[bfi];
            bd.active = true;
            bd.x = (Math.random() < 0.5 ? -2 : 2);
            bd.y = 0;
            bd.z = posZ + (Math.random() - 0.5) * 2; // 現在地の近くから浮く
            bd.vx = (Math.random() - 0.5) * 1.5;
            bd.vy = 2 + Math.random();
            bd.mesh.visible = true;
            bd.mesh.position.set(bd.x, bd.y, bd.z);
            break;
          }
        }
      }

      for (var bai = 0; bai < balloonMeshes.length; bai++) {
        var ba = balloonMeshes[bai];
        if (!ba.active) continue;
        ba.x += ba.vx * dt;
        ba.y += ba.vy * dt;
        ba.mesh.position.set(ba.x, ba.y, ba.z);
        // 風船がキャラに近づいたら外乱
        var dx = ba.x - 0;
        var dy = ba.y - 2.5;
        var dz = ba.z - stiltsMesh.position.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 1.0) {
          tiltVel += (ba.vx > 0 ? 0.5 : -0.5);
          ba.active = false;
          ba.mesh.visible = false;
          ctx.sfx.bounce();
        }
        if (ba.y > 8) {
          ba.active = false;
          ba.mesh.visible = false;
        }
      }

      /* ---- フラッシュ外乱 ---- */
      flashTimer -= dt;
      if (flashTimer <= 0) {
        flashTimer = 6 + Math.random() * 5;
        flashActive = true;
        for (var fsi = 0; fsi < spotlightMeshes.length; fsi++) {
          spotlightMeshes[fsi].material.opacity = 0.6;
        }
        // 0.4秒後に消える（タイマー管理はシンプルにflashTimerで）
      }
      if (flashActive) {
        for (var fli = 0; fli < spotlightMeshes.length; fli++) {
          spotlightMeshes[fli].material.opacity = Math.max(0,
            spotlightMeshes[fli].material.opacity - dt * 2.5);
        }
        if (spotlightMeshes[0].material.opacity <= 0) flashActive = false;
      }
    }
  });
})();
