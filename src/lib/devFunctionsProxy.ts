export const DEV_FUNCTIONS_PROXY_PREFIX = '/_dev-functions';

const CLOUD_FUNCTIONS_ORIGIN = 'https://asia-southeast1-racepulseph.cloudfunctions.net';
const ALLOWED_DEV_PROXY_FUNCTIONS = new Set(['accessApi', 'communityApi']);
const SAFE_SUBPATH_RE = /^[a-zA-Z0-9/_-]{1,120}$/;

export interface ResolveCloudFunctionBaseUrlParams {
  configuredUrl?: string;
  defaultUrl: string;
  functionName: 'accessApi' | 'communityApi';
  isDev?: boolean;
  locationProtocol?: string;
  locationHostname?: string;
}

/**
 * Resolves a Cloud Function base URL.
 * In browser DEV mode on http://localhost or http://127.0.0.1 (non-Capacitor),
 * routes through the same-origin local Express dev proxy so production Cloud Functions
 * can keep Zero Trust CORS strictly locked to production origins.
 */
export function resolveCloudFunctionBaseUrl(params: ResolveCloudFunctionBaseUrlParams): string {
  const configured =
    typeof params.configuredUrl === 'string' ? params.configuredUrl.trim().replace(/\/+$/, '') : '';
  if (configured) {
    return configured;
  }

  const isDev =
    params.isDev !== undefined
      ? params.isDev
      : Boolean(typeof import.meta !== 'undefined' && import.meta.env?.DEV);
  const protocol =
    params.locationProtocol !== undefined
      ? params.locationProtocol
      : typeof window !== 'undefined'
        ? window.location.protocol
        : '';
  const hostname =
    params.locationHostname !== undefined
      ? params.locationHostname
      : typeof window !== 'undefined'
        ? window.location.hostname
        : '';

  if (isDev && protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    return `${DEV_FUNCTIONS_PROXY_PREFIX}/${params.functionName}`;
  }

  return params.defaultUrl.replace(/\/+$/, '');
}

/**
 * Validates and builds the fixed production Cloud Functions target URL for the
 * local development proxy. Strictly blocks arbitrary hosts, unallowlisted functions,
 * query injection, and path traversal.
 */
export function resolveDevProxyUpstreamUrl(fnName: string, rawSubPath: string): string | null {
  if (!ALLOWED_DEV_PROXY_FUNCTIONS.has(fnName)) {
    return null;
  }
  const cleanSubPath = String(rawSubPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleanSubPath || cleanSubPath.includes('..') || cleanSubPath.includes('//')) {
    return null;
  }
  if (!SAFE_SUBPATH_RE.test(cleanSubPath)) {
    return null;
  }
  return `${CLOUD_FUNCTIONS_ORIGIN}/${fnName}/${cleanSubPath}`;
}
