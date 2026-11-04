package app.pilas.habitos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins propios de la app (los de npm se registran solos)
        registerPlugin(PilasSystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
