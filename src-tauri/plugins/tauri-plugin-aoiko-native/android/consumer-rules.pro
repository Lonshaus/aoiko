# Tauri は plugin クラスを FQN で生成し、@Command を reflection で呼ぶ。
-keep @app.tauri.annotation.TauriPlugin public class * {
    public <init>(...);
    @app.tauri.annotation.Command public <methods>;
    @app.tauri.annotation.PermissionCallback <methods>;
    @app.tauri.annotation.ActivityCallback <methods>;
    @app.tauri.annotation.Permission <methods>;
}
# @InvokeArg は JSON から reflection で埋めるので、フィールドと setter を残す。
-keep @app.tauri.annotation.InvokeArg public class * { *; }
# 上の照合が実行時に効くよう、注解そのものを残す。
-keepattributes *Annotation*, RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
