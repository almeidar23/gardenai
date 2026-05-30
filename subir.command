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
echo "🚀 Desplegando en servidor..."
curl -s "https://7ire.com/gardenai/deploy.php?token=GardenDeploy2026!" > /dev/null && echo "✅ Listo — app actualizada en 7ire.com/gardenai" || echo "⚠️  Push ok pero deploy manual en: 7ire.com/gardenai/deploy.php?token=GardenDeploy2026!"
echo "Presioná Enter para cerrar"
read
