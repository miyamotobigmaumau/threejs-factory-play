/* =========================================================================
 * TFSteppingStones — とびいし
 * ルール: 川の飛び石を渡っていく。長押しでパワーゲージ＋照準マーカーが
 *         のび、離すとジャンプ(放物線)。石に乗れば続行、水に落ちたら終了。
 *         石はだんだん小さくなり、流れて動く石も出てくる。
 * 操作: 長押しで ため → 左右にずらして ねらう → 離してジャンプ
 * スコア: わたった石の数 (いし)  / コンティニュー可
 * ========================================================================= */
(function () {
  'use strict';

  var STONE_POOL = 10;     // 画面内に必要な石の数

  var chara, marker, lily = [], droplets = [];
  var stones = [];         // { mesh, index, x0, z, r, moving, amp, spd, phase }
  var powerBar, powerBarBg;
  var charging, power, aimX;
  var jumping, jumpT, jumpDur, fromPos, toPos;
  var charIndex;           // いま乗っている石の番号(=スコア)
  var sinking, sinkT, ended;
  var splashRing, splashT;
  var tmpFrom, tmpTo;      // 使い回しベクトル

  // ---- 水の演出(意味もなく美しく) ----
  var waterDeep;           // 底面: 岸→中央の深みグラデ(静的)
  var waterSurf;           // 表面: 頂点アニメの波
  var waterShimmer;        // 煌めき: 加算ブレンドの光模様(UVスクロール)
  var sparkles = [];       // キラキラ Points ×2層(位相ちがいで瞬く)
  var ripples = [];        // 自然発生する波紋リングのプール
  var rippleTimer = 0;
  var SURF_W = 26, SURF_L = 96, SURF_SX = 26, SURF_SY = 64;

  /* 波の高さ(ワールド座標基準・ゆったりした3重サイン) */
  function waveH(wx, wz, t) {
    return Math.sin(wx * 0.55 + t * 1.15) * 0.045 +
           Math.sin(wz * 0.38 + t * 0.85) * 0.055 +
           Math.sin((wx + wz) * 0.24 - t * 0.6) * 0.035;
  }

  /* 深みグラデ(岸=浅い水色 → 中央=深い青)の横断テクスチャ */
  function makeDepthTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 8;
    var g = cv.getContext('2d');
    var grd = g.createLinearGradient(0, 0, 256, 0);
    grd.addColorStop(0.00, '#a5e0ee');
    grd.addColorStop(0.30, '#6fbede');
    grd.addColorStop(0.50, '#4a9bd0');
    grd.addColorStop(0.70, '#6fbede');
    grd.addColorStop(1.00, '#a5e0ee');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 8);
    return new THREE.CanvasTexture(cv);
  }

  /* 煌めき(水面の光模様)テクスチャ。RepeatWrapping でゆっくり流す */
  function makeShimmerTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    var g = cv.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineCap = 'round';
    for (var i = 0; i < 46; i++) {
      var x = Math.random() * 256, y = Math.random() * 256;
      var len = 8 + Math.random() * 26;
      var a = (Math.random() - 0.5) * 0.9;
      g.lineWidth = 1 + Math.random() * 2.2;
      g.globalAlpha = 0.25 + Math.random() * 0.55;
      g.beginPath();
      g.moveTo(x - Math.cos(a) * len / 2, y - Math.sin(a) * len / 2);
      g.lineTo(x + Math.cos(a) * len / 2, y + Math.sin(a) * len / 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 10);
    return tex;
  }

  /* キラキラ粒子のスプライト(radial 星) */
  function makeSparkleTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    var g = cv.getContext('2d');
    var grd = g.createRadialGradient(32, 32, 1, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(230,250,255,0.8)');
    grd.addColorStop(1, 'rgba(230,250,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  }

  /* 水まわり一式を組み立てる */
  function buildWater(ctx) {
    var THREE = ctx.THREE;

    // 底面(不透明・深みグラデ)。表面波の下に敷く
    waterDeep = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 400),
      new THREE.MeshBasicMaterial({ map: makeDepthTexture(THREE) })
    );
    waterDeep.rotation.x = -Math.PI / 2;
    waterDeep.position.set(0, -0.25, -150); // 波の最下点(-0.14)より下に敷く(波が潜って消えるのを防ぐ)
    ctx.scene.add(waterDeep);

    // 表面波(半透明・頂点アニメ)。カメラ前方ぶんだけ動かす
    waterSurf = new THREE.Mesh(
      new THREE.PlaneGeometry(SURF_W, SURF_L, SURF_SX, SURF_SY),
      new THREE.MeshLambertMaterial({ color: 0xaee4f4, transparent: true, opacity: 0.58 })
    );
    waterSurf.rotation.x = -Math.PI / 2;
    waterSurf.position.set(0, 0.0, -30);
    ctx.scene.add(waterSurf);

    // 煌めき(加算ブレンド・UVを2方向にゆっくりスクロール)
    waterShimmer = new THREE.Mesh(
      new THREE.PlaneGeometry(SURF_W, SURF_L),
      new THREE.MeshBasicMaterial({
        map: makeShimmerTexture(THREE), transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    waterShimmer.rotation.x = -Math.PI / 2;
    waterShimmer.position.set(0, 0.09, -30);
    ctx.scene.add(waterShimmer);

    // キラキラ Points ×2層(位相ちがいの瞬き)
    var sparkTex = makeSparkleTexture(THREE);
    for (var layer = 0; layer < 2; layer++) {
      var N = 26;
      var pos = new Float32Array(N * 3);
      for (var i = 0; i < N; i++) {
        pos[i * 3] = (Math.random() * 2 - 1) * 6;
        pos[i * 3 + 1] = 0.12;
        pos[i * 3 + 2] = -Math.random() * 70;
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      var mat = new THREE.PointsMaterial({
        map: sparkTex, size: 0.42, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
      });
      var pts = new THREE.Points(geo, mat);
      ctx.scene.add(pts);
      sparkles.push(pts);
    }

    // 自然発生する波紋リングのプール
    for (var r = 0; r < 6; r++) {
      var ring = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.36, 24),
        new THREE.MeshBasicMaterial({ color: 0xeaf9ff, transparent: true, opacity: 0, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.07;
      ring.visible = false;
      ctx.scene.add(ring);
      ripples.push({ mesh: ring, t: -1 });
    }
  }

  /* 水の毎フレーム更新(波・煌めき・キラキラ・波紋) */
  function updateWater(ctx, dt, time, followZ) {
    // 各レイヤはキャラ前方に追従(波はワールド座標基準なので滑らない)
    var cz = followZ - 28;
    waterSurf.position.z = cz;
    waterShimmer.position.z = cz;
    waterDeep.position.z = followZ - 150;

    // 表面波: ワールド座標で高さを計算(rotation -90° 後: local y → world -z)
    var posAttr = waterSurf.geometry.attributes.position;
    var mx = waterSurf.position.x, mz = waterSurf.position.z;
    for (var i = 0; i < posAttr.count; i++) {
      var wx = mx + posAttr.getX(i);
      var wz = mz - posAttr.getY(i);
      posAttr.setZ(i, waveH(wx, wz, time));
    }
    posAttr.needsUpdate = true;

    // 煌めき: UVを2方向にゆっくり流し、明滅
    var sMap = waterShimmer.material.map;
    sMap.offset.x = time * 0.015;
    sMap.offset.y = -time * 0.05;
    waterShimmer.material.opacity = 0.16 + 0.08 * Math.sin(time * 1.7);

    // キラキラ: 層ごとに位相ちがいの瞬き＋後方に流れたら前方へ回す
    for (var s = 0; s < sparkles.length; s++) {
      var pts = sparkles[s];
      pts.material.opacity = 0.35 + 0.45 * Math.abs(Math.sin(time * (2.2 + s * 0.9) + s * 1.7));
      var pa = pts.geometry.attributes.position;
      var moved = false;
      for (var k = 0; k < pa.count; k++) {
        if (pa.getZ(k) > followZ + 9) {
          pa.setX(k, (Math.random() * 2 - 1) * 6);
          pa.setZ(k, followZ - 60 - Math.random() * 12);
          moved = true;
        }
      }
      if (moved) pa.needsUpdate = true;
    }

    // 波紋: ランダムに発生 → ひろがって消える
    rippleTimer -= dt;
    if (rippleTimer <= 0) {
      rippleTimer = 0.45 + Math.random() * 0.5;
      for (var q = 0; q < ripples.length; q++) {
        if (ripples[q].t < 0) {
          var rp = ripples[q];
          rp.t = 0;
          rp.mesh.visible = true;
          rp.mesh.position.x = (Math.random() * 2 - 1) * 5.5;
          rp.mesh.position.z = followZ - 8 - Math.random() * 40;
          break;
        }
      }
    }
    for (var w = 0; w < ripples.length; w++) {
      var rr = ripples[w];
      if (rr.t < 0) continue;
      rr.t += dt;
      var k2 = rr.t / 1.4;
      rr.mesh.scale.set(1 + k2 * 4.5, 1 + k2 * 4.5, 1);
      rr.mesh.material.opacity = Math.max(0, 0.5 * (1 - k2));
      if (k2 >= 1) { rr.t = -1; rr.mesh.visible = false; }
    }
  }

  /* 石の現在のX座標(流れる石は揺れる) */
  function stoneX(s, time) {
    return s.moving ? s.x0 + Math.sin(time * s.spd + s.phase) * s.amp : s.x0;
  }

  /* index 番の石のパラメータを作る */
  function setupStone(s, index, random) {
    s.index = index;
    s.z = -index * 3.1 - random() * 1.2; // index に応じて前方へ(間隔ゆらぎつき)
    s.x0 = index === 0 ? 0 : (random() * 2 - 1) * Math.min(2.4, 0.8 + index * 0.12);
    s.r = Math.max(0.52, 1.05 - index * 0.022);
    s.moving = index >= 6 && random() < Math.min(0.55, 0.1 + index * 0.02);
    s.amp = 0.6 + random() * 0.9;
    s.spd = 0.8 + random() * 0.8;
    s.phase = random() * Math.PI * 2;
    s.mesh.scale.set(s.r, 1, s.r);
    s.mesh.position.set(s.x0, 0.12, s.z);
  }

  /* キャラを index 番の石の上に立たせる */
  function placeOnStone(index, time) {
    for (var i = 0; i < stones.length; i++) {
      if (stones[i].index === index) {
        var s = stones[i];
        chara.position.set(stoneX(s, time), 0.55, s.z);
        return s;
      }
    }
    return null;
  }

  /* 使い終わった石を前方に回す */
  function recycleStones(random) {
    var maxIndex = 0;
    for (var i = 0; i < stones.length; i++) if (stones[i].index > maxIndex) maxIndex = stones[i].index;
    for (var j = 0; j < stones.length; j++) {
      if (stones[j].index < charIndex - 1) {
        maxIndex++;
        setupStone(stones[j], maxIndex, random);
      }
    }
  }

  function makeChara(THREE) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.34, 0.55, 10),
      Style.mat(0xff8a3c)
    );
    body.position.y = 0.28;
    var head = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 10),
      Style.mat(0xffd9b0)
    );
    head.position.y = 0.78;
    var hat = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.3, 10),
      Style.mat(0xe6c34a)
    );
    hat.position.y = 1.05;
    var eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    var eyeGeo = new THREE.SphereGeometry(0.05, 6, 6);
    var eL = new THREE.Mesh(eyeGeo, eyeMat);
    eL.position.set(-0.1, 0.82, -0.26);
    var eR = new THREE.Mesh(eyeGeo, eyeMat);
    eR.position.set(0.1, 0.82, -0.26);
    g.add(body, head, hat, eL, eR);
    return g;
  }

  Shell.registerGame({
    id: 'TFSteppingStones',
    title: { en: 'Stepping Stones', ja: 'とびいし', es: 'Piedras de Salto', 'pt-BR': 'Pedras do Rio', fr: 'Pierres Sauteuses', de: 'Trittsteine', it: 'Pietre Saltanti', ko: '징검다리', 'zh-Hans': '跳石头', tr: 'Atlama Taşları' },
    howto: { en: 'Hold to charge, release to jump!\nHop from stone to stone!', ja: 'ながおしで ため、はなして ジャンプ！\nいしから いしへ わたろう', es: '¡Mantén para cargar, suelta para saltar!\n¡Salta de piedra en piedra!', 'pt-BR': 'Segure para carregar, solte para pular!\nPule de pedra em pedra!', fr: 'Maintenez pour charger, relâchez pour sauter!\nSautez de pierre en pierre!', de: 'Halten zum Laden, loslassen zum Springen!\nVon Stein zu Stein hüpfen!', it: 'Tieni premuto per caricare, rilascia per saltare!\nSalta da pietra in pietra!', ko: '길게 눌러 충전, 놓아서 점프!\n돌에서 돌로 건너자!', 'zh-Hans': '长按蓄力，松手跳跃！\n从石头跳到石头！', tr: 'Basılı tut yükle, bırak zıpla!\nTaştan taşa atla!' },
    scoreLabel: { en: 'stone', ja: 'いし', es: 'piedra', 'pt-BR': 'pedra', fr: 'pierre', de: 'Stein', it: 'pietra', ko: '개', 'zh-Hans': '块', tr: 'taş' },
    bg: 0xa8d8a0,
    fogNear: 20, fogFar: 55,
    cameraFov: 60,
    allowContinue: true,

    init: function (ctx) {
      var THREE = ctx.THREE;
      tmpFrom = new THREE.Vector3();
      tmpTo = new THREE.Vector3();

      // 小川(深みグラデ底面＋波＋煌めき＋キラキラ＋波紋)
      buildWater(ctx);

      // 両岸の土手と草
      var bankMat = Style.mat(0x8bc34a);
      var bankGeo = Style.roundedBox(8, 0.6, 400);
      var bankL = new THREE.Mesh(bankGeo, bankMat);
      bankL.position.set(-8.5, 0.1, -150);
      var bankR = new THREE.Mesh(bankGeo, bankMat);
      bankR.position.set(8.5, 0.1, -150);
      ctx.scene.add(bankL, bankR);

      // 蓮の葉(飾り)
      var lilyGeo = new THREE.CircleGeometry(0.55, 12);
      var lilyMat = Style.mat(0x3f9142);
      for (var l = 0; l < 12; l++) {
        var lf = new THREE.Mesh(lilyGeo, lilyMat);
        lf.rotation.x = -Math.PI / 2;
        lf.position.set((Math.random() * 2 - 1) * 5, 0.03, -Math.random() * 60);
        lf.userData.baseZ = lf.position.z;
        ctx.scene.add(lf);
        lily.push(lf);
      }

      // 飛び石プール
      var stoneGeo = new THREE.CylinderGeometry(1, 1.15, 0.24, 14);
      var stoneMat = Style.mat(0xb8b0a2);
      for (var i = 0; i < STONE_POOL; i++) {
        var mesh = new THREE.Mesh(stoneGeo, stoneMat);
        ctx.scene.add(mesh);
        stones.push({ mesh: mesh, index: i, x0: 0, z: 0, r: 1,
                      moving: false, amp: 0, spd: 1, phase: 0 });
      }

      // キャラクター
      chara = makeChara(THREE);
      ctx.scene.add(chara);

      // 照準マーカー(リング)
      marker = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.45, 20),
        new THREE.MeshBasicMaterial({ color: 0xffee58, transparent: true, opacity: 0.9 })
      );
      marker.rotation.x = -Math.PI / 2;
      marker.visible = false;
      ctx.scene.add(marker);

      // 水しぶきリング
      splashRing = new THREE.Mesh(
        new THREE.RingGeometry(0.4, 0.6, 20),
        new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.9 })
      );
      splashRing.rotation.x = -Math.PI / 2;
      splashRing.visible = false;
      ctx.scene.add(splashRing);

      // 着地の水しぶき粒プール
      var dropGeo = new THREE.SphereGeometry(0.08, 5, 4);
      for (var dp = 0; dp < 10; dp++) {
        var dm = new THREE.Mesh(dropGeo, new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0 }));
        dm.visible = false;
        ctx.scene.add(dm);
        droplets.push({ mesh: dm, vx: 0, vy: 0, vz: 0, life: 0 });
      }

      // パワーゲージ(DOM)
      powerBarBg = document.createElement('div');
      powerBarBg.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);' +
        'width:56vw;height:12px;background:rgba(0,0,0,.25);border-radius:6px;z-index:11;display:none;';
      powerBar = document.createElement('div');
      powerBar.style.cssText = 'height:100%;width:0%;background:#ffee58;border-radius:6px;';
      powerBarBg.appendChild(powerBar);
      document.body.appendChild(powerBarBg);
    },

    start: function (ctx) {
      charging = false; jumping = false; sinking = false; ended = false;
      power = 0; aimX = 0; splashT = -1; charIndex = 0;
      for (var i = 0; i < stones.length; i++) setupStone(stones[i], i, ctx.random);
      chara.rotation.set(0, 0, 0);
      chara.scale.set(1, 1, 1);
      placeOnStone(0, 0);
      marker.visible = false;
      splashRing.visible = false;
      powerBarBg.style.display = 'none';
      powerBar.style.width = '0%';
      // カメラを初期位置へスナップ(前回プレイの位置から飛ばないように)
      ctx.camera.position.set(0, 5.6, 7.2);
      ctx.camera.lookAt(0, 0.4, -3.5);
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Hold to charge → release!', ja: 'ながおしで ため → はなす！', es: '¡Mantén para cargar → suelta!', 'pt-BR': 'Segure para carregar → solte!', fr: 'Maintenez → relâchez!', de: 'Halten → loslassen!', it: 'Tieni premuto → rilascia!', ko: '길게 눌러 충전 → 놓기!', 'zh-Hans': '长按蓄力→松手！', tr: 'Basılı tut → bırak!' }));
    },

    onContinue: function (ctx) {
      // その場(最後に乗っていた石)から再開
      sinking = false; jumping = false; charging = false; ended = false;
      power = 0; splashT = -1;
      chara.rotation.set(0, 0, 0);
      chara.scale.set(1, 1, 1);
      splashRing.visible = false;
      powerBarBg.style.display = 'none';
      if (!placeOnStone(charIndex, ctx.elapsed)) {
        // 石がもう無ければ作り直す
        setupStone(stones[0], charIndex, ctx.random);
        placeOnStone(charIndex, ctx.elapsed);
      }
      ctx.setHint(ctx.t({ en: 'Continuing!', ja: 'つづきから！', es: '¡Continuando!', 'pt-BR': 'Continuando!', fr: 'On continue!', de: 'Weiter!', it: 'Si continua!', ko: '계속하기!', 'zh-Hans': '继续！', tr: 'Devam!' }));
    },

    onPointerDown: function (ctx, p) {
      if (jumping || sinking || ended) return;
      charging = true;
      power = 0;
      aimX = chara.position.x;
      powerBarBg.style.display = '';
      marker.visible = true;
    },

    onPointerMove: function (ctx, p) {
      if (!charging) return;
      // 画面の左右で着地点を横にずらす
      aimX = p.nx * 3.0;
    },

    onPointerUp: function (ctx, p) {
      if (!charging || jumping || sinking || ended) return;
      charging = false;
      powerBarBg.style.display = 'none';
      marker.visible = false;

      // ジャンプ開始(放物線)
      var dist = 1.4 + power * 6.4;
      tmpFrom.copy(chara.position);
      tmpTo.set(aimX, 0.55, chara.position.z - dist);
      fromPos = tmpFrom; toPos = tmpTo;
      jumping = true;
      jumpT = 0;
      jumpDur = 0.5 + power * 0.18;
      ctx.sfx.tap();
      ctx.vibrate(15);
    },

    _splashDrops: function (x, z) {
      var n = 0;
      for (var i = 0; i < droplets.length && n < 8; i++) {
        if (droplets[i].life > 0) continue;
        var a = Math.random() * Math.PI * 2;
        droplets[i].life = 0.45;
        droplets[i].vx = Math.cos(a) * (1.5 + Math.random());
        droplets[i].vy = 2 + Math.random() * 1.5;
        droplets[i].vz = Math.sin(a) * (1.5 + Math.random());
        droplets[i].mesh.position.set(x, 0.4, z);
        droplets[i].mesh.material.opacity = 0.9;
        droplets[i].mesh.visible = true;
        n++;
      }
    },

    update: function (ctx, dt) {
      if (ended) return;
      var time = ctx.elapsed;

      // 水の演出(波・煌めき・キラキラ・波紋)
      updateWater(ctx, dt, time, chara.position.z);

      // 着地しぶきの更新
      for (var di = 0; di < droplets.length; di++) {
        var dr = droplets[di];
        if (dr.life <= 0) continue;
        dr.life -= dt;
        dr.mesh.position.x += dr.vx * dt;
        dr.mesh.position.y += dr.vy * dt;
        dr.mesh.position.z += dr.vz * dt;
        dr.vy -= 8 * dt;
        dr.mesh.material.opacity = Math.max(0, dr.life / 0.45) * 0.9;
        if (dr.life <= 0) dr.mesh.visible = false;
      }

      // 流れる石を揺らす
      for (var i = 0; i < stones.length; i++) {
        var s = stones[i];
        if (s.moving) s.mesh.position.x = stoneX(s, time);
      }
      // 蓮の葉をゆっくり流す(キャラ前方でループ)
      for (var l = 0; l < lily.length; l++) {
        var lf = lily[l];
        lf.position.z += dt * 0.4;
        if (lf.position.z > chara.position.z + 8) lf.position.z -= 70;
      }

      // ため中: パワーとマーカー更新
      if (charging) {
        power = Math.min(1, power + dt * 0.85);
        powerBar.style.width = (power * 100) + '%';
        var dist = 1.4 + power * 6.4;
        marker.position.set(aimX, 0.05, chara.position.z - dist);
      }

      // キャラが乗っている石が動く場合は一緒に動く
      if (!jumping && !sinking && !charging) {
        var cur = null;
        for (var k = 0; k < stones.length; k++) if (stones[k].index === charIndex) cur = stones[k];
        if (cur && cur.moving) chara.position.x = stoneX(cur, time);
      }

      // ジャンプ中(放物線)
      if (jumping) {
        jumpT += dt;
        var r = Math.min(jumpT / jumpDur, 1);
        chara.position.x = fromPos.x + (toPos.x - fromPos.x) * r;
        chara.position.z = fromPos.z + (toPos.z - fromPos.z) * r;
        chara.position.y = 0.55 + Math.sin(r * Math.PI) * 2.4;
        chara.rotation.z = Math.sin(r * Math.PI) * 0.2; // かわいく前傾

        if (r >= 1) {
          jumping = false;
          chara.rotation.z = 0;
          // 着地判定: どれかの石の上か?
          var landed = null;
          for (var j = 0; j < stones.length; j++) {
            var st = stones[j];
            var sx = stoneX(st, time);
            var dx = chara.position.x - sx;
            var dz = chara.position.z - st.z;
            if (dx * dx + dz * dz <= (st.r * 0.95) * (st.r * 0.95)) { landed = st; break; }
          }
          if (landed) {
            chara.position.x = stoneX(landed, time);
            chara.position.z = landed.z;
            chara.position.y = 0.55;
            if (landed.index > charIndex) {
              ctx.addScore(landed.index - charIndex);
              this._splashDrops(chara.position.x, chara.position.z);
              ctx.sfx.score();
            } else {
              ctx.sfx.bounce();
            }
            charIndex = landed.index;
            recycleStones(ctx.random);
            ctx.setHint('');
          } else {
            // 水没
            sinking = true;
            sinkT = 0;
            splashRing.position.set(chara.position.x, 0.04, chara.position.z);
            splashRing.scale.set(1, 1, 1);
            splashRing.visible = true;
            splashT = 0;
            ctx.sfx.fail();
            ctx.vibrate(80);
          }
        }
      }

      // 水没演出 → ゲームオーバー
      if (sinking) {
        sinkT += dt;
        chara.position.y = 0.55 - sinkT * 1.6;
        if (sinkT > 0.6) {
          ended = true;
          ctx.gameOver(ctx.score);
        }
      }
      if (splashT >= 0) {
        splashT += dt;
        var sq = 1 + splashT * 3;
        splashRing.scale.set(sq, sq, 1);
        splashRing.material.opacity = Math.max(0, 0.9 - splashT * 1.5);
        if (splashT > 0.7) { splashRing.visible = false; splashT = -1; }
      }

      // カメラ追従(キャラの後ろ上)
      ctx.camera.position.x += (chara.position.x * 0.4 - ctx.camera.position.x) * Math.min(dt * 5, 1);
      ctx.camera.position.y += (5.6 - ctx.camera.position.y) * Math.min(dt * 5, 1);
      ctx.camera.position.z += (chara.position.z + 7.2 - ctx.camera.position.z) * Math.min(dt * 5, 1);
      ctx.camera.lookAt(chara.position.x * 0.4, 0.4, chara.position.z - 3.5);
    }
  });
})();
