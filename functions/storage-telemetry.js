'use strict';

const admin = require('firebase-admin');
const { onObjectDeleted, onObjectFinalized } = require('firebase-functions/v2/storage');
const { applyStorageObjectTelemetryDelta } = require('./telemetry-service');

async function handleStorageEvent(event, direction) {
  const objectName = event?.data?.name || '';
  const size = Number(event?.data?.size || 0);
  if (!objectName || size <= 0) return;

  try {
    await applyStorageObjectTelemetryDelta(admin.firestore(), {
      name: objectName,
      size,
      direction,
    });
  } catch (err) {
    console.error('Storage telemetry delta failed', {
      direction,
      code: err?.code || 'internal',
    });
  }
}

function resolveDefaultStorageBucket() {
  if (process.env.FIREBASE_CONFIG) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_CONFIG);
      if (typeof parsed?.storageBucket === 'string' && parsed.storageBucket.trim()) {
        return parsed.storageBucket.trim();
      }
    } catch {
      // Fall back to default project bucket when FIREBASE_CONFIG is unset or unparseable.
    }
  }
  return process.env.RACEPULSE_STORAGE_BUCKET || 'racepulseph.firebasestorage.app';
}

const triggerBucket = resolveDefaultStorageBucket();

exports.onStorageObjectFinalized = onObjectFinalized(
  {
    bucket: triggerBucket,
    region: 'asia-southeast1',
    maxInstances: 10,
  },
  (event) => handleStorageEvent(event, 'finalize'),
);

exports.onStorageObjectDeleted = onObjectDeleted(
  {
    bucket: triggerBucket,
    region: 'asia-southeast1',
    maxInstances: 10,
  },
  (event) => handleStorageEvent(event, 'delete'),
);
