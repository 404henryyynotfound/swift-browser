'use strict';

/* Swift's built-in privacy list. Bundled with the app on purpose: no remote
   list download means no startup request, no update server, no tracking.
   Only third-party requests are blocked, so sites that self-host an asset on
   one of these domains are not broken. */

const RULES = [
  // Advertising networks
  ['doubleclick.net', 'ads'], ['googlesyndication.com', 'ads'], ['googleadservices.com', 'ads'],
  ['google-analytics.com', 'analytics'], ['adservice.google.com', 'ads'], ['adwords.google.com', 'ads'],
  ['amazon-adsystem.com', 'ads'], ['adnxs.com', 'ads'], ['adsrvr.org', 'ads'],
  ['advertising.com', 'ads'], ['adtechus.com', 'ads'], ['2mdn.net', 'ads'],
  ['casalemedia.com', 'ads'], ['openx.net', 'ads'], ['pubmatic.com', 'ads'],
  ['rubiconproject.com', 'ads'], ['taboola.com', 'ads'], ['outbrain.com', 'ads'],
  ['criteo.com', 'ads'], ['criteo.net', 'ads'], ['scorecardresearch.com', 'analytics'],
  ['quantserve.com', 'analytics'], ['zedo.com', 'ads'], ['yieldmo.com', 'ads'],
  ['brightroll.com', 'ads'], ['PubMatic.com', 'ads'], ['smartadserver.com', 'ads'],
  ['springserve.com', 'ads'], ['triplelift.com', 'ads'], ['sovrn.com', 'ads'],
  ['sharethrough.com', 'ads'], ['yieldmo.com', 'ads'], ['adsafeprotected.com', 'ads'],
  ['exoclick.com', 'ads'], ['propellerads.com', 'ads'], ['popads.net', 'ads'],
  ['adcolony.com', 'ads'], ['vungle.com', 'ads'], ['chartboost.com', 'ads'],
  ['unityads.com', 'ads'], ['mintegral.com', 'ads'], ['pangle.io', 'ads'],
  ['bidswitch.net', 'ads'], ['audienceproject.net', 'ads'], ['semasio.net', 'ads'],
  // Analytics & telemetry
  ['segment.io', 'analytics'], ['segment.com', 'analytics'], ['mixpanel.com', 'analytics'],
  ['amplitude.com', 'analytics'], ['hotjar.com', 'analytics'], ['fullstory.com', 'analytics'],
  ['newrelic.com', 'analytics'], ['nr-data.net', 'analytics'], ['browser-intake-datadoghq.com', 'analytics'],
  ['datadoghq.com', 'analytics'], ['logrocket.com', 'analytics'], ['sentry.io', 'analytics'],
  ['heap.io', 'analytics'], ['heapanalytics.com', 'analytics'], ['kissmetrics.com', 'analytics'],
  ['chartbeat.net', 'analytics'], ['parsely.com', 'analytics'], ['comscore.com', 'analytics'],
  ['netations.com', 'analytics'], ['mncdn.com', 'analytics'], ['trace4celsius.com', 'analytics'],
  ['clarity.ms', 'analytics'], ['bat.bing.com', 'analytics'], ['bing.com/Partner', 'analytics'],
  // Social widgets & pixels
  ['facebook.net', 'social'], ['facebook.com/tr', 'social'], ['fbcdn.net', 'social'],
  ['connect.facebook.net', 'social'], ['twitter.com/i/jot', 'social'], ['platform.twitter.com', 'social'],
  ['twitter-widgets.s3.amazonaws.com', 'social'], ['t.co', 'social'], ['linkedin.com/px', 'social'],
  ['snapchat.com', 'social'], ['pinterest.com', 'social'], ['pinimg.com', 'social'],
  ['tumblr.com', 'social'], ['redditstatic.com', 'social'], ['reddit.com', 'social'],
  ['whatsapp.net', 'social'], ['instagram.com', 'social'], ['tiktok.com', 'social'],
  // Fingerprinting / identity
  ['fingerprintjs.com', 'fingerprinting'], ['fpjs.io', 'fingerprinting'],
  ['deviceatlas.com', 'fingerprinting'], ['51degrees.com', 'fingerprinting'],
  ['ipify.org', 'fingerprinting'], ['ipinfo.io', 'fingerprinting'], ['maxmind.com', 'fingerprinting'],
  ['client.honeybadger.io', 'analytics'], ['-browser-intake', 'analytics'],
  // Trackers / email open pixels
  ['mailchimp.com', 'tracking'], ['list-manage.com', 'tracking'], ['hubspot.com', 'tracking'],
  ['hs-scripts.com', 'tracking'], ['hsforms.net', 'tracking'], ['sendgrid.net', 'tracking'],
  ['mandrillapp.com', 'tracking'], ['cxense.com', 'tracking'], ['branch.io', 'tracking'],
  ['appsflyer.com', 'tracking'], ['adjust.com', 'tracking'], ['branch.io', 'tracking'],
  // Crypto miners & malvertising
  ['coinhive.com', 'malware'], ['coin-hive.com', 'malware'], ['cryptoloot.pro', 'malware'],
  ['minr.site', 'malware'], ['authedmine.com', 'malware'], ['jsecoin.com', 'malware'],
  ['popundertraffic.com', 'malware'], ['onclickads.net', 'malware']
];

const domains = new Map();
for (const [rule, category] of RULES) {
  const normalized = rule.toLowerCase().replace(/^www\./, '');
  if (!domains.has(normalized)) domains.set(normalized, category);
}

const CATEGORY_LABELS = {
  ads: 'Advertising',
  analytics: 'Analytics',
  social: 'Social widgets',
  fingerprinting: 'Fingerprinting',
  tracking: 'Trackers & pixels',
  malware: 'Malvertising'
};

function hostOf(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(value).toLowerCase().replace(/^www\./, '').split('/')[0];
  }
}

/* Returns { domain, category } when a request is a third-party tracker. */
function classify(requestUrl, initiator) {
  const host = hostOf(requestUrl);
  if (!host) return null;
  const firstParty = hostOf(initiator);
  if (firstParty && (host === firstParty || host.endsWith(`.${firstParty}`) || firstParty.endsWith(`.${host}`))) {
    return null;
  }
  // Exact or subdomain match against the bundled list.
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    const category = domains.get(candidate);
    if (category) return { domain: candidate, category };
  }
  // Path-scoped rules (e.g. facebook.com/tr) are checked separately.
  try {
    const url = new URL(requestUrl);
    const key = `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname}`;
    for (const [rule, category] of RULES) {
      if (rule.includes('/') && key.startsWith(rule.toLowerCase())) {
        return { domain: host, category };
      }
    }
  } catch { /* malformed URL: ignore */ }
  return null;
}

module.exports = { classify, hostOf, CATEGORY_LABELS, RULES };
