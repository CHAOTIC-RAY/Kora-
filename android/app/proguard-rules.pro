# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# === Kora perf plan (Phase 1.2): R8 keep rules ===
# Without these, minification strips the reflection-based Capacitor plugin
# bridge and Firebase classes the WebView / sign-in depend on.
-keep class com.getcapacitor.** { *; }
-keep class app.kora.reader.** { *; }
-keep class com.google.firebase.** { *; }
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,Exceptions
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}
# Preserve reflection entry points Capacitor uses to enumerate plugins.
-keep class * extends com.getcapacitor.Plugin
-keep class * implements com.getcapacitor.Plugin
-dontwarn com.getcapacitor.**
-dontwarn com.google.firebase.**
# @capacitor-firebase/authentication references the optional Facebook SDK which
# this build does not include (Google sign-in only). R8 must not error/warn on it.
-dontwarn com.facebook.**
-keep class io.capawesome.capacitorjs.plugins.firebase.authentication.** { *; }
