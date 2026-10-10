#!/bin/sh
# Mirror the source (no node_modules/dist/.git) and a git bundle to the shared folder.
set -e
cd "$(dirname "$0")"
mkdir -p /mnt/project-files/pixel-people-web
rsync -a --delete --exclude node_modules --exclude dist --exclude .git --exclude capturas ./ /mnt/project-files/pixel-people-web/
git bundle create /mnt/project-files/pixel-people-web.bundle --all
