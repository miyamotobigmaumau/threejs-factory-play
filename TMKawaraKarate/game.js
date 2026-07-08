/* =========================================================================
 * TMKawaraKarate — かわらわりチョップ
 * ルール: 気合メーターが振り子のように往復する。中心（MAX）でタップすると
 *         チョップ発動。精度に応じて割れる枚数が変わる（ピタリ=全枚数、
 *         ズレ=途中で止まる）。瓦が増え、メーターが速くなる。
 *         1枚も割れなかったら終了。
 * 操作: メーター中心のタイミングでタップ
 * スコア: 割った合計枚数
 * ========================================================================= */
(function () {
  'use strict';

  /* ---- 定数 ---- */
  var GREEN_MIN = 0.38;  // ゲージ緑ゾーン下限（精度良）
  var GREEN_MAX = 0.62;  // ゲージ緑ゾーン上限
  var MAX_ROUNDS = 15;   // 最大ラウンド数

  /* ---- シーンオブジェクト ---- */
  var kawaraGroup;       // 瓦グループ
  var kawaraMeshes = []; // 瓦メッシュ配列（プール）
  var handMesh;          // 手（チョップ）
  var tableMesh;         // 台
  var crackMeshes = [];  // 割れた破片プール（各瓦2分割）

  /* ---- DOM UI ---- */
  var meterBg, meterBar, meterNeedle, roundLabel;

  /* ---- 状態変数 ---- */
  var phase;       // 'ready' | 'chop' | 'result' | 'broken'
  var meterPos;    // 0..1（針の位置）
  var meterDir;    // +1/-1（針の向き）
  var meterSpeed;  // 針の速さ
  var totalKawara; // 現在の瓦枚数
  var round;       // 現在ラウンド
  var chopAnim;    // チョップアニメ進捗 0..1
  var brokenCount; // 今回割れた枚数
  var resultTimer; // 結果表示タイマー
  var kawaraVisible; // 各瓦の表示状態配列
  var wasInGreen;  // 前フレームで針が緑ゾーン内だったか（発光/ヒントの状態変化検知用）
  var stackTopY;   // 最上段瓦の上面ワールドY（チョップの到達目標）

  /* ---- うさぎの定位置（瓦の真後ろ） ---- */
  var BUNNY_HOME_X = 0, BUNNY_HOME_Y = 0, BUNNY_HOME_Z = -1.5;

  /* ---- 最上段瓦の発光ON/OFF ---- */
  function setTopGlow(on) {
    if (totalKawara <= 0) return;
    var m = kawaraMeshes[totalKawara - 1].material;
    m.emissive.setHex(on ? 0x1faa3c : 0x000000);
    m.emissiveIntensity = 1;
  }

  /* ---- 破片アニメ ---- */
  var shardAnim = []; // {mesh, vy, vx, vz, rot, t}

  /* ---- 瓦を積み上げる ---- */
  function buildKawara(THREE, scene, count) {
    // 全非表示
    for (var i = 0; i < kawaraMeshes.length; i++) {
      kawaraMeshes[i].visible = false;
    }
    totalKawara = count;
    kawaraVisible = [];
    for (var j = 0; j < count; j++) {
      var mesh = kawaraMeshes[j];
      mesh.visible = true;
      mesh.position.set(0, j * 0.17 + 0.08, 0);
      mesh.rotation.set(0, 0, 0);
      mesh.material.color.setHex(0xc47f4a);
      mesh.material.emissive.setHex(0x000000);
      mesh.material.emissiveIntensity = 1;
      kawaraVisible[j] = true;
    }
    kawaraGroup.position.y = 0.25; // 台の上面に載せる（0だと1枚目が台に埋まる）
    // 最上段瓦の上面Y（グループY + 中心Y + 厚み半分）
    stackTopY = kawaraGroup.position.y + (count - 1) * 0.17 + 0.08 + 0.055;
  }

  /* ---- DOM UI 作成 ---- */
  function buildDOM() {
    // メーター背景
    meterBg = document.createElement('div');
    meterBg.style.cssText = [
      'position:fixed;bottom:55px;left:50%;transform:translateX(-50%);',
      'width:70vw;height:20px;background:#e53935;border-radius:10px;',
      'z-index:11;overflow:hidden;display:none;'
    ].join('');

    // 緑ゾーン
    var greenZone = document.createElement('div');
    greenZone.style.cssText = [
      'position:absolute;top:0;height:100%;',
      'left:' + (GREEN_MIN * 100) + '%;',
      'width:' + ((GREEN_MAX - GREEN_MIN) * 100) + '%;',
      'background:#43a047;border-radius:4px;'
    ].join('');
    meterBg.appendChild(greenZone);

    // 中心ライン
    var centerLine = document.createElement('div');
    centerLine.style.cssText = [
      'position:absolute;top:0;height:100%;left:50%;',
      'width:3px;background:#fff8;transform:translateX(-50%);'
    ].join('');
    meterBg.appendChild(centerLine);

    // 針
    meterNeedle = document.createElement('div');
    meterNeedle.style.cssText = [
      'position:absolute;top:-3px;width:6px;height:26px;',
      'background:#fff;border-radius:3px;transform:translateX(-50%);'
    ].join('');
    meterBg.appendChild(meterNeedle);

    document.body.appendChild(meterBg);

    // ラウンド表示
    roundLabel = document.createElement('div');
    roundLabel.style.cssText = [
      'position:fixed;top:10px;right:14px;font-size:18px;font-weight:bold;',
      'color:#fff;text-shadow:0 1px 4px #000;z-index:11;display:none;'
    ].join('');
    document.body.appendChild(roundLabel);
  }

  Shell.registerGame({
    id: 'TMKawaraKarate',
    title: { en: 'Karate Chop!', ja: 'かわらわりチョップ', es: '¡Golpe de Karate!', 'pt-BR': 'Chop de Karatê!', fr: 'Coup de Karaté!', de: 'Karate-Chop!', it: 'Colpo di Karate!', ko: '가라테 잘라!', 'zh-Hans': '空手道劈砖', tr: 'Karate Darbesi!' },
    howto: { en: 'Tap when the meter hits center!\nPerfect timing breaks the most tiles!', ja: 'メーターがまんなかに来たらタップしよう。\nぴったりほど積まれた瓦がたくさん割れるよ。', es: '¡Toca cuando el medidor llegue al centro!\n¡El timing perfecto rompe más baldosas!', 'pt-BR': 'Toque quando o medidor chegar ao centro!\nO timing perfeito quebra mais telhas!', fr: 'Touchez quand le compteur atteint le centre!\nTiming parfait = plus de tuiles cassées!', de: 'Tippe wenn der Zeiger die Mitte trifft!\nPerfektes Timing bricht mehr Ziegel!', it: 'Tocca quando l\'indicatore raggiunge il centro!\nTiming perfetto = più tegole rotte!', ko: '미터가 중앙에 오면 탭!\n완벽한 타이밍이 가장 많이 깬다!', 'zh-Hans': '计量表到中间时点击！\n时机越准确打碎的瓦越多！', tr: 'Gösterge ortaya gelince dokun!\nMükemmel zamanlama daha çok kırar!' },
    scoreLabel: { en: 'tiles', ja: 'まい', es: 'baldosas', 'pt-BR': 'telhas', fr: 'tuiles', de: 'Ziegel', it: 'tegole', ko: '장', 'zh-Hans': '块', tr: 'kiremit' },
    bg: 0xc8a87a,
    cameraFov: 55,
    cameraPos: [0, 3, 8],
    cameraLookAt: [0, 1, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;
      var scene = ctx.scene;

      /* ---- 道場の床・壁 ---- */
      var floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(12, 12),
        Style.mat(0xc8a050)
      );
      floorMesh.rotation.x = -Math.PI / 2;
      scene.add(floorMesh);

      var wallMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(12, 5),
        Style.mat(0xb8860b)
      );
      wallMesh.position.set(0, 2.5, -4);
      scene.add(wallMesh);

      /* ---- 台 ---- */
      tableMesh = new THREE.Mesh(
        Style.roundedBox(2.5, 0.25, 1.2),
        Style.mat(0x7a5230)
      );
      tableMesh.position.set(0, 0.125, 0);
      scene.add(tableMesh);

      /* ---- 台の足 ---- */
      var legMat = Style.mat(0x5a3c18);
      var legGeo = Style.roundedBox(0.18, 0.8, 0.18);
      var legPositions = [[-1, 0.4, 0.4],[1, 0.4, 0.4],[-1, 0.4, -0.4],[1, 0.4, -0.4]];
      for (var li = 0; li < legPositions.length; li++) {
        var leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(legPositions[li][0], legPositions[li][1], legPositions[li][2]);
        scene.add(leg);
      }

      /* ---- 瓦プール（最大12枚） ---- */
      kawaraGroup = new THREE.Group();
      scene.add(kawaraGroup);
      var kawGeo = Style.roundedBox(2.1, 0.11, 0.92);
      var kawMat = Style.mat(0xc47f4a);
      for (var ki = 0; ki < 12; ki++) {
        var km = new THREE.Mesh(kawGeo, kawMat.clone());
        km.visible = false;
        kawaraGroup.add(km);
        kawaraMeshes.push(km);
      }
      kawaraGroup.position.set(0, 0.25, 0);

      /* ---- うさぎ（チョップ演者） ---- */
      var bunnyObj = GameBunny.make(THREE, { scale: 0.7 });
      handMesh = bunnyObj.group;
      handMesh._bunny = bunnyObj; // アニメ用に保持
      handMesh.position.set(BUNNY_HOME_X, BUNNY_HOME_Y, BUNNY_HOME_Z); // 瓦の真後ろに立つ（チョップが瓦の真上に来る）
      scene.add(handMesh);

      /* ---- 破片プール（最大24個） ---- */
      var shardGeo = Style.roundedBox(0.98, 0.1, 0.42);
      var shardMat = Style.mat(0xc47f4a);
      for (var si = 0; si < 24; si++) {
        var sm = new THREE.Mesh(shardGeo, shardMat.clone());
        sm.material.transparent = true;
        sm.material.opacity = 1;
        sm.visible = false;
        scene.add(sm);
        crackMeshes.push(sm);
        shardAnim.push({ mesh: sm, vy: 0, vx: 0, vz: 0, rot: 0, t: 0, active: false });
      }

      buildDOM();
    },

    start: function (ctx) {
      phase = 'ready';
      meterPos = 0;
      meterDir = 1;
      meterSpeed = 0.7;
      round = 1;
      brokenCount = 0;
      resultTimer = 0;
      chopAnim = 0;

      // 破片非表示
      for (var i = 0; i < shardAnim.length; i++) {
        shardAnim[i].active = false;
        crackMeshes[i].visible = false;
      }

      buildKawara(ctx.THREE, ctx.scene, 1);
      wasInGreen = false;
      handMesh.position.set(BUNNY_HOME_X, BUNNY_HOME_Y, BUNNY_HOME_Z); // initと同じ「瓦の真後ろ」
      if (handMesh._bunny) {
        handMesh._bunny.armR.rotation.x = 0;
      }

      meterBg.style.display = '';
      roundLabel.style.display = '';
      roundLabel.textContent = ctx.t({ en: 'Round ', ja: 'ラウンド ', es: 'Ronda ', 'pt-BR': 'Rodada ', fr: 'Manche ', de: 'Runde ', it: 'Round ', ko: '라운드 ', 'zh-Hans': '第', tr: 'Tur ' }) + round;

      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Tap the center!', ja: 'まんなかでタップ！', es: '¡Toca el centro!', 'pt-BR': 'Toque no centro!', fr: 'Touchez le centre!', de: 'Mitte antippen!', it: 'Tocca il centro!', ko: '중앙을 탭!', 'zh-Hans': '点击中间！', tr: 'Ortaya dokun!' }));
    },

    onPointerDown: function (ctx, p) {
      if (phase !== 'ready') return;
      phase = 'chop';
      chopAnim = 0;
      setTopGlow(false); // 合図の発光を消す
      wasInGreen = false;

      // 精度計算（中心=0.5からのズレ）
      var diff = Math.abs(meterPos - 0.5); // 0=完璧, 0.5=最悪
      var accuracy = 1 - diff * 2; // 1=完璧, 0=最悪

      // 割れる枚数（最低0枚）
      brokenCount = Math.round(accuracy * totalKawara);
      // 精度が緑ゾーン外なら0枚
      if (meterPos < GREEN_MIN || meterPos > GREEN_MAX) {
        brokenCount = Math.max(0, Math.round(accuracy * totalKawara * 0.5));
      }

      ctx.sfx.tap();
      ctx.vibrate(20);
    },

    update: function (ctx, dt) {
      // 破片アニメーション
      for (var si = 0; si < shardAnim.length; si++) {
        var sa = shardAnim[si];
        if (!sa.active) continue;
        sa.t += dt;
        sa.vy -= 9.8 * dt;
        crackMeshes[si].position.x += sa.vx * dt;
        crackMeshes[si].position.y += sa.vy * dt;
        crackMeshes[si].position.z += sa.vz * dt;
        crackMeshes[si].rotation.z += sa.rot * dt;
        crackMeshes[si].material.opacity = Math.max(0, 1 - sa.t / 0.6);
        if (sa.t > 0.6) {
          sa.active = false;
          crackMeshes[si].visible = false;
          crackMeshes[si].material.opacity = 1;
        }
      }

      if (phase === 'ready') {
        // メーター針を往復させる
        meterPos += meterDir * meterSpeed * dt;
        if (meterPos >= 1) { meterPos = 1; meterDir = -1; }
        if (meterPos <= 0) { meterPos = 0; meterDir = 1; }
        meterNeedle.style.left = (meterPos * 100) + '%';
        // 分かりやすい合図：緑ゾーン中は最上段瓦が緑に発光（状態変化時のみ切替）
        var inGreen = meterPos >= GREEN_MIN && meterPos <= GREEN_MAX;
        if (inGreen !== wasInGreen) {
          wasInGreen = inGreen;
          setTopGlow(inGreen);
          ctx.setHint(inGreen ? ctx.t({ en: '⚡ NOW! Tap to chop!', ja: '⚡ いま！タップして チョップ！', es: '⚡ ¡AHORA! ¡Toca para golpear!', 'pt-BR': '⚡ AGORA! Toque para golpear!', fr: '⚡ MAINTENANT! Touchez pour couper!', de: '⚡ JETZT! Tippe zum Schlagen!', it: '⚡ ORA! Tocca per colpire!', ko: '⚡ 지금! 탭으로 내려쳐!', 'zh-Hans': '⚡ 现在！点击劈瓦！', tr: '⚡ ŞİMDİ! Kesmek için dokun!' }) : ctx.t({ en: 'Tap when meter is center (green)!', ja: 'メーターがまん中(緑)で タップ！', es: '¡Toca cuando el medidor esté al centro (verde)!', 'pt-BR': 'Toque quando o medidor estiver no centro (verde)!', fr: 'Touchez quand le compteur est au centre (vert)!', de: 'Tippe wenn der Zeiger mittig (grün) ist!', it: 'Tocca quando l\'indicatore è al centro (verde)!', ko: '미터가 중앙(초록)일 때 탭!', 'zh-Hans': '计量表到中间（绿色）时点击！', tr: 'Gösterge ortada (yeşil) iken dokun!' }));
        }
        if (inGreen && totalKawara > 0) {
          // 発光を脈動させて「いま！」を強調
          kawaraMeshes[totalKawara - 1].material.emissiveIntensity = 0.7 + 0.35 * Math.sin(ctx.elapsed * 14);
        }
      }

      else if (phase === 'chop') {
        // チョップアニメ（振りかぶり → 前方へ振り下ろし）
        chopAnim = Math.min(chopAnim + dt * 6, 1);
        if (handMesh._bunny) {
          // 0〜0.35: 頭上へ振りかぶり / 0.35〜1: 前下方（瓦上面）へ振り下ろす
          var armTh;
          if (chopAnim < 0.35) armTh = -2.6 * (chopAnim / 0.35);
          else armTh = -2.6 + 1.5 * ((chopAnim - 0.35) / 0.65);
          handMesh._bunny.armR.rotation.x = armTh;
        }
        // 瓦の真後ろから前進＋最上段瓦に手が届く高さへ跳ぶ
        var strikeY = Math.max(0, stackTopY - 0.54); // 腕先端が最上段上面に接触する体の高さ
        var chopEase = Math.sin(Math.min(chopAnim, 1) * Math.PI * 0.5);
        handMesh.position.x = BUNNY_HOME_X;
        handMesh.position.y = BUNNY_HOME_Y + strikeY * chopEase;
        handMesh.position.z = BUNNY_HOME_Z + 0.75 * chopEase;

        if (chopAnim >= 1) {
          // 割れ処理
          if (brokenCount > 0) {
            ctx.sfx.success();
            ctx.vibrate(40);
            // 上のbrokenCount枚を割る
            var shardPoolIdx = 0;
            for (var ki = totalKawara - 1; ki >= totalKawara - brokenCount && ki >= 0; ki--) {
              kawaraMeshes[ki].visible = false;
              kawaraVisible[ki] = false;
              if (ctx.sfx && ctx.sfx.bounce) ctx.sfx.bounce();
              // 破片2個
              for (var half = 0; half < 2; half++) {
                if (shardPoolIdx >= shardAnim.length) break;
                var sa2 = shardAnim[shardPoolIdx];
                var sm2 = crackMeshes[shardPoolIdx];
                var baseY = kawaraGroup.position.y + ki * 0.17 + 0.08;
                sm2.position.set(
                  (half === 0 ? -0.52 : 0.52),
                  baseY,
                  (half === 0 ? -0.03 : 0.03)
                );
                sm2.rotation.set(0, 0, half === 0 ? -0.12 : 0.12);
                sm2.material.color.setHex(0xc47f4a);
                sm2.material.opacity = 1;
                sm2.visible = true;
                sa2.active = true;
                sa2.t = 0;
                sa2.vy = 2.2 + Math.random() * 2.6;
                sa2.vx = (half === 0 ? -1 : 1) * (2.2 + Math.random() * 2.4);
                sa2.vz = (Math.random() - 0.5) * 1.6;
                sa2.rot = (half === 0 ? -1 : 1) * (6 + Math.random() * 8);
                shardPoolIdx++;
              }
            }
            ctx.addScore(brokenCount);
            if (brokenCount < totalKawara) {
              ctx.setHint(ctx.t({ en: 'Ouch! ', ja: 'いたた… ', es: '¡Ay! ', 'pt-BR': 'Ai! ', fr: 'Aïe! ', de: 'Autsch! ', it: 'Ahia! ', ko: '아야! ', 'zh-Hans': '哎哟！', tr: 'Ah! ' }) + brokenCount + ctx.t({ en: ' tiles!', ja: 'まい！', es: ' baldosas!', 'pt-BR': ' telhas!', fr: ' tuiles!', de: ' Ziegel!', it: ' tegole!', ko: ' 장!', 'zh-Hans': '块！', tr: ' kiremit!' }));
            } else {
              ctx.setHint(ctx.t({ en: 'Broke them all!', ja: 'ぜんぶ割った！', es: '¡Las rompiste todas!', 'pt-BR': 'Quebrou todas!', fr: 'Toutes cassées!', de: 'Alle zerbrochen!', it: 'Tutte rotte!', ko: '다 깼다!', 'zh-Hans': '全部打碎！', tr: 'Hepsini kırdın!' }));
            }
          } else {
            // 1枚も割れない
            ctx.sfx.fail();
            ctx.vibrate(60);
            ctx.setHint(ctx.t({ en: 'Ouch…', ja: 'いたた…', es: '¡Ay…', 'pt-BR': 'Ai…', fr: 'Aïe…', de: 'Autsch…', it: 'Ahia…', ko: '아야…', 'zh-Hans': '哎哟…', tr: 'Ah…' }));
            // 手がジンジンする演出（軽いY揺れ）
            phase = 'broken';
            resultTimer = 0.8;
            return;
          }

          phase = 'result';
          resultTimer = 0.6;
        }
      }

      else if (phase === 'result') {
        resultTimer -= dt;
        // 腕を引き戻し、定位置（瓦の真後ろ）へ戻る
        if (handMesh._bunny) {
          handMesh._bunny.armR.rotation.x = Math.min(0,
            handMesh._bunny.armR.rotation.x + dt * 6);
        }
        var backK = Math.min(1, dt * 6);
        handMesh.position.x = BUNNY_HOME_X;
        handMesh.position.y += (BUNNY_HOME_Y - handMesh.position.y) * backK;
        handMesh.position.z += (BUNNY_HOME_Z - handMesh.position.z) * backK;
        if (resultTimer <= 0) {
          // 次のラウンドへ
          round++;
          if (round > MAX_ROUNDS) {
            meterBg.style.display = 'none';
            roundLabel.style.display = 'none';
            ctx.endGame(ctx.score);
            return;
          }
          // 瓦枚数増加（ラウンドに合わせて）
          var newCount = Math.min(round + 1, 12);
          // メーター速度増加
          meterSpeed = 0.7 + (round - 1) * 0.08;
          buildKawara(ctx.THREE, ctx.scene, newCount);
          roundLabel.textContent = ctx.t({ en: 'Round ', ja: 'ラウンド ', es: 'Ronda ', 'pt-BR': 'Rodada ', fr: 'Manche ', de: 'Runde ', it: 'Round ', ko: '라운드 ', 'zh-Hans': '第', tr: 'Tur ' }) + round;
          phase = 'ready';
          meterPos = 0;
          meterDir = 1;
          wasInGreen = false;
          ctx.setHint(ctx.t({ en: 'Tap the center!', ja: 'まんなかでタップ！', es: '¡Toca el centro!', 'pt-BR': 'Toque no centro!', fr: 'Touchez le centre!', de: 'Mitte antippen!', it: 'Tocca il centro!', ko: '중앙을 탭!', 'zh-Hans': '点击中间！', tr: 'Ortaya dokun!' }));
        }
      }

      else if (phase === 'broken') {
        // 体がジンジンアニメ
        handMesh.position.x = BUNNY_HOME_X + Math.sin(resultTimer * 40) * 0.1;
        resultTimer -= dt;
        if (resultTimer <= 0) {
          meterBg.style.display = 'none';
          roundLabel.style.display = 'none';
          ctx.gameOver(ctx.score);
        }
      }
    }
  });
})();
