#!/bin/sh -x

# (Re-)generate all deploy keys on
#   https://github.com/cockpit-project/cockpit/settings/environments
#
# You might want this first:
#   dnf install python3-pynacl
#
# Helpful command to check/update the lists below:
#   git grep -l 'environment: cockpit-dist' (or whatever)

set -eu
cd "$(realpath -m "$0"/../..)"

ORG=cockpit-project
THIS=cockpit

DRY_RUN="-v"
if test -n "${1:-}"; then
    if test "$1" = "--dry-run" -o "$1" = "-n"; then
        DRY_RUN="-n"
    else
        echo "Unrecognised argument"
        exit 1
    fi
fi

deploy_env() {
    ENVIRONMENT="$1"
    if [ -n "${2:-}" ]; then
        DEPLOY_TO="${ORG}/$2"
    else
        DEPLOY_TO="${ORG}/${ENVIRONMENT}"
    fi

    bots/github-upload-secrets $DRY_RUN \
        --receiver "${ORG}/${THIS}" \
        --env "${ENVIRONMENT}" \
        --ssh-keygen DEPLOY_KEY \
        --deploy-to "${DEPLOY_TO}"
}


[ -e bots ] || tools/make-bots

# https://github.com/cockpit-project/cockpit
#   - npm-update.yml
#   - weblate-sync-po.yml
deploy_env self cockpit

# https://github.com/cockpit-project/cockpit-weblate
#   - weblate-sync-pot.yml
deploy_env "${THIS}-weblate"

# https://github.com/cockpit-project/cockpit-dist
#   - prune-dist.yml
#   - webpack-jumpstart.yml
deploy_env "${THIS}-dist"

# https://github.com/cockpit-project/node-cache
#   - npm-install.yml
#   - release.yml
deploy_env node-cache
