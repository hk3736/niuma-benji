package com.everylog.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自带的相册扫描插件：必须在 super.onCreate 之前注册
        registerPlugin(GalleryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
