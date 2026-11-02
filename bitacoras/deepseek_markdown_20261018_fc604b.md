# Bitácora: Resolución de errores ACME y 502 en Dokploy + Traefik + Cloudflare

**Fecha:** 2026-10-16
**Servidor:** VPS `vmi3669480` (IP pública `185.239.208.219`)
**Dominio:** `ayrnetworxv.ve`
**Stack:** Dokploy v0.30.8 · Traefik v3.6.25 · Docker Swarm · Cloudflare (proxy naranja)

---

## 1. Resumen ejecutivo

Se presentaron tres errores en cascada que resultaron ser **síntomas del mismo problema de raíz**:

1. **Error ACME de Let's Encrypt:** `NXDOMAIN` al validar `ayrnetworxv.ve`.
2. **Error 521 de Cloudflare:** "Web Server Is Down".
3. **Error 502 de Cloudflare:** "Bad Gateway".

**Causa raíz final:** El contenedor de Traefik de Dokploy **no publicaba los puertos 80/443 al host**. El `docker-proxy` no bindeaba, así que nada escuchaba en esos puertos. Todo lo demás (ACME, 521, 502) era consecuencia de eso.

**Solución:** Recrear el contenedor de Traefik con los puertos publicados correctamente. Ajustes adicionales en Dokploy (Container Port) y en Cloudflare (SSL mode / Origin Certificate).

---

## 2. Arquitectura del stack

```
Usuario
   │
   ▼
Cloudflare (proxy naranja, SSL público)
   │  HTTPS
   ▼
Traefik (VPS 185.239.208.219, puertos 80/443)
   │  HTTP interno (red dokploy-network)
   ▼
App ayr-network-xv-ca-frontend-ayr-qzd7eb (contenedor, puerto 80)
```

Componentes relevantes:

| Componente | Detalle |
|---|---|
| VPS | `vmi3669480`, IP `185.239.208.219` |
| Orquestador | Docker Swarm |
| Panel | Dokploy v0.30.8, expuesto en `:3000` |
| Reverse proxy | Traefik v3.6.25, contenedor `dokploy-traefik` (standalone, no Swarm) |
| Red interna | `dokploy-network` (overlay, swarm) |
| DNS | Cloudflare, nameservers `aron.ns.cloudflare.com` y `camilo.ns.cloudflare.com` |
| Registrar | NIC.VE (Venezuela), delegación a Cloudflare |
| App | `ayr-network-xv-ca-frontend-ayr-qzd7eb:latest`, escucha en `80/tcp` |
| Certificado origen | Cloudflare Origin Certificate (`*.ayrnetworxv.ve`, válido hasta 2041) |

---

## 3. Cronología del incidente

| Hora | Evento |
|---|---|
| T-2h | Dominio registrado en NIC.VE, nameservers de Cloudflare configurados |
| T-1h | Zona `ayrnetworxv.ve` creada en Cloudflare, registros A creados (proxied) |
| T | Primer error ACME: `NXDOMAIN` en logs de Traefik |
| T+30m | Verificación DNS: NS ya propagados, A resuelve a IPs de Cloudflare (`104.21.x`, `172.67.x`) |
| T+1h | Error 521 de Cloudflare al intentar acceder al dominio |
| T+1h15m | Diagnóstico: `ss -tlnp` no muestra nada en 80/443 |
| T+1h20m | Diagnóstico: `docker port dokploy-traefik` devuelve vacío |
| T+1h30m | Descubrimiento: Traefik NO es servicio Swarm, es contenedor standalone |
| T+1h45m | Recreación del contenedor con puertos publicados |
| T+2h | Traefik responde en 80 (404 default) y 443 (TLS con cert default) |
| T+2h15m | Ajustes en Dokploy: HTTPS ON, Container Port 80, Certificate Provider None |
| T+2h30m | Verificación final pendiente |

---

## 4. Errores observados y su explicación

### 4.1 Error ACME (Let's Encrypt)

```
ERR Unable to obtain ACME certificate for domains
error="unable to generate a certificate for the domains [ayrnetworxv.ve]:
resolver: one or more domains had a problem: [ayrnetworxv.ve: invalid authorization:
acme: error: 400 :: urn:ietf:params:acme:error:dns ::
DNS problem: NXDOMAIN looking up A for ayrnetworxv.ve -
check that a DNS record exists for this domain;
DNS problem: NXDOMAIN looking up AAAA for ayrnetworxv.ve -
check that a DNS record exists for this domain]"
```

