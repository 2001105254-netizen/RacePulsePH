package com.racepulseph.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.List;

@CapacitorPlugin(
    name = "RunTracking",
    permissions = {
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        ),
        @Permission(
            alias = "notifications",
            strings = {
                Manifest.permission.POST_NOTIFICATIONS
            }
        )
    }
)
public class RunTrackingPlugin extends Plugin {

    private static final String EVENT_LOCATION_FIX = "locationFix";
    private static final String MODE_NATIVE = "native-foreground-service";
    private static final String DEFAULT_TITLE = "RacePulsePH Run Recording";
    private static final String DEFAULT_SUBTITLE = "Tracking live GPS pace and distance";

    private final RunTrackingForegroundService.FixListener fixListener = this::dispatchLocationFix;

    @Override
    public void load() {
        RunTrackingForegroundService.setJsBackgrounded(false);
        if (RunTrackingForegroundService.isRunning()) {
            RunTrackingForegroundService.setFixListener(fixListener);
        }
    }

    @PluginMethod
    public void startTracking(PluginCall call) {
        if (!hasFineLocationPermission()) {
            requestPermissionForAlias("location", call, "locationPermsCallback");
            return;
        }
        maybeRequestNotificationsThenStart(call);
    }

    @PermissionCallback
    private void locationPermsCallback(PluginCall call) {
        if (call == null) {
            return;
        }
        if (!hasFineLocationPermission()) {
            call.reject("Precise location permission is required for background run tracking.");
            return;
        }
        maybeRequestNotificationsThenStart(call);
    }

    @PermissionCallback
    private void notificationsPermsCallback(PluginCall call) {
        if (call == null) {
            return;
        }
        if (!hasFineLocationPermission()) {
            call.reject("Precise location permission is required for background run tracking.");
            return;
        }
        launchForegroundServiceAndResolve(call);
    }

    @PluginMethod
    public void updateNotification(PluginCall call) {
        if (!RunTrackingForegroundService.isRunning()) {
            call.resolve();
            return;
        }
        String title = call.getString("title", DEFAULT_TITLE);
        String subtitle = call.getString("subtitle", DEFAULT_SUBTITLE);

        Context context = getContext();
        Intent updateIntent = new Intent(context, RunTrackingForegroundService.class);
        updateIntent.setAction(RunTrackingForegroundService.ACTION_UPDATE_NOTIFICATION);
        updateIntent.putExtra(RunTrackingForegroundService.EXTRA_TITLE, title);
        updateIntent.putExtra(RunTrackingForegroundService.EXTRA_SUBTITLE, subtitle);
        try {
            context.startService(updateIntent);
        } catch (RuntimeException ignored) {
            // Optional notification refresh should not crash if OS restricts background service calls.
        }
        call.resolve();
    }

    @PluginMethod
    public void stopTracking(PluginCall call) {
        RunTrackingForegroundService.clearFixListener(fixListener);
        RunTrackingForegroundService.setJsBackgrounded(false);
        Context context = getContext();
        context.stopService(new Intent(context, RunTrackingForegroundService.class));

        JSObject ret = new JSObject();
        ret.put("active", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void getBufferedFixes(PluginCall call) {
        List<Bundle> drained = RunTrackingForegroundService.drainBufferedFixes();
        JSArray fixes = new JSArray();
        for (Bundle bundle : drained) {
            fixes.put(RunTrackingForegroundService.bundleToJsObject(bundle));
        }
        JSObject ret = new JSObject();
        ret.put("fixes", fixes);
        call.resolve(ret);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("active", RunTrackingForegroundService.isRunning());
        ret.put("bufferedCount", RunTrackingForegroundService.getBufferedCount());
        ret.put("mode", MODE_NATIVE);
        call.resolve(ret);
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        RunTrackingForegroundService.setJsBackgrounded(true);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        RunTrackingForegroundService.setJsBackgrounded(false);
        if (RunTrackingForegroundService.isRunning()) {
            RunTrackingForegroundService.setFixListener(fixListener);
        }
    }

    @Override
    protected void handleOnDestroy() {
        RunTrackingForegroundService.clearFixListener(fixListener);
        super.handleOnDestroy();
    }

    private boolean hasFineLocationPermission() {
        return getPermissionState("location") == PermissionState.GRANTED
            && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void maybeRequestNotificationsThenStart(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            boolean granted = ContextCompat.checkSelfPermission(
                getContext(),
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED;
            PermissionState state = getPermissionState("notifications");
            if (!granted && state != PermissionState.DENIED) {
                requestPermissionForAlias("notifications", call, "notificationsPermsCallback");
                return;
            }
        }
        launchForegroundServiceAndResolve(call);
    }

    private void launchForegroundServiceAndResolve(PluginCall call) {
        if (!hasFineLocationPermission()) {
            call.reject("Precise location permission is required for background run tracking.");
            return;
        }
        String title = call.getString("title", DEFAULT_TITLE);
        String subtitle = call.getString("subtitle", DEFAULT_SUBTITLE);

        RunTrackingForegroundService.clearBufferedFixesIfIdle();
        RunTrackingForegroundService.setJsBackgrounded(false);
        RunTrackingForegroundService.setFixListener(fixListener);

        Context context = getContext();
        Intent startIntent = new Intent(context, RunTrackingForegroundService.class);
        startIntent.setAction(RunTrackingForegroundService.ACTION_START);
        startIntent.putExtra(RunTrackingForegroundService.EXTRA_TITLE, title);
        startIntent.putExtra(RunTrackingForegroundService.EXTRA_SUBTITLE, subtitle);
        try {
            ContextCompat.startForegroundService(context, startIntent);
        } catch (RuntimeException ex) {
            RunTrackingForegroundService.clearFixListener(fixListener);
            call.reject("Unable to start background run tracking service.", ex);
            return;
        }

        JSObject ret = new JSObject();
        ret.put("active", true);
        ret.put("mode", MODE_NATIVE);
        call.resolve(ret);
    }

    private void dispatchLocationFix(@NonNull Bundle fixBundle) {
        notifyListeners(EVENT_LOCATION_FIX, RunTrackingForegroundService.bundleToJsObject(fixBundle));
    }
}
