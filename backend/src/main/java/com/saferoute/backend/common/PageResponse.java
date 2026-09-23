package com.saferoute.backend.common;

import java.util.List;

public record PageResponse<T>(List<T> items, int page, int size, long totalItems, boolean hasMore) {

    public static <T> PageResponse<T> of(List<T> items, int page, int size, long totalItems) {
        return new PageResponse<>(items, page, size, totalItems, (long) (page + 1) * size < totalItems);
    }
}
