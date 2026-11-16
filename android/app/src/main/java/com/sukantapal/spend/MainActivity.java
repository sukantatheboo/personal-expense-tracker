package com.sukantapal.spend;

import android.os.Bundle;
import com.capacitorjs.plugins.app.AppPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
