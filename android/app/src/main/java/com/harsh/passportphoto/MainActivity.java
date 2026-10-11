package com.harsh.passportphoto;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

/**
 * The web layer captures photos with getUserMedia, which needs the CAMERA
 * runtime permission before the WebView can open the camera. Ask for it up
 * front; if the user declines, the app simply falls back to the gallery picker.
 */
public class MainActivity extends BridgeActivity {

    private static final int CAMERA_REQUEST = 4242;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this, new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST);
        }
    }
}
