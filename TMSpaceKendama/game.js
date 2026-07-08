/* =========================================================================
 * TMSpaceKendama — うちゅうけんだま
 * ルール: 低重力ステーション。玉は上・左・右の壁で跳ね返り、下へ落ちてくる。
 *   ドラッグで皿(けん)を動かしてキャッチし続けろ。
 *   下（画面の底）へ落としたら終了。
 * 操作: ドラッグで皿を左右上下に動かす（皿はタッチ位置の少し上に出る）。
 * スコア: 連続キャッチ数
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------- 定数 ---------- */
  var ROOM_W = 4.6;  // 部屋の幅(半幅)＝画面内に収まるサイズ
  var ROOM_H = 7.2;  // 部屋の高さ(半高)
  var ROOM_D = 4;    // 部屋の奥行(半深)
  var BALL_R = 0.28;
  var KEN_W = 1.4;   // 皿の幅（少し広めでキャッチしやすく）
  var KEN_H = 0.18;  // 皿の厚み
  var CATCH_DIST = 1.05; // キャッチ判定距離
  var GRAVITY_DOWN = 4.2; // 基準重力の強さ
  var KEN_TOUCH_OFFSET = 1.5; // 皿をタッチ位置より上に出すオフセット（指で隠れない）
  var SWITCH_BASE = 6.0;  // 重力が切り替わる基本間隔(秒)
  var WARN_LEAD = 1.0;    // 切替の何秒前に矢印予告を出すか

  /* ---------- 状態 ---------- */
  var ballX, ballY, ballZ;
  var ballVx, ballVy, ballVz;
  var kenX, kenY;       // 皿の位置（X,Y; Z固定）
  var catchCount;
  var gx, gy;           // 現在の重力ベクトル
  var nextGx, nextGy;   // 予告中の次の重力
  var switchTimer;      // 次の切替までの秒
  var warned;           // 予告表示中か

  /* ---------- 重力ランダム化 ----------
   * 方向: 真下±110°の範囲（真上はなし）。強さ: ステージが上がるほど
   * 強弱のブレ幅が広がる。切替間隔もステージで短くなる。 */
  function stageNo() { return Math.floor(catchCount / 10); }
  function switchInterval() { return Math.max(3.0, SWITCH_BASE - stageNo() * 0.5); }
  function rollGravity() {
    var theta = (Math.random() * 2 - 1) * 1.92; // ±110°
    var spread = 0.3 + Math.min(0.6, stageNo() * 0.08);
    var mag = GRAVITY_DOWN * (1 + (Math.random() * 2 - 1) * spread);
    mag = Math.max(2.2, Math.min(8.5, mag));
    nextGx = Math.sin(theta) * mag;
    nextGy = -Math.cos(theta) * mag;
  }

  /* ---------- Three.js オブジェクト ---------- */
  var ballMesh, kenMesh;
  var trailMeshes = []; // 残像
  var shockIndicators = []; // 壁の電撃警告メッシュ×4（未使用・非表示）
  var starMeshes = [];  // 星窓の星
  var wallMeshes = [];  // 壁

  /* ---------- DOM ---------- */
  var warnDom;          // 画面下端の赤い警告グラデ帯（下に落とすと終了の可視化）
  var arrowDom;         // 次の重力方向の予告矢印（画面中央・回転）

  function makeDom() {
    warnDom = document.createElement('div');
    warnDom.style.cssText = [
      'position:fixed;left:0;right:0;bottom:0;height:14vh;',
      'background:linear-gradient(to top,rgba(255,45,45,0.55),rgba(255,45,45,0));',
      'z-index:10;pointer-events:none;display:none;'
    ].join('');
    document.body.appendChild(warnDom);

    arrowDom = document.createElement('div');
    arrowDom.textContent = '⬇';
    arrowDom.style.cssText = [
      'position:fixed;left:50%;top:42%;z-index:12;font-size:96px;',
      'pointer-events:none;display:none;color:#7fd4ff;',
      'text-shadow:0 0 24px rgba(90,190,255,0.9);',
      'transform:translate(-50%,-50%);'
    ].join('');
    document.body.appendChild(arrowDom);
  }

  // 予告矢印を次の重力方向に向けて表示（点滅は update で）
  function showArrow(gxv, gyv) {
    var deg = -Math.atan2(gxv, -gyv) * 180 / Math.PI;
    arrowDom.style.transform = 'translate(-50%,-50%) rotate(' + deg.toFixed(0) + 'deg)';
    arrowDom.style.display = '';
  }

  /* ---------- 皿をポインタ位置へ（タッチ位置の少し上にオフセット） ---------- */
  function moveKen(p) {
    kenX = p.nx * ROOM_W * 0.85;
    kenY = Math.min(ROOM_H - 0.8, p.ny * ROOM_H * 0.85 + KEN_TOUCH_OFFSET);
    kenMesh.position.set(kenX, kenY, 0);
  }

  /* ---------- 玉テクスチャ (CanvasTexture) ---------- */
  function makeBallTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    var c = cv.getContext('2d');
    // 銀色の玉
    var grad = c.createRadialGradient(40, 40, 4, 64, 64, 64);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, '#aaddff');
    grad.addColorStop(1, '#224488');
    c.fillStyle = grad;
    c.beginPath(); c.arc(64, 64, 60, 0, Math.PI * 2); c.fill();
    // 星柄
    c.fillStyle = 'rgba(255,255,200,0.6)';
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * Math.PI * 2;
      c.beginPath();
      c.arc(64 + Math.cos(a) * 30, 64 + Math.sin(a) * 30, 5, 0, Math.PI * 2);
      c.fill();
    }
    return new THREE.CanvasTexture(cv);
  }

  /* ---------- 壁メッシュ生成 ---------- */
  function buildRoom(THREE, scene) {
    var wallMat = new THREE.MeshLambertMaterial({ color: 0x1a2438, side: THREE.BackSide });
    var room = new THREE.Mesh(
      Style.roundedBox(ROOM_W * 2, ROOM_H * 2, ROOM_D * 2),
      wallMat
    );
    scene.add(room);
    wallMeshes.push(room);

    // 丸窓（フレーム＋ガラス越しの宇宙と輪っき惑星）
    var portFrame = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.14, 10, 24),
      Style.mat(0x8a94a2));
    portFrame.position.set(0, 1.2, -ROOM_D + 0.08);
    scene.add(portFrame);
    var portGlass = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24),
      new THREE.MeshBasicMaterial({ color: 0x060a18 }));
    portGlass.position.set(0, 1.2, -ROOM_D + 0.04);
    scene.add(portGlass);
    var planet = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12),
      new THREE.MeshLambertMaterial({ color: 0xe8956a }));
    planet.position.set(0.5, 1.4, -ROOM_D + 0.3);
    scene.add(planet);
    var planetRing = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 6, 20),
      new THREE.MeshBasicMaterial({ color: 0xd8c49a }));
    planetRing.rotation.x = Math.PI / 2.6;
    planetRing.position.copy(planet.position);
    scene.add(planetRing);

    // 星窓（丸い穴 → CircleGeometry で貼る）
    var winMat = new THREE.MeshBasicMaterial({ color: 0x112244 });
    var starCols = [0xffffff, 0xffe9a8, 0x9fdcff, 0xffc4e0];
    for (var i = 0; i < 26; i++) {
      var starMat = new THREE.MeshBasicMaterial({ color: starCols[i % starCols.length] });
      var star = new THREE.Mesh(new THREE.CircleGeometry(0.04 + Math.random() * 0.08, 5), starMat);
      star.position.set(
        (Math.random() - 0.5) * ROOM_W * 1.8,
        (Math.random() - 0.5) * ROOM_H * 1.8,
        -ROOM_D + 0.05
      );
      scene.add(star);
      starMeshes.push(star);
    }

    // 電撃ゾーン（壁端の帯 - 上下左右）
    var shockMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.15 });
    // 上
    var sTop = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W * 2, 1.2), shockMat.clone());
    sTop.position.set(0, ROOM_H - 0.6, -ROOM_D + 0.1);
    scene.add(sTop); shockIndicators.push(sTop);
    // 下
    var sBot = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W * 2, 1.2), shockMat.clone());
    sBot.position.set(0, -ROOM_H + 0.6, -ROOM_D + 0.1);
    scene.add(sBot); shockIndicators.push(sBot);
    // 左
    var sL = new THREE.Mesh(new THREE.PlaneGeometry(1.2, ROOM_H * 2), shockMat.clone());
    sL.position.set(-ROOM_W + 0.6, 0, -ROOM_D + 0.1);
    scene.add(sL); shockIndicators.push(sL);
    // 右
    var sR = new THREE.Mesh(new THREE.PlaneGeometry(1.2, ROOM_H * 2), shockMat.clone());
    sR.position.set(ROOM_W - 0.6, 0, -ROOM_D + 0.1);
    scene.add(sR); shockIndicators.push(sR);
  }

  /* ---------- Shell.registerGame ---------- */
  Shell.registerGame({
    id: 'TMSpaceKendama',
    title: { en: 'Space Kendama', ja: 'うちゅうけんだま', es: 'Kendama Espacial', 'pt-BR': 'Kendama Espacial', fr: 'Kendama Spatial', de: 'Weltraum-Kendama', it: 'Kendama Spaziale', ko: '우주 켄다마', 'zh-Hans': '太空剑玉', tr: 'Uzay Kendama' },
    howto: { en: 'Drag the cup to catch the ball!\nGravity keeps changing — watch the arrow!\nDrop it to the bottom = game over.', ja: 'ドラッグで皿を動かして玉をキャッチ！\n重力がコロコロ変わる→矢印に注目！\n下へおとしたら おわり。', es: '¡Arrastra la taza y atrapa la bola!\n¡La gravedad cambia: mira la flecha!\nSi cae al fondo = fin.', 'pt-BR': 'Arraste o copo e pegue a bola!\nA gravidade muda — veja a seta!\nCair no fundo = fim.', fr: 'Glissez la coupe pour attraper la balle !\nLa gravité change : suivez la flèche !\nTomber en bas = terminé.', de: 'Ziehe den Becher und fange den Ball!\nDie Schwerkraft wechselt — achte auf den Pfeil!\nUnten fallen lassen = vorbei.', it: 'Trascina la coppa e prendi la palla!\nLa gravità cambia: guarda la freccia!\nCade in fondo = fine.', ko: '드래그로 컵을 움직여 공을 잡아!\n중력이 계속 바뀐다→화살표 주목!\n아래로 떨어뜨리면 끝.', 'zh-Hans': '拖动杯子接住球！\n重力不断变化——注意箭头！\n落到底部则结束。', tr: 'Kupayı sürükle topu yakala!\nYerçekimi değişir — oku izle!\nAşağı düşerse bitti.' },
    scoreLabel: { en: 'streak', ja: 'れんぞく', es: 'racha', 'pt-BR': 'sequência', fr: 'série', de: 'Serie', it: 'serie', ko: '연속', 'zh-Hans': '连续', tr: 'seri' },
    bg: 0x0a0e1a,
    cameraFov: 60,
    cameraPos: [0, 0, 14],
    cameraLookAt: [0, 0, 0],
    fitWidth: 10,

    init: function (ctx) {
      var THREE = ctx.THREE;

      buildRoom(THREE, ctx.scene);

      // 玉
      var ballTex = makeBallTexture(THREE);
      ballMesh = new THREE.Mesh(
        new THREE.SphereGeometry(BALL_R, 12, 8),
        new THREE.MeshLambertMaterial({ map: ballTex })
      );
      // 玉のまわりに小さな惑星の輪（宇宙けんだま感）
      var ballRing = new THREE.Mesh(new THREE.TorusGeometry(BALL_R * 1.6, 0.035, 6, 18),
        new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.85 }));
      ballRing.rotation.x = Math.PI / 2.4;
      ballMesh.add(ballRing);
      ctx.scene.add(ballMesh);

      // 残像トレイル
      var trailMat = new THREE.MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.35 });
      for (var ti = 0; ti < 6; ti++) {
        var t = new THREE.Mesh(
          new THREE.SphereGeometry(BALL_R * (1 - ti * 0.1), 8, 6),
          new THREE.MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.25 - ti * 0.04 })
        );
        t.visible = false;
        ctx.scene.add(t);
        trailMeshes.push(t);
      }

      // 皿 (けん)
      kenMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(KEN_W / 2, KEN_W / 2, KEN_H, 16),
        Style.mat(0xffcc44)
      );
      // けんの縁（赤）・軸・グリップ（子メッシュ=皿に自動追従）
      var kenRim = new THREE.Mesh(new THREE.TorusGeometry(KEN_W / 2, 0.05, 8, 18),
        new THREE.MeshPhongMaterial({ color: 0xd8402e, shininess: 50 }));
      kenRim.rotation.x = Math.PI / 2;
      kenRim.position.y = KEN_H / 2;
      kenMesh.add(kenRim);
      var kenStem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.9, 10),
        Style.mat(0xb08050));
      kenStem.position.y = -0.55;
      kenMesh.add(kenStem);
      var kenGrip = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8),
        Style.mat(0xd8402e));
      kenGrip.position.y = -1.05;
      kenMesh.add(kenGrip);
      ctx.scene.add(kenMesh);

      makeDom();
    },

    start: function (ctx) {
      ballX = 0; ballY = 1; ballZ = 0;
      ballVx = (Math.random() * 2 - 1) * 1.2; ballVy = 6.5; ballVz = 0; // 上へ打ち上げてスタート
      kenX = 0; kenY = -3.0;
      catchCount = 0;
      gx = 0; gy = -GRAVITY_DOWN;    // 最初は素直な下向き重力
      switchTimer = SWITCH_BASE;
      warned = false;
      arrowDom.style.display = 'none';

      ballMesh.position.set(ballX, ballY, ballZ);
      kenMesh.position.set(kenX, kenY, 0);
      trailMeshes.forEach(function (t) { t.visible = false; });
      // 旧・電撃バンドは非表示（下落ちルールでは不要）
      shockIndicators.forEach(function (s) { s.visible = false; });
      warnDom.style.display = ''; // 下端の警告帯を常設表示
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Move the cup to catch the ball! Don\'t drop it!', ja: '皿を動かして玉をキャッチ！下におとすな！', es: '¡Mueve la taza para atrapar la bola! ¡No la dejes caer!', 'pt-BR': 'Mova o copo para pegar a bola! Não deixe cair!', fr: 'Bougez la coupe pour attraper la balle ! Ne la faites pas tomber !', de: 'Becher bewegen zum Fangen! Nicht fallen lassen!', it: 'Muovi la coppa per catturare la palla! Non farla cadere!', ko: '컵을 움직여 공을 잡아! 떨어뜨리지 마!', 'zh-Hans': '移动杯子接球！别掉下去！', tr: 'Kupayı hareket ettir topu yakala! Düşürme!' }));
    },

    onPointerDown: function (ctx, p) {
      moveKen(p);
    },

    onPointerMove: function (ctx, p) {
      moveKen(p);
    },

    update: function (ctx, dt) {
      // 下端の警告帯を薄く明滅させる
      warnDom.style.opacity = 0.55 + 0.35 * Math.sin(ctx.elapsed * 3);

      // ---- 重力ランダム切替（1秒前に矢印で予告 → 切替） ----
      switchTimer -= dt;
      if (!warned && switchTimer <= WARN_LEAD) {
        warned = true;
        rollGravity();
        showArrow(nextGx, nextGy);
        ctx.sfx.tap();
      }
      if (warned) {
        // 予告中は矢印を点滅
        arrowDom.style.opacity = 0.45 + 0.55 * Math.abs(Math.sin(ctx.elapsed * 12));
      }
      if (switchTimer <= 0) {
        gx = nextGx; gy = nextGy;
        switchTimer = switchInterval();
        warned = false;
        arrowDom.style.display = 'none';
        ctx.sfx.bounce();
        ctx.vibrate(25);
      }

      // 現在の重力を適用（方向も強さも変わる）
      ballVx += gx * dt;
      ballVy += gy * dt;

      // 位置更新
      ballX += ballVx * dt;
      ballY += ballVy * dt;

      // 壁バウンス（上・左・右のみ。下は落下＝失敗）
      if (ballX < -ROOM_W + BALL_R) { ballX = -ROOM_W + BALL_R; ballVx = Math.abs(ballVx) * 0.8; ctx.sfx.bounce(); }
      if (ballX >  ROOM_W - BALL_R) { ballX =  ROOM_W - BALL_R; ballVx = -Math.abs(ballVx) * 0.8; ctx.sfx.bounce(); }
      if (ballY >  ROOM_H - BALL_R) { ballY =  ROOM_H - BALL_R; ballVy = -Math.abs(ballVy) * 0.8; ctx.sfx.bounce(); }

      // 下へ落ちた → 終了
      if (ballY < -ROOM_H - BALL_R) {
        warnDom.style.display = 'none';
        ctx.sfx.fail();
        ctx.vibrate(80);
        ctx.setHint(ctx.t({ en: 'Dropped it!', ja: 'おっこどした…！', es: '¡Se cayó!', 'pt-BR': 'Deixou cair!', fr: 'Tombé !', de: 'Fallen gelassen!', it: 'Caduta!', ko: '떨어뜨렸어!', 'zh-Hans': '掉球了！', tr: 'Düşürdün!' }));
        ctx.gameOver(catchCount);
        return;
      }

      // 残像更新（1フレーム前の位置をずらして記録）
      for (var ti = trailMeshes.length - 1; ti > 0; ti--) {
        trailMeshes[ti].position.copy(trailMeshes[ti - 1].position);
        trailMeshes[ti].visible = true;
      }
      trailMeshes[0].position.set(ballX, ballY, ballZ);
      trailMeshes[0].visible = true;

      ballMesh.position.set(ballX, ballY, ballZ);
      ballMesh.rotation.y += dt * 2;

      // キャッチ判定（重力が横向きでも成立するよう「皿へ向かって動いている」ことを見る）
      var cdx = ballX - kenX;
      var cdy = ballY - kenY;
      var cdist = Math.sqrt(cdx * cdx + cdy * cdy);
      var approaching = (ballVx * -cdx + ballVy * -cdy) > 0;
      if (cdist < CATCH_DIST && approaching) {
        catchCount++;
        ctx.setScore(catchCount);
        ctx.sfx.score();
        ctx.vibrate(20);

        // 玉を「現在の重力の逆方向」へ弾き返す（横重力なら横へ打ち上がる）
        var gmag = Math.sqrt(gx * gx + gy * gy) || 1;
        var up = 6.5 + catchCount * 0.18;
        ballVx = (-gx / gmag) * up + (Math.random() * 2 - 1) * (1.2 + catchCount * 0.1);
        ballVy = (-gy / gmag) * up;
        ballX = kenX + (-gx / gmag) * 0.5;
        ballY = kenY + (-gy / gmag) * 0.5;
        ctx.setHint('');
      }
    }
  });
})();
