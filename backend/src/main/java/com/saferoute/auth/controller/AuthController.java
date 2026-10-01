package com.saferoute.auth.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    public record AgentRegisterRequest(String name, String email, String password, String city, String role) {}

    @PostMapping("/register-agent")
    public ResponseEntity<Void> registerAgent(@RequestBody AgentRegisterRequest request) {
        System.out.println("Registering LGU Agent for " + request.city() + ": " + request.email());
        return ResponseEntity.ok().build();
    }
}
