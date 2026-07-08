/* =========================================================================
 * TMGhostHide — おばけたいじ（ディフェンス型・再設計版）
 * ルール: 夜の子供部屋。中央のベッドで子供が寝ている。
 *   おばけが四方の暗闇からベッドへじわじわ近づいてくる。
 *   懐中電灯の光を当てている間おばけは怯んで後退し、当て続けると成仏。
 *   ただしベッド（子供）に光を当て続けると子供が目を覚ましてしまう→終了。
 *   おばけがベッドに到達しても終了。
 * 操作: 指の位置に光円が1:1で追従（遅延・慣性なし）。
 * スコア: 成仏させた（除霊した）おばけの数（体）
 * allowContinue: true → 場のおばけを一掃して再開
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------- 定数 ---------- */
  var FLASH_RADIUS = 2.3;      // 光円の半径（ワールド）
  var BED_RADIUS = 1.5;        // ベッド到達判定の半径
  var SPAWN_RADIUS = 8.2;      // おばけ出現円の半径
  var GHOST_POOL = 8;          // プール数（同時最大）
  var PURIFY_TIME = 0.9;       // 通常おばけの成仏に必要な照射秒
  var TOUGH_PURIFY_TIME = 1.9; // 強おばけ
  var RETREAT_SPEED = 1.6;     // 光を浴びた時の後退速度
  var FIELD_X = 5.0;           // 光円移動範囲（X）
  var FIELD_Z = 5.5;           // 光円移動範囲（Z）
  var WAKE_RADIUS = 2.2;       // この距離までベッドに光を当てると子供が起き始める
  var WAKE_LIMIT = 1.9;        // 連続照射がこの秒数を超えると目を覚ます→終了
  var WAKE_RECOVER = 1.4;      // 光を離すと覚醒メーターが戻る速さ（/秒）

  /* ---------- Three.js オブジェクト ---------- */
  var ghosts = [];      // { group, headMat, bodyMat, eyes }
  var flashLight, flashCircle, flashRing;
  var flashPos;         // THREE.Vector3
  var child, childBlanket, childHead;
  var wakeGauge, wakeGaugeFill;   // 子供頭上の覚醒ゲージ（蓄積で黄→赤）
  var sparkles = [];    // 成仏パーティクル { mesh, vel, life }
  var sparklePool = [];

  /* ---------- ゲーム状態 ---------- */
  // ghost state: { active, tough, x, z, speed, purify, purifyNeed, dying, dieT }
  var gState = [];
  var spawnTimer;
  var purified;
  var wakeMeter;        // 子供の覚醒メーター（ベッドへの照射で増える）
  var overFlag;
  var raycastPlane, raycaster;

  function randBetween(a, b) { return a + Math.random() * (b - a); }

  /* ---------- 難度カーブ ---------- */
  function spawnInterval(elapsed) {
    // 2.6s → 0.9s（90秒かけて）
    var t = Math.min(elapsed / 90, 1);
    return 2.6 - t * 1.7;
  }
  function ghostSpeed(elapsed) {
    // 0.55 → 1.25 m/s
    var t = Math.min(elapsed / 90, 1);
    return randBetween(0.55, 0.7) + t * 0.55;
  }
  function toughProb(elapsed) {
    if (elapsed < 20) return 0;
    return Math.min(0.35, (elapsed - 20) / 80);
  }
  function maxActive(elapsed) {
    return Math.min(GHOST_POOL, 2 + Math.floor(elapsed / 15));
  }

  /* ---------- メッシュ生成 ---------- */
  function makeGhost(THREE) {
    var g = new THREE.Group();
    var headMat = new THREE.MeshStandardMaterial({
      color: 0xddeeff, emissive: 0x8899bb, roughness: 0.9, metalness: 0,
      transparent: true, opacity: 0.4
    });
    var bodyMat = headMat.clone();
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), headMat);
    head.position.y = 1.0;
    g.add(head);
    var body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.95, 10, 1, true), bodyMat);
    body.position.y = 0.5;
    g.add(body);
    // 目（黒）
    var eyeMat = new THREE.MeshBasicMaterial({ color: 0x223344, transparent: true, opacity: 0.9 });
    var eyes = [];
    [-0.15, 0.15].forEach(function (ex) {
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), eyeMat);
      eye.position.set(ex, 1.05, 0.36);
      g.add(eye);
      eyes.push(eye);
    });
    return { group: g, headMat: headMat, bodyMat: bodyMat, eyeMat: eyeMat };
  }

  function makeBedAndChild(THREE, scene) {
    // ベッド
    var bed = new THREE.Group();
    var frame = new THREE.Mesh(Style.roundedBox(2.4, 0.5, 1.6, 0.12), Style.mat(0x8b6f4e));
    frame.position.y = 0.25;
    bed.add(frame);
    var mattress = new THREE.Mesh(Style.roundedBox(2.2, 0.25, 1.45, 0.1), Style.mat(0xf5f0e0));
    mattress.position.y = 0.55;
    bed.add(mattress);
    // 子供（頭 + ふくらみ布団）
    childHead = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), Style.mat(0xf0c8a0));
    childHead.position.set(-0.75, 0.82, 0);
    bed.add(childHead);
    // 前髪
    var hair = new THREE.Mesh(new THREE.SphereGeometry(0.31, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.45), Style.mat(0x5a3a2a));
    hair.position.copy(childHead.position);
    hair.position.y += 0.02;
    bed.add(hair);
    childBlanket = new THREE.Mesh(Style.roundedBox(1.5, 0.35, 1.3, 0.15), Style.mat(0xf6c6d0));
    childBlanket.position.set(0.35, 0.78, 0);
    bed.add(childBlanket);
    scene.add(bed);
    child = bed;

    // 覚醒ゲージ（頭上・外枠リング＋蓄積で育つ円。黄→赤で危険を伝える）
    wakeGauge = new THREE.Group();
    var gaugeBg = new THREE.Mesh(
      new THREE.RingGeometry(0.36, 0.44, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false })
    );
    wakeGauge.add(gaugeBg);
    wakeGaugeFill = new THREE.Mesh(
      new THREE.CircleGeometry(0.36, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd23b, transparent: true, opacity: 0.9, depthWrite: false })
    );
    wakeGaugeFill.position.z = 0.01;
    wakeGauge.add(wakeGaugeFill);
    wakeGauge.position.set(-0.75, 1.9, 0);
    wakeGauge.visible = false;
    scene.add(wakeGauge);
  }

  function makeRoom(THREE, scene) {
    // 床（夜のラグ）
    var floor = new THREE.Mesh(
      new THREE.CircleGeometry(11, 28),
      new THREE.MeshStandardMaterial({ color: 0x2a2a44, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    // 丸ラグ
    var rug = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 24),
      new THREE.MeshStandardMaterial({ color: 0x3a3a5c, roughness: 0.95 })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.01;
    scene.add(rug);
    // 周囲の家具シルエット（雰囲気・当たりなし）
    var darkMat = Style.mat(0x1c1c30);
    [[-4.5, -3.5, 1.4, 2.6, 0.9], [4.6, -3.0, 1.2, 2.2, 0.8],
     [-4.8, 2.8, 1.0, 1.6, 0.9], [4.4, 3.2, 1.6, 1.2, 1.0]].forEach(function (f) {
      var m = new THREE.Mesh(Style.roundedBox(f[2], f[3], f[4], 0.1), darkMat);
      m.position.set(f[0], f[3] / 2, f[1]);
      scene.add(m);
    });
    // 月明かりの窓（奥の壁面に発光プレーン）
    var win = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.8),
      new THREE.MeshBasicMaterial({ color: 0x6677aa })
    );
    win.position.set(0, 3.2, -8.5);
    scene.add(win);
  }

  function makeFlashlight(THREE, scene) {
    flashPos = new THREE.Vector3(0, 0, 3);
    // 明るい光円（加算・目立つ）
    flashCircle = new THREE.Mesh(
      new THREE.CircleGeometry(FLASH_RADIUS, 30),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.32,
        blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flashCircle.rotation.x = -Math.PI / 2;
    flashCircle.position.y = 0.03;
    scene.add(flashCircle);
    // 縁のリング（位置が分かりやすいように）
    flashRing = new THREE.Mesh(
      new THREE.RingGeometry(FLASH_RADIUS - 0.08, FLASH_RADIUS, 36),
      new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flashRing.rotation.x = -Math.PI / 2;
    flashRing.position.y = 0.04;
    scene.add(flashRing);
    // 実光源
    flashLight = new THREE.PointLight(0xffe9a8, 1.4, 8, 1.6);
    flashLight.position.set(0, 2.2, 3);
    scene.add(flashLight);
  }

  /* ---------- 成仏パーティクル ---------- */
  function spawnSparkles(THREE, scene, x, y, z) {
    for (var i = 0; i < 8; i++) {
      var sp = sparklePool.pop();
      if (!sp) {
        sp = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 5, 4),
          new THREE.MeshBasicMaterial({ color: 0xfff7c0, transparent: true, opacity: 1 })
        );
        scene.add(sp);
      }
      sp.visible = true;
      sp.material.opacity = 1;
      sp.position.set(x, y + 0.6, z);
      sparkles.push({
        mesh: sp,
        vx: randBetween(-1, 1), vy: randBetween(1.5, 3.2), vz: randBetween(-1, 1),
        life: randBetween(0.5, 0.9)
      });
    }
  }

  function updateSparkles(dt) {
    for (var i = sparkles.length - 1; i >= 0; i--) {
      var s = sparkles[i];
      s.life -= dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      s.mesh.material.opacity = Math.max(0, s.life * 1.6);
      if (s.life <= 0) {
        s.mesh.visible = false;
        sparkles.splice(i, 1);
        sparklePool.push(s.mesh);
      }
    }
  }

  /* ---------- おばけ制御 ---------- */
  function resetGhost(i) {
    gState[i].active = false;
    gState[i].dying = false;
    ghosts[i].group.visible = false;
  }

  function spawnGhost(i, elapsed) {
    var st = gState[i];
    var ang = Math.random() * Math.PI * 2;
    st.active = true;
    st.dying = false;
    st.tough = Math.random() < toughProb(elapsed);
    st.x = Math.cos(ang) * SPAWN_RADIUS;
    st.z = Math.sin(ang) * SPAWN_RADIUS;
    st.speed = ghostSpeed(elapsed) * (st.tough ? 0.8 : 1.0);
    st.purify = 0;
    st.purifyNeed = st.tough ? TOUGH_PURIFY_TIME : PURIFY_TIME;
    st.bobPhase = Math.random() * Math.PI * 2;
    var g = ghosts[i];
    g.group.visible = true;
    g.group.position.set(st.x, 0, st.z);
    g.group.scale.set(1, 1, 1);
    // 強おばけは紫がかった色
    var col = st.tough ? 0xb9a0e8 : 0xddeeff;
    var emi = st.tough ? 0x5c4488 : 0x8899bb;
    g.headMat.color.setHex(col); g.bodyMat.color.setHex(col);
    g.headMat.emissive.setHex(emi); g.bodyMat.emissive.setHex(emi);
    g.headMat.opacity = 0; g.bodyMat.opacity = 0;
  }

  /* ---------- ポインタ→床座標（1:1追従） ---------- */
  function pointerToFloor(ctx, p) {
    raycaster.setFromCamera({ x: p.nx, y: p.ny }, ctx.camera);
    var hit = raycaster.ray.intersectPlane(raycastPlane, flashPos._tmp);
    if (hit) {
      flashPos.x = Math.max(-FIELD_X, Math.min(FIELD_X, hit.x));
      flashPos.z = Math.max(-FIELD_Z, Math.min(FIELD_Z, hit.z));
    }
  }

  /* ---------- Shell 登録 ---------- */
  Shell.registerGame({
    id: 'TMGhostHide',
    title: { en: 'Ghost Bust!', ja: 'おばけたいじ', es: '¡Caza Fantasmas!', 'pt-BR': 'Caça Fantasmas!', fr: 'Chasse aux Fantômes!', de: 'Geisterjagd!', it: 'Acchiappa Fantasmi!', ko: '귀신 퇴치!', 'zh-Hans': '捉鬼！', tr: 'Hayalet Kovma!' },
    howto: { en: 'Move the light with your finger!\nShine it on ghosts to bust them!\nDon\'t keep shining on the child — they\'ll wake up!', ja: 'ゆびでライトをうごかして\nおばけをてらして 除霊！\nベッドの子に あてつづけると おきちゃう！', es: '¡Mueve la luz con el dedo!\n¡Ilumina los fantasmas para eliminarlos!\n¡No ilumines al niño — se despertará!', 'pt-BR': 'Mova a luz com o dedo!\nIlumine os fantasmas para eliminá-los!\nNão ilumine a criança — ela vai acordar!', fr: 'Déplacez la lumière avec le doigt!\nÉclairez les fantômes pour les éliminer!\nN\'éclairez pas l\'enfant — il se réveillera!', de: 'Licht mit dem Finger bewegen!\nGeister beleuchten um sie zu vertreiben!\nKind nicht anleuchten — es wacht auf!', it: 'Muovi la luce con il dito!\nIllumina i fantasmi per cacciarli!\nNon illuminare il bambino — si sveglierà!', ko: '손가락으로 빛을 움직여라!\n유령을 비춰서 퇴치하라!\n아이에게 계속 비추면 깨어난다!', 'zh-Hans': '用手指移动灯光！\n照射幽灵将其消灭！\n不要一直照孩子——他会醒来的！', tr: 'Işığı parmağınla hareket ettir!\nHayaletleri aydınlat ve kovuştur!\nÇocuğa sürekli tutma — uyanır!' },
    scoreLabel: { en: 'busted', ja: 'たい', es: 'cazados', 'pt-BR': 'caçados', fr: 'éliminés', de: 'gebannt', it: 'cacciati', ko: '퇴치', 'zh-Hans': '消灭', tr: 'kovuldu' },
    bg: 0x0d0d1a,
    fogNear: 16, fogFar: 34,
    cameraFov: 55,
    cameraPos: [0, 11.5, 8.5],
    cameraLookAt: [0, 0, -0.3],
    allowContinue: true,

    init: function (ctx) {
      var THREE = ctx.THREE;
      makeRoom(THREE, ctx.scene);
      makeBedAndChild(THREE, ctx.scene);
      makeFlashlight(THREE, ctx.scene);

      for (var i = 0; i < GHOST_POOL; i++) {
        var g = makeGhost(THREE);
        ctx.scene.add(g.group);
        ghosts.push(g);
        gState.push({ active: false });
      }

      raycaster = new THREE.Raycaster();
      raycastPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      flashPos._tmp = new THREE.Vector3();

      // 全体をほんのり照らす微弱光（真っ暗すぎ防止）
      var amb = new THREE.AmbientLight(0x223, 0.9);
      ctx.scene.add(amb);
    },

    start: function (ctx) {
      overFlag = false;
      purified = 0;
      wakeMeter = 0;
      wakeGauge.visible = false;
      spawnTimer = 0.8;
      flashPos.set(0, 0, 3);
      for (var i = 0; i < GHOST_POOL; i++) resetGhost(i);
      for (var s = sparkles.length - 1; s >= 0; s--) {
        sparkles[s].mesh.visible = false;
        sparklePool.push(sparkles[s].mesh);
      }
      sparkles.length = 0;
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Shine light on ghosts to bust them!', ja: 'ライトでおばけをてらして 除霊！', es: '¡Ilumina los fantasmas para eliminarlos!', 'pt-BR': 'Ilumine os fantasmas para eliminá-los!', fr: 'Éclairez les fantômes pour les éliminer!', de: 'Geister beleuchten zum Vertreiben!', it: 'Illumina i fantasmi per cacciarli!', ko: '빛으로 유령을 비춰 퇴치하라!', 'zh-Hans': '用灯光照射幽灵消灭它们！', tr: 'Işıkla hayaletleri aydınlat kovuştur!' }));
    },

    onContinue: function (ctx) {
      // 場のおばけを一掃して再開
      overFlag = false;
      wakeMeter = 0;
      wakeGauge.visible = false;
      for (var i = 0; i < GHOST_POOL; i++) resetGhost(i);
      spawnTimer = 1.2;
      ctx.setHint(ctx.t({ en: 'Try again! Protect the bed!', ja: 'もういちど！ベッドをまもれ！', es: '¡Otra vez! ¡Protege la cama!', 'pt-BR': 'Mais uma vez! Proteja a cama!', fr: 'Encore! Protégez le lit!', de: 'Nochmal! Bett beschützen!', it: 'Ancora! Proteggi il letto!', ko: '다시! 침대를 지켜라!', 'zh-Hans': '再来！保护床！', tr: 'Tekrar! Yatağı koru!' }));
    },

    onPointerDown: function (ctx, p) { pointerToFloor(ctx, p); },
    onPointerMove: function (ctx, p) { pointerToFloor(ctx, p); },

    update: function (ctx, dt) {
      if (overFlag) { updateSparkles(dt); return; }
      var THREE = ctx.THREE;

      // 光の追従（見た目は即時＝1:1）
      flashCircle.position.x = flashPos.x;
      flashCircle.position.z = flashPos.z;
      flashRing.position.x = flashPos.x;
      flashRing.position.z = flashPos.z;
      flashLight.position.set(flashPos.x, 2.2, flashPos.z);
      // 光のゆらぎ
      flashCircle.material.opacity = 0.28 + Math.sin(ctx.elapsed * 7) * 0.04;

      // 子供の寝息
      childBlanket.scale.y = 1 + Math.sin(ctx.elapsed * 2.2) * 0.06;

      // ベッド（子供）への照射で覚醒メーターがたまる → 起きたら終了
      var bedDist = Math.sqrt(flashPos.x * flashPos.x + flashPos.z * flashPos.z);
      if (bedDist < WAKE_RADIUS) {
        wakeMeter += dt;
        // 近づくほど警告（光が赤み・子供が身じろぎ）
        flashCircle.material.color.setHex(0xffb060);
        flashRing.material.color.setHex(0xff7a3a);
        childHead.position.y = 0.82 + Math.sin(ctx.elapsed * 18) * 0.05 * (wakeMeter / WAKE_LIMIT);
        ctx.setHint(ctx.t({ en: '⚠ Too much light on the child!', ja: '⚠ 子供に あてすぎ！おきちゃう！', es: '⚠ ¡Demasiada luz en el niño!', 'pt-BR': '⚠ Muita luz no filho!', fr: '⚠ Trop de lumière sur l\'enfant!', de: '⚠ Zu viel Licht auf das Kind!', it: '⚠ Troppa luce sul bambino!', ko: '⚠ 아이에게 빛을 너무 많이!', 'zh-Hans': '⚠ 光照孩子太久了！', tr: '⚠ Çocuğa çok fazla ışık!' }));
        if (wakeMeter >= WAKE_LIMIT) {
          overFlag = true;
          childHead.position.y = 1.15;   // ガバッと起きる
          ctx.sfx.fail();
          ctx.vibrate(150);
          ctx.setHint(ctx.t({ en: '👶 The child woke up!', ja: '👶 子供が おきちゃった！', es: '👶 ¡El niño se despertó!', 'pt-BR': '👶 A criança acordou!', fr: '👶 L\'enfant s\'est réveillé!', de: '👶 Das Kind ist aufgewacht!', it: '👶 Il bambino si è svegliato!', ko: '👶 아이가 깨어났다!', 'zh-Hans': '👶 孩子醒了！', tr: '👶 Çocuk uyandı!' }));
          var sc1 = purified;
          setTimeout(function () { ctx.gameOver(sc1, ctx.t({ en: 'You woke the child up', ja: '子供を おこしてしまった', es: 'Despertaste al niño', 'pt-BR': 'Você acordou a criança', fr: 'Vous avez réveillé l\'enfant', de: 'Du hast das Kind aufgeweckt', it: 'Hai svegliato il bambino', ko: '아이를 깨워버렸다', 'zh-Hans': '你把孩子吵醒了', tr: 'Çocuğu uyandırdın' })); }, 700);
          return;
        }
      } else {
        wakeMeter = Math.max(0, wakeMeter - dt * WAKE_RECOVER);
        flashCircle.material.color.setHex(0xfff2b0);
        flashRing.material.color.setHex(0xffe27a);
        childHead.position.y = 0.82;
      }

      // 覚醒ゲージ: 蓄積割合で円が育ち、黄→橙→赤へ変化。満タン間近は震える
      var wf = Math.min(1, wakeMeter / WAKE_LIMIT);
      if (wf > 0.02) {
        wakeGauge.visible = true;
        wakeGaugeFill.scale.set(wf, wf, 1);
        wakeGaugeFill.material.color.setHex(wf < 0.4 ? 0xffd23b : (wf < 0.75 ? 0xff8c1a : 0xff3b30));
        wakeGauge.position.set(-0.75 + Math.sin(ctx.elapsed * 22) * 0.04 * (wf > 0.75 ? 1 : 0), 1.9, 0);
        wakeGauge.lookAt(ctx.camera.position);
      } else {
        wakeGauge.visible = false;
      }

      // スポーン
      spawnTimer -= dt;
      var activeCount = 0;
      for (var a = 0; a < GHOST_POOL; a++) if (gState[a].active) activeCount++;
      if (spawnTimer <= 0 && activeCount < maxActive(ctx.elapsed)) {
        for (var f = 0; f < GHOST_POOL; f++) {
          if (!gState[f].active) { spawnGhost(f, ctx.elapsed); break; }
        }
        spawnTimer = spawnInterval(ctx.elapsed) * randBetween(0.75, 1.25);
      }

      // おばけ更新
      for (var i = 0; i < GHOST_POOL; i++) {
        var st = gState[i];
        if (!st.active) continue;
        var g = ghosts[i];

        // 成仏アニメ
        if (st.dying) {
          st.dieT -= dt;
          g.group.position.y += dt * 2.4;
          var k = Math.max(0, st.dieT / 0.5);
          g.headMat.opacity = k; g.bodyMat.opacity = k;
          g.group.scale.set(k, 1 + (1 - k) * 0.6, k);
          if (st.dieT <= 0) resetGhost(i);
          continue;
        }

        var dxL = st.x - flashPos.x;
        var dzL = st.z - flashPos.z;
        var inLight = (dxL * dxL + dzL * dzL) < FLASH_RADIUS * FLASH_RADIUS;

        var distC = Math.sqrt(st.x * st.x + st.z * st.z);

        if (inLight) {
          // 怯んで後退 + 成仏ゲージ
          st.purify += dt;
          var pushK = RETREAT_SPEED * (st.tough ? 0.6 : 1.0);
          if (distC > 0.01) {
            st.x += (st.x / distC) * pushK * dt;
            st.z += (st.z / distC) * pushK * dt;
          }
          // 白熱（成仏が近いほど明るく）
          var heat = st.purify / st.purifyNeed;
          g.headMat.emissive.setHex(st.tough ? 0x9a7ad0 : 0xccddff);
          g.headMat.opacity = Math.min(1, 0.75 + heat * 0.25);
          g.bodyMat.opacity = g.headMat.opacity;
          // ぶるぶる怯え
          g.group.rotation.z = Math.sin(ctx.elapsed * 30) * 0.1 * (1 + heat);
          g.group.scale.setScalar(1 - heat * 0.15);

          if (st.purify >= st.purifyNeed) {
            st.dying = true;
            st.dieT = 0.5;
            purified++;
            ctx.sfx.score();
            ctx.vibrate(30);
            spawnSparkles(THREE, ctx.scene, st.x, 0, st.z);
            ctx.setHint(st.tough ? ctx.t({ en: 'Tough ghost busted!', ja: 'つよいおばけを 除霊した！', es: '¡Fantasma fuerte eliminado!', 'pt-BR': 'Fantasma forte eliminado!', fr: 'Fantôme coriace éliminé!', de: 'Starkes Geist gebannt!', it: 'Fantasma duro cacciato!', ko: '강한 유령 퇴치!', 'zh-Hans': '强力幽灵消灭！', tr: 'Güçlü hayalet kovuldu!' }) : ctx.t({ en: 'Busted!', ja: '除霊した！', es: '¡Eliminado!', 'pt-BR': 'Eliminado!', fr: 'Éliminé!', de: 'Gebannt!', it: 'Cacciato!', ko: '퇴치!', 'zh-Hans': '消灭！', tr: 'Kovuldu!' }));
          }
        } else {
          // ベッドへ接近
          st.purify = Math.max(0, st.purify - dt * 1.5); // ゲージは徐々に戻る
          if (distC > 0.01) {
            st.x -= (st.x / distC) * st.speed * dt;
            st.z -= (st.z / distC) * st.speed * dt;
          }
          var emi = st.tough ? 0x5c4488 : 0x8899bb;
          g.headMat.emissive.setHex(emi);
          // 暗闇では薄ぼんやり（近いほどはっきり＝脅威が見える）
          var vis = 0.28 + Math.max(0, (SPAWN_RADIUS - distC) / SPAWN_RADIUS) * 0.45;
          g.headMat.opacity = Math.min(g.headMat.opacity + dt * 2, vis);
          g.bodyMat.opacity = g.headMat.opacity;
          g.group.rotation.z = 0;
          g.group.scale.setScalar(1);
        }

        // ふわふわ上下
        g.group.position.set(st.x, Math.sin(ctx.elapsed * 2.5 + st.bobPhase) * 0.12, st.z);
        // ベッドの方を向く
        g.group.lookAt(0, g.group.position.y, 0);

        // ベッド到達 → ゲームオーバー
        if (distC < BED_RADIUS) {
          overFlag = true;
          ctx.sfx.fail();
          ctx.vibrate(150);
          ctx.setHint(ctx.t({ en: '😭 A ghost reached the bed!', ja: '😭 おばけがベッドに…！', es: '😭 ¡Un fantasma llegó a la cama!', 'pt-BR': '😭 Um fantasma alcançou a cama!', fr: '😭 Un fantôme a atteint le lit!', de: '😭 Ein Geist hat das Bett erreicht!', it: '😭 Un fantasma ha raggiunto il letto!', ko: '😭 유령이 침대에 도달했다!', 'zh-Hans': '😭 幽灵到达了床边！', tr: '😭 Bir hayalet yatağa ulaştı!' }));
          var sc2 = purified;
          setTimeout(function () { ctx.gameOver(sc2, ctx.t({ en: 'Ghost took the bed', ja: 'おばけに ベッドを とられた', es: 'El fantasma tomó la cama', 'pt-BR': 'O fantasma tomou a cama', fr: 'Le fantôme a pris le lit', de: 'Geist hat das Bett genommen', it: 'Il fantasma ha preso il letto', ko: '유령이 침대를 빼앗았다', 'zh-Hans': '幽灵占领了床', tr: 'Hayalet yatağı ele geçirdi' })); }, 800);
          return;
        }
      }

      updateSparkles(dt);

      // スコア: 除霊した数（体）
      ctx.setScore(purified);
    }
  });
})();
