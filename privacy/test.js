'use strict';

const assert = require('assert');
const { classify } = require('./blocklist');

const cases = [
  ['https://doubleclick.net/ga.js', 'https://news.example.com/article', 'ads'],
  ['https://www.google-analytics.com/collect', 'https://shop.example.org', 'analytics'],
  ['https://connect.facebook.net/en_US/sdk.js', 'https://blog.example.net', 'social'],
  ['https://facebook.com/tr?id=123', 'https://blog.example.net', 'social'],
  ['https://coinhive.com/lib/miner.js', 'https://video.example.com', 'malware'],
  ['https://cdn.example.com/app.js', 'https://example.com', null],
  ['https://example.com/local-ad.js', 'https://example.com/page', null],
  ['https://analytics.example.com/pixel', 'https://example.com', null],
  ['https://example.net/page', 'https://sub.example.net', null],
  ['https://unrelated.example.org/script.js', 'https://example.com', null]
];

let failures = 0;
for (const [request, initiator, expected] of cases) {
  const hit = classify(request, initiator);
  const actual = hit ? hit.category : null;
  if (actual !== expected) {
    failures += 1;
    console.error(`FAIL ${request} from ${initiator}: expected ${expected}, got ${actual}`);
  }
}

if (failures) process.exit(1);
console.log(`privacy classifier: ${cases.length} cases passed`);
