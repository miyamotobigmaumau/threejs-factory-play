/* =========================================================================
 * TMMoonMari — つきのまりつき
 * ルール: 月面の低重力（地球の1/6）でまりをつき続けろ。
 *         まりの真下でタップすると突いて跳ね上がる。ずれると横に流れる。
 *         たまに隕石が横切り当たるとまりが弾かれる。
 * 操作: まりの落下点タップ
 * スコア: ついた回数
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------- 定数 ---------- */
  var MOON_G = 9.8 / 6; // 月面重力 ≈ 1.633 m/s²

  /* ---------- メッシュ参照 ---------- */
  var mariMesh;        // まり（手まり）
  var landingRing;     // 着地予測リング
  var earthMesh;       // 背景の地球
  var moonSurface;     // 月面
  var meteorMeshes;    // 隕石プール [3]
  var handGroup;       // うさぎの手（まりを突く打者）
  var missMarker;      // 空振り位置の×リング（赤）
  var missMat;         // ×リング共有マテリアル（透明度操作用）

  /* ---------- タップ→ワールド変換（Raycaster） ---------- */
  var raycaster;       // THREE.Raycaster
  var tapNDC;          // THREE.Vector2（正規化デバイス座標）
  var tapPlane;        // まりの運動平面 z=0
  var tapPoint;        // 交点の受け皿 THREE.Vector3

  /* ---------- 状態変数 ---------- */
  var mariPos;         // {x, y, z}
  var mariVel;         // {x, y, z}
  var bounceCount;
  var hitRadius;
  var gameOver;
  var meteors;         // [{mesh, vx, vy, vz, active, timer}]
  var meteorCooldown;  // 次の隕石起動までの秒数
  var mariScaleTimer;  // ヒット時のスケールパルスタイマー
  var handX;           // 手の現在X（着地予測に追従）
  var handPokeTimer;   // 突き上げアニメの残り秒数
  var handPokeAmp;     // 突き上げの高さ
  var HAND_POKE_DUR = 0.25;
  var HAND_REST_Y = 0.12;
  var missTimer;       // ×リング表示の残り秒数
  var MISS_DUR = 0.5;
  var REACH_Y = 3.2;   // 手の届く高さ。これより高い空中ではタップ無効

  /* =========================================================================
   * 手まりテクスチャ生成（Canvas2D → CanvasTexture）
   * ========================================================================= */
  function makeMariTexture(THREE) {
    var tc = document.createElement('canvas');
    tc.width = 128;
    tc.height = 128;
    var tx = tc.getContext('2d');

    // 暗い下地（深紫）
    tx.fillStyle = '#1a0a2e';
    tx.fillRect(0, 0, 128, 128);

    // 丸い形に沿ったグラデーション（球感）
    var grad = tx.createRadialGradient(45, 40, 5, 64, 64, 70);
    grad.addColorStop(0, 'rgba(200,180,255,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0.55)');
    tx.fillStyle = grad;
    tx.fillRect(0, 0, 128, 128);

    // 横縞・縦縞（手まり柄）
    var colors = ['#ff4466', '#ffcc00', '#44aaff', '#ff8800', '#ffffff'];
    for (var i = 0; i < 5; i++) {
      tx.strokeStyle = colors[i];
      tx.lineWidth = 3.5;
      // 横線
      tx.beginPath();
      tx.moveTo(0, 20 + i * 22);
      tx.lineTo(128, 20 + i * 22);
      tx.stroke();
      // 縦線
      tx.beginPath();
      tx.moveTo(20 + i * 22, 0);
      tx.lineTo(20 + i * 22, 128);
      tx.stroke();
    }

    // 斜め斜線（ジグザグ感）
    tx.strokeStyle = '#ff4466';
    tx.lineWidth = 1.5;
    for (var d = -128; d < 256; d += 18) {
      tx.beginPath();
      tx.moveTo(d, 0);
      tx.lineTo(d + 128, 128);
      tx.stroke();
    }
    tx.strokeStyle = '#ffcc00';
    for (var d2 = -128; d2 < 256; d2 += 18) {
      tx.beginPath();
      tx.moveTo(d2 + 128, 0);
      tx.lineTo(d2, 128);
      tx.stroke();
    }

    return new THREE.CanvasTexture(tc);
  }

  /* =========================================================================
   * 月面クレーターテクスチャ生成
   * ========================================================================= */
  function makeMoonTexture(THREE) {
    var tc = document.createElement('canvas');
    tc.width = 512;
    tc.height = 512;
    var tx = tc.getContext('2d');

    // ベースカラー（灰色）
    tx.fillStyle = '#9a9a9a';
    tx.fillRect(0, 0, 512, 512);

    // クレーター（円）をランダム配置
    var craterColors = ['#888888', '#b0b0b0', '#777777', '#c0c0c0'];
    for (var i = 0; i < 30; i++) {
      var cx = Math.random() * 512;
      var cy = Math.random() * 512;
      var cr = 8 + Math.random() * 40;
      tx.strokeStyle = craterColors[i % craterColors.length];
      tx.lineWidth = 2 + Math.random() * 3;
      tx.beginPath();
      tx.arc(cx, cy, cr, 0, Math.PI * 2);
      tx.stroke();
      // クレーター中心（少し暗め）
      tx.fillStyle = 'rgba(80,80,80,0.3)';
      tx.beginPath();
      tx.arc(cx, cy, cr * 0.6, 0, Math.PI * 2);
      tx.fill();
    }

    return new THREE.CanvasTexture(tc);
  }

  /* =========================================================================
   * 着地予測X座標を計算
   * まりが y=0 に落ちるまでの時間を二次方程式で解く
   * 0 = y + vy*t - 0.5*MOON_G*t²  → t = (vy + sqrt(vy²+2*MOON_G*y)) / MOON_G
   * ========================================================================= */
  function calcLandingX() {
    var vy = mariVel.y;
    var y = mariPos.y;
    if (y <= 0) return mariPos.x;
    var disc = vy * vy + 2 * MOON_G * y;
    if (disc < 0) return mariPos.x;
    var t = (vy + Math.sqrt(disc)) / MOON_G;
    if (t < 0) t = 0;
    var lx = mariPos.x + mariVel.x * t;
    // サイド壁クランプを考慮した簡易補正
    lx = Math.max(-6, Math.min(6, lx));
    return lx;
  }

  /* =========================================================================
   * Shell.registerGame
   * ========================================================================= */
  Shell.registerGame({
    id: 'TMMoonMari',
    title: { en: 'Moon Ball', ja: 'つきのまりつき', es: 'Pelota Lunar', 'pt-BR': 'Bola Lunar', fr: 'Balle Lunaire', de: 'Mondball', it: 'Palla Lunare', ko: '달 공치기', 'zh-Hans': '月球弹球', tr: 'Ay Topu' },
    howto: { en: 'Tap where the ball will land!\nMore precise = higher bounce!', ja: 'まりが落ちてくる場所をタップ！\n正確にうつほど真上へ跳ね上がる！', es: '¡Toca donde caerá la pelota!\n¡Más preciso = más rebote!', 'pt-BR': 'Toque onde a bola vai cair!\nMais preciso = mais alto!', fr: 'Touchez là où la balle tombera !\nPlus précis = plus haut !', de: 'Tippe wo der Ball landet!\nGenauer = höher!', it: 'Tocca dove cadrà la palla!\nPiù preciso = più in alto!', ko: '공이 떨어질 곳을 탭!\n정확할수록 높이 튀어오른다!', 'zh-Hans': '点击球要落的地方！\n越准确弹越高！', tr: 'Topun düşeceği yere dokun!\nDaha isabetli = daha yüksek!' },
    scoreLabel: { en: 'hits', ja: '回', es: 'hits', 'pt-BR': 'toques', fr: 'coups', de: 'Treffer', it: 'colpi', ko: '회', 'zh-Hans': '次', tr: 'vuruş' },
    bg: 0x0a0a1a,
    cameraPos: [0, 8, 14],
    cameraLookAt: [0, 2, 0],
    cameraFov: 65,
    allowContinue: true,

    /* -----------------------------------------------------------------------
     * init: シーン構築（new THREE.* はここのみ）
     * --------------------------------------------------------------------- */
    init: function (ctx) {
      var THREE = ctx.THREE;

      // --- 月面 ---
      var moonTex = makeMoonTexture(THREE);
      moonSurface = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40),
        new THREE.MeshLambertMaterial({ map: moonTex })
      );
      moonSurface.rotation.x = -Math.PI / 2;
      moonSurface.position.set(0, 0, 0);
      ctx.scene.add(moonSurface);

      // --- 地球（青い球＋白い雲模様＋大気の縁光） ---
      var ecv = document.createElement('canvas');
      ecv.width = 128; ecv.height = 64;
      var ec = ecv.getContext('2d');
      ec.fillStyle = '#2f6fd0'; ec.fillRect(0, 0, 128, 64);          // 海
      ec.fillStyle = '#3a9a4a';                                       // 大陸
      ec.beginPath(); ec.ellipse(34, 24, 16, 10, 0.4, 0, Math.PI * 2); ec.fill();
      ec.beginPath(); ec.ellipse(86, 38, 20, 12, -0.3, 0, Math.PI * 2); ec.fill();
      ec.beginPath(); ec.ellipse(112, 14, 10, 7, 0.2, 0, Math.PI * 2); ec.fill();
      ec.fillStyle = 'rgba(255,255,255,0.75)';                        // 雲
      ec.beginPath(); ec.ellipse(58, 14, 18, 5, 0.1, 0, Math.PI * 2); ec.fill();
      ec.beginPath(); ec.ellipse(20, 46, 14, 4, -0.2, 0, Math.PI * 2); ec.fill();
      ec.beginPath(); ec.ellipse(100, 52, 16, 4, 0.3, 0, Math.PI * 2); ec.fill();
      earthMesh = new THREE.Mesh(
        new THREE.SphereGeometry(2.4, 20, 16),
        new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(ecv) }));
      earthMesh.position.set(3.2, 11.5, -14);
      ctx.scene.add(earthMesh);
      var atmo = new THREE.Mesh(
        new THREE.SphereGeometry(2.55, 20, 16),
        new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.18, side: THREE.BackSide }));
      atmo.position.copy(earthMesh.position);
      ctx.scene.add(atmo);

      // --- 星（小球80個）---
      var starMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      var starGeo = new THREE.SphereGeometry(0.08, 4, 3);
      for (var s = 0; s < 80; s++) {
        var star = new THREE.Mesh(starGeo, starMat);
        star.position.set(
          (Math.random() - 0.5) * 80,
          5 + Math.random() * 40,
          -10 - Math.random() * 60
        );
        ctx.scene.add(star);
      }

      // --- まり（手まり）---
      var mariTex = makeMariTexture(THREE);
      mariMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 16, 12),
        new THREE.MeshLambertMaterial({ map: mariTex })
      );
      ctx.scene.add(mariMesh);

      // --- 着地予測リング ---
      landingRing = new THREE.Mesh(
        new THREE.RingGeometry(0.4, 0.65, 24),
        new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
      );
      landingRing.rotation.x = -Math.PI / 2;
      landingRing.position.set(0, 0.01, 0);
      ctx.scene.add(landingRing);

      // --- 隕石プール（3個）---
      meteorMeshes = [];
      var metMat = Style.mat(0x554433);
      var metGeo = new THREE.SphereGeometry(0.3, 8, 6);
      for (var m = 0; m < 3; m++) {
        var met = new THREE.Mesh(metGeo, metMat);
        met.visible = false;
        ctx.scene.add(met);
        meteorMeshes.push(met);
      }

      // 隕石データ配列（状態管理）
      meteors = [
        { mesh: meteorMeshes[0], vx: 0, vy: 0, vz: 0, active: false, timer: 0 },
        { mesh: meteorMeshes[1], vx: 0, vy: 0, vz: 0, active: false, timer: 0 },
        { mesh: meteorMeshes[2], vx: 0, vy: 0, vz: 0, active: false, timer: 0 }
      ];

      // --- うさぎの手（打者）：まりの下に控え、タップでスッと突き上げる ---
      handGroup = new THREE.Group();
      // 手のひら（白い角丸ボックス）
      var palm = new THREE.Mesh(
        Style.roundedBox(0.7, 0.3, 0.7, 0.14),
        Style.mat(0xffffff)
      );
      palm.position.y = 0;
      handGroup.add(palm);
      // 肉球（ピンクのパッド）
      var padMat = Style.mat(0xf6a8b8);
      var padC = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), padMat);
      padC.scale.set(1, 0.45, 1);
      padC.position.set(0, 0.16, 0.08);
      handGroup.add(padC);
      var padL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), padMat);
      padL.scale.set(1, 0.45, 1);
      padL.position.set(-0.18, 0.16, -0.16);
      handGroup.add(padL);
      var padR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), padMat);
      padR.scale.set(1, 0.45, 1);
      padR.position.set(0.18, 0.16, -0.16);
      handGroup.add(padR);
      // 腕（地面から生える白い柱）
      var arm = new THREE.Mesh(
        Style.roundedBox(0.4, 0.9, 0.4, 0.12),
        Style.mat(0xffffff)
      );
      arm.position.y = -0.55;
      handGroup.add(arm);
      handGroup.position.set(0, HAND_REST_Y, 0);
      ctx.scene.add(handGroup);

      // --- 空振り位置の×リング（赤・1個を使い回すプール） ---
      missMat = new THREE.MeshBasicMaterial({
        color: 0xff3344, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthWrite: false
      });
      missMarker = new THREE.Group();
      var missRing = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 24), missMat);
      missMarker.add(missRing);
      var missBar1 = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.13), missMat);
      missBar1.rotation.z = Math.PI / 4;
      missBar1.position.z = 0.001;
      missMarker.add(missBar1);
      var missBar2 = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.13), missMat);
      missBar2.rotation.z = -Math.PI / 4;
      missBar2.position.z = 0.001;
      missMarker.add(missBar2);
      missMarker.rotation.x = -Math.PI / 2;
      missMarker.visible = false;
      ctx.scene.add(missMarker);

      // --- タップ→ワールド変換用 Raycaster ---
      raycaster = new THREE.Raycaster();
      tapNDC = new THREE.Vector2();
      tapPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // まりの運動平面 z=0
      tapPoint = new THREE.Vector3();
    },

    /* -----------------------------------------------------------------------
     * start: ゲーム状態をリセット
     * --------------------------------------------------------------------- */
    start: function (ctx) {
      // まり状態
      mariPos = { x: 0, y: 3, z: 0 };
      mariVel = { x: 0, y: 0, z: 0 };
      bounceCount = 0;
      hitRadius = 1.5;
      gameOver = false;
      mariScaleTimer = 0;

      // まりメッシュを初期位置へ
      mariMesh.position.set(mariPos.x, mariPos.y, mariPos.z);
      mariMesh.scale.set(1, 1, 1);

      // 隕石を全非表示にリセット
      for (var m = 0; m < meteors.length; m++) {
        meteors[m].active = false;
        meteors[m].mesh.visible = false;
        meteors[m].timer = 0;
      }
      meteorCooldown = 8 + Math.random() * 7; // 最初の隕石まで8〜15秒

      // 手と×リングをリセット
      handX = 0;
      handPokeTimer = 0;
      handPokeAmp = 0;
      handGroup.position.set(0, HAND_REST_Y, 0);
      missTimer = 0;
      missMarker.visible = false;

      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Hit the ball!', ja: 'まりをついて！', es: '¡Golpea la pelota!', 'pt-BR': 'Bata na bola!', fr: 'Frappez la balle !', de: 'Triff den Ball!', it: 'Colpisci la palla!', ko: '공을 쳐!', 'zh-Hans': '击打球！', tr: 'Topa vur!' }));
    },

    /* -----------------------------------------------------------------------
     * onContinue: コンティニュー後にその場から再開
     * --------------------------------------------------------------------- */
    onContinue: function (ctx) {
      mariPos.y = 4;
      mariVel.x = 0;
      mariVel.y = 3;
      mariVel.z = 0;
      gameOver = false;
      // hitRadius は小さくなりすぎていたら少し戻す
      if (hitRadius < 1.0) hitRadius = 1.0;
      mariMesh.scale.set(1, 1, 1);
      ctx.setHint(ctx.t({ en: 'Keep going!', ja: '続けて！', es: '¡Continúa!', 'pt-BR': 'Continue!', fr: 'Continuez !', de: 'Weiter!', it: 'Continua!', ko: '계속해!', 'zh-Hans': '继续！', tr: 'Devam et!' }));
    },

    /* -----------------------------------------------------------------------
     * onPointerDown: タップ判定
     * --------------------------------------------------------------------- */
    onPointerDown: function (ctx, p) {
      if (gameOver) return;

      // タップ位置をカメラからのレイと「まりの運動平面 z=0」の交差でワールド座標に変換
      // （カメラはまりを追従して動くので固定係数変換だとズレる）
      tapNDC.x = p.nx;
      tapNDC.y = p.ny;
      raycaster.setFromCamera(tapNDC, ctx.camera);
      var worldX = mariPos.x; // 交差しない場合のフォールバック
      var worldY = mariPos.y;
      if (raycaster.ray.intersectPlane(tapPlane, tapPoint)) {
        worldX = Math.max(-6, Math.min(6, tapPoint.x));
        worldY = tapPoint.y;
      }
      var offset = worldX - mariPos.x; // タップ位置とまり中心のずれ（水平）

      // 空中ガード：まりが手の届く高さより上にある間はタップ無効。
      // 「落ちてきたらつく」ゲームなので、高い空中で叩いても空振り扱い。
      if (mariPos.y > REACH_Y) {
        // 無効を示す×リングをタップ地点(の地面)に一瞬表示（突き上げアニメは出さない）
        missMarker.position.set(worldX, 0.02, 0);
        missMarker.scale.set(1, 1, 1);
        missMarker.visible = true;
        missTimer = MISS_DUR;
        ctx.sfx.fail();
        return;
      }

      // 手がタップ位置へスッと移動して突き上げる（ヒット/ミス共通）
      handX = worldX;
      handPokeTimer = HAND_POKE_DUR;
      handPokeAmp = Math.max(0.5, Math.min(1.6, mariPos.y - 0.6));

      // ヒット判定：タップの「列」がまりのX±hitRadius内なら命中。
      // 縦方向は問わない（howto=「落ちてくる場所をタップ」＝地面のリングや
      // 画面下の親指位置タップが自然な操作。旧実装は縦チェックで弾いていた）
      if (Math.abs(offset) < hitRadius) {
        // ヒット！まりを突く
        mariVel.y = 6.0;                    // 上方向の初速
        mariVel.x = offset * 1.5;           // タップのずれが横ドリフトに
        bounceCount++;
        ctx.setScore(bounceCount);
        ctx.sfx.score();
        ctx.vibrate(20);

        // 10回ごとに難易度上昇（ヒット窓を縮小）
        if (bounceCount % 10 === 0) {
          hitRadius = Math.max(0.7, hitRadius - 0.1);
          ctx.setHint(bounceCount + ctx.t({ en: ' hits! Getting harder!', ja: '回！どんどん難しくなるぞ！', es: ' hits! ¡Cada vez más difícil!', 'pt-BR': ' toques! Ficando mais difícil!', fr: ' coups ! De plus en plus dur !', de: ' Treffer! Wird schwieriger!', it: ' colpi! Sempre più difficile!', ko: '회! 점점 어려워진다!', 'zh-Hans': '次！越来越难！', tr: ' vuruş! Giderek zorlaşıyor!' }));
        }

        // スケールパルスアニメ開始
        mariScaleTimer = 0.18;
      } else {
        // ミス：空振り位置に×リング（赤）を一瞬表示
        missMarker.position.set(worldX, 0.02, 0);
        missMarker.scale.set(1, 1, 1);
        missMarker.visible = true;
        missTimer = MISS_DUR;
        ctx.sfx.fail();
      }
    },

    /* -----------------------------------------------------------------------
     * update: 毎フレーム物理演算
     * --------------------------------------------------------------------- */
    update: function (ctx, dt) {
      if (gameOver) return;

      /* --- まり物理 --- */
      mariVel.y -= MOON_G * dt;
      mariPos.x += mariVel.x * dt;
      mariPos.y += mariVel.y * dt;

      // 横壁バウンド（-6〜6）
      if (mariPos.x < -6) {
        mariPos.x = -6;
        mariVel.x = Math.abs(mariVel.x) * 0.8;
      } else if (mariPos.x > 6) {
        mariPos.x = 6;
        mariVel.x = -Math.abs(mariVel.x) * 0.8;
      }

      /* --- ヒットパルスアニメ --- */
      if (mariScaleTimer > 0) {
        mariScaleTimer -= dt;
        var pulse = 1 + Math.sin((0.18 - mariScaleTimer) / 0.18 * Math.PI) * 0.25;
        mariMesh.scale.set(pulse, pulse, pulse);
        if (mariScaleTimer <= 0) {
          mariMesh.scale.set(1, 1, 1);
        }
      }

      // まりを少し回転させる（転がり感）
      mariMesh.rotation.z -= mariVel.x * dt * 1.2;
      mariMesh.rotation.x += 0.5 * dt;

      // まりメッシュ位置更新
      mariMesh.position.set(mariPos.x, mariPos.y, mariPos.z);

      /* --- カメラがまりを追従（高く上がっても見失わない） --- */
      var cam = ctx.camera;
      var followY = Math.max(2.2, mariPos.y);
      var k = Math.min(1, dt * 4);
      cam.position.x += (mariPos.x * 0.35 - cam.position.x) * k;
      cam.position.y += ((followY + 5.5) - cam.position.y) * k;
      cam.lookAt(mariPos.x * 0.35, followY, 0);

      /* --- 着地予測リング --- */
      var lx = calcLandingX();
      landingRing.position.set(lx, 0.01, 0);

      // まりが手の届く高さに入ったら点滅＆緑を強めて「今つける」を明示。
      // 高い空中では暗くして「まだ無効」を非言語で伝える。
      var inReach = mariPos.y <= REACH_Y;
      if (inReach) {
        var flash = 0.5 + 0.5 * Math.sin(ctx.elapsed * 10);
        landingRing.material.opacity = 0.55 + flash * 0.45;
        landingRing.material.color.setHex(0x00ff88);
      } else {
        landingRing.material.opacity = 0.22;
        landingRing.material.color.setHex(0x3a6a55);
      }

      /* --- うさぎの手 --- */
      if (handPokeTimer > 0) {
        // 突き上げアニメ：sin カーブでスッと上がって戻る
        handPokeTimer -= dt;
        var pk = Math.max(0, handPokeTimer);
        var prog = 1 - pk / HAND_POKE_DUR;
        handGroup.position.y = HAND_REST_Y + Math.sin(prog * Math.PI) * handPokeAmp;
        handGroup.position.x = handX;
      } else {
        // 待機中は着地予測位置に滑らかに追従（打者が構えて見える）
        handX += (lx - handX) * Math.min(1, dt * 6);
        handGroup.position.x = handX;
        handGroup.position.y = HAND_REST_Y;
      }

      /* --- ×リングのフェードアウト --- */
      if (missTimer > 0) {
        missTimer -= dt;
        var mr = Math.max(0, missTimer / MISS_DUR);
        missMat.opacity = mr * 0.9;
        var ms = 1 + (1 - mr) * 0.4;
        missMarker.scale.set(ms, ms, ms);
        if (missTimer <= 0) missMarker.visible = false;
      }

      /* --- ゲームオーバー判定（地面に落下）--- */
      if (mariPos.y <= 0) {
        mariPos.y = 0;
        mariMesh.position.y = 0;
        gameOver = true;
        ctx.vibrate(80);
        ctx.sfx.fail();
        ctx.gameOver(bounceCount);
        return;
      }

      /* --- 隕石更新 --- */
      meteorCooldown -= dt;

      // 隕石を新しく起動（クールダウンが切れたら未使用のものを1つ選ぶ）
      if (meteorCooldown <= 0) {
        for (var i = 0; i < meteors.length; i++) {
          if (!meteors[i].active) {
            var met = meteors[i];
            var fromLeft = Math.random() < 0.5;
            met.mesh.position.set(
              fromLeft ? -20 : 20,
              2 + Math.random() * 6,
              0
            );
            met.vx = fromLeft ? (6 + Math.random() * 4) : -(6 + Math.random() * 4);
            met.vy = (Math.random() - 0.5) * 1.5;
            met.vz = 0;
            met.active = true;
            met.mesh.visible = true;
            break;
          }
        }
        meteorCooldown = 8 + Math.random() * 7;
      }

      for (var j = 0; j < meteors.length; j++) {
        var meteor = meteors[j];
        if (!meteor.active) continue;

        // 隕石移動
        meteor.mesh.position.x += meteor.vx * dt;
        meteor.mesh.position.y += meteor.vy * dt;

        // 隕石がまりに近いか判定
        var dx = meteor.mesh.position.x - mariPos.x;
        var dy = meteor.mesh.position.y - mariPos.y;
        var dist2 = dx * dx + dy * dy;
        if (dist2 < 1.5 * 1.5) {
          // 衝突！まりに衝撃を与える
          var sign = meteor.vx > 0 ? 1 : -1;
          mariVel.x += sign * 3 + (Math.random() - 0.5) * 2;
          mariVel.y += 1.5 + Math.random();
          ctx.vibrate(30);
          // 隕石を非表示に
          meteor.active = false;
          meteor.mesh.visible = false;
        }

        // 画面外に出たら非表示
        if (meteor.mesh.position.x > 22 || meteor.mesh.position.x < -22) {
          meteor.active = false;
          meteor.mesh.visible = false;
        }
      }
    }
  });
})();
