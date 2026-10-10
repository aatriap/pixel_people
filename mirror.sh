#!/bin/sh
# Mirror the source (no node_modules/dist/.git) and a git bundle to the shared folder.
# capturas/ (screenshots) only exists in the mirror, so it is kept.
set -e
cd "$(dirname "$0")"
DEST=/mnt/project-files/pixel-people-web
mkdir -p "$DEST"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude node_modules --exclude dist --exclude .git --exclude capturas ./ "$DEST/"
else
  find "$DEST" -mindepth 1 -maxdepth 1 ! -name capturas -exec rm -rf {} +
  tar --exclude=./node_modules --exclude=./dist --exclude=./.git -cf - . | tar -xf - -C "$DEST"
fi
git bundle create /mnt/project-files/pixel-people-web.bundle --all
