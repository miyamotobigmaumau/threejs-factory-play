/* =========================================================================
 * TMTyphoonKasa — たいふうのかさ
 * ルール: 傘の角度を合わせて飛んでくる物をガード！
 * 操作: ドラッグで傘の向きを変える
 * マッシュアップ: 台風×かさ差し
 *   - 飛来物の入射角と傘の向きが一致（±25°以内）すれば弾く
 *   - 角度がズレると傘の耐久が減る（3回でゲームオーバー）
 *   - 木のなびきで風向き予告→傘を事前に合わせる駆け引き
 * スコア: 歩けた秒数
 * allowContinue: true
 * ========================================================================= */
(function () {
  'use strict';

  /* ---- 定数 ---- */
  var GUARD_ANGLE_DEG = 28;  // ガード成功の角度許容（±度）
  var HP_MAX = 3;
  var DEBRIS_POOL = 8;       // 飛来物プール数
  var TREE_COUNT  = 5;       // 背景の木（風向き表示）

  /* ---- 飛来物の種類（出現レベル） ---- */
  var DEBRIS_TYPES = [
    { name: 'は',   color: 0x8ee04a, size: 0.34, pts: 1, level: 0 },   // 葉を大きく・明るく
    { name: 'かんばん', color: 0xffb300, size: 0.5,  pts: 2, level: 3 },
    { name: 'バケツ',   color: 0xff5252, size: 0.6,  pts: 3, level: 6 }
  ];

  /* ---- シーンオブジェクト ---- */
  var kidGroup;           // 子供（自動歩行）
  var umbGroup;           // 傘グループ
  var umbCone;            // 傘の本体 Cone
  var umbHandle;          // 傘の柄
  var roadMesh;
  var treeMeshes = [];    // 木のグループ
  var debrisMeshes = [];  // プール
  var debrisData = [];    // {active, x, y, vx, vy, type, angle}
  var rainLines = [];     // 雨のライン
  var hpIcons = [];       // HP表示（DOM）
  var guardFan;           // ガード有効範囲の扇形メッシュ
  var guardFanMat;
  var trajDots = [];      // 飛来物ごとの軌道予測ドット群 [ [mesh,...], ... ]
  var windLeaves = [];    // 風向きに流れる葉っぱパーティクル（プール）

  /* ---- 状態 ---- */
  var umbAngle;     // 傘の角度（ラジアン、0=真上、正=右傾け）
  var hp;
  var kidX;
  var lineMeshes = [];
  var houseGroups = [];
  var windAngle;    // 現在の風向き（ラジアン）
  var windTarget;   // 目標風向き（木のなびきで予告）
  var windChangeT;  // 次の風向き変化タイミング
  var spawnT;       // 次の飛来物スポーン時刻
  var spawnInterval;
  var gameActive;
  var dragging;
  var lastDragX;
  var umbFlipT;     // 傘めくれ演出の残り時間

  /* ---- UI ---- */
  var hpContainer;

  /* ---- マテリアル（共有） ---- */
  var kidMat, umbMat, roadMat, treeMat, rainMat;
  var debrisMats;

  /* ---- 飛来物をスポーン ---- */
  function spawnDebris(ctx) {
    // アクティブでないスロットを探す
    for (var i = 0; i < DEBRIS_POOL; i++) {
      if (!debrisData[i].active) {
        var elapsed = ctx.elapsed;
        var level = Math.floor(elapsed / 15); // 15秒ごとにレベルアップ
        // このレベルで出せる型を絞る
        var available = [];
        for (var t = 0; t < DEBRIS_TYPES.length; t++) {
          if (DEBRIS_TYPES[t].level <= level) available.push(t);
        }
        var typeIdx = available[Math.floor(Math.random() * available.length)];
        var type = DEBRIS_TYPES[typeIdx];

        // 風向きに沿って飛んでくる（画面外から）
        var speed = 3.5 + level * 0.6 + Math.random() * 1.2;
        // 入射角は風向き ± 少しランダム
        var angle = windAngle + (Math.random() - 0.5) * 0.2;  // 風向きにより忠実に（傘＝風に合わせる）
        var spawnX = (Math.random() - 0.5) * 7 + kidX;
        var spawnY = 5; // 上から

        debrisData[i].active = true;
        debrisData[i].x = spawnX;
        debrisData[i].y = spawnY;
        debrisData[i].vx = Math.sin(angle) * speed;
        debrisData[i].vy = -Math.cos(angle) * speed - 1.5;
        debrisData[i].type = typeIdx;
        debrisData[i].angle = angle;
        debrisData[i].hit = false;
        debrisMeshes[i].position.set(spawnX, spawnY, 0);
        for (var vv = 0; vv < debrisMeshes[i].children.length; vv++) {
          debrisMeshes[i].children[vv].visible = (vv === typeIdx);
        }
        debrisMeshes[i].scale.setScalar(type.size * 2.2);  // 大きく＝見やすく
        debrisMeshes[i].visible = true;
        return;
      }
    }
  }

  /* ---- HP アイコン更新（☂アイコンのみ・失った分は薄く） ---- */
  function updateHP() {
    for (var i = 0; i < hpIcons.length; i++) {
      hpIcons[i].style.opacity = i < hp ? '1' : '0.18';
      hpIcons[i].style.filter = i < hp ? 'none' : 'grayscale(1)';
      hpIcons[i].style.transform = i < hp ? 'scale(1)' : 'scale(0.8)';
    }
  }

  /* ---- 飛来物と傘の当たり判定 ---- */
  function checkGuard(ctx, i) {
    var d = debrisData[i];
    // 子供のY付近に来たか
    if (d.y > 2.5 || d.y < 0.8) return;
    var dx = d.x - kidX;
    if (Math.abs(dx) > 1.2) return;

    // 入射角と傘の向きの差
    // 飛来物の入射角（どの方向から来るか）: vx/vy から
    var incidentAngle = Math.atan2(d.vx, -d.vy); // 「上から来る」基準
    var angleDiff = Math.abs(incidentAngle - umbAngle);
    while (angleDiff > Math.PI) angleDiff = Math.abs(angleDiff - Math.PI * 2);

    if (angleDiff <= GUARD_ANGLE_DEG * Math.PI / 180) {
      // ガード成功：弾く
      d.vy = Math.abs(d.vy) * 0.5;
      d.vx *= -0.8;
      d.hit = true;
      ctx.sfx.bounce();
      ctx.vibrate(10);
    } else {
      // ガード失敗：耐久ダメージ。飛来物はうさぎに当たって跳ね飛ぶ
      d.hit = true;
      d.vy = 3.0 + Math.random() * 1.5;
      d.vx = (dx >= 0 ? 1 : -1) * (2.5 + Math.random() * 2);
      hp--;
      updateHP();
      ctx.sfx.fail();
      ctx.vibrate(35);
      // 傘が一瞬めくれる演出
      umbFlipT = 0.4;
      umbGroup.rotation.z = umbAngle + (Math.random() - 0.5) * 0.5;
      if (hp <= 0) {
        gameActive = false;
        ctx.gameOver(Math.floor(ctx.elapsed));
      }
    }
  }

  Shell.registerGame({
    id: 'TMTyphoonKasa',
    title: { en: 'Typhoon Umbrella', ja: 'たいふうのかさ', es: 'Paraguas del Tifón', 'pt-BR': 'Guarda-Chuva do Tufão', fr: 'Parapluie Typhon', de: 'Taifun-Schirm', it: 'Ombrello del Tifone', ko: '태풍 우산', 'zh-Hans': '台风雨伞', tr: 'Tayfun Şemsiyesi' },
    howto: { en: 'Wind changes fast! Watch the trees\nand drag to aim the umbrella at flying debris!', ja: '風はコロコロ変わる！木のなびきを見て\nかさの角度をドラッグで合わせ、飛来物をはじけ！', es: '¡El viento cambia rápido! Observa los árboles\ny arrastra para apuntar el paraguas a los objetos voladores.', 'pt-BR': 'O vento muda rápido! Observe as árvores\ne arraste para apontar o guarda-chuva nos objetos voadores.', fr: 'Le vent change vite ! Observez les arbres\net glissez pour orienter le parapluie vers les objets volants.', de: 'Wind wechselt schnell! Bäume beobachten\nund Schirm per Ziehen auf Trümmer richten.', it: 'Il vento cambia veloce! Osserva gli alberi\ne trascina per puntare l\'ombrello sui detriti volanti.', ko: '바람이 자꾸 바뀐다! 나무가 휘는 걸 보고\n드래그로 우산 각도를 맞춰 날아오는 물체를 튕겨라!', 'zh-Hans': '风向变化快！看树的弯曲方向\n拖动调整伞角，弹开飞来的物体！', tr: 'Rüzgar hızla değişir! Ağaçlara bak\nve şemsiyeyi uçan moloza yönlendirmek için sürükle!' },
    scoreLabel: { en: 'sec', ja: 'びょう', es: 'seg', 'pt-BR': 'seg', fr: 'sec', de: 'Sek', it: 'sec', ko: '초', 'zh-Hans': '秒', tr: 'sn' },
    allowContinue: true,
    bg: 0x546e7a,
    fogNear: 18, fogFar: 40,
    cameraFov: 60,
    cameraPos: [0, 3, 10],
    cameraLookAt: [0, 2, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;

      /* 道路 */
      roadMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 3),
        Style.mat(0x78909c)
      );
      roadMesh.rotation.x = -Math.PI / 2;
      roadMesh.position.set(0, 0, 0);
      ctx.scene.add(roadMesh);

      /* 歩道の白線 */
      var lineMat = Style.mat(0xffffff);
      lineMeshes.length = 0;
      for (var l = -12; l <= 12; l += 3) {
        var line = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 3), lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(l, 0.01, 0);
        ctx.scene.add(line);
        lineMeshes.push(line);
      }

      /* 子供（うさぎ） */
      var _bunny = GameBunny.make(THREE, { scale: 0.55 });
      kidGroup = _bunny.group;
      kidGroup._bunny = _bunny; // アニメ用
      ctx.scene.add(kidGroup);

      /* 傘グループ（頭上にさす） */
      umbGroup = new THREE.Group();
      umbMat = new THREE.MeshLambertMaterial({ color: 0xff7043, side: THREE.DoubleSide });
      // 傘の布部分（開いたかさ）
      umbCone = new THREE.Mesh(
        new THREE.ConeGeometry(0.95, 0.55, 16, 1, true),
        umbMat
      );
      umbCone.position.y = 0.3;
      umbGroup.add(umbCone);
      // 骨8本: 頂点から縁へ、表面に沿わせる
      var ribMat = new THREE.MeshLambertMaterial({ color: 0xbf360c });
      var apex = new THREE.Vector3(0, 0.575, 0);
      var upVec = new THREE.Vector3(0, 1, 0);
      for (var rb = 0; rb < 8; rb++) {
        var ra = rb * Math.PI / 4;
        var rimPt = new THREE.Vector3(Math.cos(ra) * 0.95, 0.025, Math.sin(ra) * 0.95);
        var ribDir = rimPt.clone().sub(apex);
        var ribLen = ribDir.length();
        var rib = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, ribLen, 4), ribMat);
        rib.position.copy(apex).add(rimPt).multiplyScalar(0.5);
        rib.quaternion.setFromUnitVectors(upVec, ribDir.normalize());
        umbGroup.add(rib);
        // 縁の飾り玉（かさのフチ感）
        var tipBall = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5),
          new THREE.MeshLambertMaterial({ color: 0xfff3e0 }));
        tipBall.position.copy(rimPt);
        umbGroup.add(tipBall);
      }
      // てっぺんの石突き
      var umbTip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.18, 6),
        new THREE.MeshLambertMaterial({ color: 0xfff3e0 }));
      umbTip.position.y = 0.66;
      umbGroup.add(umbTip);
      // 傘の柄（頭上から手元まで）
      umbHandle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 2.0, 6),
        Style.mat(0x4e342e)
      );
      umbHandle.position.y = -0.7;
      umbGroup.add(umbHandle);
      // 手元のフック
      var hook = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.028, 6, 10, Math.PI),
        Style.mat(0x4e342e));
      hook.position.y = -1.72;
      hook.rotation.z = Math.PI;
      umbGroup.add(hook);
      // うさぎ scale=0.55 → 耳先 y≈1.4、その上に傘をかかげる
      umbGroup.position.set(0, 2.9, 0);
      kidGroup.add(umbGroup);

      /* ガード有効範囲の扇形（±GUARD_ANGLE_DEG）を傘の上に常時表示 */
      var guardRad = GUARD_ANGLE_DEG * Math.PI / 180;
      guardFanMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.16,
        side: THREE.DoubleSide, depthWrite: false
      });
      guardFan = new THREE.Mesh(
        new THREE.CircleGeometry(1.9, 24, Math.PI / 2 - guardRad, guardRad * 2),
        guardFanMat
      );
      guardFan.position.set(0, 0.3, 0.08);
      umbGroup.add(guardFan);

      /* 背景の家並み（台風の住宅街） */
      houseGroups.length = 0;
      var winMat = new THREE.MeshBasicMaterial({ color: 0xfff59d });
      var houseCols = [0xeceff1, 0xffe0b2, 0xc8e6c9];
      var roofCols = [0x8d6e63, 0x546e7a, 0xa1887f];
      for (var hh = 0; hh < 3; hh++) {
        var hg = new THREE.Group();
        var hw = 2.2 + hh * 0.3;
        var body = new THREE.Mesh(Style.roundedBox(hw, 1.6, 1.2), Style.mat(houseCols[hh]));
        body.position.y = 0.8;
        hg.add(body);
        var roof = new THREE.Mesh(new THREE.ConeGeometry(hw * 0.72, 0.9, 4), Style.mat(roofCols[hh]));
        roof.position.y = 2.05;
        roof.rotation.y = Math.PI / 4;
        hg.add(roof);
        var door = new THREE.Mesh(Style.roundedBox(0.4, 0.7, 0.06), Style.mat(0x6d4c41));
        door.position.set(-hw * 0.22, 0.35, 0.62);
        hg.add(door);
        for (var ww = 0; ww < 2; ww++) {
          var win = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), winMat);
          win.position.set(hw * (0.05 + ww * 0.25), 1.0, 0.62);
          hg.add(win);
        }
        hg.position.set(-6.5 + hh * 6.2, 0, -5.5);
        ctx.scene.add(hg);
        houseGroups.push(hg);
      }

      /* 木（風向き表示） */
      treeMat = Style.mat(0x2e7d32);
      var trunkMat = Style.mat(0x5d4037);
      for (var t = 0; t < TREE_COUNT; t++) {
        var tg = new THREE.Group();
        var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.2, 6), trunkMat);
        trunk.position.y = 0.6;
        tg.add(trunk);
        var foliage = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 7), treeMat);
        foliage.position.y = 1.6;
        tg.add(foliage);
        tg.position.set(-8 + t * 4, 0, -3 - Math.random() * 2);
        ctx.scene.add(tg);
        treeMeshes.push(tg);
      }

      /* 飛来物プール（型ごとに造形: 葉/看板/バケツ） */
      for (var di = 0; di < DEBRIS_POOL; di++) {
        var dm = new THREE.Group();
        // [0] 葉っぱ（平たい緑の楕円+葉脈）
        var leafG = new THREE.Group();
        var leaf = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 6), Style.mat(0x66bb6a));
        leaf.scale.set(1.4, 0.12, 0.8);
        leafG.add(leaf);
        var vein = new THREE.Mesh(Style.roundedBox(1.2, 0.05, 0.06), Style.mat(0x4a9a52));
        leafG.add(vein);
        dm.add(leafG);
        // [1] 看板（灰の板+白面+柄）
        var signG = new THREE.Group();
        var signBoard = new THREE.Mesh(Style.roundedBox(0.9, 0.65, 0.08), Style.mat(0x78909c));
        signG.add(signBoard);
        var signFace = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45),
          new THREE.MeshBasicMaterial({ color: 0xf5f5f5 }));
        signFace.position.z = 0.05;
        signG.add(signFace);
        var signPole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6), Style.mat(0x5a6a72));
        signPole.position.y = -0.55;
        signG.add(signPole);
        dm.add(signG);
        // [2] バケツ（赤・取っ手つき）
        var bktG = new THREE.Group();
        var bkt = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.32, 0.6, 12), Style.mat(0xe57373));
        bktG.add(bkt);
        var bktHandle = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 6, 12, Math.PI), Style.mat(0x8a8f96));
        bktHandle.position.y = 0.3;
        bktG.add(bktHandle);
        dm.add(bktG);
        dm.visible = false;
        ctx.scene.add(dm);
        debrisMeshes.push(dm);
        debrisData.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, type: 0, angle: 0, hit: false });

        // 軌道予測ドット（小球の点列・プール）
        var dotArr = [];
        for (var dj = 0; dj < 6; dj++) {
          var dot = new THREE.Mesh(
            new THREE.SphereGeometry(0.07 - dj * 0.006, 6, 5),
            new THREE.MeshBasicMaterial({ color: 0xfff59d, transparent: true, opacity: 0.5 - dj * 0.06, depthWrite: false })
          );
          dot.visible = false;
          ctx.scene.add(dot);
          dotArr.push(dot);
        }
        trajDots.push(dotArr);
      }

      /* 風向きに流れる葉っぱパーティクル（プール） */
      var leafPGeo = new THREE.SphereGeometry(0.16, 8, 5);
      for (var lp = 0; lp < 6; lp++) {
        var lm = new THREE.Mesh(leafPGeo, new THREE.MeshBasicMaterial({ color: lp % 2 ? 0x9ccc65 : 0x7cb342 }));
        lm.scale.set(1.5, 0.25, 0.9);
        lm.position.set((Math.random() - 0.5) * 14, 2 + Math.random() * 3.5, -1 - Math.random() * 2);
        ctx.scene.add(lm);
        windLeaves.push({ mesh: lm, phase: Math.random() * Math.PI * 2, spd: 0.8 + Math.random() * 0.5 });
      }

      /* 雨ライン */
      rainMat = new THREE.MeshLambertMaterial({ color: 0xb0bec5, transparent: true, opacity: 0.45 });
      var rainGeo = Style.roundedBox(0.02, 0.35, 0.02);
      for (var ri = 0; ri < 50; ri++) {
        var rm = new THREE.Mesh(rainGeo, rainMat);
        rm.position.set(
          (Math.random() - 0.5) * 16,
          Math.random() * 8,
          (Math.random() - 0.5) * 6
        );
        ctx.scene.add(rm);
        rainLines.push(rm);
      }

      /* HP UI */
      hpContainer = document.createElement('div');
      hpContainer.style.cssText = 'position:fixed;top:56px;right:12px;z-index:11;' +
        'display:none;font-size:24px;';
      for (var hi = 0; hi < HP_MAX; hi++) {
        var ico = document.createElement('span');
        ico.textContent = '☂';
        ico.style.cssText = 'color:#ff7043;display:inline-block;margin-left:6px;' +
          'transition:opacity .2s,transform .2s;';
        hpContainer.appendChild(ico);
        hpIcons.push(ico);
      }
      document.body.appendChild(hpContainer);
    },

    start: function (ctx) {
      kidX = 0;
      umbAngle = 0;
      hp = HP_MAX;
      windAngle = -0.3;
      windTarget = -0.3;
      windChangeT = 4;
      spawnT = 1.5;
      spawnInterval = 2.0;
      gameActive = true;
      dragging = false;
      lastDragX = 0;
      umbFlipT = 0;
      umbCone.scale.set(1, 1, 1);

      // 飛来物をすべて非表示
      for (var i = 0; i < DEBRIS_POOL; i++) {
        debrisData[i].active = false;
        debrisMeshes[i].visible = false;
        for (var j = 0; j < trajDots[i].length; j++) trajDots[i][j].visible = false;
      }

      kidGroup.position.set(0, 0, 0);
      umbGroup.rotation.z = umbAngle;

      updateHP();
      hpContainer.style.display = '';
      ctx.setHint(ctx.t({ en: 'Drag to angle\nthe umbrella!', ja: 'ドラッグでかさの\nかくどをあわせよう！', es: '¡Arrastra para inclinar\nel paraguas!', 'pt-BR': 'Arraste para inclinar\no guarda-chuva!', fr: 'Glissez pour incliner\nle parapluie !', de: 'Ziehe zum Neigen\ndes Schirms!', it: 'Trascina per inclinare\nl\'ombrello!', ko: '드래그로 우산\n각도를 맞추자!', 'zh-Hans': '拖动调整\n伞的角度！', tr: 'Şemsiyeyi eğmek için\nsürükle!' }));
    },

    onContinue: function (ctx) {
      hp = Math.min(HP_MAX, hp + 1);
      gameActive = true;
      updateHP();
      ctx.setHint(ctx.t({ en: 'Continue!', ja: 'コンティニュー！', es: '¡Continuar!', 'pt-BR': 'Continuar!', fr: 'Continuer !', de: 'Weiter!', it: 'Continua!', ko: '계속!', 'zh-Hans': '继续！', tr: 'Devam!' }));
    },

    onPointerDown: function (ctx, p) {
      dragging = true;
      lastDragX = p.x;
    },

    onPointerMove: function (ctx, p) {
      if (!dragging) return;
      // 左右ドラッグで傘の角度を変える
      var dx = p.dx;
      umbAngle += dx * 0.018;
      umbAngle = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, umbAngle));
      umbGroup.rotation.z = umbAngle;
    },

    onPointerUp: function (ctx, p) {
      dragging = false;
    },

    update: function (ctx, dt) {
      if (!gameActive) return;

      var elapsed = ctx.elapsed;

      /* ---- 子供（うさぎ）は自動で歩く ---- */
      kidX += dt * 0.8;
      kidGroup.position.x = kidX;
      // 歩行アニメ（うさぎの脚を振る）
      if (kidGroup._bunny) {
        var wt = elapsed * 4;
        kidGroup._bunny.legL.rotation.x =  Math.sin(wt) * 0.3;
        kidGroup._bunny.legR.rotation.x = -Math.sin(wt) * 0.3;
        kidGroup._bunny.body.rotation.z = Math.sin(wt) * 0.04;
      }

      /* ---- カメラ追従 ---- */
      ctx.camera.position.x += (kidX - ctx.camera.position.x) * Math.min(dt * 2, 1);
      ctx.camera.lookAt(kidX, 2, 0);

      /* ---- 街を無限に: 道路は追従、白線・家はラップ ---- */
      roadMesh.position.x = kidX;
      var lineBase = Math.round(kidX / 3) * 3;
      for (var li = 0; li < lineMeshes.length; li++) {
        lineMeshes[li].position.x = lineBase - 12 + li * 3;
      }
      var HOUSE_SPAN = 18.6;
      for (var hi = 0; hi < houseGroups.length; hi++) {
        var hx = houseGroups[hi].position.x;
        while (hx < kidX - HOUSE_SPAN / 2) hx += HOUSE_SPAN;
        while (hx > kidX + HOUSE_SPAN / 2) hx -= HOUSE_SPAN;
        houseGroups[hi].position.x = hx;
      }

      /* ---- 風向き変化 ---- */
      windChangeT -= dt;
      if (windChangeT <= 0) {
        // 大きく振れる（±0.9rad≈±51°）→ ガード窓(±28°)を超えるので必ず傘を合わせ直す必要
        windTarget = (Math.random() - 0.5) * 1.8;
        windChangeT = 2.0 + Math.random() * 1.8;
      }
      // 滑らかに変化
      windAngle += (windTarget - windAngle) * Math.min(dt * 1.2, 1);

      /* ---- 木をなびかせて風向き予告（しなり強調） ---- */
      for (var t = 0; t < TREE_COUNT; t++) {
        var tg = treeMeshes[t];
        // 木の根元を軸に傾ける
        tg.rotation.z = windAngle * 0.8 + Math.sin(elapsed * 2 + t) * 0.05;
        // 木をカメラに追従
        tg.position.x = kidX - 8 + (t / TREE_COUNT) * 16;
      }

      /* ---- 風向きに流れる葉っぱパーティクル ---- */
      for (var wl = 0; wl < windLeaves.length; wl++) {
        var wlf = windLeaves[wl];
        wlf.mesh.position.x += Math.sin(windAngle) * 4 * wlf.spd * dt;
        wlf.mesh.position.y += Math.sin(elapsed * 3 + wlf.phase) * dt * 1.2 - dt * 0.3;
        wlf.mesh.rotation.z += dt * 4;
        wlf.mesh.rotation.x += dt * 2.5;
        if (Math.abs(wlf.mesh.position.x - kidX) > 8 || wlf.mesh.position.y < 0.5) {
          wlf.mesh.position.x = kidX - Math.sin(windAngle) * 7 + (Math.random() - 0.5) * 4;
          wlf.mesh.position.y = 2 + Math.random() * 3.5;
        }
      }

      /* ---- 傘めくれ演出の復帰 ---- */
      if (umbFlipT > 0) {
        umbFlipT -= dt;
        umbCone.scale.y = umbFlipT > 0 ? -0.6 : 1;
        if (umbFlipT <= 0) umbGroup.rotation.z = umbAngle;
      }

      /* ---- 雨を流す ---- */
      for (var ri = 0; ri < rainLines.length; ri++) {
        rainLines[ri].position.x += windAngle * dt * 3 + dt * 0.2;
        rainLines[ri].position.y -= dt * 5;
        if (rainLines[ri].position.y < -1) {
          rainLines[ri].position.y = 8;
          rainLines[ri].position.x = kidX + (Math.random() - 0.5) * 16;
        }
        rainLines[ri].rotation.z = windAngle * 0.3;
      }

      /* ---- 飛来物スポーン ---- */
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnDebris(ctx);
        // 難易度上昇でインターバルを縮める
        spawnInterval = Math.max(0.7, 2.0 - elapsed * 0.018);
        spawnT = spawnInterval;
      }

      /* ---- 飛来物の更新 ---- */
      var guardRad2 = GUARD_ANGLE_DEG * Math.PI / 180;
      var anyInGuard = false;
      for (var di = 0; di < DEBRIS_POOL; di++) {
        var d = debrisData[di];
        if (!d.active) {
          for (var td0 = 0; td0 < trajDots[di].length; td0++) trajDots[di][td0].visible = false;
          continue;
        }
        if (d.hit) d.vy -= 12 * dt; // 弾かれ/跳ね飛び後は落下
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        debrisMeshes[di].position.x = d.x;
        debrisMeshes[di].position.y = d.y;
        debrisMeshes[di].rotation.z += dt * (d.hit ? 7 : 2);

        // 軌道予測線（小球の点列）＋ ガード範囲内判定
        if (!d.hit) {
          var incA = Math.atan2(d.vx, -d.vy);
          var aDiff = Math.abs(incA - umbAngle);
          while (aDiff > Math.PI) aDiff = Math.abs(aDiff - Math.PI * 2);
          if (aDiff <= guardRad2) anyInGuard = true;
          for (var td = 0; td < trajDots[di].length; td++) {
            var tt = (td + 1) * 0.14;
            trajDots[di][td].position.set(d.x + d.vx * tt, d.y + d.vy * tt, 0);
            trajDots[di][td].visible = true;
          }
        } else {
          for (var td2 = 0; td2 < trajDots[di].length; td2++) trajDots[di][td2].visible = false;
        }

        // ガード判定
        if (!d.hit) checkGuard(ctx, di);

        // 画面外に出たら非表示
        if (d.y < -1 || Math.abs(d.x - kidX) > 12) {
          d.active = false;
          debrisMeshes[di].visible = false;
          for (var td3 = 0; td3 < trajDots[di].length; td3++) trajDots[di][td3].visible = false;
        }
      }

      /* ---- 扇形の発光: 範囲内に入る軌道の飛来物があれば緑 ---- */
      if (anyInGuard) {
        guardFanMat.color.setHex(0x69f0ae);
        guardFanMat.opacity = 0.38;
      } else {
        guardFanMat.color.setHex(0xffffff);
        guardFanMat.opacity = 0.16;
      }

      /* ---- スコアは経過秒数 ---- */
      ctx.setScore(Math.floor(elapsed));
    }
  });

})();
