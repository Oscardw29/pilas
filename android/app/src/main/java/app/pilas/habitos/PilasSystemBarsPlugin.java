package app.pilas.habitos;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Pinta las barras del sistema (estado arriba, navegación abajo) con el fondo del tema de la app.
 *
 * Sin esto Android deja detrás de las barras el fondo gris del tema nativo (Theme.AppCompat): el SystemBars de
 * Capacitor pone padding a la vista raíz y lo que asoma es su windowBackground. El tema de la app lo elige la
 * persona dentro de la app (no sigue al del sistema), así que lo manda la web en cada cambio
 * (src/platform/systemBars.ts).
 */
@CapacitorPlugin(name = "PilasSystemBars")
public class PilasSystemBarsPlugin extends Plugin {

    @PluginMethod
    public void setColor(PluginCall call) {
        String raw = call.getString("color", "");
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", true));
        final int color;
        try {
            color = Color.parseColor(raw);
        } catch (IllegalArgumentException e) {
            call.reject("Color no válido: " + raw);
            return;
        }

        getBridge().executeOnMainThread(() -> {
            Activity activity = getActivity();
            if (activity == null) {
                call.resolve();
                return;
            }
            // El SystemBars de Capacitor vuelve a pintar la vista raíz con windowBackground cuando cambia la
            // configuración (giro, modo oscuro del sistema…): se cambia en el tema para que lo conserve.
            activity.getTheme().applyStyle(dark ? R.style.PilasBarsDark : R.style.PilasBarsLight, true);

            Window window = activity.getWindow();
            window.getDecorView().setBackgroundColor(color);

            // Android 14 o anterior (sin edge-to-edge forzado): las barras tienen color propio.
            // En Android 15+ estas llamadas no hacen nada y se ve el fondo de la vista raíz.
            window.setStatusBarColor(color);
            // Antes de Android 8.1 los iconos de la barra de navegación siempre son blancos: con fondo claro no se verían
            boolean lightNavIconsSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1;
            window.setNavigationBarColor(dark || lightNavIconsSupported ? color : Color.BLACK);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Sin esto, con navegación de 3 botones Android pone un velo gris translúcido encima
                window.setNavigationBarContrastEnforced(false);
                window.setStatusBarContrastEnforced(false);
            }

            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            controller.setAppearanceLightStatusBars(!dark);
            controller.setAppearanceLightNavigationBars(!dark && lightNavIconsSupported);
            call.resolve();
        });
    }
}