**Significado:** Let's Encrypt intentó resolver el DNS de `ayrnetworxv.ve` y obtuvo `NXDOMAIN` (el nombre no existe en DNS).

**Causas posibles:**
- Dominio mal escrito (typo).
- Dominio no registrado.
- Registros A/AAAA no publicados.
- Nameservers incorrectos a nivel de registrador.
- Propagación DNS en curso.

**En este caso:** el error fue **temporal**. La delegación NIC.VE → Cloudflare tardó ~2h en propagar. Una vez propagada, el `dig` desde resolvers públicos empezó a devolver IPs.

---

### 4.2 Error 521 de Cloudflare

**Significado:** Cloudflare no puede establecer conexión TCP con el servidor de origen.

**Causas posibles:**
- Puerto 80/443 cerrado en el origen.
- Firewall bloqueando IPs de Cloudflare.
- La IP en el registro A no corresponde al servidor.
- Servicio web no está corriendo o no escucha.

**En este caso:** el contenedor de Traefik corría pero **no publicaba los puertos** al host, así que no había nada escuchando en 80/443.

---

### 4.3 Error 502 de Cloudflare

**Significado:** Cloudflare conectó con el origen (Traefik), pero Traefik no pudo conectar con el backend (la app).

**Causas posibles:**
- Puerto incorrecto configurado en Dokploy (Container Port ≠ puerto interno real).
- La app no está corriendo.
- Traefik no está en la misma red que la app.
- El router de Traefik no matchea (Host incorrecto, entrypoint incorrecto).
- Certificado TLS inválido cuando Cloudflare está en Full (strict).

**En este caso:** se combinaron dos sub-causas:
1. **Container Port mal configurado:** Dokploy tenía `3001`, la app escucha en `80`.
2. **Certificate Provider mal configurado:** Dokploy tenía `None` sin cert asociado, Traefik servía su cert autofirmado (`TRAEFIK DEFAULT CERT`), y Cloudflare en Full (strict) lo rechazaba.

---

## 5. Diagnóstico: comandos y su interpretación

### 5.1 Verificar propagación DNS

```bash
dig +short ayrnetworxv.ve NS @1.1.1.1
dig +short ayrnetworxv.ve A @1.1.1.1
dig +short ayrnetworxv.ve A @aron.ns.cloudflare.com
```

| Resultado | Interpretación |
|---|---|
| Sin NS | Delegación no propagada aún |
| NS de Cloudflare pero sin A | Zona activa, falta registro A |
| A devuelve IPs de Cloudflare (`104.21.x`, `172.67.x`) | Proxy naranja activado |
| A devuelve la IP del VPS | DNS only (gris) |
| NXDOMAIN | El nombre no existe en DNS |

**En este caso:**
- NS: ✅ propagados a 1.1.1.1 y 8.8.8.8
- A: `172.67.188.148`, `104.21.19.194` → IPs de Cloudflare (proxied)
- AAAA: `2606:4700:3037::...` → IPv6 de Cloudflare

---

### 5.2 Verificar puertos publicados del contenedor

```bash
docker port dokploy-traefik
docker inspect dokploy-traefik --format '{{json .NetworkSettings.Ports}}' | jq
docker inspect dokploy-traefik --format '{{json .HostConfig.PortBindings}}' | jq
```

| Salida | Interpretación |
|---|---|
| `{}` en `NetworkSettings.Ports` pero `PortBindings` poblado | El mapeo está declarado pero el `docker-proxy` no bindea |
| `{}` en ambos | El contenedor no publica puertos |
| `80/tcp -> 0.0.0.0:80` | Correcto |

**En este caso:**
- `PortBindings` = `{80/tcp, 443/tcp, 443/udp}` ✅
- `NetworkSettings.Ports` = `{}` ❌
- `docker port` = vacío ❌

Esto es **firma de `docker-proxy` no bindeando**, no de puertos no declarados.

---

### 5.3 Verificar qué escucha en el host

```bash
sudo ss -tlnp | grep -E ':80|:443'
```

| Salida | Interpretación |
|---|---|
| Sin salida | Nada escucha en 80/443 |
| `LISTEN 0.0.0.0:80 docker-proxy` | Correcto |

