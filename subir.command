#!/bin/bash
cd "$(dirname "$0")"

echo "📦 Preparando cambios..."
git add .

echo "💬 Descripción del cambio (Enter para usar fecha/hora):"
read MSG
if [ -z "$MSG" ]; then
  MSG="Actualización $(date '+%d/%m/%Y %H:%M')"
fi

git commit -m "$MSG"
git push

echo ""
echo "✅ Listo — Bluehost se actualiza en ~1 minuto"
echo "Presioná Enter para cerrar"
read
