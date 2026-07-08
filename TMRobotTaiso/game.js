// TMRobotTaiso — まねっこロボたいそう（サイモン式記憶ゲーム）
// お手本ロボットが取るポーズ列を記憶し、同じ順番でポーズボタンを押して再現する。
// レベルごとにポーズ列が1つずつ伸びる。間違えたらゲームオーバー。スコア=クリア段数。
(function () {
  'use strict';

  // =====================================================
  // ポーズ定義（サイモンの4色対応）
  //   0: 画面右の手を上げる（赤）
  //   1: 画面左の手を上げる（青）
  //   2: 両手を上げる（黄）
  //   3: しゃがむ（緑）
  // rArm/lArm = 腕ピボットの目標Z回転, legs = 脚の開き, sy = 縦スケール(しゃがみ)
  // =====================================================
  var ARM_UP    = 2.7;   // 腕を頭上まで上げる角度
  var ARM_OUT   = 0.55;  // しゃがみ時に腕を軽く開く角度
  var LEG_OUT   = 0.55;  // しゃがみ時に脚を開く角度
  var SQUAT_SY  = 0.62;  // しゃがみ時の縦スケール

  var POSES = [
    { rArm: ARM_UP,  lArm: 0,        legs: 0,       sy: 1,        color: 0xe8504b, tone: 262 },
    { rArm: 0,       lArm: -ARM_UP,  legs: 0,       sy: 1,        color: 0x4b7de8, tone: 330 },
    { rArm: ARM_UP,  lArm: -ARM_UP,  legs: 0,       sy: 1,        color: 0xf2c530, tone: 392 },
    { rArm: ARM_OUT, lArm: -ARM_OUT, legs: LEG_OUT, sy: SQUAT_SY, color: 0x43b96b, tone: 523 }
  ];
  var NEUTRAL = { rArm: 0, lArm: 0, legs: 0, sy: 1 };

  // =====================================================
  // 効果音（サイモン風・ポーズごとに固有トーン）
  // shell の sfx に beep 公開が無いため軽量な自前トーンを持つ
  // =====================================================
  var _ac = null;
  function tone(freq) {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    if (!_ac) _ac = new C();
    if (_ac.state === 'suspended') _ac.resume();
    var o = _ac.createOscillator();
    var g = _ac.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.16, _ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, _ac.currentTime + 0.3);
    o.connect(g);
    g.connect(_ac.destination);
    o.start();
    o.stop(_ac.currentTime + 0.3);
  }

  // =====================================================
  // ロボット生成（既存造形を踏襲）
  // =====================================================
  function makeRobot(THREE, x, isDemo) {
    var group = new THREE.Group();
    group.position.set(x, 0, 0);

    var bodyColor  = isDemo ? 0x4488cc : 0xcc4444; // 青=お手本, 赤=プレイヤー
    var headColor  = isDemo ? 0x66aaee : 0xee6666;
    var limbColor  = isDemo ? 0x336699 : 0xaa3333;
    var jointColor = isDemo ? 0x224477 : 0x882222;

    var headMat  = Style.mat(headColor);
    var bodyMat  = Style.mat(bodyColor);
    var limbMat  = Style.mat(limbColor);
    var jointMat = Style.mat(jointColor);

    // --- 胴体 ---
    var bodyMesh = new THREE.Mesh(Style.roundedBox(1.0, 1.5, 0.6), bodyMat);
    bodyMesh.position.set(0, 1.5, 0);
    group.add(bodyMesh);

    // --- 頭 ---
    var headMesh = new THREE.Mesh(Style.roundedBox(0.7, 0.7, 0.6), headMat);
    headMesh.position.set(0, 2.65, 0);
    group.add(headMesh);

    // 目
    var eyeGeo = Style.roundedBox(0.15, 0.12, 0.05);
    var eyeMat = Style.mat(0xffffff);
    var eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    var eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.15, 2.7, 0.32);
    eyeR.position.set( 0.15, 2.7, 0.32);
    group.add(eyeL);
    group.add(eyeR);

    // 瞳
    var pupilGeo = Style.roundedBox(0.07, 0.07, 0.06);
    var pupilMat = Style.mat(0x222222);
    var pupilL = new THREE.Mesh(pupilGeo, pupilMat);
    var pupilR = new THREE.Mesh(pupilGeo, pupilMat);
    pupilL.position.set(-0.15, 2.7, 0.35);
    pupilR.position.set( 0.15, 2.7, 0.35);
    group.add(pupilL);
    group.add(pupilR);

    // アンテナ
    var antMesh = new THREE.Mesh(Style.roundedBox(0.07, 0.35, 0.07), jointMat);
    antMesh.position.set(0, 3.2, 0);
    group.add(antMesh);
    var antTopMesh = new THREE.Mesh(Style.roundedBox(0.14, 0.14, 0.14), Style.mat(0xffcc00));
    antTopMesh.position.set(0, 3.42, 0);
    group.add(antTopMesh);

    // 肢（ピボット＋メッシュ）
    function makeLimb(px, py, w, h, d) {
      var pivot = new THREE.Object3D();
      pivot.position.set(px, py, 0);
      group.add(pivot);
      var mesh = new THREE.Mesh(Style.roundedBox(w, h, d), limbMat);
      mesh.position.set(0, -0.65, 0);
      pivot.add(mesh);
      var jMesh = new THREE.Mesh(Style.roundedBox(w + 0.05, w + 0.05, d + 0.05), jointMat);
      pivot.add(jMesh);
      return pivot;
    }
    var rArmPivot = makeLimb( 0.65, 2.25, 0.3,  1.2,  0.3);
    var lArmPivot = makeLimb(-0.65, 2.25, 0.3,  1.2,  0.3);
    var rLegPivot = makeLimb( 0.28, 0.75, 0.35, 1.3,  0.35);
    var lLegPivot = makeLimb(-0.28, 0.75, 0.35, 1.3,  0.35);

    // 足（装飾）
    var footGeo = Style.roundedBox(0.4, 0.2, 0.5);
    var footMat = Style.mat(jointColor);
    var footR = new THREE.Mesh(footGeo, footMat);
    var footL = new THREE.Mesh(footGeo, footMat);
    footR.position.set( 0.28, 0.1, 0);
    footL.position.set(-0.28, 0.1, 0);
    group.add(footR);
    group.add(footL);

    return {
      group: group,
      rArmPivot: rArmPivot,
      lArmPivot: lArmPivot,
      rLegPivot: rLegPivot,
      lLegPivot: lLegPivot,
      // 目標ポーズ（毎フレーム補間）
      target: { rArm: 0, lArm: 0, legs: 0, sy: 1 }
    };
  }

  // ポーズを目標値としてセット（アニメは update で補間）
  function setPose(robot, pose) {
    robot.target.rArm = pose.rArm;
    robot.target.lArm = pose.lArm;
    robot.target.legs = pose.legs;
    robot.target.sy   = pose.sy;
  }

  // ポーズを即時反映（開始時のリセット用）
  function snapPose(robot, pose) {
    setPose(robot, pose);
    robot.rArmPivot.rotation.z =  pose.rArm;
    robot.lArmPivot.rotation.z =  pose.lArm;
    robot.rLegPivot.rotation.z =  pose.legs;
    robot.lLegPivot.rotation.z = -pose.legs;
    robot.group.scale.y = pose.sy;
  }

  // 肢・スケールのスムーズ補間（毎フレーム）
  function updateRobot(robot, dt) {
    var s = Math.min(1, 10 * dt);
    robot.rArmPivot.rotation.z += ( robot.target.rArm - robot.rArmPivot.rotation.z) * s;
    robot.lArmPivot.rotation.z += ( robot.target.lArm - robot.lArmPivot.rotation.z) * s;
    robot.rLegPivot.rotation.z += ( robot.target.legs - robot.rLegPivot.rotation.z) * s;
    robot.lLegPivot.rotation.z += (-robot.target.legs - robot.lLegPivot.rotation.z) * s;
    robot.group.scale.y        += ( robot.target.sy   - robot.group.scale.y)        * s;
  }

  // ロボット全体を暗く/明るく（見る番・入力番の表現）
  function setRobotDim(robot, dim) {
    robot.group.traverse(function (obj) {
      if (!obj.isMesh || !obj.material || !obj.material.color) return;
      if (obj.material._origHex === undefined) obj.material._origHex = obj.material.color.getHex();
      obj.material.color.setHex(obj.material._origHex);
      if (dim) obj.material.color.multiplyScalar(0.35);
    });
  }

  // =====================================================
  // ポーズボタン用シルエット SVG（ノンバーバル・白線スティック図）
  // =====================================================
  function poseSVG(idx) {
    var pre  = '<svg viewBox="0 0 40 40" width="70%" height="70%" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">';
    var post = '</svg>';
    var s;
    if (idx === 3) {
      // しゃがみ：低い姿勢・脚曲げ・腕は斜め下
      s = '<circle cx="20" cy="15" r="4.2"/>' +
          '<line x1="20" y1="19" x2="20" y2="28"/>' +
          '<line x1="20" y1="21" x2="11" y2="25"/>' +
          '<line x1="20" y1="21" x2="29" y2="25"/>' +
          '<polyline points="20,28 12,31 14,37"/>' +
          '<polyline points="20,28 28,31 26,37"/>';
    } else {
      var rUp = (idx === 0 || idx === 2); // 画面右の腕
      var lUp = (idx === 1 || idx === 2); // 画面左の腕
      s = '<circle cx="20" cy="8" r="4.2"/>' +
          '<line x1="20" y1="12" x2="20" y2="26"/>' +
          (lUp ? '<line x1="20" y1="15" x2="12" y2="4"/>'  : '<line x1="20" y1="15" x2="12" y2="23"/>') +
          (rUp ? '<line x1="20" y1="15" x2="28" y2="4"/>'  : '<line x1="20" y1="15" x2="28" y2="23"/>') +
          '<line x1="20" y1="26" x2="14" y2="37"/>' +
          '<line x1="20" y1="26" x2="26" y2="37"/>';
    }
    return pre + s + post;
  }

  function hexCss(c) {
    var s = c.toString(16);
    while (s.length < 6) s = '0' + s;
    return '#' + s;
  }

  // =====================================================
  // タイミング設定（レベルが上がるとお手本が少し速くなる）
  // =====================================================
  function demoPoseTime(level) { return Math.max(0.4, 0.75 - level * 0.03); }
  var DEMO_GAP = 0.28;

  // =====================================================
  // ゲーム本体
  // =====================================================
  Shell.registerGame({
    id          : 'TMRobotTaiso',
    title       : { en: 'Robot Pose Memory', ja: 'まねっこロボたいそう', es: 'Memoria Robot', 'pt-BR': 'Memória do Robô', fr: 'Mémoire Robot', de: 'Roboter-Merkspiel', it: 'Memoria Robot', ko: '로봇 포즈 기억', 'zh-Hans': '机器人记忆操', tr: 'Robot Hafıza' },
    howto       : { en: 'Watch the poses, then repeat them in the same order!', ja: 'おてほんのポーズを おぼえて 同じ順番でまねしよう！', es: '¡Memoriza las poses y repítelas en el mismo orden!', 'pt-BR': 'Memorize as poses e repita na mesma ordem!', fr: 'Mémorisez les poses et répétez-les dans le même ordre !', de: 'Merke dir die Posen und mache sie in gleicher Reihenfolge nach!', it: 'Memorizza le pose e ripetile nello stesso ordine!', ko: '포즈를 기억하고 같은 순서로 따라해!', 'zh-Hans': '记住示范姿势，按同样顺序模仿！', tr: 'Pozları ezberle, aynı sırayla tekrarla!' },
    scoreLabel  : { en: 'rounds', ja: 'だん', es: 'rondas', 'pt-BR': 'rodadas', fr: 'manches', de: 'Runden', it: 'round', ko: '단계', 'zh-Hans': '轮', tr: 'tur' },
    bg          : 0xf0f4ff,
    cameraFov   : 60,
    fitWidth    : 9,
    cameraPos   : [0, 3.5, 9],
    cameraLookAt: [0, 1.8, 0],

    // --------------------------------------------------
    // init — シーン構築（1回のみ）
    // --------------------------------------------------
    init: function (ctx) {
      var THREE = ctx.THREE;
      var scene = ctx.scene;
      var self  = this;

      // --------------------------------------------------
      // 体育館シーン（既存を踏襲）
      // --------------------------------------------------
      var floor = new THREE.Mesh(Style.roundedBox(14, 0.2, 8), Style.mat(0xc8a96e));
      floor.position.set(0, -0.1, 0);
      scene.add(floor);

      var lineC = new THREE.Mesh(Style.roundedBox(0.08, 0.21, 8), Style.mat(0xffffff));
      lineC.position.set(0, 0, 0);
      scene.add(lineC);

      var wall = new THREE.Mesh(Style.roundedBox(14, 6, 0.3), Style.mat(0xe8eef8));
      wall.position.set(0, 3, -3.5);
      scene.add(wall);

      var winGeo = Style.roundedBox(1.5, 1.2, 0.35);
      var winMat = Style.mat(0x88bbdd);
      [-4, -1.5, 1.5, 4].forEach(function (wx) {
        var w = new THREE.Mesh(winGeo, winMat);
        w.position.set(wx, 3.8, -3.35);
        scene.add(w);
      });

      // 区切り線（お手本 ↔ プレイヤー）
      var sep = new THREE.Mesh(Style.roundedBox(0.06, 4.5, 0.06), Style.mat(0xaaaaaa));
      sep.position.set(0, 2.25, 0);
      scene.add(sep);

      // --------------------------------------------------
      // スポットライト（今の主役を照らす。デモ番=左 / 入力番=右へ移動）
      // --------------------------------------------------
      var spotCone = new THREE.Mesh(
        new THREE.ConeGeometry(1.7, 4.6, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffee88, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
      );
      spotCone.position.set(-2, 3.0, 0);
      scene.add(spotCone);

      var spotDisc = new THREE.Mesh(
        new THREE.CircleGeometry(1.7, 32),
        new THREE.MeshBasicMaterial({ color: 0xffee88, transparent: true, opacity: 0.3, depthWrite: false })
      );
      spotDisc.rotation.x = -Math.PI / 2;
      spotDisc.position.set(-2, 0.03, 0);
      scene.add(spotDisc);

      // --------------------------------------------------
      // ロボット生成 ＋ 足元の色オーラ（ポーズ色フラッシュ用・プール）
      // --------------------------------------------------
      var demoRobot   = makeRobot(THREE, -2, true);
      var playerRobot = makeRobot(THREE, 2, false);
      scene.add(demoRobot.group);
      scene.add(playerRobot.group);

      function makeAura(x) {
        var m = new THREE.Mesh(
          new THREE.CircleGeometry(1.5, 32),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, 0.06, 0);
        scene.add(m);
        return m;
      }
      var demoAura   = makeAura(-2);
      var playerAura = makeAura(2);

      // --------------------------------------------------
      // 結果表示 ✓/✗ スプライト
      // --------------------------------------------------
      function makeResultSprite(text, color) {
        var canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        var c = canvas.getContext('2d');
        c.fillStyle = color;
        c.font = 'bold 90px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(text, 64, 64);
        var tex = new THREE.CanvasTexture(canvas);
        return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      }
      var okSprite = makeResultSprite('✓', '#33cc33');
      var ngSprite = makeResultSprite('✗', '#ff3333');
      okSprite.scale.set(2.5, 2.5, 1);
      ngSprite.scale.set(2.5, 2.5, 1);
      okSprite.position.set(0, 4.6, 0.5);
      ngSprite.position.set(0, 4.6, 0.5);
      okSprite.visible = false;
      ngSprite.visible = false;
      scene.add(okSprite);
      scene.add(ngSprite);

      // --------------------------------------------------
      // ポーズボタン ×4（DOM・色パネル＋シルエット）
      // --------------------------------------------------
      var btnWrap = document.createElement('div');
      btnWrap.style.cssText = [
        'position:fixed',
        'bottom:20px',
        'left:50%',
        'transform:translateX(-50%)',
        'display:none',
        'gap:12px',
        'z-index:60',
        'touch-action:manipulation'
      ].join(';');
      document.body.appendChild(btnWrap);

      var btns = [];
      function makePoseBtn(i) {
        var b = document.createElement('button');
        b.innerHTML = poseSVG(i);
        b.style.cssText = [
          'width:68px',
          'height:68px',
          'padding:0',
          'border:none',
          'border-radius:16px',
          'background:' + hexCss(POSES[i].color),
          'box-shadow:0 4px 10px rgba(0,0,0,0.35)',
          'cursor:pointer',
          'display:flex',
          'align-items:center',
          'justify-content:center',
          'transition:transform 0.12s,filter 0.15s',
          'touch-action:manipulation',
          '-webkit-tap-highlight-color:transparent'
        ].join(';');
        b.addEventListener('touchstart', function (e) {
          e.preventDefault();
          self._onPoseBtn(ctx, i);
        }, { passive: false });
        b.addEventListener('click', function () {
          self._onPoseBtn(ctx, i);
        });
        btnWrap.appendChild(b);
        return b;
      }
      for (var bi = 0; bi < POSES.length; bi++) btns.push(makePoseBtn(bi));

      // --------------------------------------------------
      // ランタイム状態
      // --------------------------------------------------
      ctx._rt = {
        demoRobot  : demoRobot,
        playerRobot: playerRobot,
        demoAura   : demoAura,
        playerAura : playerAura,
        spotCone   : spotCone,
        spotDisc   : spotDisc,
        okSprite   : okSprite,
        ngSprite   : ngSprite,
        btnWrap    : btnWrap,
        btns       : btns,
        // サイモン列（プール：配列を再利用）
        sequence   : [],
        level      : 1,
        // ステート: 'predemo' | 'demo' | 'input' | 'clear' | 'fail'
        state      : 'predemo',
        stateTimer : 0,
        demoIndex  : 0,
        demoPhase  : 'pose',   // 'pose' | 'gap'
        inputIndex : 0,
        playerHold : 0,        // 入力ポーズをニュートラルに戻すまでの秒
        spotTargetX: -2
      };
    },

    // --------------------------------------------------
    // ボタン活性/非活性（デモ中=暗・入力番=明。テキストに頼らない合図）
    // --------------------------------------------------
    _setButtonsEnabled: function (rt, on) {
      for (var i = 0; i < rt.btns.length; i++) {
        rt.btns[i].style.filter = on ? 'none' : 'brightness(0.35)';
        rt.btns[i].style.pointerEvents = on ? '' : 'none';
      }
    },

    // --------------------------------------------------
    // オーラをポーズ色でフラッシュ（update で減衰）
    // --------------------------------------------------
    _flashAura: function (aura, colorHex) {
      aura.material.color.setHex(colorHex);
      aura.material.opacity = 0.85;
    },

    // --------------------------------------------------
    // start — ゲーム開始（状態リセット）
    // --------------------------------------------------
    start: function (ctx) {
      var rt = ctx._rt;

      // サイモン列を作り直し（配列は再利用）
      rt.sequence.length = 0;
      rt.sequence.push((Math.random() * POSES.length) | 0);
      rt.level = 1;

      // ロボットをニュートラルに即時リセット
      snapPose(rt.demoRobot, NEUTRAL);
      snapPose(rt.playerRobot, NEUTRAL);
      rt.demoRobot.group.position.y = 0;
      rt.demoRobot.group.rotation.x = 0;
      rt.playerRobot.group.position.y = 0;
      rt.playerRobot.group.rotation.x = 0;

      // 表示リセット
      rt.okSprite.visible = false;
      rt.ngSprite.visible = false;
      rt.demoAura.material.opacity = 0;
      rt.playerAura.material.opacity = 0;
      rt.btnWrap.style.display = 'flex';

      ctx.setHint('');
      this._startDemo(ctx);
    },

    // --------------------------------------------------
    // デモ（お手本再生）フェーズ開始
    // --------------------------------------------------
    _startDemo: function (ctx) {
      var rt = ctx._rt;
      rt.state      = 'predemo';
      rt.stateTimer = 0.7;
      rt.demoIndex  = 0;
      rt.demoPhase  = 'pose';
      rt.inputIndex = 0;
      rt.playerHold = 0;

      // ロボット姿勢リセット
      setPose(rt.demoRobot, NEUTRAL);
      setPose(rt.playerRobot, NEUTRAL);
      rt.demoRobot.group.position.y = 0;
      rt.demoRobot.group.rotation.x = 0;
      rt.playerRobot.group.position.y = 0;
      rt.playerRobot.group.rotation.x = 0;

      // 見る番：お手本にスポットライト・プレイヤー暗転・ボタン非活性(暗)
      rt.spotTargetX = -2;
      setRobotDim(rt.demoRobot, false);
      setRobotDim(rt.playerRobot, true);
      this._setButtonsEnabled(rt, false);

      rt.okSprite.visible = false;
      rt.ngSprite.visible = false;
    },

    // デモの1ステップを見せる
    _showDemoStep: function (ctx) {
      var rt   = ctx._rt;
      var pose = POSES[rt.sequence[rt.demoIndex]];
      setPose(rt.demoRobot, pose);
      this._flashAura(rt.demoAura, pose.color);
      tone(pose.tone);
      rt.demoPhase  = 'pose';
      rt.stateTimer = demoPoseTime(rt.level);
    },

    // --------------------------------------------------
    // 入力フェーズ開始
    // --------------------------------------------------
    _startInput: function (ctx) {
      var rt = ctx._rt;
      rt.state      = 'input';
      rt.inputIndex = 0;

      // 入力番：スポットライトをプレイヤー側へ・明転・ボタン活性(明)
      rt.spotTargetX = 2;
      setRobotDim(rt.demoRobot, true);
      setRobotDim(rt.playerRobot, false);
      this._setButtonsEnabled(rt, true);
    },

    // --------------------------------------------------
    // ポーズボタン押下（入力判定）
    // --------------------------------------------------
    _onPoseBtn: function (ctx, idx) {
      var rt = ctx._rt;
      if (rt.state !== 'input') return;

      var pose = POSES[idx];

      // プレイヤーロボが即そのポーズ＋色点灯＋固有トーン
      setPose(rt.playerRobot, pose);
      this._flashAura(rt.playerAura, pose.color);
      tone(pose.tone);
      rt.playerHold = 0.5;

      // ボタン押下フィードバック
      var b = rt.btns[idx];
      b.style.transform = 'scale(1.15)';
      setTimeout(function () { b.style.transform = ''; }, 130);

      // 判定
      if (idx === rt.sequence[rt.inputIndex]) {
        rt.inputIndex++;
        if (rt.inputIndex >= rt.sequence.length) this._beginClear(ctx);
      } else {
        this._beginFail(ctx);
      }
    },

    // --------------------------------------------------
    // レベルクリア（✓緑＋両ロボ喜び → 列を1つ伸ばして次デモ）
    // --------------------------------------------------
    _beginClear: function (ctx) {
      var rt = ctx._rt;
      rt.state      = 'clear';
      rt.stateTimer = 1.4;
      ctx.addScore(1);
      ctx.sfx.success();
      rt.okSprite.visible = true;
      this._setButtonsEnabled(rt, false);
    },

    // --------------------------------------------------
    // 失敗（✗赤＋ロボ落胆 → ゲームオーバー）
    // --------------------------------------------------
    _beginFail: function (ctx) {
      var rt = ctx._rt;
      rt.state      = 'fail';
      rt.stateTimer = 1.6;
      ctx.sfx.fail();
      ctx.vibrate(80);
      rt.ngSprite.visible = true;
      this._setButtonsEnabled(rt, false);
    },

    // --------------------------------------------------
    // update — 毎フレーム
    // --------------------------------------------------
    update: function (ctx, dt) {
      var rt = ctx._rt;

      // ロボットのスムーズアニメーション（常時）
      updateRobot(rt.demoRobot, dt);
      updateRobot(rt.playerRobot, dt);

      // スポットライトの移動＋ゆらぎ
      var sx = rt.spotTargetX;
      rt.spotCone.position.x += (sx - rt.spotCone.position.x) * Math.min(1, 8 * dt);
      rt.spotDisc.position.x = rt.spotCone.position.x;
      rt.spotCone.material.opacity = 0.13 + Math.sin(ctx.elapsed * 3) * 0.04;
      rt.spotDisc.material.opacity = 0.25 + Math.sin(ctx.elapsed * 3) * 0.06;

      // ポーズ色オーラの減衰
      if (rt.demoAura.material.opacity > 0) {
        rt.demoAura.material.opacity = Math.max(0, rt.demoAura.material.opacity - dt * 1.6);
      }
      if (rt.playerAura.material.opacity > 0) {
        rt.playerAura.material.opacity = Math.max(0, rt.playerAura.material.opacity - dt * 1.6);
      }

      // 入力ポーズをしばらく保持してからニュートラルへ
      if (rt.playerHold > 0 && rt.state === 'input') {
        rt.playerHold -= dt;
        if (rt.playerHold <= 0) setPose(rt.playerRobot, NEUTRAL);
      }

      if (rt.state === 'predemo') {
        // デモ開始前の間（記憶の準備）
        rt.stateTimer -= dt;
        if (rt.stateTimer <= 0) {
          rt.state = 'demo';
          this._showDemoStep(ctx);
        }

      } else if (rt.state === 'demo') {
        rt.stateTimer -= dt;
        if (rt.demoPhase === 'pose' && rt.stateTimer <= 0) {
          // ポーズをやめてニュートラルへ（次ポーズとの区切り）
          setPose(rt.demoRobot, NEUTRAL);
          rt.demoPhase  = 'gap';
          rt.stateTimer = DEMO_GAP;
        } else if (rt.demoPhase === 'gap' && rt.stateTimer <= 0) {
          rt.demoIndex++;
          if (rt.demoIndex >= rt.sequence.length) {
            this._startInput(ctx);
          } else {
            this._showDemoStep(ctx);
          }
        }

      } else if (rt.state === 'clear') {
        rt.stateTimer -= dt;
        // 両ロボがぴょんぴょん（喜び）
        var hop = Math.abs(Math.sin((1.4 - rt.stateTimer) * 8)) * 0.35;
        rt.demoRobot.group.position.y   = hop;
        rt.playerRobot.group.position.y = hop;
        if (rt.stateTimer <= 0) {
          // 列を1つ伸ばして次レベルのデモへ
          rt.sequence.push((Math.random() * POSES.length) | 0);
          rt.level++;
          this._startDemo(ctx);
        }

      } else if (rt.state === 'fail') {
        rt.stateTimer -= dt;
        // プレイヤーロボがうなだれる（落胆）
        var lean = Math.min((1.6 - rt.stateTimer) * 2, 1);
        rt.playerRobot.group.rotation.x = 0.3 * lean;
        rt.playerRobot.group.position.y = -0.15 * lean;
        if (rt.stateTimer <= 0) {
          rt.btnWrap.style.display = 'none';
          ctx.gameOver(ctx.score);
        }
      }
    }
  });

})();
