/* =========================================================================
 * TMPancakeFlip — パンケーキがえし
 * ルール: 2段階タイミング:
 *   ① 焼き色ゲージ（白→きつね色→焦げ）がきつね色ゾーンでタップ → 宙返り発射
 *   ② 空中で回転するパンケーキが水平になった瞬間に再タップ → キャッチ
 *   両方成功で1枚完成。次はゲージが速く・回転が複雑になる。
 *   焦がすか落とすと終了。
 * 操作: 焼きタップ → 返しタップ
 * スコア: 完成枚数
 * ========================================================================= */
(function () {
  'use strict';

  /* ---- 定数 ---- */
  // 焼き色ゾーン（0=生, 0.5=ちょうど, 1=焦げ）
  var TOAST_MIN = 0.32;  // きつね色ゾーン開始
  var TOAST_MAX = 0.62;  // きつね色ゾーン終了（以降は焦げゾーン）
  var CHAR_START = 0.75; // 焦げ始まり

  // キャッチ判定窓（回転角が水平±X ラジアン以内）
  var CATCH_WINDOW_BASE = 0.7; // 最初の窓幅（広め＝やさしい）

  /* ---- シーンオブジェクト ---- */
  var panMesh;        // フライパン
  var pancakeMesh;    // パンケーキ（Cylinder）
  var kitchenMeshes;  // キッチン背景

  /* ---- DOM UI ---- */
  var toastBg, toastBar, toastZone;
  var flashDiv;          // 成功✓/失敗✗の大型フラッシュ（画面中央・拡大→フェード）
  var flashTimer = 0;    // 残り秒
  var FLASH_DUR = 0.85;  // 表示時間

  /* ---- キャッチ補助ビジュアル ---- */
  var ghostDisk;         // フライパン上の水平ゴースト（着地目標の薄い円盤）
  var catchRing;         // 窓内で点灯するリング
  var glowMesh;          // パンケーキの白発光（子メッシュ）
  var steamPool = [];    // 湯気パーティクル（プール）
  var sparklePool = [];  // キラキラ星パーティクル（プール・成功時に飛び散る）
  var stackMeshes = [];  // 皿に積み上がるパンケーキ（プール）
  var stackCount = 0;

  /* ---- 状態変数 ---- */
  var stoveFlames = [];  // コンロの青い炎
  var phase;         // 'baking' | 'flying' | 'catching' | 'done'
  var toastLevel;    // 0..1 焼き色進捗
  var toastSpeed;    // 焼き速度（ラウンドで増加）
  var flipAngle;     // パンケーキの回転角（X軸）
  var flipSpeed;     // 回転速度（rad/s）
  var flipY;         // パンケーキY位置
  var flipVY;        // パンケーキ上昇速度
  var catchWindow;   // キャッチ判定窓幅
  var resultTimer;   // 演出タイマー
  var round;         // ラウンド数（難易度）
  var extraSpins;    // 追加回転数
  var doneSuccess;   // done フェーズでの成否フラグ

  /* ---- パンケーキの色を更新 ---- */
  function updatePancakeColor(THREE, level) {
    var r, g, b;
    if (level < TOAST_MIN) {
      // 生地色（白→薄黄）
      var t = level / TOAST_MIN;
      r = 1.0; g = 0.95 - t * 0.05; b = 0.85 - t * 0.2;
    } else if (level < TOAST_MAX) {
      // きつね色
      var t2 = (level - TOAST_MIN) / (TOAST_MAX - TOAST_MIN);
      r = 1.0 - t2 * 0.2; g = 0.78 - t2 * 0.2; b = 0.2 - t2 * 0.1;
    } else if (level < CHAR_START) {
      // 濃い茶
      var t3 = (level - TOAST_MAX) / (CHAR_START - TOAST_MAX);
      r = 0.8 - t3 * 0.3; g = 0.58 - t3 * 0.3; b = 0.1;
    } else {
      // 焦げ（黒）
      var t4 = (level - CHAR_START) / (1 - CHAR_START);
      r = 0.5 - t4 * 0.45; g = 0.28 - t4 * 0.25; b = 0.05;
    }
    pancakeMesh.material.color.setRGB(r, g, b);
  }

  /* ---- DOM作成 ---- */
  function buildDOM() {
    // 焼き色ゲージ
    toastBg = document.createElement('div');
    toastBg.style.cssText = [
      'position:fixed;bottom:55px;left:50%;transform:translateX(-50%);',
      'width:65vw;height:22px;border-radius:11px;overflow:hidden;',
      'background:#e0e0e0;z-index:11;display:none;'
    ].join('');

    // グラデーション背景（生地色→きつね色→焦げ）
    var gradDiv = document.createElement('div');
    gradDiv.style.cssText = [
      'position:absolute;left:0;top:0;width:100%;height:100%;',
      'background:linear-gradient(to right,',
      '#f5f0e0 0%,',
      '#f0d080 ' + (TOAST_MIN * 100) + '%,',
      '#d4903a ' + (TOAST_MAX * 100) + '%,',
      '#7a3010 ' + (CHAR_START * 100) + '%,',
      '#1a0a00 100%);'
    ].join('');
    toastBg.appendChild(gradDiv);

    // 進捗インジケーター（白い縦線）
    toastBar = document.createElement('div');
    toastBar.style.cssText = [
      'position:absolute;top:-2px;width:4px;height:calc(100% + 4px);',
      'background:#fff;border-radius:2px;box-shadow:0 0 4px #0006;',
      'transform:translateX(-50%);left:0%;transition:none;'
    ].join('');
    toastBg.appendChild(toastBar);

    document.body.appendChild(toastBg);

    // 成功✓/失敗✗の大型フラッシュ（拡大→フェードは update() で駆動）
    flashDiv = document.createElement('div');
    flashDiv.style.cssText = [
      'position:fixed;top:38%;left:50%;',
      'transform:translate(-50%,-50%) scale(0);',
      'font-size:min(34vw,180px);font-weight:bold;line-height:1;',
      'pointer-events:none;z-index:30;display:none;',
      'text-shadow:0 4px 18px rgba(0,0,0,0.35);'
    ].join('');
    document.body.appendChild(flashDiv);
  }

  /* ---- 成功✓/失敗✗フラッシュを表示 ---- */
  function showFlash(mark, color) {
    flashDiv.textContent = mark;
    flashDiv.style.color = color;
    flashDiv.style.display = '';
    flashTimer = FLASH_DUR;
  }

  /* ---- フラッシュのアニメ更新（拡大→ホールド→フェード） ---- */
  function updateFlash(dt) {
    if (flashTimer <= 0) return;
    flashTimer -= dt;
    if (flashTimer <= 0) {
      flashDiv.style.display = 'none';
      return;
    }
    var p = 1 - flashTimer / FLASH_DUR; // 0→1
    var s, op;
    if (p < 0.25) {
      // ポップイン（オーバーシュート付き拡大）
      var q = p / 0.25;
      s = 1.35 * (1 - (1 - q) * (1 - q)); // easeOut
      op = 1;
    } else if (p < 0.6) {
      s = 1.35 - (p - 0.25) / 0.35 * 0.15; // 1.35→1.2 に落ち着く
      op = 1;
    } else {
      s = 1.2 + (p - 0.6) / 0.4 * 0.5;     // 拡大しながら
      op = 1 - (p - 0.6) / 0.4;            // フェードアウト
    }
    flashDiv.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
    flashDiv.style.opacity = op;
  }

  /* ---- キラキラ星パーティクル発生（プール再利用） ---- */
  function spawnSparkles() {
    for (var i = 0; i < sparklePool.length; i++) {
      var sp = sparklePool[i];
      var a = (i / sparklePool.length) * Math.PI * 2 + Math.random() * 0.5;
      sp.active = true;
      sp.t = 0;
      sp.vx = Math.cos(a) * (1.5 + Math.random() * 1.5);
      sp.vz = Math.sin(a) * (0.6 + Math.random() * 0.6);
      sp.vy = 2.5 + Math.random() * 2.5;
      sp.mesh.position.set(
        pancakeMesh.position.x,
        pancakeMesh.position.y + 0.2,
        pancakeMesh.position.z
      );
      sp.mesh.scale.setScalar(0.8 + Math.random() * 0.7);
      sp.mesh.material.opacity = 1;
      sp.mesh.visible = true;
    }
  }

  /* ---- 湯気パーティクルを発生（プール再利用） ---- */
  function spawnSteam() {
    for (var i = 0; i < steamPool.length; i++) {
      var s = steamPool[i];
      s.active = true;
      s.t = 0;
      s.vx = (Math.random() - 0.5) * 0.6;
      s.mesh.position.set(
        pancakeMesh.position.x + (Math.random() - 0.5) * 1.2,
        pancakeMesh.position.y + 0.2,
        pancakeMesh.position.z + (Math.random() - 0.5) * 0.6
      );
      s.mesh.scale.setScalar(0.6 + Math.random() * 0.8);
      s.mesh.material.opacity = 0.7;
      s.mesh.visible = true;
    }
  }

  /* ---- 皿にパンケーキを1枚積む ---- */
  function addToStack() {
    if (stackCount < stackMeshes.length) {
      stackMeshes[stackCount].visible = true;
      stackCount++;
    }
  }

  Shell.registerGame({
    id: 'TMPancakeFlip',
    title: { en: 'Pancake Flip', ja: 'パンケーキがえし', es: 'Voltear Panqueque', 'pt-BR': 'Virar Panqueca', fr: 'Retourner la Crêpe', de: 'Pfannkuchen wenden', it: 'Girare il Pancake', ko: '팬케이크 뒤집기', 'zh-Hans': '翻松饼', tr: 'Pankek Çevirme' },
    howto: { en: 'Tap at golden color → Tap when flat!\n2-step timing challenge!', ja: 'きつね色でタップ → 水平でタップ！\n2だんタイミングをきめろ！', es: '¡Toca al dorado → Toca en plano!\n¡2 pasos de tiempo!', 'pt-BR': 'Toque na cor dourada → Toque na horizontal!\nDesafio de 2 tempos!', fr: 'Touchez doré → Touchez à plat !\nChallenge en 2 temps !', de: 'Bei Goldfarbe tippen → Flach tippen!\n2-Stufen-Timing!', it: 'Tocca al dorato → Tocca in piano!\nTiming in 2 fasi!', ko: '황금빛에 탭 → 수평일 때 탭!\n2단계 타이밍에 도전!', 'zh-Hans': '金黄色时点击 → 水平时点击！\n两步时机挑战！', tr: 'Altın renkte dokun → Düz iken dokun!\n2 adımlı zamanlama!' },
    scoreLabel: { en: 'cakes', ja: 'まい', es: 'tortitas', 'pt-BR': 'panquecas', fr: 'crêpes', de: 'Stück', it: 'pancake', ko: '장', 'zh-Hans': '张', tr: 'adet' },
    bg: 0xfff8e1,
    cameraFov: 50,
    cameraPos: [0, 3.5, 9],
    cameraLookAt: [0, 1.5, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;
      var scene = ctx.scene;

      /* ---- キッチン背景 ---- */
      // 調理台
      var counterMat = Style.mat(0xd7ccc8);
      var counterMesh = new THREE.Mesh(Style.roundedBox(8, 0.3, 3), counterMat);
      counterMesh.position.set(0, 0.15, 0);
      scene.add(counterMesh);

      // 壁
      var wallMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 6),
        Style.mat(0xffe0b2)
      );
      wallMesh.position.set(0, 3, -1.5);
      scene.add(wallMesh);

      // 窓（枠・十字の桟・空色ガラス・カーテン）
      var winFrame = new THREE.Mesh(Style.roundedBox(2.2, 1.7, 0.12), Style.mat(0x8d6e63));
      winFrame.position.set(2, 3, -1.42);
      scene.add(winFrame);
      var winGlass = new THREE.Mesh(Style.roundedBox(1.9, 1.4, 0.06), Style.mat(0xb3e5fc));
      winGlass.position.set(2, 3, -1.36);
      scene.add(winGlass);
      var sashV = new THREE.Mesh(Style.roundedBox(0.09, 1.4, 0.08), Style.mat(0x8d6e63));
      sashV.position.set(2, 3, -1.33);
      scene.add(sashV);
      var sashH = new THREE.Mesh(Style.roundedBox(1.9, 0.09, 0.08), Style.mat(0x8d6e63));
      sashH.position.set(2, 3, -1.33);
      scene.add(sashH);
      // 窓の外の太陽と雲（ガラス面の手前に薄く）
      var winSun = new THREE.Mesh(new THREE.CircleGeometry(0.22, 14),
        new THREE.MeshBasicMaterial({ color: 0xffd54f }));
      winSun.position.set(2.55, 3.35, -1.345);
      scene.add(winSun);
      var curtainMat = Style.mat(0xffab91);
      var curtL = new THREE.Mesh(Style.roundedBox(0.35, 1.8, 0.06), curtainMat);
      curtL.position.set(0.95, 3.0, -1.3);
      scene.add(curtL);
      var curtR = new THREE.Mesh(Style.roundedBox(0.35, 1.8, 0.06), curtainMat);
      curtR.position.set(3.05, 3.0, -1.3);
      scene.add(curtR);

      // コンロ（五徳＋バーナーの青い炎）: フライパンの真下
      var stoveBase = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, 0.16, 16), Style.mat(0x4a4a50));
      stoveBase.position.set(0, 0.36, 0);
      scene.add(stoveBase);
      for (var gt = 0; gt < 4; gt++) {
        var prong = new THREE.Mesh(Style.roundedBox(0.5, 0.06, 0.1), Style.mat(0x2e2e34));
        prong.rotation.y = gt * Math.PI / 2 + Math.PI / 4;
        prong.position.set(Math.cos(gt * Math.PI / 2 + Math.PI / 4) * 0.55, 0.45, Math.sin(gt * Math.PI / 2 + Math.PI / 4) * 0.55);
        scene.add(prong);
      }
      // 青い炎のゆらめき（小さなコーン群・updateで揺らす用に保持）
      stoveFlames = [];
      for (var fl = 0; fl < 6; fl++) {
        var flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 6),
          new THREE.MeshBasicMaterial({ color: 0x5fa8ff, transparent: true, opacity: 0.85 }));
        var fa = fl * Math.PI / 3;
        flame.position.set(Math.cos(fa) * 0.42, 0.5, Math.sin(fa) * 0.42);
        scene.add(flame);
        stoveFlames.push(flame);
      }

      // できあがりの皿（左側に白い皿の山）＋生地ボウル（右）
      for (var pl = 0; pl < 3; pl++) {
        var plate = new THREE.Mesh(new THREE.CylinderGeometry(0.75 - pl * 0.03, 0.65 - pl * 0.03, 0.07, 16), Style.mat(0xf5f5f5));
        plate.position.set(-2.6, 0.35 + pl * 0.08, 0.4);
        scene.add(plate);
      }
      var bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.35, 0.5, 14), Style.mat(0xffcc80));
      bowl.position.set(2.7, 0.55, 0.3);
      scene.add(bowl);
      var batter = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.06, 14), Style.mat(0xfff3d6));
      batter.position.set(2.7, 0.78, 0.3);
      scene.add(batter);

      /* ---- フライパン ---- */
      panMesh = new THREE.Group();
      // 本体（円盤）
      var panBodyGeo = new THREE.CylinderGeometry(1.3, 1.3, 0.12, 20);
      var panMat = Style.mat(0x333333);
      var panBody = new THREE.Mesh(panBodyGeo, panMat);
      panMesh.add(panBody);
      // 縁（少し大きい Torus）
      var panRimGeo = new THREE.TorusGeometry(1.3, 0.08, 8, 20);
      var panRim = new THREE.Mesh(panRimGeo, panMat);
      panRim.rotation.x = Math.PI / 2;
      panMesh.add(panRim);
      // 柄
      var handleGeo = Style.roundedBox(0.18, 0.1, 1.4);
      var handle = new THREE.Mesh(handleGeo, panMat);
      handle.position.set(0, 0, 1.55);
      panMesh.add(handle);
      panMesh.position.set(0, 0.5, 0);
      scene.add(panMesh);

      /* ---- パンケーキ ---- */
      pancakeMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.1, 0.18, 20),
        Style.mat(0xfff8e1)
      );
      pancakeMesh.position.set(0, 0.71, 0);
      scene.add(pancakeMesh);

      /* ---- キャッチ補助ビジュアル ---- */
      // 水平ゴースト（フライパン上の着地目標・薄い円盤・飛行中は常時表示）
      ghostDisk = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.1, 0.05, 20),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false })
      );
      ghostDisk.position.set(0, 0.71, 0);
      ghostDisk.visible = false;
      scene.add(ghostDisk);

      // キャッチ窓リング（水平±catchWindow に入ると点灯）
      catchRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.45, 0.06, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xfff176, transparent: true, opacity: 0.9, depthWrite: false })
      );
      catchRing.rotation.x = Math.PI / 2;
      catchRing.visible = false;
      scene.add(catchRing);

      // パンケーキの白発光（子メッシュ＝回転に自動追従）
      glowMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1.18, 1.18, 0.24, 20),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false })
      );
      glowMesh.visible = false;
      pancakeMesh.add(glowMesh);

      // 湯気パーティクル（プール）
      steamPool = [];
      for (var st = 0; st < 8; st++) {
        var steam = new THREE.Mesh(
          new THREE.SphereGeometry(0.1, 6, 5),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })
        );
        steam.visible = false;
        scene.add(steam);
        steamPool.push({ mesh: steam, t: 0, active: false, vx: 0 });
      }

      // キラキラ星パーティクル（プール・成功キャッチ時に放射）
      sparklePool = [];
      for (var sq = 0; sq < 14; sq++) {
        var star = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.14),
          new THREE.MeshBasicMaterial({
            color: (sq % 3 === 0) ? 0xffffff : 0xffd54f,
            transparent: true, opacity: 0, depthWrite: false
          })
        );
        star.visible = false;
        scene.add(star);
        sparklePool.push({ mesh: star, t: 0, active: false, vx: 0, vy: 0, vz: 0 });
      }

      // 皿に積み上がるパンケーキ（プール）
      stackMeshes = [];
      for (var sk = 0; sk < 10; sk++) {
        var stacked = new THREE.Mesh(
          new THREE.CylinderGeometry(0.55, 0.55, 0.11, 16),
          Style.mat(0xd4903a)
        );
        stacked.position.set(-2.6, 0.65 + sk * 0.12, 0.4);
        stacked.visible = false;
        scene.add(stacked);
        stackMeshes.push(stacked);
      }

      buildDOM();
    },

    start: function (ctx) {
      phase = 'baking';
      toastLevel = 0;
      toastSpeed = 0.10;
      flipAngle = 0;
      flipSpeed = 0;
      flipY = 0.71;
      flipVY = 0;
      catchWindow = CATCH_WINDOW_BASE;
      resultTimer = 0;
      round = 1;
      extraSpins = 0;
      doneSuccess = false;

      pancakeMesh.position.set(0, 0.71, 0);
      pancakeMesh.rotation.set(0, 0, 0);
      updatePancakeColor(ctx.THREE, 0);

      toastBg.style.display = '';
      toastBar.style.left = '0%';

      ghostDisk.visible = false;
      catchRing.visible = false;
      glowMesh.visible = false;
      stackCount = 0;
      for (var si = 0; si < stackMeshes.length; si++) stackMeshes[si].visible = false;
      for (var pi = 0; pi < steamPool.length; pi++) { steamPool[pi].active = false; steamPool[pi].mesh.visible = false; }
      for (var qi = 0; qi < sparklePool.length; qi++) { sparklePool[qi].active = false; sparklePool[qi].mesh.visible = false; }
      flashTimer = 0;
      flashDiv.style.display = 'none';

      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Tap at golden color!', ja: 'きつね色でタップ！', es: '¡Toca al color dorado!', 'pt-BR': 'Toque na cor dourada!', fr: 'Touchez quand c\'est doré !', de: 'Bei Goldfarbe tippen!', it: 'Tocca quando è dorato!', ko: '황금빛에 탭!', 'zh-Hans': '金黄色时点击！', tr: 'Altın renkte dokun!' }));
    },

    onPointerDown: function (ctx, p) {
      // コンロの炎ゆらぎ
      for (var sf2 = 0; sf2 < stoveFlames.length; sf2++) {
        var flm = stoveFlames[sf2];
        var fs = 0.8 + 0.35 * Math.sin(ctx.elapsed * 11 + sf2 * 1.7);
        flm.scale.set(1, fs, 1);
      }

      if (phase === 'baking') {
        // 焼き色チェック
        if (toastLevel >= CHAR_START) {
          // 焦げた → 失敗
          ctx.sfx.fail();
          ctx.vibrate(60);
          showFlash('✗', '#ff5544');
          phase = 'done';
          doneSuccess = false;
          resultTimer = 0.5;
          return;
        }
        if (toastLevel >= TOAST_MIN && toastLevel < CHAR_START) {
          // きつね色ゾーン → 投げる
          var perfect = toastLevel >= TOAST_MIN && toastLevel <= TOAST_MAX;
          if (perfect) {
            ctx.sfx.score();
            ctx.vibrate(20);
          } else {
            ctx.sfx.tap();
          }
          phase = 'flying';
          flipVY = 6 + (perfect ? 1 : 0);
          flipSpeed = (Math.PI * 2) * (1 + extraSpins) * (perfect ? 0.62 : 0.45); // 回転ゆっくり＝合わせやすい
          flipAngle = 0;
          toastBg.style.display = 'none';
          ghostDisk.visible = true; // 着地目標の水平ゴーストを表示
          ctx.setHint(ctx.t({ en: 'Tap when flat!', ja: '水平でタップ！', es: '¡Toca cuando esté plano!', 'pt-BR': 'Toque quando estiver plano!', fr: 'Touchez quand c\'est plat !', de: 'Flach tippen!', it: 'Tocca quando è in piano!', ko: '수평일 때 탭!', 'zh-Hans': '水平时点击！', tr: 'Düz iken dokun!' }));
        } else {
          // まだ生地 → 何もしない
          ctx.setHint(ctx.t({ en: 'A little more...', ja: 'もうすこし...', es: 'Un poco más...', 'pt-BR': 'Um pouco mais...', fr: 'Encore un peu...', de: 'Noch etwas...', it: 'Ancora un po\'...', ko: '조금만 더...', 'zh-Hans': '再等一下…', tr: 'Biraz daha...' }));
        }
      }

      else if (phase === 'catching') {
        // 回転角が水平（0 or π mod π）かチェック
        var angle = flipAngle % (Math.PI); // 0..π
        var nearZero = angle < catchWindow || angle > Math.PI - catchWindow;
        if (nearZero) {
          // キャッチ成功 → 大きな✓＋キラキラ＋湯気で「成功！」を明確に
          ctx.sfx.success();
          ctx.vibrate([40, 40, 60]);
          ctx.addScore(1);
          phase = 'done';
          doneSuccess = true;
          resultTimer = 0.9;
          pancakeMesh.rotation.x = 0; // 水平にリセット
          showFlash('✓', '#3ddc60'); // 画面中央に大きな✓（拡大→フェード）
          spawnSparkles(); // キラキラ星
          spawnSteam();    // 湯気
          addToStack();    // 皿に1枚積む
          ctx.setHint(ctx.t({ en: 'Nice catch!', ja: 'ナイスキャッチ！', es: '¡Buena atrapada!', 'pt-BR': 'Boa pegada!', fr: 'Belle prise !', de: 'Super gefangen!', it: 'Bella presa!', ko: '나이스 캐치!', 'zh-Hans': '接得漂亮！', tr: 'Harika yakalayış!' }));
        } else {
          // 落とす
          ctx.sfx.fail();
          ctx.vibrate(60);
          showFlash('✗', '#ff5544');
          phase = 'done';
          doneSuccess = false;
          resultTimer = 0.5;
          // 落下演出
          flipVY = -2;
        }
        ghostDisk.visible = false;
        catchRing.visible = false;
        glowMesh.visible = false;
      }
    },

    update: function (ctx, dt) {
      // コンロの炎ゆらぎ
      for (var sf2 = 0; sf2 < stoveFlames.length; sf2++) {
        var flm = stoveFlames[sf2];
        var fs = 0.8 + 0.35 * Math.sin(ctx.elapsed * 11 + sf2 * 1.7);
        flm.scale.set(1, fs, 1);
      }

      // 湯気パーティクル更新（プール）
      for (var sm = 0; sm < steamPool.length; sm++) {
        var stm = steamPool[sm];
        if (!stm.active) continue;
        stm.t += dt;
        stm.mesh.position.y += dt * 1.4;
        stm.mesh.position.x += stm.vx * dt;
        stm.mesh.material.opacity = Math.max(0, 0.7 * (1 - stm.t / 0.9));
        if (stm.t >= 0.9) { stm.active = false; stm.mesh.visible = false; }
      }

      // キラキラ星パーティクル更新（プール）
      for (var sk2 = 0; sk2 < sparklePool.length; sk2++) {
        var spk = sparklePool[sk2];
        if (!spk.active) continue;
        spk.t += dt;
        spk.vy -= 7 * dt; // ゆるい重力
        spk.mesh.position.x += spk.vx * dt;
        spk.mesh.position.y += spk.vy * dt;
        spk.mesh.position.z += spk.vz * dt;
        spk.mesh.rotation.x += dt * 8;
        spk.mesh.rotation.y += dt * 10;
        spk.mesh.material.opacity = Math.max(0, 1 - spk.t / 0.8);
        if (spk.t >= 0.8) { spk.active = false; spk.mesh.visible = false; }
      }

      // ✓/✗フラッシュ更新
      updateFlash(dt);

      if (phase === 'baking') {
        // 焼き色進捗
        toastLevel = Math.min(toastLevel + toastSpeed * dt, 1);
        updatePancakeColor(ctx.THREE, toastLevel);
        toastBar.style.left = (toastLevel * 100) + '%';

        // 完全に焦げたら失敗
        if (toastLevel >= 1) {
          ctx.sfx.fail();
          ctx.vibrate(60);
          showFlash('✗', '#ff5544');
          phase = 'done';
          doneSuccess = false;
          resultTimer = 0.6;
          toastBg.style.display = 'none';
        }
      }

      else if (phase === 'flying') {
        flipVY -= 12 * dt;
        flipY += flipVY * dt;
        pancakeMesh.position.y = flipY;
        flipAngle += flipSpeed * dt;
        pancakeMesh.rotation.x = flipAngle;

        // 頂点を過ぎたら catching フェーズ
        if (flipVY < 0 && flipY < 1.5) {
          phase = 'catching';
        }

        // 落下しすぎたら失敗
        if (flipY < 0.2) {
          ctx.sfx.fail();
          ctx.vibrate(60);
          showFlash('✗', '#ff5544');
          ghostDisk.visible = false;
          phase = 'done';
          resultTimer = 0.5;
        }
      }

      else if (phase === 'catching') {
        flipVY -= 12 * dt;
        flipY += flipVY * dt;
        pancakeMesh.position.y = flipY;
        flipAngle += flipSpeed * dt;
        pancakeMesh.rotation.x = flipAngle;

        // キャッチ窓の可視化: 水平±catchWindow 内で白発光＋リング点灯
        var winAngle = flipAngle % Math.PI;
        var inWindow = winAngle < catchWindow || winAngle > Math.PI - catchWindow;
        glowMesh.visible = inWindow;
        catchRing.visible = inWindow;
        if (inWindow) {
          catchRing.position.set(pancakeMesh.position.x, pancakeMesh.position.y, pancakeMesh.position.z);
        }

        // 落としたら失敗
        if (flipY < 0.2) {
          ctx.sfx.fail();
          ctx.vibrate(60);
          showFlash('✗', '#ff5544');
          ghostDisk.visible = false;
          catchRing.visible = false;
          glowMesh.visible = false;
          phase = 'done';
          doneSuccess = false;
          resultTimer = 0.5;
        }
      }

      else if (phase === 'done') {
        resultTimer -= dt;
        // パンケーキが空中なら落下させる
        if (flipY > 0.71) {
          flipVY -= 10 * dt;
          flipY += flipVY * dt;
          pancakeMesh.position.y = Math.max(flipY, 0.2);
        }
        if (resultTimer <= 0) {
          if (doneSuccess) {
            // キャッチ成功 → 次の焼き開始
            round++;
            toastLevel = 0;
            // 難易度増加
            toastSpeed = 0.10 + (round - 1) * 0.02;
            extraSpins = Math.floor((round - 1) / 4); // 4ラウンドごとに+1回転（ゆるめ）
            catchWindow = Math.max(CATCH_WINDOW_BASE - (round - 1) * 0.02, 0.4);
            flipY = 0.71;
            flipAngle = 0;
            doneSuccess = false;
            pancakeMesh.position.set(0, 0.71, 0);
            pancakeMesh.rotation.set(0, 0, 0);
            updatePancakeColor(ctx.THREE, 0);
            toastBg.style.display = '';
            toastBar.style.left = '0%';
            phase = 'baking';
            ctx.setHint(ctx.t({ en: 'Tap at golden color!', ja: 'きつね色でタップ！', es: '¡Toca al color dorado!', 'pt-BR': 'Toque na cor dourada!', fr: 'Touchez quand c\'est doré !', de: 'Bei Goldfarbe tippen!', it: 'Tocca quando è dorato!', ko: '황금빛에 탭!', 'zh-Hans': '金黄色时点击！', tr: 'Altın renkte dokun!' }));
          } else {
            // 落とした or 焦がした → ゲームオーバー
            flashTimer = 0;
            flashDiv.style.display = 'none';
            ctx.gameOver(ctx.score);
          }
        }
      }
    }
  });
})();
