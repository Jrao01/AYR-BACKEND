#!/usr/bin/env bash
# Matriz de pruebas GET/POST contra la API de Wisphub (SOLO LECTURA).
#
# Sirve para distinguir:
#   - bloqueo de IP/ASN/geo  -> TODAS las rutas dan 403 HTML
#   - regla por método/ruta  -> GET da JSON y POST da 403 HTML
#
# No crea solicitudes: el POST va sin archivos y Wisphub lo rechaza con 400.
#
# Uso (en el HOST del VPS, desde la carpeta del backend):
#   bash scripts/vps-wisphub-matrix.sh
#
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

if [ ! -f ./.env ] || ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: ejecuta este script en el HOST del VPS, no dentro del contenedor."
  exit 1
fi

set -a; . ./.env; set +a
WISPHUB_API_URL="${WISPHUB_API_URL:-}"
WISPHUB_API_KEY="${WISPHUB_API_KEY:-}"

BASE=$(printf '%s' "$WISPHUB_API_URL" | sed -E 's#(https?://[^/]+).*#\1#')
echo "API base : $BASE"
echo "key len  : ${#WISPHUB_API_KEY}"
echo "key hash : $(printf '%s' "$WISPHUB_API_KEY" | sha256sum | cut -c1-12)"
echo

probe() { # $1=metodo $2=url ; resto = args extra
  local method="$1" url="$2"; shift 2
  local hdr body out
  hdr=$(mktemp); body=$(mktemp)
  out=$(curl -4 -s -D "$hdr" -o "$body" \
        -w 'HTTP=%{http_code} CT=%{content_type} ip=%{remote_ip}' \
        --max-time 30 -X "$method" "$url" \
        -H "Authorization: Api-Key ${WISPHUB_API_KEY}" \
        -H "Accept: application/json" "$@" 2>&1)
  echo "[$method] $url"
  echo "   $out"
  echo "   $(grep -iE '^(server|cf-ray|cf-mitigated|content-type):' "$hdr" 2>/dev/null | tr -d '\r' | tr '\n' ' ')"
  local first
  first=$(head -c 200 "$body" 2>/dev/null | tr '\n' ' ')
  case "$first" in
    '<'*) echo "   body(HTML): $first" ;;
    '{'*) echo "   body(JSON): $first" ;;
    *)    echo "   body: $first" ;;
  esac
  echo
  rm -f "$hdr" "$body"
}

echo "===== A) Conectividad general (control) ====="
curl -4 -s -o /dev/null -w "www.cloudflare.com -> HTTP=%{http_code}\n" --max-time 15 "https://www.cloudflare.com/"
curl -4 -s -o /dev/null -w "ifconfig.co        -> HTTP=%{http_code}\n" --max-time 15 "https://ifconfig.co/json"
echo

echo "===== B) Rutas de Wisphub ====="
probe GET  "$BASE/"
probe GET  "$BASE/api/solicitar-instalacion/"
probe GET  "$BASE/api/instalaciones/?estado_instalacion=1&estado_instalacion=2&estado_instalacion=3&estado_instalacion=4&estado_instalacion=7"
probe POST "$WISPHUB_API_URL" -F firstname=Diag -F lastname=Test

echo "===== RESUMEN ====="
echo "Si TODAS las rutas de Wisphub dan 403 HTML -> bloqueo de IP/ASN/geo."
echo "Si GET da JSON y solo POST da 403 HTML    -> regla por método/ruta."
