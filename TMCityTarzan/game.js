/* =========================================================================
 * TMCityTarzan — ビルのターザン
 * ルール: クレーンのフックにぶら下がり振り子スイング、放して放物線で飛び、
 *         次のフックを長押しで掴む。ビル・看板・鳩に当たると失速。
 * 操作: 長押しで掴み／離す
 * スコア: 進んだ距離 (m)
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------- 定数 ---------- */
  var GRAVITY = 9.8;          // 重力加速度 (m/s²)
  var GROUND_Y = -8;          // 地面のY座標
  var GRAB_RADIUS = 3.8;      // フック掴み判定半径（易化: 広め）
  var HOOK_COUNT = 6;         // フック数（プール）
  var BUILDING_COUNT = 8;     // ビル数（プール）
  var PIGEON_COUNT = 3;       // 鳩数
  var SIGN_COUNT = 3;         // 看板数

  /* ---------- ポンピング（ブランコの漕ぎ）定数 ---------- */
  var PUMP_ZONE = 0.45;       // 増幅可能な振り角（最下点±ラジアン）
  var PUMP_BOOST = 1.30;      // 増幅倍率（角速度に掛ける）
  var PUMP_MIN_ADD = 0.6;     // 最低でも加算される角速度
  var PUMP_COOLDOWN = 0.4;    // 連続増幅の最短間隔（秒）
  var PUMP_MAX_SPEED = 13;    // 増幅で到達できる最大線速度 (m/s)
  var FLICK_THRESHOLD = 60;   // フリック判定の累積移動量(px)

  /* ---------- 状態変数 ---------- */
  var playerPos;              // {x, y} ワールド座標
  var playerVel;              // {x, y} 速度 (m/s)
  var swingState;             // 'flying' | 'swinging'
  var currentHook;            // null | {x, y}
  var swingAngle;             // 振り子角度（垂直からのラジアン）
  var swingVel;               // 角速度 (rad/s)
  var ropeLen;                // ロープ長さ
  var distanceTraveled;       // 進んだ距離
  var gameOverFlag;           // ゲームオーバーフラグ
  var isHolding;              // ポインタ押下中
  var pumpCooldown;           // ポンピングのクールダウン残り（秒）
  var pumpFlash;              // 増幅成功フラッシュ演出の残り（秒）
  var flickAccum;             // スイング中のフリック累積移動量(px)

  /* ---------- カメラ先読みフレーミング ---------- */
  var camTX, camTY, camTZ, camLX, camLY;   // カメラ目標
  var camInit;                             // 初回スナップ用
  var parallaxFar = [], parallaxMid = [];  // 遠景/中景パララックス層 {mesh, baseX}

  // プレイヤー＋次の2フックが常に画面に収まる距離を、FOVとアスペクトから逆算。
  // スイング中は標準、放物線(flying)中はさらに引いて着地先を見せる。
  function frameCamera(ctx) {
    var ahead = [];
    for (var i = 0; i < HOOK_COUNT; i++) {
      if (hookData[i].x > playerPos.x - 1) ahead.push(hookData[i]);
    }
    ahead.sort(function (a, b) { return a.x - b.x; });
    var xMax = playerPos.x + 6, yTop = playerPos.y, yBot = playerPos.y;
    for (var k = 0; k < 2 && k < ahead.length; k++) {
      xMax = Math.max(xMax, ahead[k].x);
      yTop = Math.max(yTop, ahead[k].y);
      yBot = Math.min(yBot, ahead[k].y);
    }
    var xMin = playerPos.x - 2.5;
    yBot = Math.min(yBot, playerPos.y - 3.2);   // ロープ下端・落下ぶんの余白
    yTop = yTop + 1.6;
    var cx = (xMin + xMax) / 2, cy = (yBot + yTop) / 2;
    var halfW = (xMax - xMin) / 2 + 1.0;
    var halfH = (yTop - yBot) / 2 + 0.8;
    var vFov = (ctx.camera.fov || 60) * Math.PI / 180;
    var aspect = ctx.camera.aspect || (ctx.width && ctx.height ? ctx.width / ctx.height : 0.6);
    var tanV = Math.tan(vFov / 2), tanH = tanV * aspect;
    var D = Math.max(halfH / tanV, halfW / tanH) * 1.12 + 2.0;
    if (swingState === 'flying') D *= 1.08;

    camTX = cx - 1.0;
    camTY = cy + 1.2;
    camTZ = D;
    camLX = cx + 1.5;   // 進行方向を先読み
    camLY = cy;
  }

  /* ---------- メッシュ参照 ---------- */
  var playerMesh;             // プレイヤースフィア
  var ropeLine;               // Cylinder ロープ
  var hookMeshes;             // フックGroup配列 [HOOK_COUNT]（アーム＋ケーブル＋J字フック）
  var hookData;               // フックのワールドX/Y配列 [{x,y}]
  var guideDots;              // 掴み圏内ガイドの点線（小球プール）
  var buildingMeshes;         // ビルメッシュ配列
  var buildingData;           // ビルのワールドX/高さ配列 [{x, h}]
  var pigeonMeshes;           // 鳩メッシュ配列（Group）
  var pigeonData;             // 鳩ワールド座標 [{x, y}]
  var signMeshes;             // 看板メッシュ配列
  var signData;               // 看板ワールド座標 [{x, y}]

  /* ---------- フック初期配置テーブル（易化: 間隔を詰める） ---------- */
  var HOOK_INIT = [
    { x: 3,    y: 7 },
    { x: 7.2,  y: 6 },
    { x: 11.5, y: 7.2 },
    { x: 15.8, y: 6 },
    { x: 20,   y: 7 },
    { x: 24,   y: 6.5 }
  ];

  /* ---------- ランダム高さ ---------- */
  function randHookY() {
    return 5.5 + Math.random() * 2.5; // 5.5〜8
  }

  function clampHookY(y) {
    return Math.max(5.5, Math.min(8, y));
  }

  /* ---------- フック再配置: プレイヤーの後方に落ちたら前方へ移動 ---------- */
  function recycleHooks() {
    var px = playerPos.x;
    for (var i = 0; i < HOOK_COUNT; i++) {
      if (hookData[i].x < px - 10) {
        // 最も遠い前方フックのX座標を探して、さらに先へ
        var maxX = px + 10;
        var maxIdx = i;
        for (var j = 0; j < HOOK_COUNT; j++) {
          if (hookData[j].x > maxX) {
            maxX = hookData[j].x;
            maxIdx = j;
          }
        }
        hookData[i].x = maxX + 3.8 + Math.random() * 1.2;
        hookData[i].y = clampHookY(hookData[maxIdx].y + (Math.random() - 0.5) * 2.0);
      }
    }
  }

  /* ---------- ビル再配置 ---------- */
  function recycleBuildings() {
    var px = playerPos.x;
    for (var i = 0; i < BUILDING_COUNT; i++) {
      if (buildingData[i].x < px - 15) {
        var maxX = px + 10;
        for (var j = 0; j < BUILDING_COUNT; j++) {
          if (buildingData[j].x > maxX) maxX = buildingData[j].x;
        }
        buildingData[i].x = maxX + 3 + Math.random() * 5;
        buildingData[i].h = 4 + Math.random() * 8;
      }
    }
  }

  /* ---------- 障害物再配置 ---------- */
  function recycleObstacles() {
    var px = playerPos.x;
    for (var i = 0; i < PIGEON_COUNT; i++) {
      if (pigeonData[i].x < px - 10) {
        pigeonData[i].x = px + 15 + Math.random() * 20;
        pigeonData[i].y = -1 + Math.random() * 4;
      }
    }
    for (var k = 0; k < SIGN_COUNT; k++) {
      if (signData[k].x < px - 10) {
        signData[k].x = px + 15 + Math.random() * 20;
        signData[k].y = -2 + Math.random() * 4;
      }
    }
  }

  /* ---------- メッシュ位置同期（各フレーム） ---------- */
  function syncMeshes() {
    var px = playerPos.x;

    // プレイヤー（うさぎ: 足裏y=0、頭頂y≈1.0 for scale=0.5）
    playerMesh.position.x = playerPos.x;
    playerMesh.position.y = playerPos.y - 0.5;

    // フック
    for (var i = 0; i < HOOK_COUNT; i++) {
      hookMeshes[i].position.x = hookData[i].x;
      hookMeshes[i].position.y = hookData[i].y;
    }

    // ビル（Y中心は高さ/2 + GROUND_Y）
    for (var b = 0; b < BUILDING_COUNT; b++) {
      buildingMeshes[b].position.x = buildingData[b].x;
      // ビルはGROUND_Yからそびえ立つ（固定スケールでなく位置で表現）
      buildingMeshes[b].position.y = GROUND_Y + buildingData[b].h / 2;
      buildingMeshes[b].position.z = -4;
    }

    // 鳩
    for (var p = 0; p < PIGEON_COUNT; p++) {
      pigeonMeshes[p].position.x = pigeonData[p].x;
      pigeonMeshes[p].position.y = pigeonData[p].y;
    }

    // 看板
    for (var s = 0; s < SIGN_COUNT; s++) {
      signMeshes[s].position.x = signData[s].x;
      signMeshes[s].position.y = signData[s].y;
    }
  }

  /* ---------- ロープ更新 ---------- */
  function updateRope(hookX, hookY) {
    var dx = playerPos.x - hookX;
    var dy = playerPos.y - hookY;
    var len = Math.sqrt(dx * dx + dy * dy);
    ropeLine.position.set(hookX + dx * 0.5, hookY + dy * 0.5, 0.05);
    ropeLine.scale.y = len;
    ropeLine.rotation.z = Math.atan2(-dx, dy);
    ropeLine.visible = true;
  }

  function tryGrabHook(ctx) {
    if (swingState !== 'flying') return false;
    var bestDist = GRAB_RADIUS;
    var bestIdx = -1;
    for (var i = 0; i < HOOK_COUNT; i++) {
      var dx = hookData[i].x - playerPos.x;
      var dy = hookData[i].y - playerPos.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return false;

    currentHook = hookData[bestIdx];
    var ddx = playerPos.x - currentHook.x;
    var ddy = playerPos.y - currentHook.y;
    ropeLen = Math.sqrt(ddx * ddx + ddy * ddy);
    if (ropeLen < 0.5) ropeLen = 0.5;
    swingAngle = Math.atan2(ddx, -ddy);
    swingVel = (playerVel.x * Math.cos(swingAngle) - playerVel.y * Math.sin(swingAngle)) / ropeLen;
    swingState = 'swinging';
    updateRope(currentHook.x, currentHook.y);
    ctx.sfx.tap();
    ctx.setHint(ctx.t({ en: 'Tap on GOLD to swing bigger!', ja: '金色に光ったらタップで加速！', es: '¡Toca en DORADO para más impulso!', 'pt-BR': 'Toque no DOURADO para mais impulso!', fr: 'Tapotez sur l\'OR pour plus d\'élan!', de: 'Bei GOLD tippen für mehr Schwung!', it: 'Tocca sull\'ORO per più slancio!', ko: '금색일 때 탭하면 가속!', 'zh-Hans': '金光时点击加速！', tr: 'ALTIN parlarken dokun, hızlan!' }));
    return true;
  }

  /* ---------- ポンピング（ブランコの漕ぎ） ----------
   * 最下点付近（|swingAngle| < PUMP_ZONE）でタップ or フリックすると揺れが増幅。
   * 増幅可能なタイミングはロープが金色に光って合図する。 */
  function pumpReady() {
    return swingState === 'swinging' &&
           Math.abs(swingAngle) < PUMP_ZONE &&
           Math.abs(swingVel) > 0.15;
  }

  function tryPump(ctx) {
    if (swingState !== 'swinging') return false;
    if (pumpCooldown > 0) return false;
    if (!pumpReady()) return false;
    var dir = swingVel >= 0 ? 1 : -1;
    var boosted = swingVel * PUMP_BOOST + dir * (PUMP_MIN_ADD / Math.max(1, ropeLen));
    // 線速度の上限でクランプ（回転しすぎ防止）
    var maxAng = PUMP_MAX_SPEED / Math.max(0.5, ropeLen);
    if (Math.abs(boosted) > maxAng) boosted = dir * maxAng;
    swingVel = boosted;
    pumpCooldown = PUMP_COOLDOWN;
    pumpFlash = 0.3;
    ctx.sfx.score();
    ctx.vibrate(20);
    return true;
  }

  /* ---------- Shell.registerGame ---------- */
  Shell.registerGame({
    id: 'TMCityTarzan',
    title: { en: 'City Tarzan', ja: 'ビルのターザン', es: 'Tarzán Urbano', 'pt-BR': 'Tarzan Urbano', fr: 'Tarzan Urbain', de: 'Stadt-Tarzan', it: 'Tarzan Urbano', ko: '도시 타잔', 'zh-Hans': '城市泰山', tr: 'Şehir Tarzan' },
    howto: { en: 'Hold to grab the hook and swing!\nTap when the rope glows GOLD to swing bigger!\nRelease to fly to the next hook!', ja: '長おしでフックを掴んでスイング！\nロープが金色に光ったらタップで大きく漕げ！\n離して次のフックへ飛べ！', es: '¡Mantén pulsado para agarrar el gancho y columpiarte!\n¡Toca cuando la cuerda brille DORADA para impulsarte más!\n¡Suelta para volar al siguiente gancho!', 'pt-BR': 'Segure para agarrar o gancho e balançar!\nToque quando a corda brilhar DOURADA para balançar mais!\nSolte para voar ao próximo gancho!', fr: 'Maintenez pour saisir le crochet et vous balancer!\nTapotez quand la corde brille en OR pour amplifier l\'élan!\nRelâchez pour voler vers le prochain crochet!', de: 'Halten zum Haken greifen und schwingen!\nTippe, wenn das Seil GOLDEN leuchtet, für mehr Schwung!\nLoslassen zum nächsten Haken fliegen!', it: 'Tieni premuto per afferrare il gancio e oscillare!\nTocca quando la corda brilla d\'ORO per oscillare di più!\nRilascia per volare al prossimo gancio!', ko: '길게 누르기로 후크를 잡고 스윙!\n로프가 금색으로 빛날 때 탭하면 더 크게 흔들려!\n놓기로 다음 후크로 날아가라!', 'zh-Hans': '长按抓住钩子摇摆！\n绳子发出金光时点击可以荡得更高！\n松开飞向下一个钩子！', tr: 'Kancayı tutmak ve sallanmak için basılı tut!\nİp ALTIN parladığında dokun, daha güçlü sallan!\nSonraki kancaya uçmak için bırak!' },
    scoreLabel: 'm',
    bg: 0xff6b35,             // 夕焼けオレンジ
    allowContinue: true,

    /* ===== init: シーン構築（1回のみ） ===== */
    init: function (ctx) {
      var THREE = ctx.THREE;

      /* --- ライト --- */
      var ambient = new THREE.AmbientLight(0xffffff, 0.6);
      ctx.scene.add(ambient);
      var dir = new THREE.DirectionalLight(0xffe0a0, 0.8);
      dir.position.set(5, 10, 5);
      ctx.scene.add(dir);

      /* --- 地面（道路） --- */
      var groundMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2000, 4),
        Style.mat(0x333344)
      );
      groundMesh.rotation.x = -Math.PI / 2;
      groundMesh.position.y = GROUND_Y;
      ctx.scene.add(groundMesh);

      /* --- 窓明かりテクスチャ生成（夜のビルの点灯窓） --- */
      function makeWindowTex(base, lit) {
        var cv = document.createElement('canvas');
        cv.width = 64; cv.height = 128;
        var g = cv.getContext('2d');
        g.fillStyle = base; g.fillRect(0, 0, 64, 128);
        for (var wy = 8; wy < 122; wy += 12) {
          for (var wx = 8; wx < 58; wx += 14) {
            var on = Math.random() < 0.55;
            g.fillStyle = on ? lit : 'rgba(20,20,40,0.6)';
            g.fillRect(wx, wy, 8, 8);
          }
        }
        var tex = new THREE.CanvasTexture(cv);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        return tex;
      }
      var winTexes = [
        makeWindowTex('#1a1a2e', '#ffd98a'),
        makeWindowTex('#16213e', '#9fd8ff'),
        makeWindowTex('#241a3e', '#ffcf6a')
      ];

      /* --- 遠景シルエット層（パララックス・ゆっくり流れる） --- */
      var silMat = new THREE.MeshBasicMaterial({ color: 0x140c26 });
      parallaxFar = [];
      for (var si = 0; si < 16; si++) {
        var sh = 7 + Math.random() * 12;
        var sw = 1.8 + Math.random() * 2.4;
        var sil = new THREE.Mesh(Style.roundedBox(sw, sh, 0.5), silMat);
        var bx = -30 + si * 7;
        sil.position.set(bx, GROUND_Y + sh / 2, -16);
        ctx.scene.add(sil);
        parallaxFar.push({ mesh: sil, baseX: bx });
      }

      /* --- 中景ビル層（パララックス・窓明かり付き） --- */
      var midTex = makeWindowTex('#101830', '#8fb8ff');
      parallaxMid = [];
      for (var mi = 0; mi < 12; mi++) {
        var mh = 6 + Math.random() * 8;
        var mw = 2.2 + Math.random() * 1.8;
        var mMat = new THREE.MeshStandardMaterial({ map: midTex, roughness: 1, metalness: 0, color: 0x8a90c0 });
        var mMesh = new THREE.Mesh(Style.roundedBox(mw, mh, 1), mMat);
        var mbx = -24 + mi * 9;
        mMesh.position.set(mbx, GROUND_Y + mh / 2, -9.5);
        ctx.scene.add(mMesh);
        parallaxMid.push({ mesh: mMesh, baseX: mbx });
      }

      /* --- ビル（スクロール用プール・窓明かり付き） --- */
      buildingMeshes = [];
      buildingData = [];
      for (var bi = 0; bi < BUILDING_COUNT; bi++) {
        var bh = 4 + Math.random() * 8;
        var bw = 2 + Math.random() * 2;
        var wtex = winTexes[bi % winTexes.length];
        var bMat = new THREE.MeshStandardMaterial({ map: wtex, roughness: 1, metalness: 0, color: 0xb0b4d0 });
        var bMesh = new THREE.Mesh(Style.roundedBox(bw, bh, 2), bMat);
        bMesh.userData.baseH = bh;
        buildingMeshes.push(bMesh);
        buildingData.push({ x: 8 + bi * 10, h: bh });
        ctx.scene.add(bMesh);
      }

      /* --- フック（プール）: クレーンアームから垂れるJ字フック --- */
      // Group原点 = 掴み判定点（hookData の x/y）。アームは上方に伸びる。
      var armMat = new THREE.MeshBasicMaterial({ color: 0xff8c1a });
      var cableMat = new THREE.MeshBasicMaterial({ color: 0xd8d8d8 });
      hookMeshes = [];
      hookData = [];
      for (var hi = 0; hi < HOOK_COUNT; hi++) {
        var hg = new THREE.Group();
        // クレーンアーム（水平桁）
        var arm = new THREE.Mesh(Style.roundedBox(2.2, 0.18, 0.18), armMat);
        arm.position.y = 2.2;
        hg.add(arm);
        // 垂れるケーブル
        var cable = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 6), cableMat);
        cable.position.y = 1.2;
        hg.add(cable);
        // J字フック本体（軸＋開口が上を向く半トーラス）: 掴み合図でパルスする部分
        var hookMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
        var jGroup = new THREE.Group();
        var shank = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8), hookMat);
        shank.position.y = 0.22;
        jGroup.add(shank);
        var jCurve = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.08, 8, 12, Math.PI), hookMat);
        jCurve.rotation.z = Math.PI;   // 下半分の弧＝開口が上
        jCurve.position.y = 0.02;
        jGroup.add(jCurve);
        hg.add(jGroup);
        hg.userData.j = jGroup;
        hg.userData.mat = hookMat;
        hookMeshes.push(hg);
        hookData.push({ x: HOOK_INIT[hi].x, y: HOOK_INIT[hi].y });
        ctx.scene.add(hg);
      }

      /* --- 掴みガイド点線（小球プール） --- */
      guideDots = [];
      var guideMat = new THREE.MeshBasicMaterial({ color: 0xaef7ff, transparent: true, opacity: 0.8 });
      for (var gi = 0; gi < 7; gi++) {
        var gDot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), guideMat);
        gDot.visible = false;
        ctx.scene.add(gDot);
        guideDots.push(gDot);
      }

      /* --- プレイヤー（うさぎ） --- */
      var bunny = GameBunny.make(THREE, { scale: 0.5 });
      playerMesh = bunny.group;
      ctx.scene.add(playerMesh);

      /* --- ロープ（太く・高コントラスト: 暗い街でも視認できるよう明色＋自光） --- */
      var ropeMat = new THREE.MeshBasicMaterial({ color: 0xfff3d0 });
      ropeLine = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 8), ropeMat);
      ropeLine.visible = false;
      ctx.scene.add(ropeLine);

      /* --- 鳩（V字2翼 BoxGeometry） --- */
      pigeonMeshes = [];
      pigeonData = [];
      var wingMat = Style.mat(0xaaaaaa);
      for (var pi = 0; pi < PIGEON_COUNT; pi++) {
        var pg = new THREE.Group();
        // 左翼
        var wingL = new THREE.Mesh(Style.roundedBox(0.6, 0.08, 0.3), wingMat);
        wingL.position.set(-0.35, 0.1, 0);
        wingL.rotation.z = 0.3;
        pg.add(wingL);
        // 右翼
        var wingR = new THREE.Mesh(Style.roundedBox(0.6, 0.08, 0.3), wingMat);
        wingR.position.set(0.35, 0.1, 0);
        wingR.rotation.z = -0.3;
        pg.add(wingR);
        // 胴体
        var body = new THREE.Mesh(Style.roundedBox(0.2, 0.15, 0.4), wingMat);
        pg.add(body);
        pigeonMeshes.push(pg);
        pigeonData.push({ x: 10 + pi * 15, y: 1 + Math.random() * 3 });
        ctx.scene.add(pg);
      }

      /* --- 看板（広告） --- */
      signMeshes = [];
      signData = [];
      var signHues = [0xff3b6b, 0x37e0c8, 0xffd23b];
      var signFrameMat = Style.mat(0x555555);
      for (var ki = 0; ki < SIGN_COUNT; ki++) {
        var sg = new THREE.Group();
        // ネオン発光する看板（自光で夜に映える＝ビルのシルエット差別化）
        var neonMat = new THREE.MeshBasicMaterial({ color: signHues[ki % signHues.length] });
        var sign = new THREE.Mesh(Style.roundedBox(1.5, 0.8, 0.1), neonMat);
        sg.add(sign);
        var frame = new THREE.Mesh(Style.roundedBox(1.7, 1.0, 0.05), signFrameMat);
        frame.position.z = -0.03;
        sg.add(frame);
        signMeshes.push(sg);
        signData.push({ x: 12 + ki * 18, y: -1 + Math.random() * 3 });
        ctx.scene.add(sg);
      }
    },

    /* ===== start: ゲームリセット ===== */
    start: function (ctx) {
      playerPos = { x: 0, y: 6 };
      playerVel = { x: 4, y: 1 };
      swingState = 'flying';
      currentHook = null;
      swingAngle = 0;
      swingVel = 0;
      ropeLen = 0;
      distanceTraveled = 0;
      gameOverFlag = false;
      isHolding = false;
      pumpCooldown = 0;
      pumpFlash = 0;
      flickAccum = 0;

      // フックを初期位置に戻す
      for (var i = 0; i < HOOK_COUNT; i++) {
        hookData[i].x = HOOK_INIT[i].x;
        hookData[i].y = HOOK_INIT[i].y;
      }

      // ビルを初期位置に
      for (var b = 0; b < BUILDING_COUNT; b++) {
        buildingData[b].x = 5 + b * 10;
        buildingData[b].h = 4 + Math.random() * 8;
      }

      // 鳩・看板を初期位置に
      for (var p = 0; p < PIGEON_COUNT; p++) {
        pigeonData[p].x = 10 + p * 15;
        pigeonData[p].y = 1 + Math.random() * 3;
      }
      for (var k = 0; k < SIGN_COUNT; k++) {
        signData[k].x = 12 + k * 18;
        signData[k].y = -1 + Math.random() * 3;
      }

      // ロープ非表示
      ropeLine.visible = false;

      // ガイド点線・フック合図をリセット
      for (var g = 0; g < guideDots.length; g++) guideDots[g].visible = false;
      for (var h = 0; h < HOOK_COUNT; h++) {
        hookMeshes[h].userData.mat.color.setHex(0xffcc00);
        hookMeshes[h].userData.j.scale.set(1, 1, 1);
      }

      // カメラ初期位置（先読みフレーミングを即スナップ）
      frameCamera(ctx);
      ctx.camera.position.set(camTX, camTY, camTZ);
      ctx.camera.lookAt(camLX, camLY, 0);
      camInit = true;

      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Hold to grab the hook!', ja: '長おしでフックを掴め！', es: '¡Mantén pulsado para agarrar el gancho!', 'pt-BR': 'Segure para agarrar o gancho!', fr: 'Maintenez pour saisir le crochet!', de: 'Halten zum Haken greifen!', it: 'Tieni premuto per afferrare il gancio!', ko: '길게 눌러 후크를 잡아라!', 'zh-Hans': '长按抓住钩子！', tr: 'Kancayı tutmak için basılı tut!' }));
    },

    /* ===== onContinue: その場から再開 ===== */
    onContinue: function (ctx) {
      playerVel = { x: 4, y: 1 };
      playerPos.y = 6;
      swingState = 'flying';
      currentHook = null;
      ropeLine.visible = false;
      gameOverFlag = false;
      pumpCooldown = 0;
      pumpFlash = 0;
      flickAccum = 0;
      ctx.setHint(ctx.t({ en: 'Hold to grab the hook!', ja: '長おしでフックを掴め！', es: '¡Mantén pulsado para agarrar el gancho!', 'pt-BR': 'Segure para agarrar o gancho!', fr: 'Maintenez pour saisir le crochet!', de: 'Halten zum Haken greifen!', it: 'Tieni premuto per afferrare il gancio!', ko: '길게 눌러 후크를 잡아라!', 'zh-Hans': '长按抓住钩子！', tr: 'Kancayı tutmak için basılı tut!' }));
    },

    /* ===== 入力: 押した瞬間 → フック掴み / スイング中はポンピング ===== */
    onPointerDown: function (ctx, p) {
      isHolding = true;
      if (swingState === 'swinging') {
        tryPump(ctx);   // 2本目の指のタップでも漕げる
        return;
      }
      tryGrabHook(ctx);
    },

    /* ===== 入力: スイング中のフリックでもポンピング ===== */
    onPointerMove: function (ctx, p) {
      if (swingState !== 'swinging') { flickAccum = 0; return; }
      flickAccum += Math.abs(p.dx) + Math.abs(p.dy);
      if (flickAccum >= FLICK_THRESHOLD) {
        flickAccum = 0;
        tryPump(ctx);
      }
    },

    /* ===== 入力: 離した瞬間 → ロープ放す ===== */
    onPointerUp: function (ctx, p) {
      isHolding = false;
      if (swingState === 'swinging') {
        // 振り子の角速度を速度に変換
        playerVel.x = ropeLen * swingVel * Math.cos(swingAngle);
        playerVel.y = ropeLen * swingVel * Math.sin(swingAngle);
        playerVel.x *= 1.15;
        playerVel.y *= 1.15;
        if (playerVel.y < -1.5) playerVel.y = -1.5;
        // 最低限の前進速度を確保
        if (playerVel.x < 1.0) playerVel.x = 1.0;
        swingState = 'flying';
        currentHook = null;
        ropeLine.visible = false;
        ctx.sfx.bounce();
      }
    },

    /* ===== 毎フレーム更新 ===== */
    update: function (ctx, dt) {
      if (gameOverFlag) return;

      // dt が大きすぎる場合はクランプ（フレーム落ち対策）
      if (dt > 0.1) dt = 0.1;

      /* --- ポンピングタイマー更新 --- */
      if (pumpCooldown > 0) pumpCooldown = Math.max(0, pumpCooldown - dt);
      if (pumpFlash > 0) pumpFlash = Math.max(0, pumpFlash - dt);
      flickAccum = Math.max(0, flickAccum - flickAccum * 6 * dt); // フリック累積は減衰

      /* --- 物理: スイング中 --- */
      if (swingState === 'swinging' && currentHook) {
        var hx = currentHook.x;
        var hy = currentHook.y;

        // 振り子方程式: α = -(g / L) * sin(θ)
        swingVel += (-GRAVITY / ropeLen) * Math.sin(swingAngle) * dt;
        // 減衰
        swingVel *= (1 - 0.01 * dt);
        swingAngle += swingVel * dt;

        // プレイヤー位置を振り子から計算
        playerPos.x = hx + ropeLen * Math.sin(swingAngle);
        playerPos.y = hy - ropeLen * Math.cos(swingAngle);

        // ロープ更新
        updateRope(hx, hy);

        // ポンピング視覚合図: 増幅可能な最下点付近でロープが金色に光り太くなる
        var ropeM = ropeLine.material;
        if (pumpFlash > 0) {
          // 増幅成功の白金フラッシュ
          ropeM.color.setHex(0xffffff);
          ropeLine.scale.x = ropeLine.scale.z = 2.2;
        } else if (pumpCooldown <= 0 && pumpReady()) {
          var gp = 0.5 + 0.5 * Math.sin(ctx.elapsed * 18);
          ropeM.color.setHex(gp > 0.5 ? 0xffd700 : 0xffb300);
          ropeLine.scale.x = ropeLine.scale.z = 1.7;
        } else {
          ropeM.color.setHex(0xfff3d0);
          ropeLine.scale.x = ropeLine.scale.z = 1;
        }

        // スイング中でも距離を加算
        if (playerVel.x > 0) {
          distanceTraveled += Math.max(0, playerPos.x - (playerPos.x - playerVel.x * dt)) ;
        }
        // 位置ベースで距離を記録
        distanceTraveled = Math.max(distanceTraveled, playerPos.x);

      } else if (swingState === 'flying') {
        /* --- 物理: 飛行中 --- */
        playerVel.y -= GRAVITY * dt;
        playerPos.x += playerVel.x * dt;
        playerPos.y += playerVel.y * dt;

        ropeLine.visible = false;

        if (isHolding && tryGrabHook(ctx)) {
          syncMeshes();
        }

        // 地面に落ちたらゲームオーバー
        if (playerPos.y < GROUND_Y) {
          gameOverFlag = true;
          ctx.sfx.fail();
          ctx.vibrate(100);
          ctx.gameOver(Math.round(distanceTraveled));
          return;
        }
      }

      /* --- 距離スコア --- */
      distanceTraveled = Math.max(distanceTraveled, playerPos.x);
      ctx.setScore(Math.round(distanceTraveled));

      /* --- スクロール再配置 --- */
      recycleHooks();
      recycleBuildings();
      recycleObstacles();

      /* --- 障害物衝突判定 --- */
      // 鳩
      for (var pi = 0; pi < PIGEON_COUNT; pi++) {
        var pdx = pigeonData[pi].x - playerPos.x;
        var pdy = pigeonData[pi].y - playerPos.y;
        var pdist = Math.sqrt(pdx * pdx + pdy * pdy);
        if (pdist < 1.5) {
          playerVel.x *= 0.5;
          pigeonData[pi].x = playerPos.x + 20 + Math.random() * 10; // 衝突後遠ざける
          ctx.sfx.fail();
          ctx.vibrate(50);
        }
      }
      // 看板
      for (var ki = 0; ki < SIGN_COUNT; ki++) {
        var sdx = signData[ki].x - playerPos.x;
        var sdy = signData[ki].y - playerPos.y;
        var sdist = Math.sqrt(sdx * sdx + sdy * sdy);
        if (sdist < 1.5) {
          playerVel.x *= 0.5;
          signData[ki].x = playerPos.x + 20 + Math.random() * 10;
          ctx.sfx.fail();
          ctx.vibrate(50);
        }
      }

      /* --- 掴み圏内の合図: 最寄りフックが発光＋拡大パルス、点線ガイド表示 --- */
      var nearIdx = -1, nearD = GRAB_RADIUS;
      if (swingState === 'flying') {
        for (var nh = 0; nh < HOOK_COUNT; nh++) {
          var ndx = hookData[nh].x - playerPos.x;
          var ndy = hookData[nh].y - playerPos.y;
          var nd = Math.sqrt(ndx * ndx + ndy * ndy);
          if (nd < nearD) { nearD = nd; nearIdx = nh; }
        }
      }
      for (var hm = 0; hm < HOOK_COUNT; hm++) {
        var jg = hookMeshes[hm].userData.j;
        if (hm === nearIdx) {
          hookMeshes[hm].userData.mat.color.setHex(0xffff66);
          var pulse = 1.25 + Math.sin(ctx.elapsed * 12) * 0.2;
          jg.scale.set(pulse, pulse, pulse);
        } else {
          hookMeshes[hm].userData.mat.color.setHex(0xffcc00);
          jg.scale.set(1, 1, 1);
        }
      }
      for (var gd = 0; gd < guideDots.length; gd++) {
        if (nearIdx >= 0) {
          var gt = (gd + 1) / (guideDots.length + 1);
          guideDots[gd].position.set(
            playerPos.x + (hookData[nearIdx].x - playerPos.x) * gt,
            playerPos.y + (hookData[nearIdx].y - playerPos.y) * gt,
            0.1);
          guideDots[gd].visible = true;
        } else {
          guideDots[gd].visible = false;
        }
      }

      /* --- 鳩アニメ（羽ばたき） --- */
      var flapAngle = Math.sin(ctx.elapsed * 6) * 0.3;
      for (var pa = 0; pa < PIGEON_COUNT; pa++) {
        var pg = pigeonMeshes[pa];
        if (pg.children[0]) pg.children[0].rotation.z = 0.3 + flapAngle;
        if (pg.children[1]) pg.children[1].rotation.z = -(0.3 + flapAngle);
        // 小さな上下運動
        pigeonData[pa].y += Math.sin(ctx.elapsed * 2 + pa) * 0.005;
      }

      /* --- メッシュ位置同期 --- */
      syncMeshes();

      /* --- カメラ: 先読みフレーミングへゆっくり追従 --- */
      frameCamera(ctx);
      var cam = ctx.camera;
      var lk = Math.min(1, dt * 3.5);
      cam.position.x += (camTX - cam.position.x) * lk;
      cam.position.y += (camTY - cam.position.y) * lk;
      cam.position.z += (camTZ - cam.position.z) * lk;
      cam.lookAt(camLX, camLY, 0);

      /* --- パララックス: 遠景/中景をカメラX基準で緩く流す（奥行き感） --- */
      for (var pf = 0; pf < parallaxFar.length; pf++) {
        var span = parallaxFar.length * 7;
        var rel = (parallaxFar[pf].baseX - cam.position.x * 0.25);
        rel = ((rel % span) + span) % span;   // 0..span で巡回
        parallaxFar[pf].mesh.position.x = cam.position.x + rel - span / 2;
      }
      for (var pm = 0; pm < parallaxMid.length; pm++) {
        var span2 = parallaxMid.length * 9;
        var rel2 = (parallaxMid[pm].baseX - cam.position.x * 0.5);
        rel2 = ((rel2 % span2) + span2) % span2;
        parallaxMid[pm].mesh.position.x = cam.position.x + rel2 - span2 / 2;
      }
    }
  });
})();
