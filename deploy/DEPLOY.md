# Ursus Insight — Деплой с доступом через интернет

## 1. Требования
- VPS/VM с публичным IP (или проброс портов на роутере)
- Ubuntu 22.04+ / Debian 12+ / Fedora 40+
- Python 3.10+, nginx, certbot

## 2. Копирование файлов
```bash
sudo mkdir -p /opt/ursus
sudo cp -r * /opt/ursus/
sudo chown -R www-data:www-data /opt/ursus
```

## 3. Зависимости Python
```bash
sudo pip3 install flask flask-cors matplotlib pandas numpy psutil requests
```

## 4. Смена паролей (ОБЯЗАТЕЛЬНО!)
Откройте `deploy/ursus.service` и замените:
```
URSUS_USER=admin                 ← логин для веб-интерфейса
URSUS_PASS=your-strong-password  ← пароль для веб-интерфейса
URSUS_AGENT_KEY=...              ← ключ для агентов
URSUS_SECRET=...                 ← секрет Flask-сессий
```

Генерация случайных ключей:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

## 5. Systemd-сервис
```bash
sudo cp deploy/ursus.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ursus
sudo systemctl start ursus
sudo systemctl status ursus
```

## 6. Nginx + HTTPS

### Установка nginx и certbot
```bash
# Ubuntu/Debian
sudo apt install nginx certbot python3-certbot-nginx

# Fedora
sudo dnf install nginx certbot python3-certbot-nginx
```

### Конфиг nginx
```bash
# Отредактируйте домен в конфиге:
nano deploy/nginx_ursus.conf
# Замените оба вхождения "your-domain.com" на свой домен

sudo cp deploy/nginx_ursus.conf /etc/nginx/sites-available/ursus
sudo ln -s /etc/nginx/sites-available/ursus /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Убедитесь что файл `/etc/nginx/proxy_params` существует:
```bash
# Если нет — создайте:
sudo bash -c 'cat > /etc/nginx/proxy_params << EOF
proxy_set_header Host $http_host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_connect_timeout 60s;
proxy_read_timeout 60s;
EOF'
```

### Получение SSL-сертификата
```bash
sudo certbot --nginx -d your-domain.com
# certbot автоматически обновит конфиг nginx
# Автообновление сертификата уже настроено через systemd/cron
```

## 7. Файрвол
```bash
# Ubuntu (ufw)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 8080/tcp   # Flask не должен быть доступен напрямую
sudo ufw enable

# Fedora (firewalld)
sudo firewall-cmd --add-service=http --permanent
sudo firewall-cmd --add-service=https --permanent
sudo firewall-cmd --remove-port=8080/tcp --permanent
sudo firewall-cmd --reload
```

## 8. Если нет домена (только IP)

Используйте самоподписанный сертификат:
```bash
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/ursus.key \
  -out /etc/ssl/certs/ursus.crt \
  -subj "/CN=ursus-siem"
```

В `nginx_ursus.conf` замените строки ssl_certificate на:
```
ssl_certificate     /etc/ssl/certs/ursus.crt;
ssl_certificate_key /etc/ssl/private/ursus.key;
```
И удалите блок `server { listen 80 ...}` (или настройте без редиректа).

## 9. Проверка
```bash
# Сервис запущен?
sudo systemctl status ursus

# Логи SIEM:
sudo journalctl -u ursus -f

# Nginx работает?
curl -I https://your-domain.com
```

## Итоговая архитектура
```
Интернет → :443 (nginx, HTTPS, rate-limit) → :8080 (Flask, localhost only)
Агенты   → :443/api/agent/ingest (X-Agent-Key header)
Syslog   → :514/:1514 UDP (напрямую, не через nginx)
```
