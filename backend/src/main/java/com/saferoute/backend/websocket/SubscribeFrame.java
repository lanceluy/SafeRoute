package com.saferoute.backend.websocket;

import java.util.List;

/**
 * Inbound frames from a connected client:
 * <ul>
 *   <li>{@code {"type":"subscribe","lat":..,"lon":..}} — on connect and on significant movement</li>
 *   <li>{@code {"type":"route","route":[[lat,lon],...]}} — active route for on-route alerts;
 *       {@code "route":null} clears it</li>
 *   <li>{@code {"type":"watch","bbox":[minLat,minLon,maxLat,maxLon]}} — moderators/officials
 *       only: receive every hazard change inside the box, regardless of location or alert
 *       radius (the municipal portal's live map); {@code "bbox":null} stops it</li>
 * </ul>
 */
public record SubscribeFrame(String type, Double lat, Double lon, List<double[]> route, double[] bbox) {
}
