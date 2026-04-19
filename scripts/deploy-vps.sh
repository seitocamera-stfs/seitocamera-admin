#!/bin/bash
# ===========================================
# SeitoCamera Admin — Desplegament al VPS
# ===========================================
# Ús: ssh root@213.210.20.138 'bash -s' < scripts/deploy-vps.sh
#
# O copiar al servidor i executar:
#   scp -r . root@213.210.20.138:/opt/seitocamera/
#   ssh root@213.210.20.138
#   cd /opt/seitocamera && bash scripts/deploy-vps.sh
#
# IMPORTANT: Abans d'executar:
#   1. Configurar DNS: admin.seito.camera → 213.210.20.138
#   2. Crear .env a l'arrel amb les variables de producció
# ===========================================

set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
section() { echo -e "\n${BLUE}=== $1 ===${NC}"; }

DOMAIN="admin.seito.camera"
APP_DIR="/opt/seitocamera"
EMAIL="${CERTBOT_EMAIL:-seitocamera@gmail.com}"

# ===========================================
# 0. Verificacions prèvies
# ===========================================
section "Verificacions prèvies"

if [ "$(id -u)" -ne 0 ]; then
    error "Aquest script s'ha d'executar com a root (o amb sudo)"
fi

if [ ! -f "$APP_DIR/.env" ]; then
    error "Falta l'arxiu .env! Copia .env.production.example a .env i configura tots els valors"
fi

log "Verificacions OK"

# ===========================================
# 1. Actualitzar sistema i instal·lar dependències
# ===========================================
section "Actualitzant sistema"

apt-get update -y
apt-get upgrade -y
apt-get install -y \
    curl \
    git \
    ufw \
    fail2ban \
    unattended-upgrades \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release

log "Sistema actualitzat"

# ===========================================
# 2. Instal·lar Docker (si no està instal·lat)
# ===========================================
section "Docker"

if ! command -v docker &> /dev/null; then
    log "Instal·lant Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    log "Docker instal·lat"
else
    log "Docker ja instal·lat: $(docker --version)"
fi

if ! command -v docker compose &> /dev/null; then
    # Docker Compose V2 ve amb Docker, però per si de cas
    apt-get install -y docker-compose-plugin 2>/dev/null || true
fi

log "Docker Compose: $(docker compose version)"

# ===========================================
# 3. Configurar Firewall (UFW)
# ===========================================
section "Firewall (UFW)"

ufw default deny incoming
ufw default allow outgoing

# SSH (important: fer-ho ABANS d'activar UFW!)
ufw allow 22/tcp comment 'SSH'

# HTTP i HTTPS
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# Activar UFW (--force per no demanar confirmació)
ufw --force enable

log "Firewall configurat:"
ufw status verbose

# ===========================================
# 4. Configurar Fail2Ban (anti brute-force SSH)
# ===========================================
section "Fail2Ban"

cat > /etc/fail2ban/jail.local << 'JAIL'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 7200
JAIL

systemctl enable fail2ban
systemctl restart fail2ban

log "Fail2Ban configurat (3 intents SSH = ban 2h)"

# ===========================================
# 5. Crear directoris necessaris
# ===========================================
section "Directoris"

mkdir -p "$APP_DIR/backups/daily"
mkdir -p "$APP_DIR/backups/weekly"
mkdir -p "$APP_DIR/certbot/conf"
mkdir -p "$APP_DIR/certbot/www"

log "Directoris creats"

# ===========================================
# 6. Obtenir certificat SSL (Let's Encrypt)
# ===========================================
section "Certificat SSL (Let's Encrypt)"

# Verificar que el DNS apunta al servidor
SERVER_IP=$(curl -s ifconfig.me)
DNS_IP=$(dig +short "$DOMAIN" 2>/dev/null || echo "")

if [ "$DNS_IP" != "$SERVER_IP" ]; then
    warn "DNS de $DOMAIN ($DNS_IP) no apunta a aquest servidor ($SERVER_IP)"
    warn "Assegura't que el DNS estigui configurat correctament"
    warn "Continuant igualment... (el certificat pot fallar)"
fi

# Primer, arrencar Nginx temporalment amb HTTP per al challenge
if [ ! -d "$APP_DIR/certbot/conf/live/$DOMAIN" ]; then
    log "Obtenint certificat per primera vegada..."

    # Crear config Nginx temporal (només HTTP per al challenge)
    cat > "$APP_DIR/nginx/nginx.initial.conf" << 'NGINXCONF'
