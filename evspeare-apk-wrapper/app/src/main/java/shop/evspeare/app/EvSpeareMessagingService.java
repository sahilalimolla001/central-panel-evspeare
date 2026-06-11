package shop.evspeare.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class EvSpeareMessagingService extends FirebaseMessagingService {
    public static final String PREFS_NAME = "evspeare_push";
    public static final String TOKEN_KEY = "fcm_token";
    public static final String CHANNEL_ID = "evspeare_updates";

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        saveToken(token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);

        String title = "EV Speare";
        String body = "New update available";

        if (message.getNotification() != null) {
            if (message.getNotification().getTitle() != null) {
                title = message.getNotification().getTitle();
            }
            if (message.getNotification().getBody() != null) {
                body = message.getNotification().getBody();
            }
        }

        if (message.getData().containsKey("title")) {
            title = message.getData().get("title");
        }
        if (message.getData().containsKey("message")) {
            body = message.getData().get("message");
        }

        showNotification(title, body);
    }

    private void saveToken(String token) {
        SharedPreferences preferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        preferences.edit().putString(TOKEN_KEY, token).apply();
    }

    private void showNotification(String title, String body) {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "EV Speare updates",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("Order, offer and delivery updates");
            manager.createNotificationChannel(channel);
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
            ? new android.app.Notification.Builder(this, CHANNEL_ID)
            : new android.app.Notification.Builder(this);

        builder
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title == null || title.trim().isEmpty() ? "EV Speare" : title)
            .setContentText(body == null || body.trim().isEmpty() ? "New update available" : body)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true);

        manager.notify((int) System.currentTimeMillis(), builder.build());
    }
}
