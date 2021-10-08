#!/bin/sh
# (Re-)generate all deploy keys on https://github.com/cockpit-project/cockpit/settings/environments

set -eux

ORG=cockpit-project
THIS=cockpit

[ -e bots ] || make bots

# for workflows pushing to our own repo: npm-update.yml and weblate-sync-po.yml
bots/github-upload-secrets --receiver "${ORG}/${THIS}" --env self --ssh-keygen DEPLOY_KEY --deploy-to "${ORG}/${THIS}"

# for weblate-sync-pot.yml: push to https://github.com/cockpit-project/cockpit-weblate/settings/keys
bots/github-upload-secrets --receiver "${ORG}/${THIS}" --env "${THIS}-weblate" --ssh-keygen DEPLOY_KEY --deploy-to "${ORG}/${THIS}-weblate"

# for webpack-jumpstart.yml/prune-dist.yml: push to https://github.com/cockpit-project/cockpit-dist/settings/keys
bots/github-upload-secrets --receiver "${ORG}/${THIS}" --env "${THIS}-dist" --ssh-keygen DEPLOY_KEY --deploy-to "${ORG}/${THIS}-dist"

# for npm-install.yml/release.yml pushing to https://github.com/cockpit-project/node-cache/settings/keys
bots/github-upload-secrets --receiver "${ORG}/${THIS}" --env node-cache --ssh-keygen DEPLOY_KEY --deploy-to "${ORG}/${THIS}-dist"
