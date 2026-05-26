# URSUS SIEM — Сценарии инцидентов и SIGMA-правила

> Полная библиотека из **60 сценариев реагирования на инциденты** с привязкой к SIGMA-правилам корреляции.

---

## Структура документации

| Файл | Категория | Правил |
|------|-----------|--------|
| [01_credential_access.md](01_credential_access.md) | Кража учётных данных | 5 |
| [02_brute_force.md](02_brute_force.md) | Перебор паролей | 5 |
| [03_command_and_control.md](03_command_and_control.md) | Управление и контроль (C2) | 5 |
| [04_collection.md](04_collection.md) | Сбор данных | 2 |
| [05_data_exfiltration.md](05_data_exfiltration.md) | Утечка данных | 4 |
| [06_defense_evasion.md](06_defense_evasion.md) | Обход защиты | 4 |
| [07_discovery.md](07_discovery.md) | Разведка в сети | 2 |
| [08_execution.md](08_execution.md) | Выполнение кода | 2 |
| [09_impact.md](09_impact.md) | Воздействие | 3 |
| [10_initial_access.md](10_initial_access.md) | Начальный доступ | 2 |
| [11_lateral_movement.md](11_lateral_movement.md) | Горизонтальное перемещение | 4 |
| [12_malware.md](12_malware.md) | Вредоносное ПО | 6 |
| [13_persistence.md](13_persistence.md) | Закрепление | 5 |
| [14_privilege_escalation.md](14_privilege_escalation.md) | Повышение привилегий | 2 |
| [15_reconnaissance.md](15_reconnaissance.md) | Сетевая разведка | 6 |
| [16_other.md](16_other.md) | Прочие угрозы | 3 |

---

## Все 60 сценариев — Сводная таблица

