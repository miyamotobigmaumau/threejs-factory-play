/* =========================================================================
 * ads.js — AdMob WebView ブリッジ（threejs-factory 共通）
 *
 * ネイティブシェル（iOS: WKScriptMessageHandler "admob" / Android:
 * @JavascriptInterface "AdMobBridge"）と通信する。ブラウザ単体で開いた
 * 場合はシミュレータ（画面オーバーレイ）で動作確認できる。
 *
 * 頻度設計は docs/AD_REVENUE_DESIGN.md の solitiaV3 逆算に従う。
 * 値はゲームごとに window.AD_CONFIG で上書き可能。
 * ========================================================================= */
(function () {
  'use strict';

  var DEFAULTS = {
    // インタースティシャル: Nプレイ終了ごとに1回（初回プレイ直後は出さない）
    interstitialEveryNPlays: 2,
    // インタースティシャル最小間隔（ミリ秒）
    interstitialMinIntervalMs: 60 * 1000,
    // リワード（スコア2倍/コンティニュー）をリザルトに出すか
    rewardedEnabled: true,
    // ブラウザ単体時に広告シミュレータを表示するか
    simulateInBrowser: true
  };

  var cfg = Object.assign({}, DEFAULTS, window.AD_CONFIG || {});

  var state = {
    playsSinceInterstitial: 0,
    lastInterstitialAt: 0,
    totalPlays: 0,
    pendingRewardCb: null
  };

  /* ---------- ネイティブブリッジ検出 ---------- */
  function iosBridge() {
    try {
      return window.webkit && window.webkit.messageHandlers &&
             window.webkit.messageHandlers.admob || null;
    } catch (e) { return null; }
  }
  function androidBridge() {
    return window.AdMobBridge || null;
  }
  function hasNative() { return !!(iosBridge() || androidBridge()); }

  function postNative(action, payload) {
    var msg = { action: action, payload: payload || {} };
    var ios = iosBridge();
    if (ios) { ios.postMessage(JSON.stringify(msg)); return true; }
    var and = androidBridge();
    if (and && typeof and.postMessage === 'function') {
      and.postMessage(JSON.stringify(msg)); return true;
    }
    return false;
  }

  /* ---------- ブラウザ用シミュレータ ---------- */
  function simulateAd(kind, done) {
    if (!cfg.simulateInBrowser) { done(kind === 'rewarded'); return; }
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,10,20,.92);' +
      'z-index:9999;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;color:#fff;font-family:sans-serif;';
    var label = kind === 'rewarded' ? 'リワード広告（テスト）' : 'インタースティシャル広告（テスト）';
    ov.innerHTML = '<div style="font-size:18px;margin-bottom:12px;">' + label + '</div>' +
      '<div style="font-size:12px;opacity:.7;margin-bottom:24px;">WebViewシェル内では実広告が表示されます</div>';
    var btn = document.createElement('button');
    btn.textContent = kind === 'rewarded' ? '視聴完了（報酬を受け取る）' : '閉じる';
    btn.style.cssText = 'padding:12px 28px;font-size:16px;border-radius:24px;border:0;';
    btn.addEventListener('click', function () {
      document.body.removeChild(ov);
      done(true);
    });
    ov.appendChild(btn);
    document.body.appendChild(ov);
    if (kind === 'interstitial') {
      setTimeout(function () {
        if (ov.parentNode) { document.body.removeChild(ov); done(true); }
      }, 2500);
    }
  }

  /* ---------- 公開 API ---------- */
  var Ads = {
    config: cfg,

    /** シェルがリザルト表示前に呼ぶ。表示したら true を返す。 */
    maybeShowInterstitial: function (onClosed) {
      state.totalPlays++;
      state.playsSinceInterstitial++;
      var now = Date.now();
      var due = state.playsSinceInterstitial >= cfg.interstitialEveryNPlays;
      var cooled = (now - state.lastInterstitialAt) >= cfg.interstitialMinIntervalMs;
      var notFirst = state.totalPlays > 1;
      if (!(due && cooled && notFirst)) { if (onClosed) onClosed(false); return false; }

      state.playsSinceInterstitial = 0;
      state.lastInterstitialAt = now;
      if (hasNative()) {
        Ads._onInterstitialClosed = function () { if (onClosed) onClosed(true); };
        postNative('showInterstitial');
      } else {
        simulateAd('interstitial', function () { if (onClosed) onClosed(true); });
      }
      return true;
    },

    rewardedAvailable: function () {
      return cfg.rewardedEnabled;
    },

    /** リワード広告。報酬付与可否を cb(granted) で返す。 */
    showRewarded: function (cb) {
      if (!cfg.rewardedEnabled) { cb(false); return; }
      if (hasNative()) {
        state.pendingRewardCb = cb;
        postNative('showRewarded');
      } else {
        simulateAd('rewarded', cb);
      }
    },

    /* ---- ネイティブ側から呼ばれるコールバック ---- */
    onNativeInterstitialClosed: function () {
      if (Ads._onInterstitialClosed) { Ads._onInterstitialClosed(); Ads._onInterstitialClosed = null; }
    },
    onNativeRewardResult: function (granted) {
      var cb = state.pendingRewardCb; state.pendingRewardCb = null;
      if (cb) cb(!!granted);
    }
  };

  window.GameAds = Ads;
})();
