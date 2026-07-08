/* =========================================================================
 * TMSpaceTamaire — うちゅうたまいれ
 * ルール: 無重力空間、正面でスイングする「輪っか（ゴールリング）」に
 *   ボールを通せ。網は無し・穴をくぐらせるだけの分かりやすいルール。
 * 操作: スワイプで投げる（重力なし・直進）
 * スコア: 通した玉数（こ）
 * ========================================================================= */
(function () {
  'use strict';

  // ─── 定数 ───────────────────────────────────────────────────────────────
  var TOTAL_BALLS    = 20;    // 全投球数
  var BALL_POOL_SIZE = 5;     // 玉プール数
  var BALL_RADIUS    = 0.25;  // 玉の半径
  var BASKET_ORBIT_R = 5.0;   // （旧・未使用）
  var BASKET_SPEED_0 = 0.7;   // 輪っかの初期スイング速度 (rad/s)
  var BASKET_SPEED_D = 0.03;  // スコアごとの速度増加量（ゆるめ）
  var RING_Z         = -6.5;  // 輪っかの奥行き位置（正面）
  var BALL_SPEED     = 13.0;  // 玉の飛翔速度
  var HIT_RADIUS     = 1.2;   // 輪をくぐった判定半径（輪の見た目≈1.2に一致）
  var MAX_DIST       = 40.0;  // 玉がこれを超えたら回収
  var STAR_POOL_SIZE = 12;    // 命中バーストの星パーティクル数

  // ─── モジュール変数 ──────────────────────────────────────────────────────
  var basketMesh;             // カゴ（Torus）
  var earthMesh;              // 地球デコレーション
  var ballPool = [];          // 玉プール（{mesh, active, vel}）
  var orbitAngle = 0;         // カゴの現在角度
  var orbitSpeed = BASKET_SPEED_0; // 現在の軌道角速度

  var ballsLeft = TOTAL_BALLS;    // 残り投球数
  var score = 0;                  // スコア
  var gameOver = false;           // 終了フラグ

  // スワイプ用
  var swipeStart = null;  // {x, y, t}

  // GC削減用 一時ベクトル（毎フレーム再利用）
  var _tmpVec3A, _tmpVec3B, _tmpVec3C;

  // 弾倉UI（紅白玉アイコン列・DOM）
  var ammoDom, ammoIcons = [];

  // 命中エフェクト
  var flashT = 0;             // 輪フラッシュ残時間 (1→0)
  var flashDisc, innerRing;   // 輪のフラッシュ対象メッシュ
  var starPool = [];          // 星形パーティクル（プール）

  // ─── 玉テクスチャ生成（紅白玉）────────────────────────────────────────────
  function makeBallTexture(THREE) {
    var size = 64;
    var canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    var ctx2d = canvas.getContext('2d');
    // 白ベース
    ctx2d.fillStyle = '#ffffff';
    ctx2d.fillRect(0, 0, size, size);
    // 赤の半分
    ctx2d.fillStyle = '#e81c1c';
    ctx2d.fillRect(0, 0, size / 2, size);
    // 境界線
    ctx2d.strokeStyle = '#cccccc';
    ctx2d.lineWidth = 2;
    ctx2d.strokeRect(0, 0, size, size);
    var tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  // ─── 星フィールド生成（小さな白い球を散布）────────────────────────────────
  function makeStars(THREE, scene) {
    var starGeo = new THREE.SphereGeometry(0.08, 4, 4);
    var starMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (var i = 0; i < 120; i++) {
      var star = new THREE.Mesh(starGeo, starMat);
      // カメラから離れた位置にランダム配置（半径 30〜60 の球殻）
      var theta = Math.random() * Math.PI * 2;
      var phi   = Math.acos(2 * Math.random() - 1);
      var r     = 30 + Math.random() * 30;
      star.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
      scene.add(star);
    }
  }

  // ─── ゴールリング生成（網なし・くぐらせる輪っか） ──────────────────────
  function makeBasket(THREE) {
    var g = new THREE.Group();
    // 太めの輪っか（ゴールポスト風・明るいオレンジ）
    var ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.16, 10, 28),
      new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0x7a2f00, roughness: 0.5 }));
    g.add(ring);
    // 内側の光る縁（穴を強調＝ここを通す）
    var inner = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.05, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0xffe27a }));
    g.add(inner);
    // うっすら光る面（狙う面を分かりやすく）
    var disc = new THREE.Mesh(new THREE.CircleGeometry(1.18, 28),
      new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
    g.add(disc);
    return g;
  }

  // ─── 地球（デコレーション）生成 ──────────────────────────────────────────
  function makeEarth(THREE) {
    var geo = new THREE.SphereGeometry(8, 24, 24);
    // 海と陸のツートーン感をCanvasTextureで表現
    var size = 256;
    var canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    var c = canvas.getContext('2d');
    // 海（青）
    c.fillStyle = '#1a6bbf';
    c.fillRect(0, 0, size, size);
    // 大陸風のランダム緑ブロック
    c.fillStyle = '#2e8b2e';
    var regions = [
      [20, 60, 80, 60], [130, 40, 70, 80], [60, 140, 60, 50],
      [170, 130, 50, 60], [30, 170, 90, 40], [120, 180, 80, 50]
    ];
    for (var i = 0; i < regions.length; i++) {
      c.fillRect(regions[i][0], regions[i][1], regions[i][2], regions[i][3]);
    }
    // 雲（白半透明）
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.fillRect(0, 30, size, 20);
    c.fillRect(0, 130, size, 15);
    var tex = new THREE.CanvasTexture(canvas);
    var mat = new THREE.MeshLambertMaterial({ map: tex });
    return new THREE.Mesh(geo, mat);
  }

  // ─── 玉プール生成 ─────────────────────────────────────────────────────────
  function makeBallPool(THREE, scene) {
    var tex = makeBallTexture(THREE);
    var geo = new THREE.SphereGeometry(BALL_RADIUS, 12, 12);
    var pool = [];
    for (var i = 0; i < BALL_POOL_SIZE; i++) {
      var mat  = new THREE.MeshLambertMaterial({ map: tex });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      pool.push({
        mesh: mesh,
        active: false,
        vel: new THREE.Vector3()  // 速度ベクトル（プリアロケート）
      });
    }
    return pool;
  }

  // ─── 弾倉UI（紅白玉アイコン列）生成/更新 ──────────────────────────────────
  function buildAmmoDom() {
    ammoDom = document.createElement('div');
    ammoDom.style.cssText = [
      'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);',
      'display:flex;gap:3px;z-index:11;pointer-events:none;'
    ].join('');
    ammoIcons = [];
    for (var i = 0; i < TOTAL_BALLS; i++) {
      var d = document.createElement('div');
      d.style.cssText = [
        'width:12px;height:12px;border-radius:50%;',
        'background:linear-gradient(90deg,#e81c1c 50%,#ffffff 50%);',
        'box-shadow:0 1px 2px rgba(0,0,0,0.5);',
        'transition:opacity 0.2s,transform 0.2s;'
      ].join('');
      ammoDom.appendChild(d);
      ammoIcons.push(d);
    }
    document.body.appendChild(ammoDom);
  }

  function updateAmmoDom() {
    for (var i = 0; i < ammoIcons.length; i++) {
      var used = i >= ballsLeft;
      ammoIcons[i].style.opacity = used ? '0.12' : '1';
      ammoIcons[i].style.transform = used ? 'scale(0.55)' : 'scale(1)';
    }
  }

  // ─── 星形パーティクルプール生成 ────────────────────────────────────────────
  function makeStarPool(THREE, scene) {
    var shape = new THREE.Shape();
    for (var i = 0; i < 10; i++) {
      var a = i / 10 * Math.PI * 2 - Math.PI / 2;
      var r = (i % 2 === 0) ? 0.24 : 0.1;
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    var geo = new THREE.ShapeGeometry(shape);
    for (var p = 0; p < STAR_POOL_SIZE; p++) {
      var mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffe27a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
      }));
      mesh.visible = false;
      scene.add(mesh);
      starPool.push({ mesh: mesh, vel: new THREE.Vector3(), t: 0, active: false });
    }
  }

  // ─── 星形バーストを発生（プール再利用） ──────────────────────────────────
  function spawnStarBurst(pos) {
    for (var i = 0; i < starPool.length; i++) {
      var s = starPool[i];
      s.active = true;
      s.t = 0;
      var a = i / starPool.length * Math.PI * 2;
      s.vel.set(Math.cos(a) * (2.5 + Math.random() * 2), Math.sin(a) * (2.5 + Math.random() * 2), 2.0);
      s.mesh.position.copy(pos);
      s.mesh.rotation.z = Math.random() * Math.PI;
      s.mesh.material.opacity = 1;
      s.mesh.visible = true;
    }
  }

  // ─── 空きプールスロット取得 ────────────────────────────────────────────────
  function getFreeSlot() {
    for (var i = 0; i < ballPool.length; i++) {
      if (!ballPool[i].active) return ballPool[i];
    }
    return null;
  }

  // ─── 玉を発射 ─────────────────────────────────────────────────────────────
  // dirWorld: 正規化された世界座標の飛翔方向 (THREE.Vector3)
  // 発射位置はカメラの少し前（0,0,12）
  function launchBall(dirWorld) {
    var slot = getFreeSlot();
    if (!slot) return;
    slot.mesh.position.set(0, 0, 12);
    slot.vel.copy(dirWorld).multiplyScalar(BALL_SPEED);
    slot.active = true;
    slot.mesh.visible = true;
  }

  // ─── スワイプ → 世界座標の発射方向に変換 ───────────────────────────────────
  // p0: {x,y} 開始点, p1: {x,y} 終了点（いずれもピクセル座標）
  // camera: THREE.Camera
  function swipeToWorldDir(p0, p1, camera, THREE) {
    var W = window.innerWidth;
    var H = window.innerHeight;

    // スワイプ変位を正規化デバイス座標の変化量へ（Y軸反転）
    var ndx = (p1.x - p0.x) / W * 2;
    var ndy = -(p1.y - p0.y) / H * 2;

    // スワイプ量が小さければ正面方向
    var len = Math.sqrt(ndx * ndx + ndy * ndy);
    if (len < 0.01) {
      _tmpVec3A.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      return _tmpVec3A;
    }

    // カメラ空間での方向: (ndx, ndy, -1) を正規化
    _tmpVec3A.set(ndx, ndy, -1.0).normalize();
    // 世界空間へ
    _tmpVec3A.applyQuaternion(camera.quaternion);
    _tmpVec3A.normalize();
    return _tmpVec3A;
  }

  // ─── ゲーム登録 ─────────────────────────────────────────────────────────
  Shell.registerGame({
    id: 'TMSpaceTamaire',
    title: { en: 'Space Ring Toss', ja: 'うちゅうたまいれ', es: 'Lanzamiento Espacial', 'pt-BR': 'Arremesso Espacial', fr: 'Lancer Spatial', de: 'Weltraum-Wurf', it: 'Lancio Spaziale', ko: '우주 고리 던지기', 'zh-Hans': '太空投球', tr: 'Uzay Halka Atma' },
    howto: { en: 'Swipe at the moving ring!\nThrow the ball through the hoop!', ja: 'うごく わっかを ねらってスワイプ！\nボールを わっかに 通せ！', es: '¡Desliza hacia el aro en movimiento!\n¡Pasa la pelota por el aro!', 'pt-BR': 'Deslize para o aro em movimento!\nJogue a bola pelo aro!', fr: 'Glissez vers l\'anneau en mouvement !\nPassez la balle dans l\'anneau !', de: 'Wische zum bewegenden Ring!\nWirf den Ball durch den Ring!', it: 'Scorri verso l\'anello in movimento!\nLancia la palla nell\'anello!', ko: '움직이는 고리를 향해 스와이프!\n공을 고리에 통과시켜라!', 'zh-Hans': '滑向移动的圆环！\n将球穿过圆环！', tr: 'Hareket eden halkaya kaydır!\nTopu halkadan geçir!' },
    scoreLabel: { en: 'pts', ja: 'こ', es: 'pts', 'pt-BR': 'pts', fr: 'pts', de: 'Pkt', it: 'pts', ko: '개', 'zh-Hans': '个', tr: 'pts' },
    bg: 0x000022,
    allowContinue: false,

    // ─── 初期化（シーン構築）──────────────────────────────────────────────
    init: function (ctx) {
      var THREE = ctx.THREE;

      // 一時ベクトルをプリアロケート
      _tmpVec3A = new THREE.Vector3();
      _tmpVec3B = new THREE.Vector3();
      _tmpVec3C = new THREE.Vector3();

      // カメラ設定
      ctx.camera.position.set(0, 0, 15);
      ctx.camera.lookAt(0, 0, 0);

      // 環境光・平行光
      var ambient = new THREE.AmbientLight(0x334466, 1.2);
      ctx.scene.add(ambient);
      var sun = new THREE.DirectionalLight(0xffffff, 1.0);
      sun.position.set(5, 8, 10);
      ctx.scene.add(sun);

      // 星フィールド
      makeStars(THREE, ctx.scene);

      // 地球（画面下奥に配置）
      earthMesh = makeEarth(THREE);
      earthMesh.position.set(0, -12, -10);
      ctx.scene.add(earthMesh);

      // カゴ
      basketMesh = makeBasket(THREE);
      ctx.scene.add(basketMesh);
      // フラッシュ対象の参照（内側リング・面ディスク）
      innerRing = basketMesh.children[1];
      flashDisc = basketMesh.children[2];

      // 玉プール
      ballPool = makeBallPool(THREE, ctx.scene);

      // 星形パーティクルプール
      makeStarPool(THREE, ctx.scene);

      // 弾倉UI
      buildAmmoDom();
    },

    // ─── ゲーム開始（リセット）───────────────────────────────────────────
    start: function (ctx) {
      ballsLeft  = TOTAL_BALLS;
      score      = 0;
      gameOver   = false;
      orbitAngle = 0;
      orbitSpeed = BASKET_SPEED_0;
      swipeStart = null;

      // 玉を全部回収
      for (var i = 0; i < ballPool.length; i++) {
        ballPool[i].active = false;
        ballPool[i].mesh.visible = false;
      }

      // 星パーティクル・フラッシュをリセット
      for (var s = 0; s < starPool.length; s++) {
        starPool[s].active = false;
        starPool[s].mesh.visible = false;
      }
      flashT = 0;
      if (flashDisc) flashDisc.material.opacity = 0.14;
      if (innerRing) innerRing.scale.setScalar(1);

      // カメラ位置リセット
      ctx.camera.position.set(0, 0, 15);
      ctx.camera.lookAt(0, 0, 0);

      // 残り玉数は画面下の紅白玉アイコン列で表示（テキスト不要）
      updateAmmoDom();
      ctx.setHint('');
    },

    // ─── タッチ開始：スワイプ開始位置を記録 ──────────────────────────────
    onPointerDown: function (ctx, p) {
      if (gameOver) return;
      swipeStart = { x: p.x, y: p.y, t: performance.now() };
    },

    // ─── タッチ終了：スワイプ方向を計算して玉を発射 ────────────────────
    onPointerUp: function (ctx, p) {
      if (gameOver) return;
      if (!swipeStart) return;
      if (ballsLeft <= 0) return;

      var THREE = ctx.THREE;
      var elapsed = performance.now() - swipeStart.t;
      var dx = p.x - swipeStart.x;
      var dy = p.y - swipeStart.y;
      var dist = Math.sqrt(dx * dx + dy * dy);

      // 5px 以上のスワイプのみ受け付ける
      if (dist > 5) {
        var dir = swipeToWorldDir(swipeStart, p, ctx.camera, THREE);
        launchBall(dir);
        ballsLeft--;
        ctx.sfx.tap();
        updateAmmoDom(); // 弾倉アイコンを1個消す
      }
      swipeStart = null;
    },

    // ─── 毎フレーム更新 ─────────────────────────────────────────────────
    update: function (ctx, dt) {
      if (gameOver) return;

      // 輪っかは正面(奥)で左右＋上下にゆっくりスイング（狙いやすい）
      orbitAngle += orbitSpeed * dt;
      basketMesh.position.set(
        Math.sin(orbitAngle) * 3.2,
        Math.sin(orbitAngle * 0.6) * 1.5,
        RING_Z
      );
      basketMesh.lookAt(ctx.camera.position); // 穴が正面を向く

      // 地球をゆっくり自転
      earthMesh.rotation.y += dt * 0.05;

      // 命中フラッシュ（輪を一瞬光らせる）
      if (flashT > 0) {
        flashT = Math.max(0, flashT - dt * 3);
        flashDisc.material.opacity = 0.14 + flashT * 0.5;
        innerRing.scale.setScalar(1 + flashT * 0.25);
      }

      // 星形パーティクル更新（プール）
      for (var sp = 0; sp < starPool.length; sp++) {
        var sb = starPool[sp];
        if (!sb.active) continue;
        sb.t += dt;
        sb.mesh.position.addScaledVector(sb.vel, dt);
        sb.mesh.rotation.z += dt * 6;
        sb.mesh.material.opacity = Math.max(0, 1 - sb.t / 0.6);
        if (sb.t >= 0.6) { sb.active = false; sb.mesh.visible = false; }
      }

      // 玉の移動・命中・回収処理
      var basketPos = basketMesh.position;
      var activeBalls = 0;

      for (var i = 0; i < ballPool.length; i++) {
        var slot = ballPool[i];
        if (!slot.active) continue;
        activeBalls++;

        // 直進（無重力）
        slot.mesh.position.addScaledVector(slot.vel, dt);

        // 通過判定：輪っかの面(奥z)付近で、輪の中心近くを通ったら成功
        _tmpVec3B.copy(slot.mesh.position).sub(basketPos);
        if (slot.mesh.position.z <= basketPos.z + 0.6 && _tmpVec3B.length() < HIT_RADIUS) {
          // 命中！
          score++;
          ctx.setScore(score);
          ctx.sfx.score();
          ctx.vibrate(30);
          // 命中エフェクト: 輪フラッシュ＋星形バースト
          flashT = 1;
          spawnStarBurst(basketPos);
          // 軌道速度アップ
          orbitSpeed = BASKET_SPEED_0 + score * BASKET_SPEED_D;
          // 玉を回収
          slot.active = false;
          slot.mesh.visible = false;
          activeBalls--;
          continue;
        }

        // 遠くへ飛んだら回収
        if (slot.mesh.position.length() > MAX_DIST) {
          slot.active = false;
          slot.mesh.visible = false;
          activeBalls--;
        }
      }

      // 全投球消費 & 飛翔中の玉なし → 終了
      if (ballsLeft <= 0 && activeBalls <= 0 && !gameOver) {
        gameOver = true;
        ctx.endGame(score);
      }
    }
  });
})();
