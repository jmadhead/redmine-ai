#!/bin/bash

podman run -d \
    --name redmine-ai \
    -p 3000:3000 \
    -e POSTGRES_USER=redmine \
    -e POSTGRES_PASSWORD='verySecretPassword' \
    -e POSTGRES_DB=redmine \
    -e SECRET_KEY_BASE='secret key' \
    -v redmine-pgdata:/var/lib/postgresql/data \
    -v "$(pwd)/redmine/files:/usr/src/redmine/files" \
    -v "$(pwd)/redmine/log:/usr/src/redmine/log" \
    -v "$(pwd)/redmine/tmp:/usr/src/redmine/tmp" \
    -v "$(pwd)/redmine/plugin_assets:/usr/src/redmine/public/plugin_assets" \
    -v "$(pwd)/redmine/themes:/usr/src/redmine/themes" \
    local-redmine-ai
