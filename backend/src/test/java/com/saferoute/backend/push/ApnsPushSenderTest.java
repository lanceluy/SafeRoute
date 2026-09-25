package com.saferoute.backend.push;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.JwsHeader;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.spec.ECGenParameterSpec;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;

class ApnsPushSenderTest {

    private static final String TOKEN_OK = "a".repeat(64);
    private static final String TOKEN_GONE = "b".repeat(64);
    private static final String TOKEN_BAD = "c".repeat(64);
    private static final String TOKEN_ERROR = "d".repeat(64);

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Map<String, Map<String, String>> requestHeaders = new ConcurrentHashMap<>();
    private final Map<String, String> requestBodies = new ConcurrentHashMap<>();
    private KeyPair keys;
    private HttpServer fakeApns;
    private ApnsPushSender sender;

    @BeforeEach
    void setUp() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        keys = generator.generateKeyPair();

        // Stands in for api.push.apple.com, answering the way APNs does for each token.
        fakeApns = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        fakeApns.createContext("/3/device/", exchange -> {
            String token = exchange.getRequestURI().getPath().substring("/3/device/".length());
            requestHeaders.put(token, Map.of(
                    "authorization", exchange.getRequestHeaders().getFirst("authorization"),
                    "apns-topic", exchange.getRequestHeaders().getFirst("apns-topic"),
                    "apns-push-type", exchange.getRequestHeaders().getFirst("apns-push-type"),
                    "apns-collapse-id", exchange.getRequestHeaders().getFirst("apns-collapse-id")));
            requestBodies.put(token, new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            int status;
            String body;
            if (token.equals(TOKEN_OK)) { status = 200; body = ""; }
            else if (token.equals(TOKEN_GONE)) { status = 410; body = "{\"reason\":\"Unregistered\"}"; }
            else if (token.equals(TOKEN_BAD)) { status = 400; body = "{\"reason\":\"BadDeviceToken\"}"; }
            else { status = 500; body = "{\"reason\":\"InternalServerError\"}"; }
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
            if (bytes.length > 0) exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        fakeApns.start();

        sender = new ApnsPushSender(keys.getPrivate(), "KEY1234567", "TEAM123456", "com.saferoute.app",
                URI.create("http://127.0.0.1:" + fakeApns.getAddress().getPort()), objectMapper,
                HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build());
    }

    @AfterEach
    void tearDown() {
        fakeApns.stop(0);
    }

    @Test
    void providerTokenIsAnEs256JwtApnsAccepts() {
        String token = sender.providerToken(Instant.now());

        Jws<Claims> parsed = Jwts.parser().verifyWith(keys.getPublic()).build().parseSignedClaims(token);
        JwsHeader header = parsed.getHeader();
        assertThat(header.getAlgorithm()).isEqualTo("ES256");
        assertThat(header.getKeyId()).isEqualTo("KEY1234567");
        assertThat(parsed.getPayload().getIssuer()).isEqualTo("TEAM123456");
        assertThat(parsed.getPayload().getIssuedAt()).isNotNull();
    }

    @Test
    void providerTokenIsReusedUntilItNearlyExpires() {
        Instant start = Instant.now();
        String first = sender.providerToken(start);
        assertThat(sender.providerToken(start.plusSeconds(30 * 60))).isEqualTo(first);
        assertThat(sender.providerToken(start.plus(ApnsPushSender.TOKEN_TTL).plusSeconds(1))).isNotEqualTo(first);
    }

    @Test
    void payloadStaysValidJsonWhateverTheText() throws Exception {
        UUID hazardId = UUID.randomUUID();
        String title = "Hazard \"near\" you";
        String body = "Line one\nLine two \\ done";

        JsonNode json = objectMapper.readTree(sender.payload(new PushMessage(title, body, hazardId)));

        assertThat(json.at("/aps/alert/title").asText()).isEqualTo(title);
        assertThat(json.at("/aps/alert/body").asText()).isEqualTo(body);
        assertThat(json.at("/aps/sound").asText()).isEqualTo("default");
        assertThat(json.get("hazardId").asText()).isEqualTo(hazardId.toString());
    }

    @Test
    void sendsTheHeadersApnsRequires() throws Exception {
        UUID hazardId = UUID.randomUUID();
        PushSender.Result result = sender.send(TOKEN_OK, new PushMessage("t", "b", hazardId)).get();

        assertThat(result).isEqualTo(PushSender.Result.DELIVERED);
        Map<String, String> headers = requestHeaders.get(TOKEN_OK);
        assertThat(headers.get("authorization")).startsWith("bearer ");
        assertThat(headers.get("apns-topic")).isEqualTo("com.saferoute.app");
        assertThat(headers.get("apns-push-type")).isEqualTo("alert");
        assertThat(headers.get("apns-collapse-id")).isEqualTo(hazardId.toString());
        assertThat(objectMapper.readTree(requestBodies.get(TOKEN_OK)).at("/aps/alert/title").asText()).isEqualTo("t");
    }

    @Test
    void mapsApnsResponsesToResults() throws Exception {
        PushMessage message = new PushMessage("t", "b", UUID.randomUUID());
        assertThat(sender.send(TOKEN_GONE, message).get()).isEqualTo(PushSender.Result.INVALID_TOKEN);
        assertThat(sender.send(TOKEN_BAD, message).get()).isEqualTo(PushSender.Result.INVALID_TOKEN);
        assertThat(sender.send(TOKEN_ERROR, message).get()).isEqualTo(PushSender.Result.FAILED);
    }

    @Test
    void readsAnAppleP8Key() throws Exception {
        String pem = "-----BEGIN PRIVATE KEY-----\n"
                + Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.UTF_8)).encodeToString(keys.getPrivate().getEncoded())
                + "\n-----END PRIVATE KEY-----\n";
        assertThat(ApnsPushSender.parseKey(pem).getEncoded()).isEqualTo(keys.getPrivate().getEncoded());
    }
}