**En este caso:** sin salida → nada escuchando. Confirmación del problema.

---

### 5.4 Verificar tipo de contenedor (Swarm vs standalone)

```bash
docker service ls
docker ps | grep traefik
```

| Observación | Interpretación |
|---|---|
| Contenedor con sufijo `.1.<hash>` | Es una tarea de Swarm |
| Contenedor con nombre limpio | Es standalone |

**En este caso:**
- `docker service ls` → **NO aparecía Traefik**, solo `dokploy`, `dokploy-postgres`, `ayr-network...`, `hello-world...`
- `docker ps` → `dokploy-traefik` con nombre limpio

**Conclusión:** Traefik es un **contenedor standalone** gestionado por Dokploy, no un servicio Swarm. Por eso `docker service update` no aplicaba.

---

### 5.5 Verificar cert servido por Traefik

```bash
openssl s_client -connect 127.0.0.1:443 -servername ayrnetworxv.ve </dev/null 2>/dev/null | \
  openssl x509 -noout -subject -issuer -dates
```

| Salida | Interpretación |
|---|---|
| `issuer=CloudFlare Origin SSL Certificate Authority` | Cert correcto |
| `subject=CN=TRAEFIK DEFAULT CERT` | Traefik sirve cert autofirmado (mal para Cloudflare strict) |

---

### 5.6 Verificar puerto interno real de la app

```bash
# Opción 1: puertos expuestos
docker inspect <contenedor> --format '{{json .Config.ExposedPorts}}' | jq

# Opción 2: probar varios puertos desde la red
for PORT in 80 3000 3001 8080 8000; do
  echo "=== Puerto $PORT ==="
  docker run --rm --network dokploy-network curlimages/curl \
    -s -o /dev/null -w "HTTP %{http_code}\n" --max-time 4 \
    http://<nombre-servicio>:$PORT/
done
```

| Resultado | Interpretación |
|---|---|
| `HTTP 200/301/302/404` con tiempo bajo | Puerto correcto |
| `HTTP 000` con timeout | Nada escuchando en ese puerto |

**En este caso:** el contenedor mostraba `80/tcp` en su columna PORTS → puerto interno = **80**, no 3001.

---

## 6. Solución aplicada

### 6.1 Diagnóstico inicial del contenedor

```bash
# Capturar toda la config del contenedor antes de tocar nada
mkdir -p /root/traefik-fix
docker inspect dokploy-traefik > /root/traefik-fix/traefik-inspect-$(date +%s).json

# Ver red, entrypoint, cmd, mounts, restart policy
docker inspect dokploy-traefik --format '{{json .HostConfig.PortBindings}}' | jq
docker inspect dokploy-traefik --format '{{json .NetworkSettings.Ports}}' | jq
docker inspect dokploy-traefik --format '{{json .HostConfig.NetworkMode}}' | jq
docker inspect dokploy-traefik --format '{{json .Config.Cmd}}' | jq
docker inspect dokploy-traefik --format '{{json .Config.Entrypoint}}' | jq
docker inspect dokploy-traefik --format '{{json .Mounts}}' | jq
docker inspect dokploy-traefik --format '{{json .Config.Env}}' | jq
docker inspect dokploy-traefik --format '{{json .HostConfig.RestartPolicy}}' | jq
```

**Resultado de la inspección:**

```json
// PortBindings
{
  "443/tcp": [{"HostIp": "", "HostPort": "443"}],
  "443/udp": [{"HostIp": "", "HostPort": "443"}],
  "80/tcp":  [{"HostIp": "", "HostPort": "80"}]
}
// NetworkSettings.Ports
{}
// NetworkMode
"dokploy-network"
// Entrypoint
["/entrypoint.sh"]
// Cmd
["traefik"]
// RestartPolicy
{"Name": "always", "MaximumRetryCount": 0}
// Mounts
[
  {Source: "/etc/dokploy/traefik/traefik.yml",    Destination: "/etc/traefik/traefik.yml"},
  {Source: "/var/run/docker.sock",                Destination: "/var/run/docker.sock", ro: true},
  {Source: "/etc/dokploy/traefik/dynamic",        Destination: "/etc/dokploy/traefik/dynamic"}
]
```

### 6.2 Recrear el contenedor con puertos publicados

