FROM redmine:6.1-bookworm

USER root

# PostgreSQL server/client + utilities needed to run both services
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        postgresql \
        postgresql-contrib \
        gosu \
        curl \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/usr/lib/postgresql/15/bin:${PATH}"

# Persistent locations
RUN mkdir -p \
        /var/lib/postgresql/data \
        /usr/src/redmine/config \
        /usr/src/redmine/files \
        /usr/src/redmine/log \
        /usr/src/redmine/tmp \
        /usr/src/redmine/public/plugin_assets \
    && chown -R postgres:postgres /var/lib/postgresql \
    && chown -R redmine:redmine /usr/src/redmine

COPY docker-entrypoint.sh /usr/local/bin/redmine-all-in-one-entrypoint

RUN chmod +x /usr/local/bin/redmine-all-in-one-entrypoint

EXPOSE 3000

ENTRYPOINT ["redmine-all-in-one-entrypoint"]
CMD ["web"]