events {
    worker_connections 1024;
}
http {
    server {
        listen 80;
        server_name _;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 200 'SeitoCamera - Esperant certificat SSL...';
            add_header Content-Type text/plain;
        }
    }
}
NGINXCONF

    # Arrencar Nginx temporal
    docker run -d --name nginx-temp \
        -p 80:80 \
        -v "$APP_DIR/nginx/nginx.initial.conf:/etc/nginx/nginx.conf:ro" \
        -v "$APP_DIR/certbot/www:/var/www/certbot:ro" \
        nginx:alpine

    # Obtenir certificat
    docker run --rm \
        -v "$APP_DIR/certbot/conf:/etc/letsencrypt" \
        -v "$APP_DIR/certbot/www:/var/www/certbot" \
        certbot/certbot certonly \
        --webroot \
        --webroot-path /var/www/certbot \
        -d "$DOMAIN" \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        --non-interactive

    # Aturar Nginx temporal
    docker rm -f nginx-temp 2>/dev/null || true
    rm -f "$APP_DIR/nginx/nginx.initial.conf"

    if [ -d "$APP_DIR/certbot/conf/live/$DOMAIN" ]; then
        log "Certificat SSL obtingut correctament!"
    else
        error "No s'ha pogut obtenir el certificat SSL. Verifica el DNS."
    fi
else
    log "Certificat SSL ja existeix"
fi

# ===========================================
# 7. Construir i arrencar l'aplicació
# ===========================================
section "Arrencant aplicació"

cd "$APP_DIR"

# Aturar contenidors anteriors si existeixen
docker compose -f docker-compose.prod.yml down 2>/dev/null || true

# Construir i arrencar
docker compose -f docker-compose.prod.yml up -d --build

log "Esperant que els serveis estiguin llestos..."
sleep 10

# Verificar que tots els contenidors estan running
RUNNING=$(docker compose -f docker-compose.prod.yml ps --format json | grep -c '"running"' || echo "0")
TOTAL=$(docker compose -f docker-compose.prod.yml ps --format json | wc -l)

log "Contenidors actius: $RUNNING / $TOTAL"

# Executar migracions de Prisma
log "Executant migracions de base de dades..."
docker exec seitocamera-backend npx prisma migrate deploy

log "Migracions completades"

# ===========================================
# 8. Configurar Backup automàtic (cron)
# ===========================================
section "Backup automàtic"

# Afegir cron per backup diari a les 3:00
CRON_LINE="0 3 * * * $APP_DIR/scripts/backup.sh >> /var/log/seitocamera-backup.log 2>&1"

# Eliminar entrades anteriors i afegir la nova
(crontab -l 2>/dev/null | grep -v "seitocamera" || true; echo "$CRON_LINE") | crontab -

log "Backup diari configurat a les 03:00"

# ===========================================
# 9. Configurar renovació automàtica SSL
# ===========================================
section "Renovació SSL"

# El contenidor certbot ja fa renovació automàtica cada 12h
# Però necessitem recarregar Nginx després de renovar
RENEW_CRON="0 5 * * * docker exec seitocamera-nginx nginx -s reload >> /var/log/seitocamera-ssl.log 2>&1"
(crontab -l 2>/dev/null; echo "$RENEW_CRON") | sort -u | crontab -

log "Renovació SSL automàtica configurada"

# ===========================================
# 10. Configurar actualitzacions automàtiques de seguretat
# ===========================================
section "Actualitzacions automàtiques"

cat > /etc/apt/apt.conf.d/20auto-upgrades << 'AUTOUPGRADE'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
AUTOUPGRADE

log "Actualitzacions de seguretat automàtiques activades"

# ===========================================
# 11. Verificació final
# ===========================================
section "Verificació final"

echo ""
log "Estat dels contenidors:"
docker compose -f docker-compose.prod.yml ps
echo ""

# Test HTTPS
if curl -sSf "https://$DOMAIN" -o /dev/null 2>/dev/null; then
    log "HTTPS funciona correctament a https://$DOMAIN"
else
    warn "HTTPS no respon encara. Verifica el DNS i els certificats."
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Desplegament completat!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  URL:     https://$DOMAIN"
echo "  Backup:  Diari a les 03:00 ($APP_DIR/backups/)"
echo "  Logs:    docker compose -f docker-compose.prod.yml logs -f"
echo "  Estat:   docker compose -f docker-compose.prod.yml ps"
echo ""
echo "  Comandes útils:"
echo "    Reiniciar:  docker compose -f docker-compose.prod.yml restart"
echo "    Aturar:     docker compose -f docker-compose.prod.yml down"
echo "    Backup:     $APP_DIR/scripts/backup.sh"
echo "    Logs back:  docker logs seitocamera-backend -f"
echo ""
