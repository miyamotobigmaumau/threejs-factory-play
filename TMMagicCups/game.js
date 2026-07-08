/* =========================================================================
 * TMMagicCups — マジックカップ
 * ルール: シャッフルを目で追って玉入りカップをタップ！
 * 操作: カップをタップ
 * マッシュアップ: マジシャン×コップかくし
 *   - シャッフル回数・速度がレベルで増加
 *   - レベル5からカップ4個
 *   - レベル10からフェイク（交差時に一瞬持ち上がる）
 *   - 弧を描くスワップ軌道（手前/奥にふくらむ）＋わずかな傾き
 * ビジュアル:
 *   - LatheGeometry の実物風カップ（口広・底狭・縁の厚み・内側は暗色）
 *   - 開始時は玉を見せてからカップが上から降りてきて被せる
 *   - 選択時はカップが真上に持ち上がり中が見える（当たり=玉が鎮座）
 *   - 緑フェルトのテーブルクロス（垂れ付き）・幕・スポットライト・小物
 * スコア: 連続正解数
 * ========================================================================= */
(function () {
  'use strict';

  /* ---- 定数 ---- */
  var CUP_COUNT_INIT   = 3;    // 初期カップ数
  var CUP_LIFT_Y       = 1.7;  // 正解/公開時の持ち上げY
  var CUP_HOVER_Y      = 2.2;  // 開始時に宙で待機するY
  var CUP_DROP_START_Y = 3.4;  // 画面上から降りてくる開始Y
  var BALL_Y           = 0.24; // 玉のY（半径ぶん浮かす）

  /* ---- カップ配置X座標（3個 / 4個） ---- */
  var POSITIONS_3 = [-2.2, 0, 2.2];
  var POSITIONS_4 = [-3.3, -1.1, 1.1, 3.3];

  /* ---- フェーズ ---- */
  var PHASE_REVEAL  = 'reveal';   // 玉を見せる
  var PHASE_COVER   = 'cover';    // カップをかぶせる
  var PHASE_SHUFFLE = 'shuffle';  // シャッフル中
  var PHASE_WAIT    = 'wait';     // プレイヤー選択待ち
  var PHASE_CORRECT = 'correct';  // 正解演出
  var PHASE_WRONG   = 'wrong';    // 不正解演出

  /* ---- シーンオブジェクト ---- */
  var cupGroups  = [];   // カップグループ×4（initで全生成、不要分はvisible=false）
  var cupShadows = [];   // カップの接地影×4
  var ballMesh;          // 玉（常に1個）
  var ballShadow;        // 玉の接地影
  var spotlightMesh;     // スポットライトの光円（時間切れ警告の明滅にも使用）
  var spotInner;         // 内側の明るい光円（ゆるく脈動）
  var stars = [];        // 背景の星（きらめき用に保持）
  var sparks = [];       // 正解エフェクト（プール方式）
  var raycaster;         // 1個使い回し
  var tmpV2;             // THREE.Vector2 使い回し

  /* ---- カップ状態 ---- */
  var cupCount;          // 現在のカップ数
  var slotX = [];        // 初期スロットX座標
  var ballSlot;          // 玉が入っているカップ（メッシュ）のインデックス
  var chosenSlot;        // プレイヤーが選んだカップ（-1=時間切れ）

  /* ---- アニメ状態 ---- */
  var phase;
  var phaseTimer;
  var shuffleMoves;      // 残りシャッフル移動数
  var totalMoves;        // 今ラウンドの総移動数（加速計算用）
  var curMove;           // 現在アニメ中の移動 {a,b,t,duration,fake,ax,bx}
  var gameActive;
  var streak;            // 連続正解
  var wrongRevealed;     // 不正解時に正解カップを開いたか
  var gtime = 0;         // 汎用経過時間（きらめき用）

  /* ---- カップ座標（アニメ補間用） ---- */
  var cupPosX  = [];     // 現在の実X
  var cupTargX = [];     // 目標X（＝論理位置）
  var cupPosY  = [];     // 現在の実Y
  var cupTargY = [];     // 目標Y
  var cupPosZ  = [];     // 現在の実Z（弧軌道用）
  var cupTilt  = [];     // 傾き（rotation.z）

  /* ---- レベル計算 ---- */
  function getLevel() { return streak; }
  function getShuffleCount() { return 3 + Math.min(getLevel(), 12); }
  function getShuffleSpeed() { return Math.max(0.62 - getLevel() * 0.028, 0.24); } // 1移動の基準時間(秒)
  function hasFake() { return getLevel() >= 10; }
  function hasFour() { return getLevel() >= 5; }

  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* ---- マテリアル（initで生成） ---- */
  var cupBodyMat, cupInnerMat, rimMat, ballMat, sparkMat;

  /* ---- カップグループを1個生成（口が下向きの伏せカップ） ---- */
  function makeCupGroup(THREE) {
    var g = new THREE.Group();

    // 胴体: Latheの回転体。口(y=0)が広く上(カップ底)が狭い実物輪郭＋縁の厚み
    var pts = [];
    pts.push(new THREE.Vector2(0.56, 0.02));  // 内側の口
    pts.push(new THREE.Vector2(0.60, 0.00));  // 縁の下端
    pts.push(new THREE.Vector2(0.65, 0.04));  // 縁ふくらみ
    pts.push(new THREE.Vector2(0.66, 0.13));  // 縁バンド上端
    pts.push(new THREE.Vector2(0.62, 0.20));
    pts.push(new THREE.Vector2(0.55, 0.55));
    pts.push(new THREE.Vector2(0.48, 0.90));
    pts.push(new THREE.Vector2(0.44, 1.06));
    pts.push(new THREE.Vector2(0.34, 1.15));  // 底の丸み
    pts.push(new THREE.Vector2(0.0, 1.17));   // 底の中心
    var body = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), cupBodyMat);
    g.add(body);

    // 内側: 暗色の逆すぼみ筒＋天井円盤で「中に空間がある」見え方
    var inner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.30, 0.55, 1.02, 20, 1, true),
      cupInnerMat
    );
    inner.position.y = 0.53;
    g.add(inner);
    var ceil = new THREE.Mesh(new THREE.CircleGeometry(0.31, 20), cupInnerMat);
    ceil.rotation.x = Math.PI / 2; // 下向き
    ceil.position.y = 1.02;
    g.add(ceil);

    // 口の縁リング（クリーム色のトーラスで厚みを強調）
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.615, 0.055, 10, 26), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.05;
    g.add(rim);

    // 胴の白帯（マジシャンのカップ風・全カップ共通で識別不能のまま）
    var band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.575, 0.545, 0.16, 24, 1, true),
      rimMat
    );
    band.position.y = 0.62;
    g.add(band);

    // ※番号等の識別テクスチャは貼らない（全カップ同一見た目がこのゲームの成立条件）
    return g;
  }

  /* ---- スロットを初期化（カップは上空から降下待機、玉を見せる） ---- */
  function initSlots(count) {
    cupCount = count;
    var positions = count === 4 ? POSITIONS_4 : POSITIONS_3;
    for (var i = 0; i < 4; i++) {
      var vis = i < count;
      cupGroups[i].visible = vis;
      cupShadows[i].visible = vis;
    }
    for (var s = 0; s < count; s++) {
      slotX[s]    = positions[s];
      cupPosX[s]  = positions[s];
      cupTargX[s] = positions[s];
      cupPosY[s]  = CUP_DROP_START_Y + s * 0.25; // 少しずつ時間差で降りる
      cupTargY[s] = CUP_HOVER_Y;
      cupPosZ[s]  = 0;
      cupTilt[s]  = 0;
      cupGroups[s].position.set(positions[s], cupPosY[s], 0);
      cupGroups[s].rotation.z = 0;
    }
    // 玉はランダムなカップの位置に（開始時に見せる）
    ballSlot = Math.floor(Math.random() * count);
    chosenSlot = -1;
    wrongRevealed = false;
    ballMesh.position.set(slotX[ballSlot], BALL_Y, 0);
    ballMesh.visible = true;
  }

  /* ---- ランダムスワップ（同じスロットは避ける） ---- */
  function pickSwap() {
    var a = Math.floor(Math.random() * cupCount);
    var b;
    do { b = Math.floor(Math.random() * cupCount); } while (b === a);
    return { a: a, b: b };
  }

  /* ---- シャッフル移動を1回実行 ---- */
  function nextShuffleMove(ctx) {
    if (shuffleMoves <= 0) {
      // シャッフル完了→プレイヤー選択待ち
      setPhase(PHASE_WAIT);
      ctx.setHint(ctx.t({ en: 'Which cup has the ball?', ja: 'どのカップに たまが あるかな？', es: '¿En qué vaso está la bola?', 'pt-BR': 'Em qual copo está a bola?', fr: 'Dans quel gobelet est la balle ?', de: 'In welchem Becher ist die Kugel?', it: 'In quale bicchiere è la pallina?', ko: '어느 컵에 공이 있을까?', 'zh-Hans': '球在哪个杯子里？', tr: 'Top hangi bardakta?' }));
      return;
    }
    shuffleMoves--;
    var sw = pickSwap();
    var fake = hasFake() && Math.random() < 0.25; // 25%でフェイク
    // 徐々に加速: 序盤ゆっくり→終盤速い
    var done = totalMoves - shuffleMoves;
    var speedF = 1.2 - 0.55 * (done / totalMoves);
    var dur = getShuffleSpeed() * speedF;
    curMove = {
      a: sw.a, b: sw.b, t: 0, duration: dur, fake: fake,
      ax: cupTargX[sw.a], bx: cupTargX[sw.b]
    };
    // 論理位置を交換
    var tmpX = cupTargX[sw.a];
    cupTargX[sw.a] = cupTargX[sw.b];
    cupTargX[sw.b] = tmpX;
    // 玉は物理カップ(メッシュ)と一緒に運ばれる。ballSlot はメッシュ番号なので
    // 何もしないのが正しい（メッシュの移動に追従する）。
  }

  /* ---- フェーズ変更 ---- */
  function setPhase(p) {
    phase = p;
    phaseTimer = 0;
    // 時間切れ警告の赤明滅をリセット
    if (spotlightMesh) {
      spotlightMesh.material.color.setHex(0xffe0b2);
      spotlightMesh.material.opacity = 0.10;
    }
  }

  /* ---- 全カップ公開（時間切れ用） ---- */
  function revealAll() {
    for (var i = 0; i < cupCount; i++) {
      cupTargY[i] = CUP_LIFT_Y;
    }
    ballMesh.position.set(cupPosX[ballSlot], BALL_Y, cupPosZ[ballSlot]);
    ballMesh.visible = true;
  }

  /* ---- 正解キラキラ（プールから発生） ---- */
  function spawnBurst(x, y, z, n) {
    var used = 0;
    for (var i = 0; i < sparks.length && used < n; i++) {
      var s = sparks[i];
      if (s.life > 0) continue;
      used++;
      s.life = 0.7 + Math.random() * 0.4;
      s.mesh.visible = true;
      s.mesh.position.set(x, y, z);
      var a = Math.random() * Math.PI * 2;
      var sp = 1.5 + Math.random() * 2.0;
      s.vx = Math.cos(a) * sp;
      s.vz = Math.sin(a) * sp * 0.5;
      s.vy = 2.2 + Math.random() * 2.2;
    }
  }

  function updateSparks(dt) {
    for (var i = 0; i < sparks.length; i++) {
      var s = sparks[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      s.vy -= 9 * dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      s.mesh.rotation.x += 6 * dt;
      s.mesh.rotation.z += 5 * dt;
      var sc = Math.min(s.life * 2.5, 1);
      s.mesh.scale.set(sc, sc, sc);
    }
  }

  Shell.registerGame({
    id: 'TMMagicCups',
    title: { en: 'Magic Cups', ja: 'マジックカップ', es: 'Vasos Mágicos', 'pt-BR': 'Copos Mágicos', fr: 'Gobelets Magiques', de: 'Zauberbecher', it: 'Bicchieri Magici', ko: '컵 게임', 'zh-Hans': '魔术杯', tr: 'Sihirli Bardaklar' },
    howto: { en: 'Watch the shuffle carefully!\nTap the cup with the ball!', ja: 'シャッフルをよく見て\nたまのはいったカップをタップ！', es: '¡Mira bien el truco!\n¡Toca el vaso con la bola!', 'pt-BR': 'Observe bem o embaralhamento!\nToque o copo com a bola!', fr: 'Regardez bien le mélange !\nTouchez le gobelet avec la balle !', de: 'Beobachte genau!\nTippe auf den Becher mit der Kugel!', it: 'Guarda bene il giro!\nTocca il bicchiere con la pallina!', ko: '잘 보고\n공이 든 컵을 탭!', 'zh-Hans': '仔细观察洗牌！\n点击有球的杯子！', tr: 'Karıştırmayı dikkatlice izle!\nTopu olan bardağa dokun!' },
    scoreLabel: { en: 'streak', ja: 'れんぞく', es: 'racha', 'pt-BR': 'sequência', fr: 'série', de: 'Serie', it: 'serie', ko: '연속', 'zh-Hans': '连续', tr: 'seri' },
    bg: 0x14081f,
    cameraFov: 55,
    cameraPos: [0, 3.4, 9.6],
    cameraLookAt: [0, 0.8, 0],
    fitWidth: 8.4,

    init: function (ctx) {
      var THREE = ctx.THREE;
      var i;

      /* マテリアル */
      cupBodyMat  = Style.mat(0xc73535, { roughness: 0.65 });                       // マットな赤カップ
      cupInnerMat = Style.mat(0x2e0d12, { roughness: 1.0, side: THREE.DoubleSide }); // 内側は暗色
      rimMat      = Style.mat(0xf2e3c4, { roughness: 0.6 });                        // 縁・帯のクリーム
      ballMat     = Style.mat(0xff2e4d, { roughness: 0.35, emissive: 0x4a0008 });   // つやのある赤玉
      sparkMat    = new THREE.MeshBasicMaterial({ color: 0xffe08a });

      var clothMat     = Style.mat(0x1e7a52, { roughness: 1.0 });  // 緑フェルト
      var clothDarkMat = Style.mat(0x14573a, { roughness: 1.0 });  // 垂れ布（濃）
      var trimMat      = Style.mat(0xe8b64c, { roughness: 0.5 });  // 金トリム
      var curtainMatA  = Style.mat(0x6b1530, { roughness: 1.0 });  // 幕（明）
      var curtainMatB  = Style.mat(0x571026, { roughness: 1.0 });  // 幕（暗）
      var hatMat       = Style.mat(0x23202b, { roughness: 0.8 });  // シルクハット
      var starTwinkleMat = Style.mat(0xffd76a, { emissive: 0x8a6a1a });

      /* 床（テーブルの向こう/下の暗い床） */
      var floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 40),
        Style.mat(0x0e0616, { roughness: 1.0 })
      );
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.set(0, -2.8, -2);
      ctx.scene.add(floorMesh);

      /* 舞台の幕（背景・縦筒の連なりでドレープ表現） */
      var curtainGeo = new THREE.CylinderGeometry(0.75, 0.75, 16, 10);
      for (i = 0; i < 14; i++) {
        var cm = new THREE.Mesh(curtainGeo, (i % 2 === 0) ? curtainMatA : curtainMatB);
        cm.position.set(-9.1 + i * 1.4, 6.2, -6.5);
        ctx.scene.add(cm);
      }

      /* テーブル（緑フェルトのクロス＋垂れ＋金トリム） */
      var tableTop = new THREE.Mesh(Style.roundedBox(11, 0.5, 4.6, 0.12), clothMat);
      tableTop.position.set(0, -0.26, 0);
      ctx.scene.add(tableTop);
      var drapeFront = new THREE.Mesh(Style.roundedBox(11, 2.5, 0.24, 0.08), clothDarkMat);
      drapeFront.position.set(0, -1.6, 2.2);
      ctx.scene.add(drapeFront);
      var drapeL = new THREE.Mesh(Style.roundedBox(0.24, 2.5, 4.6, 0.08), clothDarkMat);
      drapeL.position.set(-5.5, -1.6, 0);
      ctx.scene.add(drapeL);
      var drapeR = new THREE.Mesh(Style.roundedBox(0.24, 2.5, 4.6, 0.08), clothDarkMat);
      drapeR.position.set(5.5, -1.6, 0);
      ctx.scene.add(drapeR);
      var trimF = new THREE.Mesh(Style.roundedBox(11.1, 0.12, 0.14, 0.05), trimMat);
      trimF.position.set(0, -0.05, 2.32);
      ctx.scene.add(trimF);
      var trimB = new THREE.Mesh(Style.roundedBox(11.1, 0.12, 0.14, 0.05), trimMat);
      trimB.position.set(0, -0.05, -2.32);
      ctx.scene.add(trimB);

      /* スポットライト（光円×2＋うっすら光柱） */
      spotlightMesh = new THREE.Mesh(
        new THREE.CircleGeometry(3.6, 28),
        new THREE.MeshBasicMaterial({ color: 0xffe0b2, transparent: true, opacity: 0.10, depthWrite: false })
      );
      spotlightMesh.rotation.x = -Math.PI / 2;
      spotlightMesh.position.set(0, 0.006, 0);
      ctx.scene.add(spotlightMesh);
      spotInner = new THREE.Mesh(
        new THREE.CircleGeometry(2.2, 24),
        new THREE.MeshBasicMaterial({ color: 0xfff3d0, transparent: true, opacity: 0.08, depthWrite: false })
      );
      spotInner.rotation.x = -Math.PI / 2;
      spotInner.position.set(0, 0.008, 0);
      ctx.scene.add(spotInner);
      var beam = new THREE.Mesh(
        new THREE.ConeGeometry(4.2, 10, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      beam.position.set(0, 5, 0);
      ctx.scene.add(beam);

      /* 小物: シルクハット（左奥） */
      var hat = new THREE.Group();
      var brim = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.86, 0.07, 22), hatMat);
      brim.position.y = 0.035;
      hat.add(brim);
      var crown = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.85, 22), hatMat);
      crown.position.y = 0.49;
      hat.add(crown);
      var hatBand = new THREE.Mesh(new THREE.CylinderGeometry(0.555, 0.565, 0.16, 22), cupBodyMat);
      hatBand.position.y = 0.18;
      hat.add(hatBand);
      hat.position.set(-4.45, 0, -1.2);
      hat.rotation.y = 0.5;
      ctx.scene.add(hat);
      var hatShadow = Style.softShadow(1.0);
      hatShadow.position.set(-4.45, 0.012, -1.2);
      ctx.scene.add(hatShadow);

      /* 小物: マジックワンド（右手前・寝かせて置く） */
      var wand = new THREE.Group();
      var stick = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.2, 10), hatMat);
      wand.add(stick);
      var tip1 = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.2, 10), rimMat);
      tip1.position.y = 0.5;
      wand.add(tip1);
      var tip2 = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.2, 10), rimMat);
      tip2.position.y = -0.5;
      wand.add(tip2);
      wand.position.set(4.45, 0.06, 1.1);
      wand.rotation.z = Math.PI / 2;
      wand.rotation.y = 0.6;
      ctx.scene.add(wand);

      /* 背景の星（きらめき付き） */
      var starGeo = new THREE.OctahedronGeometry(0.1);
      for (i = 0; i < 22; i++) {
        var sm = new THREE.Mesh(starGeo, starTwinkleMat);
        sm.position.set(
          (Math.random() - 0.5) * 17,
          2.2 + Math.random() * 7,
          -5.4 - Math.random() * 0.8
        );
        sm.rotation.z = Math.random() * Math.PI;
        ctx.scene.add(sm);
        stars.push({ mesh: sm, speed: 1.5 + Math.random() * 2.5, off: Math.random() * Math.PI * 2 });
      }

      /* カップグループ＋接地影（4個全部作る、不要分は非表示） */
      for (i = 0; i < 4; i++) {
        var cg = makeCupGroup(THREE);
        ctx.scene.add(cg);
        cupGroups.push(cg);
        cupPosX.push(0); cupTargX.push(0);
        cupPosY.push(0); cupTargY.push(0);
        cupPosZ.push(0); cupTilt.push(0);
        var sh = Style.softShadow(0.85);
        sh.position.set(0, 0.014 + i * 0.001, 0);
        ctx.scene.add(sh);
        cupShadows.push(sh);
      }

      /* 玉＋接地影 */
      ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), ballMat);
      ctx.scene.add(ballMesh);
      ballShadow = Style.softShadow(0.3);
      ballShadow.position.set(0, 0.02, 0);
      ctx.scene.add(ballShadow);

      /* 正解キラキラのプール */
      var sparkGeo = new THREE.OctahedronGeometry(0.09);
      for (i = 0; i < 24; i++) {
        var sp = new THREE.Mesh(sparkGeo, sparkMat);
        sp.visible = false;
        ctx.scene.add(sp);
        sparks.push({ mesh: sp, vx: 0, vy: 0, vz: 0, life: 0 });
      }

      /* Raycaster（1個だけ、使い回し） */
      raycaster = new THREE.Raycaster();
      tmpV2 = new THREE.Vector2();
    },

    start: function (ctx) {
      streak     = 0;
      gameActive = true;
      curMove    = null;

      // 4個 or 3個。カップは上空に待機して玉を見せる
      initSlots(hasFour() ? 4 : CUP_COUNT_INIT);
      setPhase(PHASE_REVEAL);
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Remember the ball!', ja: 'たまをおぼえて！', es: '¡Recuerda la bola!', 'pt-BR': 'Lembre-se da bola!', fr: 'Mémorisez la balle !', de: 'Merke dir die Kugel!', it: 'Ricorda la pallina!', ko: '공을 기억해!', 'zh-Hans': '记住球的位置！', tr: 'Topu hatırla!' }));
    },

    onPointerDown: function (ctx, p) {
      if (!gameActive || phase !== PHASE_WAIT) return;

      // Raycaster でタップしたカップを判定（光線とy=0.5平面の交点のX距離）
      tmpV2.set(p.nx, p.ny);
      raycaster.setFromCamera(tmpV2, ctx.camera);

      var hitSlot = -1;
      var bestDist = Infinity;
      var ray = raycaster.ray;
      if (Math.abs(ray.direction.y) > 0.0001) {
        var t = (0.5 - ray.origin.y) / ray.direction.y;
        if (t > 0) {
          var wx = ray.origin.x + ray.direction.x * t;
          for (var i = 0; i < cupCount; i++) {
            var d = Math.abs(wx - cupPosX[i]);
            if (d < 0.9 && d < bestDist) {
              bestDist = d;
              hitSlot = i;
            }
          }
        }
      }
      if (hitSlot < 0) return;

      chosenSlot = hitSlot;
      // 選んだカップが真上へ持ち上がって中が見える
      cupTargY[hitSlot] = CUP_LIFT_Y;

      if (hitSlot === ballSlot) {
        // 正解！ 玉が下に鎮座
        streak++;
        ctx.setScore(streak);
        ctx.sfx.success();
        ctx.vibrate(15);
        setPhase(PHASE_CORRECT);
        ballMesh.position.set(cupPosX[ballSlot], BALL_Y, cupPosZ[ballSlot]);
        ballMesh.visible = true;
        spawnBurst(cupPosX[ballSlot], 1.0, 0.3, 14);
        ctx.setHint(ctx.t({ en: 'Correct! ', ja: 'せいかい！ ', es: '¡Correcto! ', 'pt-BR': 'Correto! ', fr: 'Correct ! ', de: 'Richtig! ', it: 'Corretto! ', ko: '정답! ', 'zh-Hans': '正确！', tr: 'Doğru! ' }) + streak + ctx.t({ en: ' streak!', ja: 'れんぞく！', es: ' en racha!', 'pt-BR': ' sequência!', fr: ' série !', de: ' Serie!', it: ' serie!', ko: ' 연속!', 'zh-Hans': ' 连续！', tr: ' seri!' }));
      } else {
        // 不正解: まず選んだカップが上がる（中は空）→少し後に正解カップが開く
        setPhase(PHASE_WRONG);
        wrongRevealed = false;
        ctx.sfx.fail();
        ctx.vibrate(40);
        ctx.setHint(ctx.t({ en: 'Wrong! The ball was here!', ja: 'はずれ… たまはここだよ！', es: '¡Fallaste! ¡La bola estaba aquí!', 'pt-BR': 'Errou! A bola estava aqui!', fr: 'Raté ! La balle était là !', de: 'Daneben! Die Kugel war hier!', it: 'Sbagliato! La pallina era qui!', ko: '틀렸어! 공은 여기 있었어!', 'zh-Hans': '错了！球在这里！', tr: 'Yanlış! Top buradaydı!' }));
      }
    },

    update: function (ctx, dt) {
      if (!gameActive) return;

      phaseTimer += dt;
      gtime += dt;

      var i;

      /* ---- Y（持ち上げ/降下）は常に滑らかに補間 ---- */
      for (i = 0; i < cupCount; i++) {
        cupPosY[i] += (cupTargY[i] - cupPosY[i]) * Math.min(dt * 7, 1);
      }

      /* ---- シャッフル: 弧軌道のパラメトリック移動（徐々に加速） ---- */
      var moveA = -1, moveB = -1, fakeLift = 0;
      if (phase === PHASE_SHUFFLE && curMove) {
        curMove.t += dt;
        var pr = Math.min(curMove.t / curMove.duration, 1);
        var e = easeInOut(pr);
        var arc = Math.sin(pr * Math.PI);
        moveA = curMove.a;
        moveB = curMove.b;
        cupPosX[moveA] = curMove.ax + (curMove.bx - curMove.ax) * e;
        cupPosX[moveB] = curMove.bx + (curMove.ax - curMove.bx) * e;
        cupPosZ[moveA] = arc * 1.05;   // 片方は手前の弧
        cupPosZ[moveB] = -arc * 0.8;   // 片方は奥の弧
        var dirA = curMove.bx > curMove.ax ? 1 : -1;
        cupTilt[moveA] = -dirA * 0.13 * arc; // 進行方向へわずかに傾く
        cupTilt[moveB] = dirA * 0.13 * arc;
        if (curMove.fake) fakeLift = arc * 0.45; // フェイク: 中間で一瞬浮く
        if (pr >= 1) {
          cupPosX[moveA] = curMove.bx;
          cupPosX[moveB] = curMove.ax;
          cupPosZ[moveA] = 0;
          cupPosZ[moveB] = 0;
          cupTilt[moveA] = 0;
          cupTilt[moveB] = 0;
          curMove = null;
          nextShuffleMove(ctx);
        }
      }

      /* ---- カップの適用＋接地影の追従 ---- */
      for (i = 0; i < cupCount; i++) {
        if (i !== moveA && i !== moveB) {
          cupPosX[i] += (cupTargX[i] - cupPosX[i]) * Math.min(dt * 10, 1);
          cupPosZ[i] *= Math.max(1 - dt * 8, 0);
          cupTilt[i] += (0 - cupTilt[i]) * Math.min(dt * 10, 1);
        }
        var ry = cupPosY[i] + ((i === moveA || i === moveB) ? fakeLift : 0);
        cupGroups[i].position.set(cupPosX[i], ry, cupPosZ[i]);
        cupGroups[i].rotation.z = cupTilt[i];
        cupShadows[i].position.x = cupPosX[i];
        cupShadows[i].position.z = cupPosZ[i];
        var ss = 1 + ry * 0.16;
        cupShadows[i].scale.set(ss, 1, ss);
        cupShadows[i].material.opacity = Math.max(0.18, 1 - ry * 0.35);
      }

      /* ---- 玉の追従（隠れている間もXを追い、公開時に正しい位置へ） ---- */
      if (phase === PHASE_SHUFFLE || phase === PHASE_COVER || phase === PHASE_WAIT) {
        ballMesh.position.x = cupPosX[ballSlot];
        ballMesh.position.z = cupPosZ[ballSlot];
        if (phase !== PHASE_COVER) ballMesh.position.y = BALL_Y;
      }
      ballShadow.visible = ballMesh.visible;
      if (ballMesh.visible) {
        ballShadow.position.x = ballMesh.position.x;
        ballShadow.position.z = ballMesh.position.z;
      }

      /* ---- 背景の星のきらめき＋光円の脈動 ---- */
      for (i = 0; i < stars.length; i++) {
        var st = stars[i];
        var sc = 0.7 + 0.45 * Math.sin(gtime * st.speed + st.off);
        st.mesh.scale.set(sc, sc, sc);
      }
      spotInner.material.opacity = 0.07 + 0.03 * Math.sin(gtime * 2);

      /* ---- 正解キラキラ ---- */
      updateSparks(dt);

      /* ---- フェーズ別処理 ---- */
      if (phase === PHASE_REVEAL) {
        // 玉が小さくはねて「ここにあるよ」をアピール
        ballMesh.position.y = BALL_Y + Math.abs(Math.sin(phaseTimer * 4)) * 0.18;
        if (phaseTimer > 1.4) {
          // カップが上から降りてきて被せる
          for (i = 0; i < cupCount; i++) {
            cupTargY[i] = 0;
          }
          setPhase(PHASE_COVER);
        }
      }
      else if (phase === PHASE_COVER) {
        // 玉のカップが被さったら玉を隠す
        if (ballMesh.visible && cupPosY[ballSlot] < 0.7) {
          ballMesh.visible = false;
          ballMesh.position.y = BALL_Y;
        }
        if (phaseTimer > 0.8) {
          totalMoves = getShuffleCount();
          shuffleMoves = totalMoves;
          curMove = null;
          setPhase(PHASE_SHUFFLE);
          nextShuffleMove(ctx);
        }
      }
      else if (phase === PHASE_CORRECT) {
        if (phaseTimer > 1.6) {
          // 次のラウンド：カップ数チェック→また上空からの登場演出
          initSlots(hasFour() ? 4 : CUP_COUNT_INIT);
          setPhase(PHASE_REVEAL);
          ctx.setHint(ctx.t({ en: 'Remember the ball!', ja: 'たまをおぼえて！', es: '¡Recuerda la bola!', 'pt-BR': 'Lembre-se da bola!', fr: 'Mémorisez la balle !', de: 'Merke dir die Kugel!', it: 'Ricorda la pallina!', ko: '공을 기억해!', 'zh-Hans': '记住球的位置！', tr: 'Topu hatırla!' }));
        }
      }
      else if (phase === PHASE_WRONG) {
        // 選んだ空カップが上がった少し後に、正解カップも開いて玉を見せる
        if (!wrongRevealed && phaseTimer > 0.6) {
          wrongRevealed = true;
          cupTargY[ballSlot] = CUP_LIFT_Y;
          ballMesh.position.set(cupPosX[ballSlot], BALL_Y, cupPosZ[ballSlot]);
          ballMesh.visible = true;
        }
        if (phaseTimer > 2.2) {
          gameActive = false;
          ctx.gameOver(streak);
        }
      }
      else if (phase === PHASE_WAIT) {
        // 残り5秒からスポットライトを赤く明滅させて時間切れを予告
        if (phaseTimer > 10) {
          var blink = 0.5 + 0.5 * Math.sin(phaseTimer * 10);
          spotlightMesh.material.color.setHex(0xff3030);
          spotlightMesh.material.opacity = 0.08 + blink * 0.22;
        }
        // 15秒以内に答えないとゲームオーバー
        if (phaseTimer > 15) {
          setPhase(PHASE_WRONG);
          chosenSlot = -1;
          wrongRevealed = true;
          revealAll();
          ctx.sfx.fail();
          ctx.setHint(ctx.t({ en: 'Time\'s up!', ja: 'じかんぎれ！', es: '¡Tiempo!', 'pt-BR': 'Tempo esgotado!', fr: 'Temps écoulé !', de: 'Zeit abgelaufen!', it: 'Tempo scaduto!', ko: '시간 초과!', 'zh-Hans': '时间到！', tr: 'Süre doldu!' }));
        }
      }
    }
  });

})();
