package com.saferoute.backend.closure;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Lifts closures whose end time has passed. Each one expires in its own transaction. */
@Service
public class RoadClosureExpiryService {

    private static final Logger log = LoggerFactory.getLogger(RoadClosureExpiryService.class);
    private static final int BATCH_SIZE = 100;

    private final RoadClosureRepository repository;
    private final RoadClosureService service;

    public RoadClosureExpiryService(RoadClosureRepository repository, RoadClosureService service) {
        this.repository = repository;
        this.service = service;
    }

    @Scheduled(fixedDelayString = "${saferoute.closure.expiry-check-interval:PT1M}", initialDelayString = "PT30S")
    public void expireEndedClosures() {
        List<UUID> ids = repository.findExpiredIds(Instant.now(), BATCH_SIZE);
        int expired = 0;
        for (UUID id : ids) {
            try {
                if (service.expire(id)) expired++;
            } catch (ObjectOptimisticLockingFailureException e) {
                log.debug("Closure {} changed while expiring; will re-check next run", id);
            }
        }
        if (expired > 0) log.info("Expired {} road closure(s)", expired);
    }
}
