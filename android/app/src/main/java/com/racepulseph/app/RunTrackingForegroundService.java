package com.racepulseph.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import com.getcapacitor.JSObject;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

public class RunTrackingForegroundService extends Service {

    public interface FixListener {
        void onLocationFix(Bundle fixBundle);
    }

    public static final String CHANNEL_ID = "racepulse_run_tracking";
    private static final String CHANNEL_NAME = "Run Tracking";
    private static final int NOTIFICATION_ID = 4201;
    private static final int MAX_BUFFERED_FIXES = 20_000;
    private static final long WAKE_LOCK_TIMEOUT_MS = 6L * 60L * 60L * 1000L;

    public static final String ACTION_START = "com.racepulseph.app.action.RUN_TRACKING_START";
    public static final String ACTION_UPDATE_NOTIFICATION = "com.racepulseph.app.action.RUN_TRACKING_UPDATE_NOTIFICATION";
    public static final String ACTION_STOP = "com.racepulseph.app.action.RUN_TRACKING_STOP";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_SUBTITLE = "subtitle";

    private static final String DEFAULT_TITLE = "RacePulsePH Run Recording";
    private static final String DEFAULT_SUBTITLE = "Tracking live GPS pace and distance";

    private static final Object STATE_LOCK = new Object();
    private static final ArrayDeque<Bundle> BUFFERED_FIXES = new ArrayDeque<>();
    private static FixListener fixListener;
    private static boolean jsBackgrounded = false;
    private static boolean running = false;

    private final Object wakeLockSync = new Object();
    private PowerManager.WakeLock wakeLock;
    private FusedLocationProviderClient fusedClient;
    private boolean locationUpdatesActive = false;
    private String currentTitle = DEFAULT_TITLE;
    private String currentSubtitle = DEFAULT_SUBTITLE;

    private final LocationCallback locationCallback = new LocationCallback() {
        @Override
        public void onLocationResult(@NonNull LocationResult locationResult) {
            for (Location location : locationResult.getLocations()) {
                handleIncomingLocation(location);
            }
        }
    };

    public static void setFixListener(@Nullable FixListener listener) {
        synchronized (STATE_LOCK) {
            fixListener = listener;
        }
    }

    public static void clearFixListener(@Nullable FixListener listener) {
        synchronized (STATE_LOCK) {
            if (listener == null || fixListener == listener) {
                fixListener = null;
            }
        }
    }

    public static void setJsBackgrounded(boolean backgrounded) {
        synchronized (STATE_LOCK) {
            jsBackgrounded = backgrounded;
        }
    }

    public static boolean isRunning() {
        synchronized (STATE_LOCK) {
            return running;
        }
    }

    public static int getBufferedCount() {
        synchronized (STATE_LOCK) {
            return BUFFERED_FIXES.size();
        }
    }

    public static List<Bundle> drainBufferedFixes() {
        synchronized (STATE_LOCK) {
            List<Bundle> drained = new ArrayList<>(BUFFERED_FIXES.size());
            while (!BUFFERED_FIXES.isEmpty()) {
                drained.add(BUFFERED_FIXES.pollFirst());
            }
            return drained;
        }
    }

    public static JSObject bundleToJsObject(@NonNull Bundle bundle) {
        JSObject obj = new JSObject();
        obj.put("latitude", bundle.getDouble("latitude"));
        obj.put("longitude", bundle.getDouble("longitude"));
        obj.put("accuracyM", bundle.getDouble("accuracyM", 999.0));
        obj.put("altitudeM", bundle.containsKey("altitudeM") ? bundle.getDouble("altitudeM") : JSONObject.NULL);
        obj.put("speedMps", bundle.containsKey("speedMps") ? bundle.getDouble("speedMps") : JSONObject.NULL);
        obj.put("headingDeg", bundle.containsKey("headingDeg") ? bundle.getDouble("headingDeg") : JSONObject.NULL);
        obj.put("timestamp", bundle.getLong("timestamp"));
        obj.put("provider", bundle.getString("provider", "native-foreground-gnss"));
        return obj;
    }

    private static void handleIncomingLocation(@Nullable Location location) {
        if (location == null) {
            return;
        }
        double lat = location.getLatitude();
        double lon = location.getLongitude();
        if (!Double.isFinite(lat) || !Double.isFinite(lon)) {
            return;
        }

        Bundle fixBundle = toFixBundle(location);
        FixListener liveTarget = null;
        synchronized (STATE_LOCK) {
            if (fixListener != null && !jsBackgrounded) {
                liveTarget = fixListener;
            } else {
                while (BUFFERED_FIXES.size() >= MAX_BUFFERED_FIXES) {
                    BUFFERED_FIXES.pollFirst();
                }
                BUFFERED_FIXES.addLast(fixBundle);
            }
        }
        if (liveTarget != null) {
            liveTarget.onLocationFix(fixBundle);
        }
    }

