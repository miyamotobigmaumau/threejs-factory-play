/* =========================================================================
 * backend.js — Firebase バックエンドクライアント（threejs-factory 共通）
 *
 * 既定では BACKEND_AVAILABLE=false（スタブ動作、ローカル完結）。
 * backend/ テンプレートのセットアップ完了後、window.BACKEND_CONFIG に
 * Firebase 設定を入れて有効化する（docs/SETUP_GUIDE.md 参照）。
 *
 * セキュリティ原則:
 *  - スコア送信は必ず Cloud Functions (callable) 経由。Firestore へ
 *    クライアントから直接 write しない（rules でも拒否される）。
 *  - 認証は匿名 Auth。
 * ========================================================================= */
(function () {
  'use strict';

  var BACKEND_AVAILABLE = !!window.BACKEND_CONFIG;

  var Backend = {
    available: BACKEND_AVAILABLE,
    _uid: null,

    /** 起動時に呼ぶ。未設定なら即 resolve（スタブ）。 */
    init: function () {
      if (!BACKEND_AVAILABLE) return Promise.resolve(false);
      if (typeof firebase === 'undefined') {
        console.warn('[backend] Firebase SDK が読み込まれていません。スタブ動作します。');
        Backend.available = false;
        return Promise.resolve(false);
      }
      firebase.initializeApp(window.BACKEND_CONFIG);
      return firebase.auth().signInAnonymously().then(function (cred) {
        Backend._uid = cred.user.uid;
        return true;
      }).catch(function (e) {
        console.warn('[backend] 匿名認証に失敗:', e);
        Backend.available = false;
        return false;
      });
    },

    /**
     * スコア送信。gameId / score / プレイ時間(ms) を Functions に渡し、
     * サーバー側で妥当性検証（上限・レート・プレイ時間整合）される。
     */
    submitScore: function (gameId, score, playMs) {
      if (!Backend.available) return Promise.resolve(null);
      var fn = firebase.functions().httpsCallable('submitScore');
      return fn({ gameId: gameId, score: score, playMs: playMs })
        .then(function (res) { return res.data; })
        .catch(function (e) { console.warn('[backend] submitScore 失敗:', e); return null; });
    },

    /** 上位 N 件のリーダーボード取得（Functions 経由・読み取り専用）。 */
    getLeaderboard: function (gameId, limit) {
      if (!Backend.available) return Promise.resolve([]);
      var fn = firebase.functions().httpsCallable('getLeaderboard');
      return fn({ gameId: gameId, limit: limit || 20 })
        .then(function (res) { return res.data.entries || []; })
        .catch(function () { return []; });
    }
  };

  window.GameBackend = Backend;
})();
