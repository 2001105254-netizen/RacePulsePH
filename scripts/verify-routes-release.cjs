#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const errors = [];
const assert = (cond, msg) => {
  if (!cond) errors.push(msg);
};

// 1. CSP check
const fb = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
const headers = fb.hosting?.headers?.find((h) => h.source === '**')?.headers || [];
const csp = headers.find((h) => h.key.toLowerCase() === 'content-security-policy')?.value || '';
assert(csp.includes('https://tiles.openfreemap.org'), 'firebase.json CSP connect-src must include https://tiles.openfreemap.org.');
assert(csp.includes('https://services.arcgisonline.com'), 'firebase.json CSP connect-src must include https://services.arcgisonline.com.');
assert(!csp.includes("'unsafe-eval'"), "CSP must not include 'unsafe-eval'.");

// 2. Fixtures exist and contain valid GPX tracks
for (const fixture of [
  'public/fixtures/baguio-cordillera-21k.gpx',
  'public/fixtures/baguio-cordillera-10k.gpx',
  'public/fixtures/cebu-highlands-21k.gpx',
  'public/fixtures/bukidnon-kitanglad-32k.gpx',
]) {
  assert(fs.existsSync(fixture), `Missing GPX fixture: ${fixture}`);
  const xml = fs.readFileSync(fixture, 'utf8');
  assert(xml.includes('<gpx') && xml.includes('<trkseg>'), `Invalid GPX structure in ${fixture}`);
}

// 3. No forbidden em dashes or unsafe HTML sinks in route UI/lib files
const checkDir = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      checkDir(full);
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      const content = fs.readFileSync(full, 'utf8');
      assert(!content.includes('\u2014'), `Forbidden em dash character found in ${full}`);
      assert(!/dangerouslySetInnerHTML|\.innerHTML\s*=/.test(content), `Forbidden raw HTML sink in ${full}`);
    }
  }
};
checkDir('src/components/routes');
checkDir('src/lib/routes');
assert(!fs.readFileSync('src/components/RouteElevationProfile.tsx', 'utf8').includes('\u2014'), 'Forbidden em dash in RouteElevationProfile.tsx');

// 3b. Confidential map stack check across route UI surfaces and server telemetry
const forbiddenCaseInsensitive = /copernicus|sentinel|glo-?30|openstreetmap|openmaptiles|strava|google satellite|dataspace\.copernicus|s2maps\.eu/i;
const checkConfidentialFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  assert(!forbiddenCaseInsensitive.test(content), `Forbidden third-party map brand leak found in ${filePath}`);
  assert(!content.includes('OpenFreeMap'), `Forbidden UI label "OpenFreeMap" found in ${filePath}`);
};
const walkConfidentialDir = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkConfidentialDir(full);
    else if (/\.(tsx?|js)$/.test(entry.name)) checkConfidentialFile(full);
  }
};
walkConfidentialDir('src/components/routes');
checkConfidentialFile('src/components/RouteElevationProfile.tsx');
checkConfidentialFile('src/components/RouteMap3D.tsx');
checkConfidentialFile('server.ts');

// 4. Dist build check if dist exists
if (fs.existsSync('dist/index.html')) {
  const assetFiles = fs.readdirSync('dist/assets');
  assert(assetFiles.some((f) => f.includes('vendor-map')), 'Expected lazy-loaded vendor-map chunk in dist/assets.');
}

if (errors.length > 0) {
  console.error('FAIL: Route release verification found issues:\n' + errors.map((e) => `- ${e}`).join('\n'));
  process.exit(1);
}
console.log('PASS: Route release verification clean (CSP, GPX fixtures, anti-slop/HTML guard, lazy map chunk).');
