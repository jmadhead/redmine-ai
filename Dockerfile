FROM redmine:7.0-bookworm

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gosu \
        curl \
    && rm -rf /var/lib/apt/lists/*

COPY docker-entrypoint.sh /usr/local/bin/redmine-entrypoint

RUN chmod +x /usr/local/bin/redmine-entrypoint

ENTRYPOINT ["redmine-entrypoint"]
CMD ["web"]
