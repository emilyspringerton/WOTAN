#!/usr/bin/env bash
# build-image.sh [TAG] — Cloud Build the wotan static-site image from git-tracked files and push it to
# Artifact Registry. TAG defaults to the short git SHA (what CI passes). The in-cluster
# gitops-autodeploy cron (EMILY/gitops/watch-tags.sh, WOTAN_TAG wotan) notices the newest tag and
# rolls it out through the PARENA-rendered manifests -- nothing else to do after this.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${1:-$(git -C "$SRC" rev-parse --short HEAD)}"
PROJECT="${PROJECT:-project-d24a71e9-2daf-4b2d-917}"
CTX="$(mktemp -d)"; trap 'rm -rf "$CTX"' EXIT
mkdir -p "$CTX/site"
git -C "$SRC" ls-files -z -- . ':(exclude)ops' ':(exclude)scripts' ':(exclude).github' ':(exclude)*.md' | (cd "$SRC" && xargs -0 -r tar cf - 2>/dev/null) | tar xf - -C "$CTX/site"
cp "$SRC/ops/docker/wotan.Dockerfile" "$CTX/Dockerfile"

# CI SA constraints (EMILY/gitops/CI_SETUP.md, found live 2026-10-05): pin the staging dir so gcloud
# does not list buckets project-wide (403), and --async + poll status instead of streaming logs
# (needs a Viewer role the CI SA deliberately lacks).
BUILD_ID=$(gcloud builds submit "$CTX" --project "$PROJECT" \
  --tag "us-central1-docker.pkg.dev/$PROJECT/emily/wotan:$TAG" \
  --gcs-source-staging-dir="gs://${PROJECT}_cloudbuild/source" \
  --async --format="value(id)")

echo "submitted build $BUILD_ID, polling for completion..."
while true; do
  STATUS=$(gcloud builds describe "$BUILD_ID" --project "$PROJECT" --format="value(status)")
  case "$STATUS" in
    SUCCESS) echo "wotan:$TAG"; exit 0 ;;
    FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED) echo "build $BUILD_ID: $STATUS" >&2; exit 1 ;;
    *) sleep 5 ;;
  esac
done
