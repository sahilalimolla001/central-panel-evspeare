package shop.evspeare.app;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.google.firebase.messaging.FirebaseMessaging;
import com.google.android.gms.auth.api.phone.SmsRetriever;
import com.google.android.gms.auth.api.phone.SmsRetrieverClient;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Status;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {
    private static final String HOME_URL = "https://www.evspeare.shop/";
    private static final int LOCATION_PERMISSION_REQUEST = 42;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 43;
    private static final int SMS_CONSENT_REQUEST = 44;
    private static final String ORDER_CHANNEL_ID = "evspeare_orders";
    private WebView webView;
    private GeolocationPermissions.Callback geolocationCallback;
    private String geolocationOrigin;
    private BroadcastReceiver smsConsentReceiver;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        webView.addJavascriptInterface(new NotificationBridge(), "EvSpeareAndroid");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleExternalUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleExternalUrl(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                registerStoredPushToken();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                    return;
                }

                geolocationOrigin = origin;
                geolocationCallback = callback;
                requestPermissions(
                    new String[] {
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                    },
                    LOCATION_PERMISSION_REQUEST
                );
            }
        });

        createNotificationChannel();
        requestNotificationPermissionIfNeeded();
        fetchFirebaseToken();
        webView.loadUrl(HOME_URL);
    }

    private boolean handleExternalUrl(Uri uri) {
        String host = uri.getHost();
        String scheme = uri.getScheme();
        if (scheme == null) return false;

        if (scheme.equals("https") && (host == null || host.endsWith("evspeare.shop"))) {
            return false;
        }

        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        startActivity(intent);
        return true;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            ORDER_CHANNEL_ID,
            "Order updates",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("EV Speare order and delivery updates");
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATION_PERMISSION_REQUEST);
    }

    private void fetchFirebaseToken() {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful() || task.getResult() == null) return;
            String token = task.getResult();
            SharedPreferences preferences = getSharedPreferences(EvSpeareMessagingService.PREFS_NAME, MODE_PRIVATE);
            preferences.edit().putString(EvSpeareMessagingService.TOKEN_KEY, token).apply();
            runOnUiThread(() -> registerPushTokenWithWeb(token));
        });
    }

    private void registerStoredPushToken() {
        SharedPreferences preferences = getSharedPreferences(EvSpeareMessagingService.PREFS_NAME, MODE_PRIVATE);
        String token = preferences.getString(EvSpeareMessagingService.TOKEN_KEY, "");
        registerPushTokenWithWeb(token, 0);
        registerPushTokenWithWeb(token, 1200);
        registerPushTokenWithWeb(token, 3000);
        registerPushTokenWithWeb(token, 6000);
    }

    private void registerPushTokenWithWeb(String token) {
        registerPushTokenWithWeb(token, 0);
    }

    private void registerPushTokenWithWeb(String token, long delayMs) {
        if (webView == null || token == null || token.trim().isEmpty()) return;
        webView.postDelayed(() -> {
            String script = "window.EvSpeareRegisterPushToken && window.EvSpeareRegisterPushToken('" + escapeJs(token) + "')";
            webView.evaluateJavascript(script, null);
        }, delayMs);
    }

    private String escapeJs(String value) {
        return value
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "\\r");
    }

    private void startOtpListener() {
        unregisterSmsConsentReceiver();
        SmsRetrieverClient client = SmsRetriever.getClient(this);
        client.startSmsUserConsent(null);

        smsConsentReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!SmsRetriever.SMS_RETRIEVED_ACTION.equals(intent.getAction())) return;
                Bundle extras = intent.getExtras();
                if (extras == null) return;
                Status status = (Status) extras.get(SmsRetriever.EXTRA_STATUS);
                if (status == null || status.getStatusCode() != CommonStatusCodes.SUCCESS) return;
                Intent consentIntent = extras.getParcelable(SmsRetriever.EXTRA_CONSENT_INTENT);
                if (consentIntent == null) return;
                try {
                    startActivityForResult(consentIntent, SMS_CONSENT_REQUEST);
                } catch (Exception ignored) {
                    // User consent UI may already be unavailable if the activity changed state.
                }
            }
        };

        IntentFilter filter = new IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(smsConsentReceiver, filter, SmsRetriever.SEND_PERMISSION, null, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(smsConsentReceiver, filter, SmsRetriever.SEND_PERMISSION, null);
        }
    }

    private void unregisterSmsConsentReceiver() {
        if (smsConsentReceiver == null) return;
        try {
            unregisterReceiver(smsConsentReceiver);
        } catch (Exception ignored) {
            // Receiver can already be unregistered by Android after activity changes.
        }
        smsConsentReceiver = null;
    }

    private void sendOtpToWeb(String message) {
        Matcher matcher = Pattern.compile("\\b(\\d{4,6})\\b").matcher(message == null ? "" : message);
        if (!matcher.find() || webView == null) return;
        String code = matcher.group(1);
        runOnUiThread(() -> {
            String script = "window.EvSpeareReceiveOtp && window.EvSpeareReceiveOtp('" + escapeJs(code) + "')";
            webView.evaluateJavascript(script, null);
        });
    }

    private void showOrderNotification(String title, String message) {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        android.app.Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new android.app.Notification.Builder(this, ORDER_CHANNEL_ID)
            : new android.app.Notification.Builder(this);

        builder
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title == null || title.trim().isEmpty() ? "Ev Speare" : title)
            .setContentText(message == null || message.trim().isEmpty() ? "Order update available" : message)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true);

        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.notify((int) System.currentTimeMillis(), builder.build());
    }

    public class NotificationBridge {
        @JavascriptInterface
        public void orderUpdate(String title, String message) {
            runOnUiThread(() -> showOrderNotification(title, message));
        }

        @JavascriptInterface
        public String getPushToken() {
            SharedPreferences preferences = getSharedPreferences(EvSpeareMessagingService.PREFS_NAME, MODE_PRIVATE);
            return preferences.getString(EvSpeareMessagingService.TOKEN_KEY, "");
        }

        @JavascriptInterface
        public void startOtpListener() {
            runOnUiThread(() -> MainActivity.this.startOtpListener());
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != SMS_CONSENT_REQUEST || resultCode != RESULT_OK || data == null) return;
        sendOtpToWeb(data.getStringExtra(SmsRetriever.EXTRA_SMS_MESSAGE));
    }

    @Override
    protected void onDestroy() {
        unregisterSmsConsentReceiver();
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != LOCATION_PERMISSION_REQUEST || geolocationCallback == null) return;

        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        geolocationCallback.invoke(geolocationOrigin, granted, false);
        geolocationCallback = null;
        geolocationOrigin = null;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }
}