```bash
# 1. Detener y eliminar el contenedor actual (NO borra config en disco)
docker stop dokploy-traefik
docker rm dokploy-traefik

# 2. Recrear con la misma config + puertos
docker run -d \
  --name dokploy-traefik \
  --restart always \
  --network dokploy-network \
  -p 80:80 \
  -p 443:443 \
  -p 443:443/udp \
  -v /etc/dokploy/traefik/traefik.yml:/etc/traefik/traefik.yml \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /etc/dokploy/traefik/dynamic:/etc/dokploy/traefik/dynamic \
  traefik:v3.6.25

# 3. Verificar
sleep 5
docker ps | grep traefik
docker port dokploy-traefik
sudo ss -tlnp | grep -E ':80|:443'
```

**Resultado esperado:**

```
docker port:
  80/tcp   -> 0.0.0.0:80
  80/tcp   -> [::]:80
  443/tcp  -> 0.0.0.0:443
  443/tcp  -> [::]:443
  443/udp  -> 0.0.0.0:443

ss -tlnp:
  LISTEN 0.0.0.0:80   docker-proxy
  LISTEN 0.0.0.0:443  docker-proxy
```

**En este caso:** ✅ Los puertos ya aparecen, `docker-proxy` está corriendo.

### 6.3 Guardar script de recreación para el futuro

Por si Dokploy vuelve a recrear Traefik sin puertos:

```bash
cat > /root/traefik-fix/recreate-traefik.sh << 'EOF'
#!/bin/bash
# Recrear Traefik de Dokploy con puertos publicados
docker stop dokploy-traefik 2>/dev/null
docker rm dokploy-traefik 2>/dev/null
docker run -d \
  --name dokploy-traefik \
  --restart always \
  --network dokploy-network \
  -p 80:80 \
  -p 443:443 \
  -p 443:443/udp \
  -v /etc/dokploy/traefik/traefik.yml:/etc/traefik/traefik.yml \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /etc/dokploy/traefik/dynamic:/etc/dokploy/traefik/dynamic \
  traefik:v3.6.25
docker port dokploy-traefik
EOF
chmod +x /root/traefik-fix/recreate-traefik.sh
```

### 6.4 Ajustes en Dokploy (sección Domains)

En Dokploy → app `ayr-network-xv-ca-frontend-ayr-qzd7eb` → **Domains** → editar `ayrnetworxv.ve`:

| Campo | Valor anterior | Valor corregido |
|---|---|---|
| Host | `ayrnetworxv.ve` | `ayrnetworxv.ve` |
| Path | `/` | `/` |
| Internal Path | `/` | `/` |
| Strip Path | OFF | OFF |
| **Container Port** | `3001` | **`80`** |
| Custom Entrypoint | OFF | OFF |
| HTTPS | (varía) | **ON** |
| **Certificate Provider** | `None` sin cert / `Custom` con texto | **`None`** (Traefik matchea por SNI) |
| Middlewares | vacío | vacío |

