package com.saferoute.backend.moderation;

import com.saferoute.backend.common.ApiException;
import com.saferoute.backend.moderation.dto.SavedViewRequest;
import com.saferoute.backend.moderation.dto.SavedViewResponse;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class SavedViewService {

    static final int MAX_VIEWS_PER_USER = 50;

    private final SavedViewRepository repository;

    public SavedViewService(SavedViewRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<SavedViewResponse> list(UUID userId) {
        return repository.findByUserIdOrderByNameAsc(userId).stream().map(SavedViewResponse::from).toList();
    }

    @Transactional
    public SavedViewResponse save(UUID userId, SavedViewRequest request) {
        String name = request.name().trim();
        SavedView view = repository.findByUserIdAndNameIgnoreCase(userId, name).orElse(null);
        if (view == null) {
            if (repository.countByUserId(userId) >= MAX_VIEWS_PER_USER) {
                throw new ApiException(HttpStatus.CONFLICT, "TOO_MANY_SAVED_VIEWS",
                        "You can keep up to " + MAX_VIEWS_PER_USER + " saved views; delete one first.");
            }
            view = SavedView.builder().userId(userId).name(name).config(request.config()).build();
        } else {
            view.setConfig(request.config());
            view.setCreatedAt(Instant.now());
        }
        return SavedViewResponse.from(repository.save(view));
    }

    @Transactional
    public void delete(UUID userId, UUID id) {
        SavedView view = repository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "SAVED_VIEW_NOT_FOUND", "Saved view not found"));
        repository.delete(view);
    }
}
