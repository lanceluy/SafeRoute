-- Consumer idempotency (review §22): a redelivered Kafka event is recognised and skipped.
CREATE TABLE processed_events (
    event_id       UUID NOT NULL,
    consumer_name  VARCHAR(80) NOT NULL,
    processed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_processed_events PRIMARY KEY (event_id, consumer_name)
);
