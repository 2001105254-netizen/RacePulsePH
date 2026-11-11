# R8 / ProGuard rules for RacePulsePH Capacitor Android release builds.

-keepattributes *Annotation*,SourceFile,LineNumberTable
-keep class com.racepulseph.app.MainActivity { *; }
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
