/* =========================================================================
 * TFStackTower — つみあげタワー
 * ルール: 左右にうごくブロックをタップで真上に落として積み上げる。
 *        下段からはみ出たぶんは切り落とされ、ブロックが小さくなる。
 *        ピッタリ(誤差5%以内)は「ピタッ！」演出＋幅がすこし回復。
 *        完全に外すと落下して終了。
 * 操作: タップ
 * スコア: 積んだ階数 (かい)
 * ========================================================================= */
(function () {
  'use strict';

  var BASE = 2.4;   // 基準ブロック幅
  var H = 0.55;     // ブロック1段の高さ
  var RANGE = 2.2;  // 往復移動の振幅

  var sceneRef = null;
  var boxGeo;
  var mats = [];                    // 虹グラデーション（階数で共有）
  var placedPool = [], placedN = 0; // 置いたブロック（プールで再利用）
  var debrisPool = [];              // 切り落とし破片プール
  var mover;                        // 動いているブロック
  var floors, sizeX, sizeZ, topX, topZ, topY, axis, movDir, speed;
  var dying, dieT, dieVy, hintT;

  /* ---- ビジュアルディテール用 ---- */
  var wireMesh, hookMesh;           // クレーン（吊りワイヤー＋フック）
  var perfRing, ringMat, perfT = -1;// ピタッ！金リング
  var stars = [], starMat;          // ピタッ！星バースト（プール）
  var puffs = [], puffMat, puffT = -1; // 着地の土ぼこり（プール）
  var lastPlaced = null, squashT = 0;  // 着地スクワッシュ対象
  var clouds = [];                  // 空の雲（ドリフト）
  var balloon;                      // 高空の気球（登った先のごほうび）
  var flashDiv, flashT = -1;        // 失敗の赤フラッシュ

  function matFor(i) { return mats[i % mats.length]; }

  // クレーンのワイヤー・フックを mover に追従させる
  function craneFollow() {
    hookMesh.position.set(mover.position.x, mover.position.y + H / 2 + 0.09, mover.position.z);
    wireMesh.position.set(mover.position.x, mover.position.y + H / 2 + 0.18 + 15, mover.position.z);
  }

  // スクワッシュ中のブロックを正規スケールへ戻す
  function restorePlacedScale() {
    if (!lastPlaced) return;
    lastPlaced.scale.set(lastPlaced.userData.sx, 1, lastPlaced.userData.sz);
    lastPlaced = null;
  }

  // ピタッ！演出（金リング拡散＋星バースト）
  function spawnPerfect(x, yTop, z) {
    perfT = 0;
    perfRing.visible = true;
    perfRing.position.set(x, yTop + 0.03, z);
    perfRing.scale.set(1, 1, 1);
    ringMat.opacity = 0.9;
    starMat.opacity = 1;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var a = (i / stars.length) * Math.PI * 2 + Math.random() * 0.5;
      s.position.set(x, yTop, z);
      s.userData.vx = Math.cos(a) * (1.4 + Math.random());
      s.userData.vz = Math.sin(a) * (1.4 + Math.random());
      s.userData.vy = 2.4 + Math.random() * 1.4;
      s.userData.spin = 3 + Math.random() * 4;
      s.rotation.set(0, 0, 0);
      s.visible = true;
    }
  }

  // 着地の土ぼこり（新ブロックと下段の継ぎ目から四方へ）
  function spawnPuffs(x, ySeam, z, sx, sz) {
    puffT = 0;
    puffMat.opacity = 0.7;
    for (var i = 0; i < puffs.length; i++) {
      var p = puffs[i];
      var a = (i / puffs.length) * Math.PI * 2 + Math.random();
      p.position.set(x + Math.cos(a) * sx * 0.5, ySeam, z + Math.sin(a) * sz * 0.5);
      p.userData.vx = Math.cos(a) * (0.9 + Math.random() * 0.6);
      p.userData.vz = Math.sin(a) * (0.9 + Math.random() * 0.6);
      p.scale.setScalar(1);
      p.visible = true;
    }
  }

  // 確定ブロックをプールから取得（無ければ生成して scene へ）
  function getPlaced() {
    var m = placedPool[placedN];
    if (!m) {
      m = new THREE.Mesh(boxGeo, mats[0]);
      sceneRef.add(m);
      placedPool.push(m);
    }
    m.visible = true;
    placedN++;
    return m;
  }

  // 切り落とし破片を発生（プール再利用）
  function spawnDebris(x, y, z, sx, sz, mat) {
    for (var i = 0; i < debrisPool.length; i++) {
      var d = debrisPool[i];
      if (d.userData.active) continue;
      d.visible = true;
      d.userData.active = true;
      d.userData.vy = 0;
      d.userData.spin = (Math.random() - 0.5) * 5;
      d.material = mat;
      d.scale.set(Math.max(sx, 0.02), 1, Math.max(sz, 0.02));
      d.position.set(x, y, z);
      d.rotation.set(0, 0, 0);
      return;
    }
  }

  // 次の動くブロックをセット
  function resetMover() {
    mover.visible = true;
    mover.material = matFor(floors + 1);
    mover.scale.set(Math.max(sizeX, 0.02), 1, Math.max(sizeZ, 0.02));
    mover.rotation.set(0, 0, 0);
    var side = (floors % 2 === 0) ? -1 : 1; // 交互の側から登場
    movDir = -side;
    if (axis === 'x') mover.position.set(side * RANGE, topY + H, topZ);
    else mover.position.set(topX, topY + H, side * RANGE);
    // クレーン再接続（吊っていることを見せる）
    if (wireMesh) {
      wireMesh.visible = true;
      hookMesh.visible = true;
      craneFollow();
    }
  }

  Shell.registerGame({
    id: 'TFStackTower',
    title: {
      en: 'Stack Tower', ja: 'つみあげタワー', es: 'Torre de Bloques', 'pt-BR': 'Torre de Blocos',
      fr: 'Tour de Blocs', de: 'Stapelturm', it: 'Torre a Blocchi', ko: '블록 쌓기',
      'zh-Hans': '叠塔', tr: 'Kule İnşa'
    },
    howto: {
      en: 'Tap to drop the moving block on top!\nOverhang gets cut off.',
      ja: 'うごくブロックをタップでまうえに！\nはみだすと ちいさくなっちゃうよ',
      es: '¡Toca para soltar el bloque encima!\nLo que sobresale se corta.',
      'pt-BR': 'Toque para soltar o bloco em cima!\nO que sobra é cortado.',
      fr: 'Touchez pour poser le bloc au sommet !\nCe qui dépasse est coupé.',
      de: 'Tippe, um den Block oben abzusetzen!\nÜberstand wird abgeschnitten.',
      it: 'Tocca per posare il blocco in cima!\nLa sporgenza viene tagliata.',
      ko: '움직이는 블록을 탭해서 위에 쌓아요!\n삐져나온 부분은 잘려요.',
      'zh-Hans': '点击把移动的方块叠在正上方！\n超出部分会被切掉。',
      tr: 'Hareketli bloğu tam üste bırakmak için dokun!\nTaşan kısım kesilir.'
    },
    scoreLabel: {
      en: 'floors', ja: 'かい', es: 'pisos', 'pt-BR': 'andares', fr: 'étages', de: 'Etagen',
      it: 'piani', ko: '층', 'zh-Hans': '层', tr: 'kat'
    },
    bg: 0xffa270,
    fogNear: 42, fogFar: 120,
    cameraFov: 60,
    cameraPos: [6.5, 7.4, 6.5],
    cameraLookAt: [0, 1, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;
      sceneRef = ctx.scene;
      boxGeo = new THREE.BoxGeometry(1, H, 1);

      // 虹グラデーション（階数ごとに色相が回る共有マテリアル）
      // ※シェル照明≈1.35倍で白飛びするため、狙いより一段暗く・濃く指定
      for (var i = 0; i < 40; i++) {
        var c = new THREE.Color();
        c.setHSL((i * 0.047) % 1, 0.68, 0.5);
        mats.push(new THREE.MeshLambertMaterial({ color: c }));
      }

      // 地面（夕焼けに染まる街の広場）
      var g = new THREE.Mesh(
        new THREE.PlaneGeometry(300, 300),
        new THREE.MeshLambertMaterial({ color: 0x7a4f6d })
      );
      g.rotation.x = -Math.PI / 2;
      ctx.scene.add(g);

      // 建設現場の広場（敷石の円＋濃色の縁 = プレイの「場」の輪郭）
      var plaza = new THREE.Mesh(new THREE.CircleGeometry(3.1, 30),
        new THREE.MeshLambertMaterial({ color: 0x93636f }));
      plaza.rotation.x = -Math.PI / 2;
      plaza.position.y = 0.004;
      ctx.scene.add(plaza);
      var rim = new THREE.Mesh(new THREE.RingGeometry(3.1, 3.55, 30),
        new THREE.MeshLambertMaterial({ color: 0x4f2f47 }));
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.006;
      ctx.scene.add(rim);

      // 塔の基礎（石の土台スラブ＋接地影 = 浮いて見えない）
      var slab = new THREE.Mesh(Style.roundedBox(BASE + 0.6, 0.1, BASE + 0.6, 0.04),
        Style.mat(0x857a70));
      slab.position.y = 0.05;
      ctx.scene.add(slab);
      var baseShadow = Style.softShadow(2.4);
      baseShadow.position.y = 0.012;
      ctx.scene.add(baseShadow);

      // ミッドプロップ: 工事コーン×2（建設中の物語）
      [[3.0, 2.1], [-2.4, 3.1]].forEach(function (pos) {
        var cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.66, 10), Style.mat(0xc75b28));
        cone.position.set(pos[0], 0.33, pos[1]);
        ctx.scene.add(cone);
        var band = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.23, 0.1, 10), Style.mat(0xf5efe2));
        band.position.set(pos[0], 0.26, pos[1]);
        ctx.scene.add(band);
      });
      // ミッドプロップ: 資材クレート
      var crate1 = new THREE.Mesh(Style.roundedBox(0.85, 0.85, 0.85, 0.08), Style.mat(0x9a713f));
      crate1.position.set(-3.7, 0.43, -2.1);
      crate1.rotation.y = 0.4;
      ctx.scene.add(crate1);
      var crate2 = new THREE.Mesh(Style.roundedBox(0.55, 0.55, 0.55, 0.06), Style.mat(0x8a6136));
      crate2.position.set(-3.0, 0.28, -2.7);
      crate2.rotation.y = -0.3;
      ctx.scene.add(crate2);
      // ミッドプロップ: 街灯×2（夕暮れに灯る）
      [[4.4, -2.6], [-4.3, 2.6]].forEach(function (pos) {
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 2.6, 8), Style.mat(0x3f3a3f));
        pole.position.set(pos[0], 1.3, pos[1]);
        ctx.scene.add(pole);
        var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xffd58a }));
        lamp.position.set(pos[0], 2.72, pos[1]);
        ctx.scene.add(lamp);
      });

      // 夕焼けの街（遠景ビルのシルエット＋窓明かり）
      var cityMat = new THREE.MeshLambertMaterial({ color: 0x54306b });
      var winGeo = new THREE.PlaneGeometry(0.5, 0.7);
      var winMat = new THREE.MeshBasicMaterial({ color: 0xffc16e });
      var windows = new THREE.InstancedMesh(winGeo, winMat, 80);
      var wDummy = new THREE.Object3D();
      var wi = 0;
      for (var b = 0; b < 26; b++) {
        var w = 2 + Math.random() * 3;
        var h = 3 + Math.random() * 13;
        var bld = new THREE.Mesh(boxGeo, cityMat);
        bld.scale.set(w, h / H, w);
        var ang = Math.random() * Math.PI * 2;
        var r = 26 + Math.random() * 28;
        var bx = Math.cos(ang) * r, bz = Math.sin(ang) * r;
        bld.position.set(bx, h / 2, bz);
        ctx.scene.add(bld);
        // 中心（カメラ側）を向く面に窓明かりを2〜3個（InstancedMeshで1draw call）
        var nx = -bx / r, nz = -bz / r;           // ビル→中心の単位ベクトル
        var tx = -nz, tz = nx;                    // その接線方向
        var wn = 2 + (b % 2);
        for (var k = 0; k < wn && wi < 80; k++) {
          var lat = (k - (wn - 1) / 2) * w * 0.32;
          wDummy.position.set(
            bx + nx * (w / 2 + 0.03) + tx * lat,
            h * (0.25 + Math.random() * 0.5),
            bz + nz * (w / 2 + 0.03) + tz * lat);
          wDummy.rotation.set(0, Math.atan2(nx, nz), 0);
          wDummy.updateMatrix();
          windows.setMatrixAt(wi++, wDummy.matrix);
        }
      }
      windows.count = wi;
      windows.instanceMatrix.needsUpdate = true;
      ctx.scene.add(windows);

      // 夕日＋グロー
      var sun = new THREE.Mesh(
        new THREE.SphereGeometry(7, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffd54f })
      );
      sun.position.set(-45, 12, -70);
      ctx.scene.add(sun);
      var glow = new THREE.Mesh(new THREE.SphereGeometry(9.5, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.3, depthWrite: false }));
      glow.position.copy(sun.position);
      ctx.scene.add(glow);

      // 雲（低空〜高空に配置。塔が伸びるほど雲を追い越していく）
      [[16, 9, -30, 1.9, 1.2], [-18, 16, -32, 2.3, -0.9], [7, 24, -36, 1.7, 0.7], [-6, 34, -30, 2.1, -0.6]]
        .forEach(function (cc) {
          var cloud = new THREE.Group();
          for (var ci = 0; ci < 3; ci++) {
            var puff = new THREE.Mesh(new THREE.SphereGeometry(cc[3] * (0.7 + Math.random() * 0.4), 7, 5),
              new THREE.MeshBasicMaterial({ color: 0xffe9da }));
            puff.position.set(ci * cc[3] * 0.9 - cc[3], (Math.random() - 0.5) * 0.4, 0);
            cloud.add(puff);
          }
          cloud.position.set(cc[0], cc[1], cc[2]);
          cloud.userData.drift = cc[4];
          ctx.scene.add(cloud);
          clouds.push(cloud);
        });

      // 高空の気球（高く積んだ人だけが出会えるごほうび）
      balloon = new THREE.Group();
      var env = new THREE.Mesh(new THREE.SphereGeometry(1.7, 12, 10), Style.mat(0xb3543f));
      env.scale.y = 1.15;
      balloon.add(env);
      var basket = new THREE.Mesh(Style.roundedBox(0.6, 0.5, 0.6, 0.1), Style.mat(0x7d5b33));
      basket.position.y = -2.3;
      balloon.add(basket);
      balloon.position.set(-13, 27, -32);
      balloon.userData.bx = -13;
      balloon.userData.by = 27;
      ctx.scene.add(balloon);

      // 動くブロック
      mover = new THREE.Mesh(boxGeo, mats[1]);
      ctx.scene.add(mover);

      // クレーン（ワイヤー＋フック）: ブロックを「吊って運んでいる」因果の見える化
      wireMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 30, 6),
        new THREE.MeshBasicMaterial({ color: 0x574f4a }));
      ctx.scene.add(wireMesh);
      hookMesh = new THREE.Mesh(Style.roundedBox(0.2, 0.16, 0.2, 0.05), Style.mat(0xb08a3e));
      ctx.scene.add(hookMesh);

      // ピタッ！用: 金リング＋星バーストプール
      ringMat = new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      perfRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 28), ringMat);
      perfRing.rotation.x = -Math.PI / 2;
      perfRing.visible = false;
      ctx.scene.add(perfRing);
      starMat = new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 1, depthWrite: false });
      var starGeo = new THREE.OctahedronGeometry(0.13, 0);
      for (var s = 0; s < 8; s++) {
        var st = new THREE.Mesh(starGeo, starMat);
        st.visible = false;
        ctx.scene.add(st);
        stars.push(st);
      }
      // 着地土ぼこりプール
      puffMat = new THREE.MeshBasicMaterial({ color: 0xf3e2cd, transparent: true, opacity: 0, depthWrite: false });
      var puffGeo = new THREE.SphereGeometry(0.12, 6, 5);
      for (var pu = 0; pu < 6; pu++) {
        var pf = new THREE.Mesh(puffGeo, puffMat);
        pf.visible = false;
        ctx.scene.add(pf);
        puffs.push(pf);
      }

      // 失敗の赤フラッシュ（DOMオーバーレイ）
      flashDiv = document.createElement('div');
      flashDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#e5453a;opacity:0;pointer-events:none;z-index:9;';
      document.body.appendChild(flashDiv);

      // 破片プール
      for (var d = 0; d < 10; d++) {
        var deb = new THREE.Mesh(boxGeo, mats[0]);
        deb.visible = false;
        deb.userData.active = false;
        ctx.scene.add(deb);
        debrisPool.push(deb);
      }
    },

    start: function (ctx) {
      // 前プレイの残りを片付け（増殖リーク防止）
      for (var i = 0; i < placedPool.length; i++) placedPool[i].visible = false;
      placedN = 0;
      for (var d = 0; d < debrisPool.length; d++) {
        debrisPool[d].visible = false;
        debrisPool[d].userData.active = false;
      }
      // 演出状態のリセット
      restorePlacedScale();
      squashT = 0;
      perfT = -1;
      perfRing.visible = false;
      for (var si = 0; si < stars.length; si++) stars[si].visible = false;
      puffT = -1;
      for (var pi = 0; pi < puffs.length; pi++) puffs[pi].visible = false;
      flashT = -1;
      flashDiv.style.opacity = '0';

      floors = 0;
      sizeX = BASE; sizeZ = BASE;
      topX = 0; topZ = 0; topY = H / 2;
      axis = 'x';
      speed = 2.3;
      dying = false; dieT = 0; dieVy = 0; hintT = 0;

      // 土台
      var base = getPlaced();
      base.material = matFor(0);
      base.scale.set(BASE, 1, BASE);
      base.position.set(0, H / 2, 0);
      base.rotation.set(0, 0, 0);

      resetMover();

      ctx.camera.position.set(6.5, topY + 6.9, 6.5);
      ctx.camera.lookAt(0, topY, 0);
      ctx.setHint({ en: 'Tap to drop!', ja: 'タップでとめる！', es: '¡Toca para soltar!', 'pt-BR': 'Toque para soltar!', fr: 'Touchez pour lâcher !', de: 'Tippen zum Ablegen!', it: 'Tocca per rilasciare!', ko: '탭해서 놓기!', 'zh-Hans': '点击放下！', tr: 'Bırakmak için dokun!' });
    },

    onPointerDown: function (ctx) {
      if (dying) return;

      var moveP = (axis === 'x') ? mover.position.x : mover.position.z;
      var topP = (axis === 'x') ? topX : topZ;
      var size = (axis === 'x') ? sizeX : sizeZ;
      var delta = moveP - topP;
      var overlap = size - Math.abs(delta);

      // 完全に外した → 落下して終了（クレーンから切り離し＋赤フラッシュ）
      if (overlap <= 0) {
        dying = true; dieT = 0; dieVy = 0;
        wireMesh.visible = false;
        hookMesh.visible = false;
        flashT = 0;
        flashDiv.style.opacity = '0.35';
        ctx.sfx.fail();
        ctx.vibrate(60);
        ctx.setHint('');
        return;
      }

      var newP, newSize;
      var wasPerfect = false;
      if (Math.abs(delta) <= size * 0.05) {
        wasPerfect = true;
        // ピタッ！ … 真上に補正＋わずかに幅回復
        newP = topP;
        newSize = Math.min(size * 1.1, BASE);
        ctx.setHint({ en: 'Perfect!', ja: 'ピタッ！', es: '¡Perfecto!', 'pt-BR': 'Perfeito!', fr: 'Parfait !', de: 'Perfekt!', it: 'Perfetto!', ko: '완벽!', 'zh-Hans': '完美！', tr: 'Mükemmel!' });
        hintT = 0.7;
        ctx.sfx.success();
        ctx.vibrate(30);
      } else {
        // はみ出しを切り落とす
        newSize = overlap;
        newP = topP + delta / 2;
        var cut = Math.abs(delta);
        var cutC = newP + (delta > 0 ? 1 : -1) * (size / 2);
        if (axis === 'x') spawnDebris(cutC, topY + H, topZ, cut, sizeZ, matFor(floors + 1));
        else spawnDebris(topX, topY + H, cutC, sizeX, cut, matFor(floors + 1));
        ctx.sfx.tap();
        if (floors === 0) ctx.setHint('');
      }

      if (axis === 'x') { topX = newP; sizeX = newSize; }
      else { topZ = newP; sizeZ = newSize; }

      floors++;
      ctx.setScore(floors);

      // 確定ブロックを置く
      restorePlacedScale();
      var b = getPlaced();
      b.material = matFor(floors);
      b.scale.set(Math.max(sizeX, 0.02), 1, Math.max(sizeZ, 0.02));
      b.position.set(topX, topY + H, topZ);
      b.rotation.set(0, 0, 0);
      // 着地フィードバック: スクワッシュ＋（ピタッ=金リング星バースト / 通常=土ぼこり）
      b.userData.sx = Math.max(sizeX, 0.02);
      b.userData.sz = Math.max(sizeZ, 0.02);
      lastPlaced = b;
      squashT = 0;
      if (wasPerfect) spawnPerfect(topX, topY + H + H / 2, topZ);
      else spawnPuffs(topX, topY + H / 2, topZ, sizeX, sizeZ);

      topY += H;
      axis = (axis === 'x') ? 'z' : 'x';
      speed = Math.min(2.3 + floors * 0.09, 5.4); // だんだん速く
      resetMover();
    },

    update: function (ctx, dt) {
      // 破片の落下
      for (var i = 0; i < debrisPool.length; i++) {
        var d = debrisPool[i];
        if (!d.userData.active) continue;
        d.userData.vy -= 18 * dt;
        d.position.y += d.userData.vy * dt;
        d.rotation.x += d.userData.spin * dt;
        d.rotation.z += d.userData.spin * 0.7 * dt;
        if (d.position.y < topY - 14) { d.visible = false; d.userData.active = false; }
      }

      // 雲のドリフト・気球のゆらぎ（常時。上へ積むほど追い越していく）
      for (var ci = 0; ci < clouds.length; ci++) {
        var cl = clouds[ci];
        cl.position.x += cl.userData.drift * dt;
        if (cl.position.x > 55) cl.position.x = -55;
        if (cl.position.x < -55) cl.position.x = 55;
      }
      balloon.position.x = balloon.userData.bx + Math.sin(ctx.elapsed * 0.25) * 1.6;
      balloon.position.y = balloon.userData.by + Math.sin(ctx.elapsed * 0.6) * 0.5;
      balloon.rotation.z = Math.sin(ctx.elapsed * 0.4) * 0.05;

      // ピタッ！演出（金リング拡散＋星バースト）
      if (perfT >= 0) {
        perfT += dt;
        var pk = perfT / 0.55;
        if (pk >= 1) {
          perfT = -1;
          perfRing.visible = false;
          for (var si = 0; si < stars.length; si++) stars[si].visible = false;
        } else {
          var rs = 1 + pk * 2.0;
          perfRing.scale.set(rs, rs, rs);
          ringMat.opacity = 0.9 * (1 - pk);
          starMat.opacity = 1 - pk;
          for (var si2 = 0; si2 < stars.length; si2++) {
            var st2 = stars[si2];
            st2.position.x += st2.userData.vx * dt;
            st2.position.z += st2.userData.vz * dt;
            st2.position.y += st2.userData.vy * dt;
            st2.userData.vy -= 6.5 * dt;
            st2.rotation.y += st2.userData.spin * dt;
            st2.rotation.x += st2.userData.spin * 0.6 * dt;
          }
        }
      }
      // 着地の土ぼこり
      if (puffT >= 0) {
        puffT += dt;
        var qk = puffT / 0.4;
        if (qk >= 1) {
          puffT = -1;
          for (var pi = 0; pi < puffs.length; pi++) puffs[pi].visible = false;
        } else {
          puffMat.opacity = 0.7 * (1 - qk);
          for (var pi2 = 0; pi2 < puffs.length; pi2++) {
            var pf = puffs[pi2];
            pf.position.x += pf.userData.vx * dt;
            pf.position.z += pf.userData.vz * dt;
            pf.position.y += 0.4 * dt;
            pf.scale.setScalar(1 + qk * 1.8);
          }
        }
      }
      // 置いたブロックの着地スクワッシュ（ぷにっと沈んで戻る）
      if (lastPlaced) {
        squashT += dt;
        var sk = Math.min(squashT / 0.24, 1);
        var sq = Math.sin(Math.PI * sk);
        lastPlaced.scale.y = 1 - 0.22 * sq;
        lastPlaced.scale.x = lastPlaced.userData.sx * (1 + 0.1 * sq);
        lastPlaced.scale.z = lastPlaced.userData.sz * (1 + 0.1 * sq);
        if (sk >= 1) restorePlacedScale();
      }
      // 失敗の赤フラッシュ減衰
      if (flashT >= 0) {
        flashT += dt;
        var fk = flashT / 0.35;
        if (fk >= 1) { flashT = -1; flashDiv.style.opacity = '0'; }
        else flashDiv.style.opacity = String(0.35 * (1 - fk));
      }

      // 「ピタッ！」ヒントの消去
      if (hintT > 0) { hintT -= dt; if (hintT <= 0) ctx.setHint(''); }

      // 外して落下中 → 演出後に終了
      if (dying) {
        dieT += dt;
        dieVy -= 18 * dt;
        mover.position.y += dieVy * dt;
        mover.rotation.x += 2.5 * dt;
        if (dieT > 0.9) ctx.gameOver(floors);
        return;
      }

      // ブロック往復
      var p = (axis === 'x') ? mover.position.x : mover.position.z;
      p += movDir * speed * dt;
      if (p > RANGE) { p = RANGE; movDir = -1; }
      if (p < -RANGE) { p = -RANGE; movDir = 1; }
      if (axis === 'x') mover.position.x = p; else mover.position.z = p;
      craneFollow(); // ワイヤー・フックが吊って運ぶ

      // カメラは積むたびゆっくり上昇
      var targetY = topY + 6.9;
      ctx.camera.position.y += (targetY - ctx.camera.position.y) * Math.min(1, dt * 3);
      ctx.camera.lookAt(0, topY, 0);
    }
  });
})();
