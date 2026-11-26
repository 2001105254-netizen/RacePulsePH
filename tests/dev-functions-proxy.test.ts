import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  resolveCloudFunctionBaseUrl,
  resolveDevProxyUpstreamUrl,
} from '../src/lib/devFunctionsProxy.ts';
import { AnimatedMetricValue, ValueSkeleton } from '../src/components/ui/MotionPrimitives.tsx';

test('resolveCloudFunctionBaseUrl uses same-origin dev proxy on http://localhost in DEV mode', () => {
  const url = resolveCloudFunctionBaseUrl({
    defaultUrl: 'https://asia-southeast1-racepulseph.cloudfunctions.net/communityApi',
    functionName: 'communityApi',
    isDev: true,
    locationProtocol: 'http:',
    locationHostname: 'localhost',
  });
  assert.equal(url, '/_dev-functions/communityApi');

  const loopbackUrl = resolveCloudFunctionBaseUrl({
    defaultUrl: 'https://asia-southeast1-racepulseph.cloudfunctions.net/accessApi',
    functionName: 'accessApi',
    isDev: true,
    locationProtocol: 'http:',
    locationHostname: '127.0.0.1',
  });
  assert.equal(loopbackUrl, '/_dev-functions/accessApi');
});

test('resolveCloudFunctionBaseUrl uses direct Cloud Functions URL in production, Capacitor, and explicit env override', () => {
  // Production web
  assert.equal(
    resolveCloudFunctionBaseUrl({
      defaultUrl: 'https://asia-southeast1-racepulseph.cloudfunctions.net/communityApi',
      functionName: 'communityApi',
      isDev: false,
      locationProtocol: 'http:',
      locationHostname: 'localhost',
    }),
    'https://asia-southeast1-racepulseph.cloudfunctions.net/communityApi',
  );

  // Capacitor Android uses https://localhost -> direct Cloud Functions (allowed by PROD_ALLOWED_ORIGINS)
  assert.equal(
    resolveCloudFunctionBaseUrl({
      defaultUrl: 'https://asia-southeast1-racepulseph.cloudfunctions.net/communityApi',
      functionName: 'communityApi',
      isDev: true,
      locationProtocol: 'https:',
      locationHostname: 'localhost',
    }),
    'https://asia-southeast1-racepulseph.cloudfunctions.net/communityApi',
  );

  // Explicit env override always wins
  assert.equal(
    resolveCloudFunctionBaseUrl({
      configuredUrl: 'http://127.0.0.1:5001/racepulseph/asia-southeast1/communityApi/',
      defaultUrl: 'https://asia-southeast1-racepulseph.cloudfunctions.net/communityApi',
      functionName: 'communityApi',
      isDev: true,
      locationProtocol: 'http:',
      locationHostname: 'localhost',
    }),
    'http://127.0.0.1:5001/racepulseph/asia-southeast1/communityApi',
  );
});

test('resolveDevProxyUpstreamUrl strictly enforces function allowlist and blocks path traversal / SSRF', () => {
  assert.equal(
    resolveDevProxyUpstreamUrl('communityApi', 'social/feed'),
    'https://asia-southeast1-racepulseph.cloudfunctions.net/communityApi/social/feed',
  );
  assert.equal(
    resolveDevProxyUpstreamUrl('accessApi', '/presence/heartbeat'),
    'https://asia-southeast1-racepulseph.cloudfunctions.net/accessApi/presence/heartbeat',
  );

  // Reject unallowlisted functions and traversal/scheme injection
  assert.equal(resolveDevProxyUpstreamUrl('paymentsApi', 'checkout'), null);
  assert.equal(resolveDevProxyUpstreamUrl('evilHost', 'social/feed'), null);
  assert.equal(resolveDevProxyUpstreamUrl('communityApi', '../paymentsApi/checkout'), null);
  assert.equal(resolveDevProxyUpstreamUrl('communityApi', 'social/feed?redirect=http://evil.test'), null);
  assert.equal(resolveDevProxyUpstreamUrl('communityApi', ''), null);
});

test('ValueSkeleton and loading AnimatedMetricValue do not emit block <div> inside <p>', () => {
  const skeletonHtml = renderToStaticMarkup(
    React.createElement('p', null, React.createElement(ValueSkeleton, { widthClass: 'w-16', heightClass: 'h-8' })),
  );
  assert.equal(skeletonHtml.includes('<div'), false, `Unexpected <div> inside <p>: ${skeletonHtml}`);

  const metricHtml = renderToStaticMarkup(
    React.createElement('p', null, React.createElement(AnimatedMetricValue, { value: 0, loading: true })),
  );
  assert.equal(metricHtml.includes('<div'), false, `Unexpected <div> inside <p>: ${metricHtml}`);
});
