#!/usr/bin/env bash
# Diagnóstico SOLO LECTURA del 403 HTML que el VPS recibe de Wisphub.
#
# No modifica código, ni contenedores, ni base de datos.
# No crea solicitudes en Wisphub: todos los POST van SIN archivos y Wisphub
# los rechaza con 400 (no persiste nada).
#
# Uso (desde cualquier carpeta):
#   bash scripts/vps-diagnose.sh
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

echo "############ 0) Entorno ############"
echo "directorio       = $ROOT"
if [ ! -f ./.env ]; then
  echo "ERROR: no existe $ROOT/.env"; exit 1
fi
set -a; . ./.env; set +a
WISPHUB_API_URL="${WISPHUB_API_URL:-}"
WISPHUB_API_KEY="${WISPHUB_API_KEY:-}"

echo "WISPHUB_API_URL  = ${WISPHUB_API_URL:-<vacío>}"
echo "KEY len          = ${#WISPHUB_API_KEY}"
echo "KEY huella       = $(printf '%s' "${WISPHUB_API_KEY:-}" | sha256sum | cut -c1-12)"
echo "KEY primeros 4   = ${WISPHUB_API_KEY:0:4}"
# Compara la huella con la de la key que funcionó localmente (...j2S).

if [ -z "${WISPHUB_API_URL:-}" ] || [ -z "${WISPHUB_API_KEY:-}" ]; then
  echo "ERROR: faltan WISPHUB_API_URL o WISPHUB_API_KEY en .env"; exit 1
fi

echo
echo "############ 1) DNS de api.wisphub.co (A / AAAA) ############"
getent ahosts api.wisphub.co 2>/dev/null | awk '{print $1}' | sort -u

echo
echo "############ 2) IP de egreso del VPS ############"
echo "--- IPv4 ---"
curl -4 -s --max-time 10 https://ifconfig.co/json 2>/dev/null | grep -E '"(ip|country|asn|asn_org)"'
echo "--- IPv6 ---"
curl -6 -s --max-time 10 https://ifconfig.co/json 2>/dev/null | grep -E '"(ip|country|asn|asn_org)"' \
  || echo "sin IPv6 de egreso"

post() { # $1=etiqueta, resto=flags curl
  local label="$1"; shift
  local hdr="/tmp/wh_${label}.h" body="/tmp/wh_${label}.b"
  local out
  out=$(curl "$@" -s -D "$hdr" -o "$body" \
        -w 'HTTP=%{http_code} CT=%{content_type} ip=%{remote_ip}' \
        --max-time 40 -X POST "$WISPHUB_API_URL" \
        -H "Authorization: Api-Key ${WISPHUB_API_KEY}" \
        -H "Accept: application/json" \
        -F firstname=Diag -F lastname=Test 2>&1)
  echo "[$label] $out"
  grep -iE '^(server|cf-ray|cf-mitigated|content-type):' "$hdr" 2>/dev/null \
    | tr -d '\r' | sed 's/^/    /'
  echo "    body: $(head -c 300 "$body" 2>/dev/null | tr '\n' ' ')"
}

echo
echo "############ 3) POST mínimo IPv4 — UA tipo node (curl) ############"
post ipv4_node -4

echo
echo "############ 4) POST mínimo IPv4 — UA de navegador + Origin ############"
post ipv4_browser -4 \
  -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36' \
  -H 'Origin: https://ayrnetworxv.ve' \
  -H 'Referer: https://ayrnetworxv.ve/' \
  -H 'Accept-Language: es-VE,es;q=0.9,en;q=0.8'

echo
echo "############ 5) POST mínimo IPv6 ############"
post ipv6_node -6 || echo "  (IPv6 no disponible)"

echo
echo "############ 6) Ruta REAL del código (fetch/undici en el contenedor) ############"
if docker compose ps --status running --format '{{.Service}}' 2>/dev/null | grep -qx api; then
  docker compose exec -T api node -e '
const url = process.env.WISPHUB_API_URL;
const key = process.env.WISPHUB_API_KEY || "";
console.log("  url:", url, "| keylen:", key.length);
const f = new FormData();
f.set("firstname","Diag"); f.set("lastname","Test");
fetch(url, { method:"POST", headers:{ Authorization:`Api-Key ${key}`, Accept:"application/json" }, body:f })
  .then(async r => {
    const t = await r.text();
    console.log("  status:", r.status,
      "| ct:", r.headers.get("content-type"),
      "| cf-ray:", r.headers.get("cf-ray"),
      "| cf-mitigated:", r.headers.get("cf-mitigated"));
    console.log("  body:", t.slice(0, 400).replace(/\n/g," "));
  })
  .catch(e => console.error("  ERR:", e && e.message));
'
else
  echo "  (el servicio 'api' no está corriendo; se omite esta prueba)"
fi

echo
echo "############ 7) Log del último fallo real (body + headers) ############"
docker compose logs api --since 48h 2>/dev/null \
  | grep -B2 -A6 'Wisphub devolvió un error' | tail -60 \
  || echo "  (sin entradas)"

echo
echo "############ RESUMEN PARA PEGAR EN EL CHAT ############"
echo "key huella: $(printf '%s' "${WISPHUB_API_KEY:-}" | sha256sum | cut -c1-12)"
for l in ipv4_node ipv4_browser ipv6_node; do
  if [ -f "/tmp/wh_${l}.h" ]; then
    echo "$l -> $(head -c 220 "/tmp/wh_${l}.b" 2>/dev/null | tr '\n' ' ')"
  fi
done
echo "############ FIN ############"