| № | ID правила | Название сценария | Категория | Критичность | MITRE |
|---|-----------|------------------|-----------|-------------|-------|
| 1 | `auth-kerb-001` | Атака Kerberoasting | Credential Access | HIGH | T1558.003 |
| 2 | `cred-acc-003` | Копирование базы NTDS.dit | Credential Access | CRITICAL | T1003.003 |
| 3 | `cred-acc-001` | Распыление паролей (Password Spray) | Credential Access | HIGH | T1110.003 |
| 4 | `cred-acc-002` | Impacket Secretsdump | Credential Access | CRITICAL | T1003.002 |
| 5 | `cred-mimi-001` | Mimikatz — дамп учётных данных | Credential Access | CRITICAL | T1003 |
| 6 | `bf-ftp-001` | Brute-force атака на FTP | Brute Force | HIGH | T1110.001 |
| 7 | `bf-rdp-001` | Brute-force атака на RDP | Brute Force | HIGH | T1110.001 |
| 8 | `bf-smtp-001` | Brute-force атака на SMTP AUTH | Brute Force | HIGH | T1110.001 |
| 9 | `bf-ssh-001` | Brute-force атака на SSH | Brute Force | HIGH | T1110 |
| 10 | `bf-web-001` | Brute-force / Credential Stuffing на веб-форму | Brute Force | HIGH | T1110.003 |
| 11 | `c2-net-001` | C2 Beaconing — регулярные исходящие соединения | C2 | HIGH | T1071 |
| 12 | `c2-net-003` | CobaltStrike Beacon — сетевые паттерны | C2 | CRITICAL | T1071.001 |
| 13 | `c2-dns-001` | DNS Tunneling — туннелирование через DNS | C2 | HIGH | T1071.004 |
| 14 | `c2-net-002` | Использование сети Tor | C2 | HIGH | T1090 |
| 15 | `hunt-proto-001` | Нестандартные протоколы на внешние хосты | C2 | MEDIUM | T1095 |
| 16 | `collect-data-001` | Доступ к буферу обмена | Collection | MEDIUM | T1115 |
| 17 | `collect-data-002` | Снятие скриншотов | Collection | MEDIUM | T1113 |
| 18 | `exfil-001` | Большая утечка данных через сеть | Exfiltration | HIGH | T1048 |
| 19 | `exfil-net-001` | Загрузка данных в облачные хранилища | Exfiltration | MEDIUM | T1567.002 |
| 20 | `exfil-net-002` | Большой HTTP POST на внешний IP | Exfiltration | HIGH | T1048.003 |
| 21 | `insider-dl-001` | Массовое скачивание файлов (инсайдер) | Exfiltration | MEDIUM | T1213 |
| 22 | `evasion-log-001` | Очистка журналов событий | Defense Evasion | HIGH | T1070.001 |
| 23 | `evasion-av-001` | Отключение антивируса | Defense Evasion | HIGH | T1562.001 |
| 24 | `evasion-proc-001` | Инъекция в процесс (Process Injection) | Defense Evasion | HIGH | T1055 |
| 25 | `evasion-file-001` | Изменение временных меток файлов (Timestomping) | Defense Evasion | MEDIUM | T1070.006 |
| 26 | `disc-acc-001` | Перечисление локальных пользователей | Discovery | LOW | T1087.001 |
| 27 | `disc-net-001` | Перечисление сетевых ресурсов | Discovery | LOW | T1135 |
| 28 | `exec-revsh-001` | Bash Reverse Shell | Execution | CRITICAL | T1059.004 |
| 29 | `exec-psblock-001` | Подозрительный PowerShell ScriptBlock | Execution | HIGH | T1059.001 |
| 30 | `dos-syn-001` | TCP SYN Flood — атака DoS | Impact | CRITICAL | T1498.001 |
| 31 | `impact-wipe-001` | Уничтожение данных (Disk Wipe) | Impact | CRITICAL | T1561.001 |
| 32 | `impact-svc-001` | Остановка критических сервисов | Impact | HIGH | T1489 |
| 33 | `init-acc-002` | Эксплуатация уязвимости публичного сервиса | Initial Access | HIGH | T1190 |
| 34 | `init-acc-001` | Фишинговый вложение (Spear Phishing) | Initial Access | HIGH | T1566.001 |
| 35 | `lm-pth-001` | Pass-the-Hash атака | Lateral Movement | CRITICAL | T1550.002 |
| 36 | `lm-psexec-001` | Горизонтальное перемещение через PsExec | Lateral Movement | HIGH | T1021.002 |
| 37 | `lm-rdp-001` | RDP-соединение с нового хоста | Lateral Movement | HIGH | T1021.001 |
| 38 | `lm-wmi-001` | Удалённое выполнение через WMI | Lateral Movement | HIGH | T1021.006 |
| 39 | `mal-miner-001` | Активность криптомайнера | Malware | HIGH | T1496 |
| 40 | `mal-macro-001` | Вредоносный макрос в Office-документе | Malware | HIGH | T1566.001 |
| 41 | `mal-ransom-001` | Индикаторы шифровальщика (Ransomware) | Malware | CRITICAL | T1486 |
| 42 | `mal-proc-001` | Подозрительный запуск процесса | Malware | HIGH | T1059 |
| 43 | `mal-trojan-001` | Троян — закрепление через реестр | Malware | HIGH | T1547.001 |
| 44 | `mal-webshell-001` | Загрузка или вызов веб-шелла | Malware | CRITICAL | T1505.003 |
| 45 | `persist-cron-001` | Изменение cron-задачи | Persistence | MEDIUM | T1053.003 |
| 46 | `persist-win-001` | Создание нового Windows-сервиса | Persistence | MEDIUM | T1543.003 |
| 47 | `persist-reg-001` | Закрепление через реестр (Run-ключи) | Persistence | HIGH | T1547.001 |
| 48 | `persist-lin-001` | Модификация authorized_keys (SSH) | Persistence | MEDIUM | T1098.004 |
| 49 | `persist-startup-001` | Файл в папке автозапуска Startup | Persistence | HIGH | T1547.001 |
| 50 | `pe-sudo-001` | Подозрительное использование sudo | Privilege Escalation | MEDIUM | T1548.003 |
| 51 | `pe-win-001` | Имперсонация токена Windows | Privilege Escalation | HIGH | T1134 |
| 52 | `net-scan-001` | Сканирование портов | Reconnaissance | MEDIUM | T1046 |
| 53 | `recon-arp-001` | ARP-сканирование сети | Reconnaissance | LOW | T1018 |
| 54 | `recon-dnszt-001` | DNS Zone Transfer (AXFR) | Reconnaissance | MEDIUM | T1590.002 |
| 55 | `recon-ldap-001` | Перечисление Active Directory (LDAP) | Reconnaissance | MEDIUM | T1087.002 |
| 56 | `recon-nmap-001` | Сканирование Nmap | Reconnaissance | MEDIUM | T1046 |
| 57 | `recon-smb-001` | Перечисление SMB-ресурсов | Reconnaissance | MEDIUM | T1135 |
| 58 | `supply-pkg-001` | Установка пакетов из ненадёжных источников | Supply Chain | MEDIUM | T1195 |
| 59 | `web-sqli-001` | SQL-инъекция | Web Attacks | HIGH | T1190 |
| 60 | `web-xss-001` | Cross-Site Scripting (XSS) | Web Attacks | MEDIUM | T1190 |

---

## Шкала критичности

| Уровень | Цвет | Описание |
|---------|------|----------|
| CRITICAL | 🔴 | Немедленное реагирование. Угроза активна или нанесён ущерб. |
| HIGH | 🟠 | Реагирование в течение 1 часа. Высокая вероятность компрометации. |
| MEDIUM | 🟡 | Расследование в течение рабочего дня. Подозрительная активность. |
| LOW | 🟢 | Мониторинг. Возможна легитимная активность. |

---

## Формат каждого сценария

Каждый сценарий содержит:
- **ID и название** правила SIGMA
- **Описание угрозы** — что происходит и почему опасно
- **SIGMA-правило** — полный YAML для корреляции
- **Индикаторы компрометации (IoC)** — на что обратить внимание
- **Шаги расследования** — алгоритм действий аналитика
- **Рекомендации по реагированию** — как локализовать угрозу
- **Ложные срабатывания** — когда правило не должно тревожить

---

*URSUS SIEM Documentation · 2024 · Версия 1.0*
