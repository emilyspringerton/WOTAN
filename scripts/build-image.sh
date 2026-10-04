#!/usr/bin/env bash
# build-image.sh [TAG] — Cloud Build the wotan static-site image from git-tracked files.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${1:-$(git -C "$SRC" rev-parse --short HEAD)}"
PROJECT="${PROJECT:-project-d24a71e9-2daf-4b2d-917}"
CTX="$(mktemp -d)"; trap 'rm -rf "$CTX"' EXIT
mkdir -p "$CTX/site"
git -C "$SRC" ls-files -z -- . ':(exclude)ops' ':(exclude)scripts' ':(exclude)*.md' | (cd "$SRC" && xargs -0 -r tar cf - 2>/dev/null) | tar xf - -C "$CTX/site"
cp "$SRC/ops/docker/wotan.Dockerfile" "$CTX/Dockerfile"
gcloud builds submit "$CTX" --project "$PROJECT" --tag "us-central1-docker.pkg.dev/$PROJECT/emily/wotan:$TAG"
echo "wotan:$TAG"
