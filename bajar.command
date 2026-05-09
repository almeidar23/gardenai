#!/bin/bash
cd "$(dirname "$0")"

echo "⬇️  Trayendo última versión de GitHub..."
git pull

echo ""
echo "✅ Listo — ya tenés la versión más actualizada"
echo "Presioná Enter para cerrar"
read
