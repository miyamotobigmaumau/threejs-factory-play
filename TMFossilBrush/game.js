/* =========================================================================
 * TMFossilBrush — 立体3Dブロックくずし（id はランチャー互換のため据え置き）
 * ルール: パドルでボールをはね返し、奥のブロック壁をぜんぶ壊す
 * 操作: ドラッグでパドル左右移動。タップ/指を離すと発射
 * 物理: XZ平面の2.5D反射（壁・パドル・ブロック）。パドルの当たり位置で角度変化
 * スコア: 壊したブロック数（こ）。全消しで次の面（段+1・速度微増）
 * 失敗: ボールがパドルの下へ落ちると残機-1（残機3、❤で常時表示）
 * ========================================================================= */
(function () {
  'use strict';

  /* ---- 定数 ---- */
  var PLAY_W       = 8.0;                 // プレイ幅（ワールド単位）
  var HALF_W       = PLAY_W / 2;          // 半幅
  var BACK_Z       = -9.0;                // 奥の壁
  var PADDLE_Z     = 3.2;                 // パドルの奥行き位置
  var LOSE_Z       = 5.2;                 // ここを超えたら落球
  var PADDLE_W     = 2.4;                 // パドル幅
  var PADDLE_H     = 0.5;
  var PADDLE_D     = 0.6;
  var BALL_R       = 0.28;                // ボール半径
  var BALL_Y       = 0.34;                // ボール高さ（床上）
  var BALL_SPEED0  = 8.0;                 // 初期ボール速度
  var SPEED_UP     = 0.07;                // 面ごとの速度増加率
  var MAX_BOUNCE_ANGLE = Math.PI / 3;     // パドル端での反射角（60°）
  var COLS         = 6;                   // ブロック列数
  var ROWS0        = 4;                   // 初期段数
  var ROWS_MAX     = 7;                   // 最大段数
  var BLOCK_GAP    = 0.12;                // ブロック間隔
  var BLOCK_W      = (PLAY_W - BLOCK_GAP * (COLS + 1)) / COLS;
  var BLOCK_H      = 0.6;
  var BLOCK_D      = 0.72;
  var BLOCK_TOP_Z  = -8.2;                // 最奥段の中心 z
  var LIVES_MAX    = 3;                   // 残機
  var DEBRIS_POOL  = 30;                  // 破片プール数
  var DEBRIS_PER_HIT = 6;                 // 1ブロックで飛ぶ破片数
  var TRAIL_POOL   = 14;                  // トレイルプール数
  var TRAIL_INTERVAL = 0.028;             // トレイル発生間隔(秒)
  var TAP_DRAG_PX  = 14;                  // これ未満のドラッグはタップ扱い
  // 行ごとの鮮やかなレインボー配色（濃紺コート上で視認性最優先。パステル不可）
  // ※シェル照明(ambient+dir≈1.35倍)で白側に飛ぶため、2〜3割暗めに設定
  var BLOCK_ROW_COLORS = [0xa62626, 0xbf6a1f, 0xbf9c17, 0x2f8c36, 0x2273a8, 0x7038a3, 0xba4374];

  /* ---- 多言語ヒント ---- */
  var HINT_LAUNCH = {
    en: 'Drag to move / Tap to launch!', ja: 'ドラッグでうごかす／タップで発射！',
    es: '¡Arrastra para mover / Toca para lanzar!', 'pt-BR': 'Arraste para mover / Toque para lançar!',
    fr: 'Glissez pour bouger / Touchez pour lancer !', de: 'Ziehen zum Bewegen / Tippen zum Start!',
    it: 'Trascina per muovere / Tocca per lanciare!', ko: '드래그로 이동 / 탭으로 발사!',
    'zh-Hans': '拖动移动 / 点击发射！', tr: 'Sürükleyerek oynat / Dokunarak fırlat!'
  };
  var HINT_LEVEL = {
    en: 'Level up!', ja: 'つぎの めん！', es: '¡Nivel superado!', 'pt-BR': 'Próximo nível!',
    fr: 'Niveau suivant !', de: 'Nächstes Level!', it: 'Livello successivo!',
    ko: '다음 레벨!', 'zh-Hans': '下一关！', tr: 'Sonraki seviye!'
  };

  /* ---- モジュール変数 ---- */
  var paddle, paddleShadow;               // パドルと接地影
  var ball, ballShadow;                   // ボールと接地影
  var ballVel;                            // ボール速度 (THREE.Vector3, yは常に0)
  var ballSpeed = BALL_SPEED0;            // 現在のボール速度
  var waiting = true;                     // 発射待ち（ボールがパドル上）
  var level = 1;                          // 現在の面
  var lives = LIVES_MAX;                  // 残機
  var over = false;                       // 終了フラグ
  var blocks = [];                        // ブロックプール {mesh, mat, alive, x, z, color}
  var blocksAlive = 0;                    // 生存ブロック数
  var debris = [];                        // 破片プール {mesh, mat, vel, spin, t, active}
  var debrisCursor = 0;                   // 破片プールのラウンドロビン位置
  var trail = [];                         // トレイルプール {mesh, t, active}
  var trailCursor = 0;
  var trailTimer = 0;
  var paddleBump = 0;                     // パドルヒット時のぷに演出 (1→0)
  var dragPx = 0;                         // Down からの累計ドラッグ量(px)
  var heartsDom = null, heartIcons = [];  // 残機❤表示（DOM）
  var _v = null;                          // 一時ベクトル

  /* ---- 残機❤UI（DOM） ---- */
  function buildHearts() {
    heartsDom = document.createElement('div');
    heartsDom.style.cssText = [
      'position:fixed;top:14px;right:14px;display:flex;gap:4px;',
      'z-index:11;pointer-events:none;font-size:22px;',
      'filter:drop-shadow(0 1px 2px rgba(0,0,0,0.35));'
    ].join('');
    heartIcons = [];
    for (var i = 0; i < LIVES_MAX; i++) {
      var s = document.createElement('span');
      s.textContent = '❤';
      s.style.transition = 'opacity 0.25s, transform 0.25s';
      heartsDom.appendChild(s);
      heartIcons.push(s);
    }
    heartsDom.style.display = 'none';
    document.body.appendChild(heartsDom);
  }
  function updateHearts() {
    for (var i = 0; i < heartIcons.length; i++) {
      var lost = i >= lives;
      heartIcons[i].style.opacity = lost ? '0.18' : '1';
      heartIcons[i].style.transform = lost ? 'scale(0.7)' : 'scale(1)';
    }
  }

  /* ---- ブロックのレイアウト（面ごと・メッシュはプール再利用） ---- */
  function layoutBlocks(rows) {
    var idx = 0;
    blocksAlive = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < COLS; c++) {
        var b = blocks[idx++];
        var x = -HALF_W + BLOCK_GAP + BLOCK_W / 2 + c * (BLOCK_W + BLOCK_GAP);
        var z = BLOCK_TOP_Z + r * (BLOCK_D + BLOCK_GAP);
        b.x = x; b.z = z;
        b.color = BLOCK_ROW_COLORS[r % BLOCK_ROW_COLORS.length];
        b.mat.color.setHex(b.color);
        b.mesh.position.set(x, BLOCK_H / 2 + 0.02, z);
        b.mesh.scale.set(1, 1, 1);
        b.mesh.visible = true;
        b.alive = true;
        blocksAlive++;
      }
    }
    // 余りのプールは隠す
    for (; idx < blocks.length; idx++) {
      blocks[idx].alive = false;
      blocks[idx].mesh.visible = false;
    }
  }

  /* ---- ボールをパドルに乗せて発射待ちへ ---- */
  function resetBallOnPaddle() {
    waiting = true;
    ballVel.set(0, 0, 0);
    ball.position.set(paddle.position.x, BALL_Y, PADDLE_Z - PADDLE_D / 2 - BALL_R - 0.06);
  }

  /* ---- 発射 ---- */
  function launchBall(ctx) {
    if (!waiting) return;
    waiting = false;
    var a = (ctx.random() - 0.5) * 0.5; // わずかにランダムな角度
    ballVel.set(Math.sin(a) * ballSpeed, 0, -Math.cos(a) * ballSpeed);
    ctx.sfx.tap();
    ctx.setHint('');
  }

  /* ---- 破片バースト（プール・ラウンドロビン） ---- */
  function spawnDebris(x, z, color, rnd) {
    for (var i = 0; i < DEBRIS_PER_HIT; i++) {
      var d = debris[debrisCursor];
      debrisCursor = (debrisCursor + 1) % debris.length;
      d.active = true;
      d.t = 0;
      d.mat.color.setHex(color);
      d.mat.opacity = 1;
      d.mesh.position.set(x, BLOCK_H / 2, z);
      d.mesh.scale.set(1, 1, 1);
      d.mesh.visible = true;
      var ang = (i / DEBRIS_PER_HIT) * Math.PI * 2 + rnd() * 0.8;
      var sp = 2.2 + rnd() * 2.2;
      d.vel.set(Math.cos(ang) * sp, 3.2 + rnd() * 2.6, Math.sin(ang) * sp);
      d.spin = 4 + rnd() * 8;
    }
  }

  /* ---- トレイル1粒を置く（プール） ---- */
  function spawnTrail() {
    var t = trail[trailCursor];
    trailCursor = (trailCursor + 1) % trail.length;
    t.active = true;
    t.t = 0;
    t.mesh.position.copy(ball.position);
    t.mesh.scale.setScalar(1);
    t.mesh.material.opacity = 0.4;
    t.mesh.visible = true;
  }

  /* ---- 面クリア → 次の面 ---- */
  function nextLevel(ctx) {
    level++;
    ballSpeed = BALL_SPEED0 * (1 + SPEED_UP * (level - 1));
    var rows = Math.min(ROWS0 + (level - 1), ROWS_MAX);
    layoutBlocks(rows);
    resetBallOnPaddle();
    ctx.sfx.success();
    ctx.vibrate(40);
    ctx.setHint(ctx.t(HINT_LEVEL));
  }

  /* ---- 落球 ---- */
  function loseLife(ctx) {
    lives--;
    updateHearts();
    ctx.sfx.fail();
    ctx.vibrate(60);
    if (lives <= 0) {
      over = true;
      heartsDom.style.display = 'none';
      ctx.gameOver(ctx.score);
      return;
    }
    resetBallOnPaddle();
    ctx.setHint(ctx.t(HINT_LAUNCH));
  }

  /* ---- ゲーム登録 ---- */
  Shell.registerGame({
    id: 'TMFossilBrush',
    title: {
      en: 'Brick Breaker 3D', ja: 'ブロックくずし', es: 'Rompebloques 3D', 'pt-BR': 'Quebra-Blocos 3D',
      fr: 'Casse-Briques 3D', de: 'Blöcke Brecher 3D', it: 'Spaccamattoni 3D',
      ko: '벽돌깨기 3D', 'zh-Hans': '3D打砖块', tr: 'Tuğla Kırma 3D'
    },
    howto: {
      en: 'Bounce the ball with the paddle\nand smash all the bricks!',
      ja: 'パドルでボールをはね返して\nブロックをこわそう！',
      es: '¡Rebota la pelota con la paleta\ny rompe todos los bloques!',
      'pt-BR': 'Rebata a bola com a raquete\ne quebre todos os blocos!',
      fr: 'Renvoyez la balle avec la raquette\net cassez toutes les briques !',
      de: 'Lass den Ball abprallen\nund zerbrich alle Blöcke!',
      it: 'Fai rimbalzare la palla\ne rompi tutti i mattoni!',
      ko: '패들로 공을 튕겨서\n벽돌을 모두 부숴라!',
      'zh-Hans': '用挡板反弹小球\n击碎所有砖块！',
      tr: 'Topu raketle sektir\nve tüm tuğlaları kır!'
    },
    scoreLabel: {
      en: 'blocks', ja: 'こ', es: 'bloques', 'pt-BR': 'blocos', fr: 'blocs',
      de: 'Steine', it: 'blocchi', ko: '개', 'zh-Hans': '块', tr: 'blok'
    },
    bg: 0xdfeffa,
    cameraFov: 55,
    cameraPos: [0, 9.0, 9.5],
    cameraLookAt: [0, 0.3, -2.5],
    fitWidth: PLAY_W + 2.2,   // レール込みのプレイ幅が縦画面に必ず収まる
    allowContinue: false,

    /* ---- 初期化（シーン構築・1回のみ） ---- */
    init: function (ctx) {
      var THREE = ctx.THREE;
      _v = new THREE.Vector3();

      // 柔らか照明（共通アートディレクション）
      Style.lights(ctx.scene);

      // 床（外周は明るいクリーム）
      var floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 44), Style.mat(0xf4ecd9));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(0, 0, -3);
      ctx.scene.add(floor);

      // プレイコート（濃紺。鮮やかなブロック/パドル/白ボールが際立つ）
      var matArea = new THREE.Mesh(new THREE.PlaneGeometry(PLAY_W + 0.6, 16),
        new THREE.MeshLambertMaterial({ color: 0x1e2a52 }));
      matArea.rotation.x = -Math.PI / 2;
      matArea.position.set(0, 0.01, -2.2);
      ctx.scene.add(matArea);
      // コートのセンターライン（うっすら）
      var midLine = new THREE.Mesh(new THREE.PlaneGeometry(PLAY_W + 0.6, 0.08),
        new THREE.MeshBasicMaterial({ color: 0x3d4f8a }));
      midLine.rotation.x = -Math.PI / 2;
      midLine.position.set(0, 0.015, -2.2);
      ctx.scene.add(midLine);

      // サイドレール（左右の壁・パステル）
      var railGeo = Style.roundedBox(0.5, 0.8, 15.6, 0.18);
      var railL = new THREE.Mesh(railGeo, Style.mat(Style.palette.aqua));
      railL.position.set(-HALF_W - 0.25, 0.4, -2.4);
      ctx.scene.add(railL);
      var railR = new THREE.Mesh(railGeo, Style.mat(Style.palette.aqua));
      railR.position.set(HALF_W + 0.25, 0.4, -2.4);
      ctx.scene.add(railR);

      // 奥の壁
      var backWall = new THREE.Mesh(Style.roundedBox(PLAY_W + 1.0, 0.9, 0.5, 0.18),
        Style.mat(Style.palette.wisteria));
      backWall.position.set(0, 0.45, BACK_Z - 0.35);
      ctx.scene.add(backWall);

      // パドル（鮮やかな赤・白いエッジで濃紺コートに映える）
      paddle = new THREE.Mesh(Style.roundedBox(PADDLE_W, PADDLE_H, PADDLE_D, 0.2),
        Style.mat(0xa62a2a));
      var paddleStripe = new THREE.Mesh(Style.roundedBox(PADDLE_W * 0.94, PADDLE_H * 0.3, PADDLE_D * 0.3, 0.06),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      paddleStripe.position.set(0, PADDLE_H * 0.2, -PADDLE_D * 0.36);
      paddle.add(paddleStripe);
      paddle.position.set(0, PADDLE_H / 2 + 0.02, PADDLE_Z);
      ctx.scene.add(paddle);
      paddleShadow = Style.softShadow(PADDLE_W * 0.72);
      paddleShadow.position.set(0, 0.012, PADDLE_Z);
      ctx.scene.add(paddleShadow);

      // ボール（白・ほんのり発光で視認性UP）
      ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 16),
        Style.mat(0xffffff, { emissive: 0x554433, roughness: 0.6 }));
      ball.position.set(0, BALL_Y, PADDLE_Z - 1);
      ctx.scene.add(ball);
      ballVel = new THREE.Vector3();
      ballShadow = Style.softShadow(BALL_R * 1.7);
      ballShadow.position.set(0, 0.013, PADDLE_Z - 1);
      ctx.scene.add(ballShadow);

      // ブロックプール（最大 COLS × ROWS_MAX、ジオメトリ共有）
      var blockGeo = Style.roundedBox(BLOCK_W, BLOCK_H, BLOCK_D, 0.14);
      for (var i = 0; i < COLS * ROWS_MAX; i++) {
        var m = Style.mat(0xffffff);
        var mesh = new THREE.Mesh(blockGeo, m);
        mesh.visible = false;
        ctx.scene.add(mesh);
        blocks.push({ mesh: mesh, mat: m, alive: false, x: 0, z: 0, color: 0xffffff });
      }

      // 破片プール（小さな角丸片・色は都度差し替え）
      var debGeo = Style.roundedBox(0.22, 0.18, 0.22, 0.06, 2);
      for (var d = 0; d < DEBRIS_POOL; d++) {
        var dm = Style.mat(0xffffff, { transparent: true });
        var dmesh = new THREE.Mesh(debGeo, dm);
        dmesh.visible = false;
        ctx.scene.add(dmesh);
        debris.push({ mesh: dmesh, mat: dm, vel: new THREE.Vector3(), spin: 0, t: 0, active: false });
      }

      // トレイルプール（半透明の残像球）
      var trailGeo = new THREE.SphereGeometry(BALL_R * 0.8, 10, 8);
      for (var t = 0; t < TRAIL_POOL; t++) {
        var tm = new THREE.MeshBasicMaterial({
          color: 0xfff2c8, transparent: true, opacity: 0, depthWrite: false
        });
        var tmesh = new THREE.Mesh(trailGeo, tm);
        tmesh.visible = false;
        ctx.scene.add(tmesh);
        trail.push({ mesh: tmesh, t: 0, active: false });
      }

      // 残機UI
      buildHearts();
    },

    /* ---- プレイ開始（リセット・毎回） ---- */
    start: function (ctx) {
      level = 1;
      lives = LIVES_MAX;
      over = false;
      ballSpeed = BALL_SPEED0;
      paddleBump = 0;
      trailTimer = 0;
      dragPx = 0;

      paddle.position.x = 0;
      layoutBlocks(ROWS0);
      resetBallOnPaddle();

      // 破片・トレイルを全回収
      for (var i = 0; i < debris.length; i++) { debris[i].active = false; debris[i].mesh.visible = false; }
      for (var t = 0; t < trail.length; t++) { trail[t].active = false; trail[t].mesh.visible = false; }

      heartsDom.style.display = 'flex';
      updateHearts();
      ctx.setHint(ctx.t(HINT_LAUNCH));
    },

    /* ---- 入力: Down はドラッグ量の計測開始 ---- */
    onPointerDown: function (ctx, p) {
      if (over) return;
      dragPx = 0;
    },

    /* ---- 入力: ドラッグでパドル左右移動（nx: -1..1） ---- */
    onPointerMove: function (ctx, p) {
      if (over) return;
      dragPx += Math.abs(p.dx) + Math.abs(p.dy);
      var maxX = HALF_W - PADDLE_W / 2;
      var x = p.nx * HALF_W * 1.15; // 指の移動よりやや大きく動かして端まで届かせる
      if (x < -maxX) x = -maxX;
      if (x > maxX) x = maxX;
      paddle.position.x = x;
      if (waiting) ball.position.x = x; // 発射前はボールも一緒に
    },

    /* ---- 入力: タップ（ほぼ動かさず離す）で発射 ---- */
    onPointerUp: function (ctx, p) {
      if (over) return;
      if (waiting && dragPx < TAP_DRAG_PX) launchBall(ctx);
    },

    /* ---- 毎フレーム更新 ---- */
    update: function (ctx, dt) {
      if (over) return;

      // パドルのぷに演出と接地影
      if (paddleBump > 0) {
        paddleBump = Math.max(0, paddleBump - dt * 5);
        paddle.scale.set(1 + paddleBump * 0.18, 1 - paddleBump * 0.22, 1 + paddleBump * 0.18);
      }
      paddleShadow.position.x = paddle.position.x;

      // 破片更新（重力・回転・フェード）
      for (var di = 0; di < debris.length; di++) {
        var d = debris[di];
        if (!d.active) continue;
        d.t += dt;
        d.vel.y -= 12 * dt;
        d.mesh.position.addScaledVector(d.vel, dt);
        d.mesh.rotation.x += d.spin * dt;
        d.mesh.rotation.z += d.spin * 0.7 * dt;
        var k = 1 - d.t / 0.7;
        if (k <= 0 || d.mesh.position.y < 0.05) {
          d.active = false; d.mesh.visible = false;
        } else {
          d.mat.opacity = k;
          d.mesh.scale.setScalar(0.4 + k * 0.6);
        }
      }

      // トレイル更新（フェード＆縮小）
      for (var ti = 0; ti < trail.length; ti++) {
        var tr = trail[ti];
        if (!tr.active) continue;
        tr.t += dt;
        var tk = 1 - tr.t / 0.35;
        if (tk <= 0) { tr.active = false; tr.mesh.visible = false; }
        else {
          tr.mesh.material.opacity = tk * 0.4;
          tr.mesh.scale.setScalar(Math.max(0.05, tk));
        }
      }

      if (waiting) {
        // 発射待ち: パドルの上でふわふわ
        ball.position.z = PADDLE_Z - PADDLE_D / 2 - BALL_R - 0.06;
        ball.position.y = BALL_Y + Math.sin(ctx.elapsed * 4) * 0.05;
        ballShadow.position.set(ball.position.x, 0.013, ball.position.z);
        return;
      }

      // ボール移動（XZ平面の2.5D）
      ball.position.addScaledVector(ballVel, dt);
      ball.rotation.x += ballVel.z * dt * 2;
      ball.rotation.z -= ballVel.x * dt * 2;

      // トレイル発生
      trailTimer += dt;
      if (trailTimer >= TRAIL_INTERVAL) {
        trailTimer = 0;
        spawnTrail();
      }

      // 左右の壁で反射
      var limX = HALF_W - BALL_R;
      if (ball.position.x < -limX) { ball.position.x = -limX; ballVel.x = Math.abs(ballVel.x); ctx.sfx.bounce(); }
      else if (ball.position.x > limX) { ball.position.x = limX; ballVel.x = -Math.abs(ballVel.x); ctx.sfx.bounce(); }

      // 奥の壁で反射
      if (ball.position.z < BACK_Z + BALL_R) {
        ball.position.z = BACK_Z + BALL_R;
        ballVel.z = Math.abs(ballVel.z);
        ctx.sfx.bounce();
      }

      // パドルで反射（当たった位置で角度が変わる・端ほど鋭角）
      if (ballVel.z > 0 &&
          ball.position.z + BALL_R >= PADDLE_Z - PADDLE_D / 2 &&
          ball.position.z < PADDLE_Z + PADDLE_D / 2) {
        var off = (ball.position.x - paddle.position.x) / (PADDLE_W / 2 + BALL_R);
        if (off >= -1 && off <= 1) {
          var ang = off * MAX_BOUNCE_ANGLE;
          ballVel.set(Math.sin(ang) * ballSpeed, 0, -Math.cos(ang) * ballSpeed);
          ball.position.z = PADDLE_Z - PADDLE_D / 2 - BALL_R;
          paddleBump = 1;
          ctx.sfx.bounce();
          ctx.vibrate(15);
        }
      }

      // ブロック衝突（円 vs AABB・1フレーム1個）
      for (var bi = 0; bi < blocks.length; bi++) {
        var b = blocks[bi];
        if (!b.alive) continue;
        var cx = ball.position.x - b.x;
        var cz = ball.position.z - b.z;
        var hw = BLOCK_W / 2, hd = BLOCK_D / 2;
        var nx2 = Math.max(-hw, Math.min(hw, cx));
        var nz2 = Math.max(-hd, Math.min(hd, cz));
        var ddx = cx - nx2, ddz = cz - nz2;
        if (ddx * ddx + ddz * ddz <= BALL_R * BALL_R) {
          // 反射軸: めり込みの浅い側を弾く
          var overX = hw + BALL_R - Math.abs(cx);
          var overZ = hd + BALL_R - Math.abs(cz);
          if (overX < overZ) ballVel.x = cx > 0 ? Math.abs(ballVel.x) : -Math.abs(ballVel.x);
          else ballVel.z = cz > 0 ? Math.abs(ballVel.z) : -Math.abs(ballVel.z);

          // ブロック破壊
          b.alive = false;
          b.mesh.visible = false;
          blocksAlive--;
          ctx.addScore(1);
          ctx.sfx.score();
          ctx.vibrate(20);
          spawnDebris(b.x, b.z, b.color, ctx.random);

          // 全消しで次の面
          if (blocksAlive <= 0) nextLevel(ctx);
          break;
        }
      }

      // 落球判定
      if (ball.position.z > LOSE_Z) {
        loseLife(ctx);
        return;
      }

      // ボールの接地影
      ballShadow.position.set(ball.position.x, 0.013, ball.position.z);
    }
  });
})();
