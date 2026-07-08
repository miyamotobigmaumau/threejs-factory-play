/* =========================================================================
 * TMDinoRope — きょうりゅうなわとび
 * ルール: ティラノサウルスがなわとび。タイミングタップでジャンプ。
 * マッシュアップ肝: 巨体ゆえタップから0.2秒遅れて跳ぶ（先読み必須）。
 *   足元に予備動作モーションあり。着地で画面揺れ＋小鳥が飛ぶ。
 *   10回ごとに縄が加速。たまに翼竜がフェイント（速度を一瞬変える。
 *   フェイント中は翼竜が赤く点滅して知らせる）。
 * 見せ方（ノンバーバル設計）:
 *   - 縄は紅白ストライプの太いロープ（円柱インスタンス）。翼竜の手元を
 *     軸に Y-Z 平面で立体回転し、奥→頭上→手前→足元と一周が目で追える。
 *   - 縄が足元に来る 0.9 秒前から赤いリングが恐竜へ収縮（接近予告）。
 *   - 跳び成功で金色リングが拡散。失敗は縄が足に絡んで転倒。
 * スコア: 跳んだ回数
 * allowContinue: true → その場から再開
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------- 定数 ---------- */
  var ROPE_PERIOD_BASE = 1.4;  // 縄1回転の秒数（初期）
  var JUMP_DELAY = 0.2;        // タップから跳ぶまでの遅延（巨体）
  var JUMP_HEIGHT = 3.4;       // ジャンプ高さ
  var JUMP_DUR = 0.78;         // 空中時間(秒)
  var ROPE_SEGS = 40;          // ロープ分割数（円柱インスタンス数）
  var HAND_X = 3.5;            // 縄の両端X（翼竜の手元）
  var HAND_Y = 2.35;           // 縄の回転軸の高さ
  var ROPE_R = 2.25;           // 縄中央の振り半径（最下点 y≈0.1）
  var CAM_BASE_Y = 4.2;

  /* ---------- 状態 ---------- */
  var jumpCount;
  var ropeAngle;       // 縄の角度(ラジアン)。cos=+1 が真上, cos=-1 が足元
  var ropePeriod;
  var jumpQueued;
  var jumpQueueTimer;
  var dinoY;
  var dinoJumping;
  var jumpTimer;
  var preMotion;
  var preMotionTimer;
  var cameraShake;
  var fakeActive;
  var fakeTimer;
  var fakeDir;
  var hitFlag;
  var gameEnded;
  var ropeTurns;
  var scoreRingT;      // 成功リングのアニメ経過（<0 で非表示）
  var fallT;           // 転倒アニメ経過（<0 で非アクティブ）

  /* ---------- Three.js オブジェクト ---------- */
  var dinoMesh, dinoBody, dinoHead, dinoTail, dinoTailTip, dinoLegL, dinoLegR;
  var pterL, pterR;            // 翼竜（縄を回す）
  var pterMatL, pterMatR;      // フェイント点滅用マテリアル
  var ropeSegRed, ropeSegWhite; // InstancedMesh ×2（紅白ストライプ）
  var warningMesh;             // 縄接近予告（収縮リング）
  var scoreRingMesh;           // 成功時の拡散リング
  var birds = [];
  var birdPool = [];
  var dusts = [];
  var dustPool = [];

  /* ---------- DOM ---------- */
  var delayBar, delayBarBg;

  function makeDelayBarDom() {
    delayBarBg = document.createElement('div');
    delayBarBg.style.cssText = [
      'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);',
      'width:60vw;height:10px;background:rgba(0,0,0,.3);border-radius:5px;z-index:11;display:none;'
    ].join('');
    delayBar = document.createElement('div');
    delayBar.style.cssText = 'height:100%;width:0%;background:#ff6600;border-radius:5px;transition:none;';
    delayBarBg.appendChild(delayBar);
    document.body.appendChild(delayBarBg);
  }

  /* ---------- ティラノ生成 ---------- */
  function makeDino(THREE) {
    var g = new THREE.Group();
    var greenMat = Style.mat(0x4a7c3f);
    var darkMat  = Style.mat(0x2d4a28);
    var bellyMat = Style.mat(0xd8e8b8);
    var spikeMat = Style.mat(0x3b6332);

    // 胴体
    dinoBody = new THREE.Group();
    var torso = new THREE.Mesh(Style.roundedBox(1.8, 1.4, 1.2), greenMat);
    dinoBody.add(torso);
    // 腹当て（明色で正面が分かる）
    var belly = new THREE.Mesh(Style.roundedBox(1.2, 1.0, 0.5), bellyMat);
    belly.position.set(0.35, -0.12, 0.42);
    dinoBody.add(belly);
    // 背びれ3枚
    for (var s = 0; s < 3; s++) {
      var spike = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.42, 5), spikeMat);
      spike.position.set(-0.55 + s * 0.5, 0.82, 0);
      dinoBody.add(spike);
    }
    dinoBody.position.set(0, 1.0, 0);
    g.add(dinoBody);

    // 頭
    dinoHead = new THREE.Group();
    dinoHead.position.set(0.9, 1.55, 0);
    var headBox = new THREE.Mesh(Style.roundedBox(1.0, 0.7, 0.8), greenMat);
    dinoHead.add(headBox);
    var jaw = new THREE.Mesh(Style.roundedBox(0.9, 0.22, 0.7), darkMat);
    jaw.position.set(-0.02, -0.38, 0);
    dinoHead.add(jaw);
    // 目（白目＋黒目。両側）
    [1, -1].forEach(function (zs) {
      var white = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      white.position.set(0.28, 0.18, 0.41 * zs);
      dinoHead.add(white);
      var pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4),
        new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
      pupil.position.set(0.36, 0.18, 0.46 * zs);
      dinoHead.add(pupil);
    });
    // 鼻の穴
    [1, -1].forEach(function (zs) {
      var nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4),
        new THREE.MeshBasicMaterial({ color: 0x223318 }));
      nose.position.set(0.5, 0.02, 0.18 * zs);
      dinoHead.add(nose);
    });
    g.add(dinoHead);

    // 尾（2セグメントで生き物らしく）
    dinoTail = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.8, 6), greenMat);
    dinoTail.position.set(-1.3, 0.7, 0);
    dinoTail.rotation.z = -Math.PI / 2.2;
    g.add(dinoTail);
    dinoTailTip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 6), spikeMat);
    dinoTailTip.position.set(-2.15, 1.05, 0);
    dinoTailTip.rotation.z = -Math.PI / 2.05;
    g.add(dinoTailTip);

    // 脚（巨大）＋足先の爪
    function makeLeg(zs) {
      var leg = new THREE.Group();
      leg.position.set(-0.45, 0.4, 0.4 * zs);
      var thigh = new THREE.Mesh(Style.roundedBox(0.5, 1.1, 0.5), darkMat);
      thigh.position.y = -0.55;
      leg.add(thigh);
      var foot = new THREE.Mesh(Style.roundedBox(0.62, 0.16, 0.5), greenMat);
      foot.position.set(0.12, -1.02, 0);
      leg.add(foot);
      for (var c = -1; c <= 1; c++) {
        var claw = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 4), bellyMat);
        claw.rotation.z = -Math.PI / 2;
        claw.position.set(0.48, -1.02, c * 0.15);
        leg.add(claw);
      }
      return leg;
    }
    dinoLegL = makeLeg(1);
    g.add(dinoLegL);
    dinoLegR = makeLeg(-1);
    g.add(dinoLegR);

    // 短い腕（ティラノの特徴）
    [1, -1].forEach(function (zs) {
      var arm = new THREE.Mesh(Style.roundedBox(0.3, 0.5, 0.2), greenMat);
      arm.position.set(0.6, 1.35, 0.5 * zs);
      arm.rotation.z = 0.4;
      g.add(arm);
    });

    // 接地シャドウ
    var shadow = Style.softShadow(1.5);
    shadow.position.y = 0.01;
    g.add(shadow);

    return g;
  }

  /* ---------- 翼竜生成 ---------- */
  function makePterodactyl(THREE, color) {
    var g = new THREE.Group();
    var mat = Style.mat(color);
    var body = new THREE.Mesh(Style.roundedBox(0.6, 0.45, 0.35), mat);
    g.add(body);
    // 翼（羽ばたき用に回転軸を根元へ）
    var wings = [];
    [1, -1].forEach(function (zs) {
      var pivot = new THREE.Group();
      pivot.position.set(0, 0.1, 0.17 * zs);
      var wing = new THREE.Mesh(Style.roundedBox(0.5, 0.06, 1.5), mat);
      wing.position.z = 0.75 * zs;
      pivot.add(wing);
      g.add(pivot);
      wings.push(pivot);
    });
    g.userData.wings = wings;
    // 頭＋くちばし＋トサカ
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), mat);
    head.position.set(0.38, 0.18, 0);
    g.add(head);
    var beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 5), Style.mat(0xf2b632));
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.68, 0.15, 0);
    g.add(beak);
    var crest = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 5), mat);
    crest.rotation.z = Math.PI / 2.6;
    crest.position.set(0.18, 0.38, 0);
    g.add(crest);
    var eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0x111111 }));
    eye.position.set(0.45, 0.26, 0.13);
    g.add(eye);
    // 脚（縄をつかむ）
    var legs = new THREE.Mesh(Style.roundedBox(0.1, 0.4, 0.1), Style.mat(0x8a6a3a));
    legs.position.set(-0.05, -0.4, 0);
    g.add(legs);
    return { group: g, mat: mat };
  }

  /* ---------- 縄（紅白ストライプの太ロープ / InstancedMesh×2） ---------- */
  var _dummy = null;
  var _up = null;
  var _tangent = null;
  var _quat = null;

  function makeRope(THREE, scene) {
    _dummy = new THREE.Object3D();
    _up = new THREE.Vector3(0, 1, 0);
    _tangent = new THREE.Vector3();
    _quat = new THREE.Quaternion();
    var segGeo = new THREE.CylinderGeometry(0.085, 0.085, 1, 6, 1, true);
    var redMat = new THREE.MeshStandardMaterial({ color: 0xe84545, roughness: 0.9, metalness: 0 });
    var whiteMat = new THREE.MeshStandardMaterial({ color: 0xfff6e8, roughness: 0.9, metalness: 0 });
    var half = ROPE_SEGS / 2;
    ropeSegRed = new THREE.InstancedMesh(segGeo, redMat, half);
    ropeSegWhite = new THREE.InstancedMesh(segGeo, whiteMat, half);
    ropeSegRed.frustumCulled = false;
    ropeSegWhite.frustumCulled = false;
    scene.add(ropeSegRed);
    scene.add(ropeSegWhite);
  }

  // 縄上の点: 両端は翼竜の手元(±HAND_X, HAND_Y, 0)。中央ほど振り半径が大きい。
  function ropePoint(t, cosA, sinA, out) {
    var rho = ROPE_R * Math.sin(Math.PI * t);
    out.x = -HAND_X + 2 * HAND_X * t;
    out.y = HAND_Y + rho * cosA;
    out.z = rho * sinA;
  }

  var _pA = null, _pB = null;
  function updateRope(angle) {
    if (!_pA) { _pA = new THREE.Vector3(); _pB = new THREE.Vector3(); }
    var cosA = Math.cos(angle), sinA = Math.sin(angle);
    var ri = 0, wi = 0;
    for (var i = 0; i < ROPE_SEGS; i++) {
      ropePoint(i / ROPE_SEGS, cosA, sinA, _pA);
      ropePoint((i + 1) / ROPE_SEGS, cosA, sinA, _pB);
      _dummy.position.set((_pA.x + _pB.x) / 2, (_pA.y + _pB.y) / 2, (_pA.z + _pB.z) / 2);
      _tangent.set(_pB.x - _pA.x, _pB.y - _pA.y, _pB.z - _pA.z);
      var len = _tangent.length() || 0.001;
      _tangent.normalize();
      _quat.setFromUnitVectors(_up, _tangent);
      _dummy.quaternion.copy(_quat);
      _dummy.scale.set(1, len * 1.12, 1);
      _dummy.updateMatrix();
      if (i % 2 === 0) ropeSegRed.setMatrixAt(ri++, _dummy.matrix);
      else ropeSegWhite.setMatrixAt(wi++, _dummy.matrix);
    }
    ropeSegRed.instanceMatrix.needsUpdate = true;
    ropeSegWhite.instanceMatrix.needsUpdate = true;
  }

  /* ---------- 小鳥・砂煙 ---------- */
  function spawnBirds(count) {
    for (var i = 0; i < count; i++) {
      var bird = null;
      for (var bi = 0; bi < birdPool.length; bi++) {
        if (!birdPool[bi].visible) { bird = birdPool[bi]; break; }
      }
      if (!bird) return;
      bird.userData.vx = (Math.random() - 0.5) * 4;
      bird.userData.vy = 2 + Math.random() * 2;
      bird.userData.life = 1.5;
      bird.position.set((Math.random() - 0.5) * 3, 0.5, (Math.random() - 0.5) * 1.5);
      bird.visible = true;
      birds.push(bird);
    }
  }

  function spawnDust(count) {
    for (var i = 0; i < count; i++) {
      var d = null;
      for (var di = 0; di < dustPool.length; di++) {
        if (!dustPool[di].visible) { d = dustPool[di]; break; }
      }
      if (!d) return;
      var ang = Math.random() * Math.PI * 2;
      d.userData.vx = Math.cos(ang) * (1.5 + Math.random());
      d.userData.vz = Math.sin(ang) * (1.5 + Math.random());
      d.userData.life = 0.5 + Math.random() * 0.25;
      d.userData.maxLife = d.userData.life;
      d.position.set((Math.random() - 0.5) * 0.8, 0.15, (Math.random() - 0.5) * 0.8);
      d.scale.set(1, 1, 1);
      d.visible = true;
      dusts.push(d);
    }
  }

  /* ---------- 背景（ジャングルの舞台説明） ---------- */
  function buildStage(ctx) {
    var THREE = ctx.THREE;

    // 地面
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), Style.mat(0x5a8a30));
    ground.rotation.x = -Math.PI / 2;
    ctx.scene.add(ground);

    // 踏み固められた土の輪（なわとびの「場」を示す）
    var dirt = new THREE.Mesh(new THREE.CircleGeometry(3.4, 28), Style.mat(0xa88d5f));
    dirt.rotation.x = -Math.PI / 2;
    dirt.position.y = 0.005;
    ctx.scene.add(dirt);

    // 火山（背景ランドマーク）
    var volcano = new THREE.Mesh(new THREE.ConeGeometry(7, 9, 8), Style.mat(0x7a5a48, { flat: true }));
    volcano.position.set(-14, 4.5, -22);
    ctx.scene.add(volcano);
    var crater = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 1.2, 8),
      new THREE.MeshBasicMaterial({ color: 0xff7043 }));
    crater.position.set(-14, 8.6, -22);
    ctx.scene.add(crater);

    // 雲
    [[8, 11, -20, 1.6], [-4, 13, -24, 2.0], [16, 12, -16, 1.2]].forEach(function (c) {
      var cloud = new THREE.Group();
      for (var i = 0; i < 3; i++) {
        var puff = new THREE.Mesh(new THREE.SphereGeometry(c[3] * (0.7 + Math.random() * 0.4), 7, 5),
          new THREE.MeshBasicMaterial({ color: 0xfffdf5 }));
        puff.position.set(i * c[3] * 0.9 - c[3], (Math.random() - 0.5) * 0.4, 0);
        cloud.add(puff);
      }
      cloud.position.set(c[0], c[1], c[2]);
      ctx.scene.add(cloud);
    });

    // 木（ヤシ風に葉を放射）
    var trunkMat = Style.mat(0x6b4c2a);
    var leafMat = Style.mat(0x2d6e1e);
    [[-8, -6], [9, -5], [-7, 4], [10, 3], [-12, -1], [13, -2]].forEach(function (pos) {
      var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 3.2, 7), trunkMat);
      trunk.position.set(pos[0], 1.6, pos[1]);
      trunk.rotation.z = (Math.random() - 0.5) * 0.15;
      ctx.scene.add(trunk);
      for (var l = 0; l < 5; l++) {
        var ang = (l / 5) * Math.PI * 2;
        var leaf = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.9, 5), leafMat);
        leaf.position.set(pos[0] + Math.cos(ang) * 0.85, 3.3, pos[1] + Math.sin(ang) * 0.85);
        leaf.rotation.set(Math.sin(ang) * 1.25, 0, -Math.cos(ang) * 1.25);
        ctx.scene.add(leaf);
      }
    });

    // シダ・岩（手前の情報量）
    [[-4.5, 2.5], [4.8, 2.2], [-5.5, -2.8], [5.8, -3.0]].forEach(function (pos, idx) {
      if (idx % 2 === 0) {
        for (var f = 0; f < 4; f++) {
          var fern = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.9, 4), Style.mat(0x3f8a2f));
          fern.position.set(pos[0] + (Math.random() - 0.5) * 0.5, 0.42, pos[1] + (Math.random() - 0.5) * 0.5);
          fern.rotation.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6);
          ctx.scene.add(fern);
        }
      } else {
        var rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), Style.mat(0x9aa0a6, { flat: true }));
        rock.position.set(pos[0], 0.3, pos[1]);
        rock.rotation.set(Math.random(), Math.random(), 0);
        ctx.scene.add(rock);
      }
    });
  }

  /* ---------- Shell.registerGame ---------- */
  Shell.registerGame({
    id: 'TMDinoRope',
    title: { en: 'Dino Jump Rope', ja: 'きょうりゅうなわとび', es: 'Dinosaurio Saltarín', 'pt-BR': 'Dino Pula-Corda', fr: 'Dino Corde à Sauter', de: 'Dino-Springseil', it: 'Dino Saltacorda', ko: '공룡 줄넘기', 'zh-Hans': '恐龙跳绳', tr: 'Dino İp Atlama' },
    howto: { en: 'Tap before the rope hits!\nHeavy body — tap a bit early!', ja: '縄が来る前にタップ！\nおもいからおそめに押すべし', es: '¡Toca antes de que la cuerda golpee!\n¡Cuerpo pesado — toca un poco antes!', 'pt-BR': 'Toque antes da corda atingir!\nCorpo pesado — toque um pouco antes!', fr: 'Touchez avant que la corde ne frappe!\nCorps lourd — touchez un peu plus tôt!', de: 'Tippe bevor das Seil trifft!\nSchwerer Körper — etwas früher tippen!', it: 'Tocca prima che la corda colpisca!\nCorpo pesante — tocca un po\' prima!', ko: '줄이 오기 전에 탭!\n몸이 무거우니 조금 일찍 눌러라!', 'zh-Hans': '在绳子打到前点击！\n身体沉重——稍早一点点击！', tr: 'İp çarpmadan önce dokun!\nAğır vücut — biraz erken dokun!' },
    scoreLabel: { en: 'jumps', ja: 'かい', es: 'saltos', 'pt-BR': 'pulos', fr: 'sauts', de: 'Sprünge', it: 'salti', ko: '회', 'zh-Hans': '次', tr: 'atlama' },
    bg: 0x9edcf0,
    fogNear: 26, fogFar: 70,
    cameraFov: 58,
    cameraPos: [5.6, CAM_BASE_Y, 10.8],
    cameraLookAt: [0, 1.9, 0],
    fitWidth: 13,
    allowContinue: true,

    init: function (ctx) {
      var THREE = ctx.THREE;

      buildStage(ctx);

      // ティラノ
      dinoMesh = makeDino(THREE);
      ctx.scene.add(dinoMesh);

      // 翼竜（縄の両端を持って羽ばたく）
      var pl = makePterodactyl(THREE, 0xcc8844);
      pterL = pl.group; pterMatL = pl.mat;
      pterL.position.set(-HAND_X - 0.35, HAND_Y + 0.5, 0);
      ctx.scene.add(pterL);

      var pr = makePterodactyl(THREE, 0xb87333);
      pterR = pr.group; pterMatR = pr.mat;
      pterR.position.set(HAND_X + 0.35, HAND_Y + 0.5, 0);
      pterR.rotation.y = Math.PI; // 内側を向く
      ctx.scene.add(pterR);

      // 縄
      makeRope(THREE, ctx.scene);

      // 接近予告リング（赤・収縮）
      warningMesh = new THREE.Mesh(
        new THREE.RingGeometry(1.35, 1.7, 28),
        new THREE.MeshBasicMaterial({ color: 0xff5252, transparent: true, opacity: 0, side: THREE.DoubleSide })
      );
      warningMesh.rotation.x = -Math.PI / 2;
      warningMesh.position.set(0, 0.02, 0);
      warningMesh.visible = false;
      ctx.scene.add(warningMesh);

      // 成功リング（金・拡散）
      scoreRingMesh = new THREE.Mesh(
        new THREE.RingGeometry(1.0, 1.22, 28),
        new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0, side: THREE.DoubleSide })
      );
      scoreRingMesh.rotation.x = -Math.PI / 2;
      scoreRingMesh.position.set(0, 0.03, 0);
      scoreRingMesh.visible = false;
      ctx.scene.add(scoreRingMesh);

      // 小鳥・砂煙プール
      var birdGeo = new THREE.SphereGeometry(0.08, 4, 3);
      var birdMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
      for (var bp = 0; bp < 18; bp++) {
        var birdMesh = new THREE.Mesh(birdGeo, birdMat);
        birdMesh.visible = false;
        ctx.scene.add(birdMesh);
        birdPool.push(birdMesh);
      }
      var dustGeo = new THREE.SphereGeometry(0.14, 5, 4);
      for (var dp = 0; dp < 12; dp++) {
        var dustMesh = new THREE.Mesh(dustGeo,
          new THREE.MeshBasicMaterial({ color: 0xcbb48a, transparent: true, opacity: 0.8 }));
        dustMesh.visible = false;
        ctx.scene.add(dustMesh);
        dustPool.push(dustMesh);
      }

      makeDelayBarDom();
    },

    start: function (ctx) {
      jumpCount = 0;
      ropeAngle = 0;
      ropePeriod = ROPE_PERIOD_BASE;
      ropeTurns = 0;
      jumpQueued = false;
      jumpQueueTimer = 0;
      dinoY = 0;
      dinoJumping = false;
      jumpTimer = 0;
      preMotion = 0;
      preMotionTimer = 0;
      cameraShake = 0;
      fakeActive = false;
      fakeTimer = 0;
      fakeDir = 1;
      hitFlag = false;
      gameEnded = false;
      scoreRingT = -1;
      fallT = -1;
      warningMesh.visible = false;
      scoreRingMesh.visible = false;

      dinoMesh.position.set(0, 0, 0);
      dinoMesh.rotation.set(0, 0, 0);
      dinoMesh.scale.set(1, 1, 1);
      dinoBody.position.y = 1.0;
      dinoHead.position.y = 1.55;
      dinoLegL.rotation.x = 0;
      dinoLegR.rotation.x = 0;
      pterMatL.color.setHex(0xcc8844);
      pterMatR.color.setHex(0xb87333);
      birds.forEach(function (b) { b.visible = false; });
      birds.length = 0;
      dusts.forEach(function (d) { d.visible = false; });
      dusts.length = 0;

      delayBarBg.style.display = 'none';
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Watch the timing and tap!', ja: 'タイミングをみて タップ！', es: '¡Observa el ritmo y toca!', 'pt-BR': 'Observe o ritmo e toque!', fr: 'Regardez le rythme et touchez!', de: 'Timing beobachten und tippen!', it: 'Osserva il ritmo e tocca!', ko: '타이밍을 보고 탭!', 'zh-Hans': '观察时机点击！', tr: 'Zamanlamayı gözle ve dokun!' }));
      updateRope(ropeAngle);
    },

    onContinue: function (ctx) {
      hitFlag = false;
      gameEnded = false;
      dinoJumping = false;
      dinoY = 0;
      jumpQueued = false;
      fallT = -1;
      dinoMesh.rotation.set(0, 0, 0);
      dinoMesh.position.set(0, 0, 0);
      ropeAngle = 0;   // 縄を真上から再開（即死防止）
      ropeTurns = 0;   // 最初の1周をゆっくりに戻して立て直しの猶予を作る
      ctx.setHint(ctx.t({ en: 'Tap to jump!', ja: 'タップで跳べ！', es: '¡Toca para saltar!', 'pt-BR': 'Toque para pular!', fr: 'Touchez pour sauter!', de: 'Tippe zum Springen!', it: 'Tocca per saltare!', ko: '탭으로 뛰어라!', 'zh-Hans': '点击跳跃！', tr: 'Atlamak için dokun!' }));
    },

    onPointerDown: function (ctx, p) {
      if (gameEnded || dinoJumping) return; // 空中では無効
      jumpQueued = true;
      jumpQueueTimer = 0;
      preMotion = 1;
      preMotionTimer = 0;
      delayBarBg.style.display = '';
      delayBar.style.width = '0%';
      ctx.sfx.tap();
    },

    update: function (ctx, dt) {
      // 転倒アニメ（gameEnded 後も動かす）
      if (fallT >= 0) {
        fallT += dt;
        var ft = Math.min(fallT / 0.5, 1);
        dinoMesh.rotation.z = 0.9 * ft * ft;
        dinoMesh.position.y = -0.25 * ft;
        if (fallT > 0.25 && fallT - dt <= 0.25) spawnDust(6);
      }
      // 小鳥・砂煙は常に更新
      for (var bi = birds.length - 1; bi >= 0; bi--) {
        var b = birds[bi];
        b.userData.life -= dt;
        b.position.x += b.userData.vx * dt;
        b.position.y += b.userData.vy * dt;
        b.userData.vy -= 4 * dt;
        if (b.userData.life <= 0) { b.visible = false; birds.splice(bi, 1); }
      }
      for (var di = dusts.length - 1; di >= 0; di--) {
        var d = dusts[di];
        d.userData.life -= dt;
        d.position.x += d.userData.vx * dt;
        d.position.z += d.userData.vz * dt;
        var lr = Math.max(d.userData.life / d.userData.maxLife, 0);
        d.material.opacity = 0.8 * lr;
        d.scale.setScalar(1 + (1 - lr) * 1.6);
        if (d.userData.life <= 0) { d.visible = false; dusts.splice(di, 1); }
      }

      if (gameEnded) return;

      // 縄の回転（最初の1周はゆっくり）
      var effectivePeriod = ropePeriod * (ropeTurns < 1 ? 1.7 : 1.0);
      var angSpeed = (Math.PI * 2) / effectivePeriod;

      // フェイント（翼竜のいたずら。発動中は翼竜が赤く点滅して知らせる）
      if (!fakeActive && jumpCount > 0 && jumpCount % 10 === 0 && Math.random() < 0.003 / dt) {
        fakeActive = true;
        fakeTimer = 0.4 + Math.random() * 0.3;
        fakeDir = Math.random() < 0.5 ? 0.5 : 2.0;
      }
      if (fakeActive) {
        fakeTimer -= dt;
        angSpeed *= fakeDir;
        var blink = Math.sin(ctx.elapsed * 25) > 0;
        pterMatL.color.setHex(blink ? 0xff4040 : 0xcc8844);
        pterMatR.color.setHex(blink ? 0xff4040 : 0xb87333);
        if (fakeTimer <= 0) {
          fakeActive = false;
          pterMatL.color.setHex(0xcc8844);
          pterMatR.color.setHex(0xb87333);
        }
      }

      var angleStep = angSpeed * dt;
      ropeAngle = (ropeAngle + angleStep) % (Math.PI * 2);
      ropeTurns += angleStep / (Math.PI * 2);
      updateRope(ropeAngle);

      // 接近予告: 縄が足元(angle=π)に来る0.9秒前から赤リングが収縮
      var secondsToBottom = ((Math.PI - ropeAngle + Math.PI * 2) % (Math.PI * 2)) / angSpeed;
      if (secondsToBottom < 0.9 && !dinoJumping) {
        var wt = 1 - secondsToBottom / 0.9; // 0→1
        warningMesh.visible = true;
        warningMesh.material.opacity = 0.2 + wt * 0.6;
        var ws = 1.9 - wt * 0.9; // 1.9 → 1.0 に収縮
        warningMesh.scale.set(ws, ws, ws);
      } else {
        warningMesh.visible = false;
      }

      // 成功リング拡散
      if (scoreRingT >= 0) {
        scoreRingT += dt;
        var st = scoreRingT / 0.45;
        if (st >= 1) {
          scoreRingT = -1;
          scoreRingMesh.visible = false;
        } else {
          scoreRingMesh.visible = true;
          var ss = 1 + st * 1.8;
          scoreRingMesh.scale.set(ss, ss, ss);
          scoreRingMesh.material.opacity = 0.85 * (1 - st);
        }
      }

      // 翼竜: 羽ばたき＋手元の小さな円運動（縄を「回している」ことを見せる）
      var cosA = Math.cos(ropeAngle), sinA = Math.sin(ropeAngle);
      [pterL, pterR].forEach(function (pt, idx) {
        var baseX = idx === 0 ? -HAND_X - 0.35 : HAND_X + 0.35;
        pt.position.x = baseX;
        pt.position.y = HAND_Y + 0.5 + 0.22 * cosA;
        pt.position.z = 0.22 * sinA;
        var wings = pt.userData.wings;
        var flap = Math.sin(ctx.elapsed * (fakeActive ? 14 : 7) + idx) * 0.55;
        wings[0].rotation.x = flap;
        wings[1].rotation.x = -flap;
      });

      // 跳ぶ予約の遅延タイマー
      if (jumpQueued) {
        jumpQueueTimer += dt;
        delayBar.style.width = Math.min(100, (jumpQueueTimer / JUMP_DELAY) * 100) + '%';
        if (jumpQueueTimer >= JUMP_DELAY) {
          jumpQueued = false;
          delayBarBg.style.display = 'none';
          if (!dinoJumping) {
            dinoJumping = true;
            jumpTimer = 0;
            preMotion = 0;
            spawnDust(4);
            ctx.sfx.bounce();
            ctx.vibrate(15);
          }
        }
      }

      // 予備動作（しゃがみスクワッシュ）
      if (preMotion === 1) {
        preMotionTimer += dt;
        var crouch = Math.min(preMotionTimer / JUMP_DELAY, 1);
        dinoMesh.scale.y = 1 - crouch * 0.12;
        dinoMesh.scale.x = 1 + crouch * 0.06;
      }

      // ジャンプ物理（二次曲線）＋ストレッチ
      if (dinoJumping) {
        jumpTimer += dt;
        var t = jumpTimer / JUMP_DUR;
        if (t >= 1.0) {
          dinoY = 0;
          dinoJumping = false;
          jumpTimer = 0;
          dinoMesh.scale.set(1.08, 0.9, 1.08); // 着地スクワッシュ
          cameraShake = 0.3;
          ctx.sfx.bounce();
          ctx.vibrate(30);
          spawnDust(7);
          spawnBirds(3 + Math.floor(Math.random() * 3));
        } else {
          dinoY = JUMP_HEIGHT * 4 * t * (1 - t);
          var stretch = 1 + Math.sin(t * Math.PI) * 0.1;
          dinoMesh.scale.set(1 / stretch, stretch, 1 / stretch);
          dinoLegL.rotation.x = -Math.sin(t * Math.PI) * 0.6;
          dinoLegR.rotation.x = Math.sin(t * Math.PI) * 0.6;
        }
      } else {
        dinoLegL.rotation.x = 0;
        dinoLegR.rotation.x = 0;
        // スクワッシュ戻し
        if (preMotion !== 1) {
          dinoMesh.scale.x += (1 - dinoMesh.scale.x) * Math.min(dt * 10, 1);
          dinoMesh.scale.y += (1 - dinoMesh.scale.y) * Math.min(dt * 10, 1);
          dinoMesh.scale.z += (1 - dinoMesh.scale.z) * Math.min(dt * 10, 1);
        }
      }

      dinoMesh.position.y = dinoY;

      // ---- 縄ヒット判定 ----
      // 縄が足元を通過 = ropeAngle ≈ π（cos ≈ -1）。窄い窓で「予告→タップ→ジャンプ」が
      // 間に合う設計（遅延0.2s込み）。
      var ropeCrossing = cosA < -0.97;

      if (!hitFlag && ropeCrossing && !dinoJumping) {
        if (dinoY < 0.5) {
          hitFlag = true;
          gameEnded = true;
          fallT = 0; // 転倒アニメ開始
          jumpQueued = false;
          delayBarBg.style.display = 'none';
          warningMesh.visible = false;
          ctx.sfx.fail();
          ctx.vibrate(80);
          setTimeout(function () {
            ctx.gameOver(jumpCount);
          }, 800);
          return;
        }
      } else if (!hitFlag && ropeCrossing && dinoJumping) {
        jumpCount++;
        ctx.setScore(jumpCount);
        ctx.sfx.score();
        scoreRingT = 0; // 金リング拡散
        if (jumpCount % 10 === 0) {
          ropePeriod = Math.max(0.55, ropePeriod * 0.88);
          ctx.setHint(ctx.t({ en: 'Speed up!', ja: 'はやくなった！', es: '¡Más rápido!', 'pt-BR': 'Mais rápido!', fr: 'Plus vite!', de: 'Schneller!', it: 'Più veloce!', ko: '빨라졌다!', 'zh-Hans': '加速了！', tr: 'Hızlandı!' }));
        }
      }

      if (hitFlag && !ropeCrossing) hitFlag = false;
      else if (ropeCrossing) hitFlag = true;

      // カメラ振動（着地後）
      if (cameraShake > 0) {
        cameraShake -= dt;
        ctx.camera.position.y = CAM_BASE_Y + Math.sin(cameraShake * 40) * 0.08 * cameraShake;
      }
    }
  });
})();