    private static Bundle toFixBundle(@NonNull Location location) {
        Bundle bundle = new Bundle();
        bundle.putDouble("latitude", location.getLatitude());
        bundle.putDouble("longitude", location.getLongitude());
        double accuracyM = location.hasAccuracy() && Float.isFinite(location.getAccuracy())
            ? location.getAccuracy()
            : 999.0;
        bundle.putDouble("accuracyM", accuracyM);

        if (location.hasAltitude() && Double.isFinite(location.getAltitude())) {
            bundle.putDouble("altitudeM", location.getAltitude());
        }
        if (location.hasSpeed() && Float.isFinite(location.getSpeed())) {
            bundle.putDouble("speedMps", location.getSpeed());
        }
        if (location.hasBearing() && Float.isFinite(location.getBearing())) {
            bundle.putDouble("headingDeg", location.getBearing());
        }

        long timestamp = location.getTime() > 0L ? location.getTime() : System.currentTimeMillis();
        bundle.putLong("timestamp", timestamp);
        bundle.putString("provider", "native-foreground-gnss");
        return bundle;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        String action = intent != null && intent.getAction() != null ? intent.getAction() : ACTION_START;

        if (ACTION_STOP.equals(action)) {
            shutdownService(true);
            return START_NOT_STICKY;
        }

        // Android 14+ throws SecurityException if a location FGS starts without ACCESS_FINE_LOCATION.
        if (!hasFineLocationPermission()) {
            shutdownService(false);
            return START_NOT_STICKY;
        }

        if (intent != null) {
            String nextTitle = intent.getStringExtra(EXTRA_TITLE);
            String nextSubtitle = intent.getStringExtra(EXTRA_SUBTITLE);
            if (nextTitle != null && !nextTitle.isEmpty()) {
                currentTitle = nextTitle;
            }
            if (nextSubtitle != null && !nextSubtitle.isEmpty()) {
                currentSubtitle = nextSubtitle;
            }
        }

        Notification notification = buildNotification(currentTitle, currentSubtitle);

        if (ACTION_UPDATE_NOTIFICATION.equals(action) && isRunning()) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(NOTIFICATION_ID, notification);
            }
            return START_STICKY;
        }

        int foregroundType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            : 0;
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, foregroundType);
        } catch (SecurityException | IllegalStateException ex) {
            shutdownService(false);
            return START_NOT_STICKY;
        }

        synchronized (STATE_LOCK) {
            running = true;
        }
        acquireWakeLock();
        if (!startLocationUpdates()) {
            shutdownService(true);
            return START_NOT_STICKY;
        }

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopLocationUpdates();
        releaseWakeLock();
        synchronized (STATE_LOCK) {
            running = false;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private boolean hasFineLocationPermission() {
        return ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    private boolean startLocationUpdates() {
        if (fusedClient == null) {
            fusedClient = LocationServices.getFusedLocationProviderClient(this);
        }
        if (locationUpdatesActive) {
            return true;
        }
        if (!hasFineLocationPermission()) {
            return false;
        }

        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000L)
            .setMinUpdateIntervalMillis(1000L)
            .setWaitForAccurateLocation(false)
            .build();
        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
            locationUpdatesActive = true;
            return true;
        } catch (SecurityException ex) {
            locationUpdatesActive = false;
            return false;
        }
    }

    private void stopLocationUpdates() {
        if (fusedClient != null && locationUpdatesActive) {
            fusedClient.removeLocationUpdates(locationCallback);
        }
        locationUpdatesActive = false;
    }

    private void shutdownService(boolean stopForegroundNotification) {
        stopLocationUpdates();
        releaseWakeLock();
        synchronized (STATE_LOCK) {
            running = false;
        }
        if (stopForegroundNotification) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        }
        stopSelf();
    }

    private void acquireWakeLock() {
        synchronized (wakeLockSync) {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "RacePulsePH::RunTrackingWakeLock"
                    );
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
            }
        }
    }

    private void releaseWakeLock() {
        synchronized (wakeLockSync) {
            if (wakeLock != null && wakeLock.isHeld()) {
                try {
                    wakeLock.release();
                } catch (RuntimeException ignored) {
                    // WakeLock may already be released after its 6h safety timeout.
                }
            }
            wakeLock = null;
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Active GPS run tracking updates");
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification(String title, String subtitle) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(contentIntent)
            .build();
    }
}
