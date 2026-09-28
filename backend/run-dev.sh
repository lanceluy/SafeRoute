#!/bin/sh
# Start the backend on the dev profile (port 8080) with Java 21, from any terminal.
# Needs Postgres and Kafka running: `docker compose up -d` in the project root.
set -e
cd "$(dirname "$0")"

# The macOS default `java` can be an old Intel-only browser plugin ("Bad CPU type in executable"),
# so pick JDK 21 explicitly unless JAVA_HOME already points at one.
if [ -z "$JAVA_HOME" ] || ! "$JAVA_HOME/bin/java" -version 2>&1 | grep -q '"21'; then
  for candidate in /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
                   "$(/usr/libexec/java_home -v 21 2>/dev/null)"; do
    if [ -n "$candidate" ] && [ -x "$candidate/bin/java" ]; then JAVA_HOME=$candidate; break; fi
  done
fi
if [ -z "$JAVA_HOME" ] || [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "Java 21 not found. Install it with: brew install openjdk@21" >&2
  exit 1
fi
export JAVA_HOME

SPRING_PROFILES_ACTIVE=${SPRING_PROFILES_ACTIVE:-dev} \
SAFEROUTE_MODERATOR_EMAILS=${SAFEROUTE_MODERATOR_EMAILS:-mod@saferoute.local} \
exec ./mvnw -q spring-boot:run "$@"
