#!/usr/bin/env bash
set -euo pipefail

# Deploy femrun platform to GCP Compute Engine
# Prerequisites: gcloud CLI authenticated, project selected

INSTANCE_NAME="${1:-femrun-platform}"
ZONE="${2:-us-central1-a}"
MACHINE_TYPE="${3:-e2-standard-4}"

echo "Creating GCP instance: $INSTANCE_NAME"

gcloud compute instances create "$INSTANCE_NAME" \
  --zone="$ZONE" \
  --machine-type="$MACHINE_TYPE" \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=50GB \
  --tags=http-server,https-server \
  --metadata=startup-script='#!/bin/bash
    apt-get update
    apt-get install -y docker.io docker-compose-plugin
    systemctl enable docker
    systemctl start docker
    usermod -aG docker $USER
  '

echo "Instance created. SSH in and run:"
echo "  git clone <repo-url> femrun && cd femrun"
echo "  cp .env.example .env  # fill in secrets"
echo "  docker compose -f docker/docker-compose.prod.yml up -d"

# Open firewall for HTTP/HTTPS
gcloud compute firewall-rules create allow-femrun-http \
  --allow=tcp:80,tcp:443,tcp:3000 \
  --target-tags=http-server 2>/dev/null || true