**Nota crítica:** en el campo **Custom Certificate Resolver** NO va el nombre del certificado. Ese campo es para *cert resolvers* de Traefik (Let's Encrypt, Cloudflare DNS-01). Para usar el Origin Certificate subido a Dokploy, se selecciona **None** y Traefik lo matchea automáticamente por SNI.

### 6.5 Ajustes en Cloudflare

| Configuración | Valor |
|---|---|
| DNS → `ayrnetworxv.ve` A | `185.239.208.219`, **Proxied** (naranja) |
| DNS → `www.ayrnetworxv.ve` A | `185.239.208.219`, **Proxied** (naranja) |
| SSL/TLS → Overview | **Full (strict)** |
| SSL/TLS → Origin Server | Origin Certificate creado para `*.ayrnetworxv.ve` y `ayrnetworxv.ve` |
| Always Use HTTPS | ON (una sola capa de redirect) |

**Advertencia sobre redirect loop:** si Traefik también hace redirect HTTP→HTTPS además de Cloudflare, se produce un bucle. Solo uno de los dos debe redirigir.

---

## 7. Verificación final

### 7.1 Local (desde el VPS)

```bash
# HTTP
curl -sv -H 'Host: ayrnetworxv.ve' http://127.0.0.1:80/ 2>&1 | head -20
# Esperado: 301/302 a HTTPS (redirect de Traefik)

# HTTPS
curl -skv -H 'Host: ayrnetworxv.ve' https://127.0.0.1:443/ 2>&1 | head -30
# Esperado: HTML/JSON de la app
```

### 7.2 Certificado

```bash
openssl s_client -connect 127.0.0.1:443 -servername ayrnetworxv.ve </dev/null 2>/dev/null | \
  openssl x509 -noout -subject -issuer -dates
```

**Esperado:**
```
subject=CN=ayrnetworxv.ve  (o CN=*.ayrnetworxv.ve)
issuer=CloudFlare Origin SSL Certificate Authority
notAfter=... 2041
```

### 7.3 Desde la IP pública

```bash
curl -sv http://185.239.208.219/ 2>&1 | head -20
```

### 7.4 Desde fuera (navegador)

`https://ayrnetworxv.ve`

| Resultado | Significado |
|---|---|
| App con candado ✅ | Todo correcto |
| 502 | Cert inválido o backend inalcanzable |
| 521 | Cloudflare no llega al origen (puertos) |
| 525/526 | TLS inválido entre Cloudflare y origen |
| Redirect loop | Doble redirect HTTP→HTTPS |
| 404 de Traefik | El router no matchea |

---

## 8. Prevención: evitar que Dokploy vuelva a romper Traefik

Dokploy gestiona el contenedor de Traefik. Al hacer redeploy/actualización, puede recrearlo **sin publicar puertos**, reproduciendo el problema. Para prevenirlo:

1. **Panel de Dokploy → Settings → Server** (o Web Server).
2. Buscar opciones tipo:
   - `Use external reverse proxy`
   - `Traefik behind proxy`
   - `Disable Traefik port publishing`
   - `Publish ports`
3. Asegurar que **NO** esté activada la opción de proxy externo (si no lo hay).
4. Tras cualquier redeploy de Traefik, verificar:
   ```bash
   docker port dokploy-traefik
   ```
   Debe seguir mostrando `0.0.0.0:80` y `0.0.0.0:443`.

Si Dokploy insiste en romperlo, usar el script `/root/traefik-fix/recreate-traefik.sh`.

---

## 9. Comandos de diagnóstico rápido (chuleta)

```bash
# DNS
dig +short ayrnetworxv.ve NS @1.1.1.1
dig +short ayrnetworxv.ve A @1.1.1.1
dig +short ayrnetworxv.ve A @aron.ns.cloudflare.com

# Puertos
docker port dokploy-traefik
docker inspect dokploy-traefik --format '{{json .NetworkSettings.Ports}}' | jq
sudo ss -tlnp | grep -E ':80|:443'

# Contenedores y servicios
docker ps
docker service ls
docker service ps ayr-network-xv-ca-frontend-ayr-qzd7eb

# Cert
openssl s_client -connect 127.0.0.1:443 -servername ayrnetworxv.ve </dev/null 2>/dev/null | \
  openssl x509 -noout -subject -issuer -dates

# Logs
docker logs dokploy-traefik --tail 100 2>&1
docker logs dokploy-traefik -f

# Puertos internos de la app
docker inspect <contenedor> --format '{{json .Config.ExposedPorts}}' | jq
for P in 80 3000 3001 8080 8000; do
  echo "=== $P ==="
  docker run --rm --network dokploy-network curlimages/curl \
    -s -o /dev/null -w "HTTP %{http_code}\n" --max-time 4 \
    http://<nombre-servicio>:$P/
done

# Config dinámica de Traefik
ls -la /etc/dokploy/traefik/dynamic/
cat /etc/dokploy/traefik/dynamic/*.yml 2>/dev/null

# Config estática
cat /etc/dokploy/traefik/traefik.yml
```

---

## 10. Lecciones aprendidas

1. **Los errores en cascada suelen tener una única causa raíz.** ACME `NXDOMAIN`, 521 y 502 parecían tres problemas distintos, pero el segundo y el tercero venían del mismo: puertos no publicados.

2. **`NetworkSettings.Ports: {}` con `PortBindings` poblado ≠ "sin puertos".** Es firma de `docker-proxy` que no bindea. Reiniciar Docker a veces lo relanza, pero no siempre; recrear el contenedor es más seguro.

3. **No todos los contenedores son servicios Swarm.** El nombre del contenedor (con o sin sufijo `.1.<hash>`) lo delata. Traefik de Dokploy es standalone; el resto de servicios son Swarm.

4. **En Dokploy, el Container Port es el puerto INTERNO del contenedor**, no el que usabas en localhost. Si mapeaste `8080:3001`, el puerto interno es `3001`, no `8080`.

5. **Cloudflare Full (strict) requiere que el origen sirva un cert válido y confiable.** Si Traefik sirve su default autofirmado, Cloudflare devuelve 502 o 526.

6. **Para usar un Origin Certificate subido a Dokploy, el Certificate Provider debe ser `None`.** El campo "Custom Certificate Resolver" es para resolvers de Traefik, no para certs pegados.

7. **Nunca hagas `docker compose down -v`** sin entender qué volúmenes se borran. Puedes perder la config de Dokploy y todas las apps.

8. **Backup antes de tocar.** Capturar `docker inspect` del contenedor antes de recrearlo permite replicar exactamente la config.

---

## 11. Archivos y rutas relevantes

| Ruta | Contenido |
|---|---|
| `/etc/dokploy/traefik/traefik.yml` | Config estática de Traefik (entrypoints, providers) |
| `/etc/dokploy/traefik/dynamic/` | Config dinámica (routers, services, middlewares) generada por Dokploy |
| `/etc/dokploy/traefik/acme.json` | Certificados ACME (si se usa Let's Encrypt) |
| `/var/run/docker.sock` | Socket de Docker (montado en Traefik para autodescubrimiento) |
| `/root/traefik-fix/` | Backups y script de recreación |
| `/root/traefik-fix/traefik-inspect-<timestamp>.json` | Snapshot de la config del contenedor antes de recrear |
| `/root/traefik-fix/recreate-traefik.sh` | Script para recrear Traefik con puertos publicados |

---

## 12. Anexos

### A. Salida de `docker service ls` al momento del diagnóstico

```
ID             NAME                                    MODE         REPLICAS   IMAGE
wt97ymaia2o1   ayr-network-xv-ca-frontend-ayr-qzd7eb   replicated   1/1        ayr-network-xv-ca-frontend-ayr-qzd7eb:latest
l19nl4lfci7q   dokploy                                 replicated   1/1        dokploy/dokploy:v0.30.8
qcojnouhrq2e   dokploy-postgres                        replicated   1/1        postgres:16
rgrq595ab90q   hello-world-hwhtua-7nt8db               replicated   0/0        nginxdemos/hello:latest
```

**Observación:** Traefik no aparece aquí porque no es un servicio Swarm.

### B. Salida de `docker ps` al momento del diagnóstico

```
CONTAINER ID   IMAGE                                          ...   PORTS                                         NAMES
d68a35a6b1ee   ayr-network-xv-ca-frontend-ayr-qzd7eb:latest   ...   80/tcp                                        ayr-network-xv-ca-frontend-ayr-qzd7eb.1.<hash>
917a620bc3c8   dokploy/dokploy:v0.30.8                        ...   0.0.0.0:3000->3000/tcp                        dokploy.1.<hash>
c7d2c6befcf0   postgres:16                                    ...   5432/tcp                                      dokploy-postgres.1.<hash>
1f88c0549353   traefik:v3.6.25                                ...   (sin puertos)                                 dokploy-traefik
```

**Observación:** `dokploy-traefik` no publica puertos, mientras `dokploy` sí publica `0.0.0.0:3000`.

### C. Configuración del dominio en Dokploy (estado final)

```
Host:                 ayrnetworxv.ve
Path:                 /
Internal Path:        /
Strip Path:           OFF
Container Port:       80
Custom Entrypoint:    OFF
HTTPS:                ON
Certificate Provider: None
Middlewares:          (vacío)
```

### D. Configuración de Cloudflare (estado final)

```
DNS Records:
  ayrnetworxv.ve        A    185.239.208.219    Proxied
  www.ayrnetworxv.ve    A    185.239.208.219    Proxied

SSL/TLS:
  Encryption mode:      Full (strict)
  Always Use HTTPS:     ON
  Automatic HTTPS Rewrites: ON

Origin Server:
  Certificate:          *.ayrnetworxv.ve, ayrnetworxv.ve
  Expires:              Oct 12, 2041
```

---

**Fin de la bitácora.**