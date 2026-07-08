/* =========================================================================
 * bunny.js — 共通プレイヤーキャラクター「シンプルうさぎ」
 *
 * 全ゲームの人型プレイヤーはこのうさぎに統一する。
 * 見た目: クリーム色の2等身ちびうさぎ。装飾は最小限。
 *   ・大きな丸頭（全高のほぼ半分＝2等身）＋小さな胴
 *   ・耳は単色（内側ピンクなし）
 *   ・目は小さな黒い点（ハイライトなし）
 *   ・頬チークなし・鼻はごく小さな黒点のみ
 *
 * 使い方:
 *   var bunny = GameBunny.make(ctx.THREE, { scale: 1.2 });
 *   ctx.scene.add(bunny.group);
 *   bunny.group.position.set(...);
 * アニメ用に各パーツへアクセスできる:
 *   bunny.head / bunny.earL / bunny.earR / bunny.armL / bunny.armR /
 *   bunny.legL / bunny.legR / bunny.body
 *   耳・腕・脚は付け根が原点（rotation.z/x を振るだけで自然に揺れる）。
 * 便利メソッド:
 *   bunny.hop(t)    … t(0..1) でぴょこんと屈伸（呼び出し側でtを進める）
 *   bunny.flop(t)   … 耳を揺らす（t=経過秒などを渡す）
 * 全長はおよそ 2.0（scale=1 時、足裏 y=0 〜 頭頂 y≈2.0）。
 * ========================================================================= */
(function () {
  'use strict';

  var COLORS = {
    body: 0xf2e0c8,   // ふんわりクリーム
    inner: 0xe6d3b8,  // 少し濃い（足先）
    eye: 0x2a2018,
    nose: 0x3a2b20,   // ごく小さな暗色の鼻
    tail: 0xfaf2e4
  };

  function make(THREE, opts) {
    opts = opts || {};
    var scale = opts.scale || 1;
    var matBody = new THREE.MeshLambertMaterial({ color: opts.color || COLORS.body });
    var matInner = new THREE.MeshLambertMaterial({ color: COLORS.inner });
    var matEye = new THREE.MeshLambertMaterial({ color: COLORS.eye });
    var matNose = new THREE.MeshLambertMaterial({ color: COLORS.nose });

    var group = new THREE.Group();

    // 胴体（小さめ・下半分。2等身なので頭より控えめ）
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 12), matBody);
    body.scale.set(1, 1.05, 0.92);
    body.position.y = 0.6;
    group.add(body);

    // 頭（大きなまんまる＝全高の約半分。顔パーツは頭の子）
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.56, 16, 14), matBody);
    head.position.y = 1.42;
    group.add(head);

    // 目（小さな黒い点。ハイライトなし）
    [-1, 1].forEach(function (side) {
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), matEye);
      eye.scale.set(0.85, 1, 0.6);
      eye.position.set(0.2 * side, 0.05, 0.47);
      head.add(eye);
    });

    // 鼻（ごく小さな暗色の点のみ）
    var nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), matNose);
    nose.scale.set(1.2, 0.85, 0.7);
    nose.position.set(0, -0.08, 0.55);
    head.add(nose);

    // 耳（単色。付け根ピボット＝rotation.z/xで揺れる）
    function ear(side) {
      var pivot = new THREE.Group();
      pivot.position.set(0.2 * side, 1.86, 0);
      var e = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 12), matBody);
      e.scale.set(0.32, 0.72, 0.22);
      e.position.set(0.05 * side, 0.3, 0);
      pivot.add(e);
      pivot.rotation.z = -0.16 * side;           // 外側へ少しハの字
      return pivot;
    }
    var earL = ear(-1), earR = ear(1);
    group.add(earL, earR);

    // 腕（みじかくぷにっと・付け根ピボット）
    function arm(side) {
      var pivot = new THREE.Group();
      pivot.position.set(0.38 * side, 0.92, 0);
      var a = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), matBody);
      a.scale.set(0.55, 1.0, 0.55);
      a.position.y = -0.22;
      pivot.add(a);
      pivot.rotation.z = 0.3 * side;   // 下向きに沿わせて少し開く
      return pivot;
    }
    var armL = arm(-1), armR = arm(1);
    group.add(armL, armR);

    // 脚（短い・付け根ピボット）
    function leg(side) {
      var pivot = new THREE.Group();
      pivot.position.set(0.17 * side, 0.32, 0);
      var l = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), matBody);
      l.scale.set(0.6, 0.85, 0.6);
      l.position.y = -0.14;
      pivot.add(l);
      var foot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), matInner);
      foot.scale.set(1, 0.55, 1.3);
      foot.position.set(0, -0.3, 0.08);
      pivot.add(foot);
      return pivot;
    }
    var legL = leg(-1), legR = leg(1);
    group.add(legL, legR);

    // しっぽ（白ぽんぽん）
    var tail = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8),
      new THREE.MeshLambertMaterial({ color: COLORS.tail }));
    tail.position.set(0, 0.54, -0.4);
    group.add(tail);

    group.scale.setScalar(scale);

    var bunny = {
      group: group, body: body, head: head,
      earL: earL, earR: earR, armL: armL, armR: armR,
      legL: legL, legR: legR, tail: tail,
      /** t(0..1): ジャンプ等の屈伸。0=直立 0.5=しゃがみ 1=直立 */
      hop: function (t) {
        var s = 1 - 0.18 * Math.sin(Math.PI * Math.min(Math.max(t, 0), 1));
        group.scale.set(scale * (2 - s), scale * s, scale * (2 - s));
      },
      /** t: 経過秒などを渡すと耳がぴょこぴょこ揺れる */
      flop: function (t) {
        var w = Math.sin(t * 6) * 0.12;
        earL.rotation.z = 0.16 + w;
        earR.rotation.z = -0.16 + w;
      }
    };
    return bunny;
  }

  window.GameBunny = { make: make, COLORS: COLORS };
})();
