package com.saferoute.notification.service;

import org.springframework.stereotype.Service;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

@Service
public class ApnsService {

    private static final String APNS_DEV_URL = "https://api.development.push.apple.com/3/device/";

    public void sendPushNotification(String deviceToken, String title, String body) {
        if (deviceToken == null || deviceToken.isBlank()) return;

        String payload = String.format("""
            {
                "aps": {
                    "alert": {
                        "title": "%s",
                        "body": "%s"
                    },
                    "sound": "default"
                }
            }
            """, title, body);

        try {
            HttpClient client = HttpClient.newHttpClient();
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(APNS_DEV_URL + deviceToken))
                    .header("apns-topic", "com.saferoute.app")
                    .header("apns-push-type", "alert")
                    .POST(HttpRequest.BodyPublishers.ofString(payload))
                    .build();

            client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                    .thenAccept(response -> {
                        System.out.println("APNs Response Code: " + response.statusCode());
                    });
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
