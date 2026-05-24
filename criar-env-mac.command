#!/bin/bash
cd "$(dirname "$0")"
if [ -f .env ]; then
  echo ".env já existe. Abrindo para edição..."
else
  cp .env.example .env
  echo ".env criado a partir do .env.example."
fi
open -e .env
