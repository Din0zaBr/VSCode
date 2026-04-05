# Известные проблемы и нерешённые задачи

## Автозапуск агента на Windows 10 через Task Scheduler

### Проблема

Агент (`logvault-agent`) успешно запускается вручную, но не удаётся настроить
надёжный автозапуск через Windows Task Scheduler.

**Симптом:** задача создаётся успешно, `schtasks /run` возвращает SUCCESS,
но состояние навсегда остаётся **"Поставлено в очередь"** и никогда не
переходит в **"Выполняется"**.

### Причины

**Попытка 1 — SYSTEM + ONSTART:**
```
/sc ONSTART /ru SYSTEM /rl HIGHEST
```
- Python установлен в `C:\Users\Kordon\AppData\Local\Programs\Python\Python311\`
- Учётная запись SYSTEM не имеет доступа к пользовательскому `AppData`
- Задача уходит в очередь и не запускается

**Попытка 2 — пользователь + ONLOGON:**
```
/sc ONLOGON /ru "DESKTOP-BJFRFDA\Kordon" /rl HIGHEST
```
- Режим "Только интерактивный" — задача требует активного сеанса пользователя
- `schtasks /run` из Admin PowerShell ставит задачу в очередь,
  но она не запускается даже при активном сеансе
- Предположительно конфликт UAC-токенов или ограничение Task Scheduler

**Попытка 3 — bat-обёртка + cmd.exe:**
- bat-файл написан в CP1251 для поддержки кириллицы в пути (`Хак`)
- cmd.exe от SYSTEM не создавал лог-файл — bat не исполнялся вообще
- Вероятная причина: кириллица в пути при нестандартной кодовой странице SYSTEM

### Правильное решение

Есть **три надёжных способа**, любой из них решит проблему:

---

#### Способ A (рекомендуется): Установить Python system-wide

1. Скачать Python 3.11 с python.org, при установке выбрать
   **"Install for all users"** → Python встанет в `C:\Program Files\Python311\`
2. Переустановить зависимости:
   ```
   C:\Program Files\Python311\python.exe -m pip install -r requirements-windows.txt
   C:\Program Files\Python311\Scripts\pywin32_postinstall.py -install
   ```
3. Создать задачу от SYSTEM:
   ```
   schtasks /create /tn "LogVault Agent" \
     /tr "\"C:\Program Files\Python311\python.exe\" -m agent.src.main \"C:\ProgramData\logvault-agent\config.yaml\"" \
     /sc ONSTART /ru SYSTEM /rl HIGHEST /f
   ```

---

#### Способ B: NSSM (Non-Sucking Service Manager)

Регистрирует Python-процесс как настоящий Windows Service (не задачу планировщика).
Работает от SYSTEM, поддерживает авторестарт, ведёт логи.

```powershell
# Скачать NSSM
Invoke-WebRequest https://nssm.cc/release/nssm-2.24.zip -OutFile C:\nssm.zip
Expand-Archive C:\nssm.zip C:\nssm

# Установить сервис
C:\nssm\nssm-2.24\win64\nssm.exe install "LogVault Agent" `
    "C:\Users\Kordon\AppData\Local\Programs\Python\Python311\python.exe"
C:\nssm\nssm-2.24\win64\nssm.exe set "LogVault Agent" AppParameters `
    "-m agent.src.main C:\ProgramData\logvault-agent\config.yaml"
C:\nssm\nssm-2.24\win64\nssm.exe set "LogVault Agent" AppDirectory `
    "C:\Users\Kordon\VSCode\Хак\Test1111"
C:\nssm\nssm-2.24\win64\nssm.exe set "LogVault Agent" AppEnvironmentExtra `
    "PYTHONPATH=C:\Users\Kordon\VSCode\Хак\Test1111"
C:\nssm\nssm-2.24\win64\nssm.exe set "LogVault Agent" ObjectName `
    "DESKTOP-BJFRFDA\Kordon" "PASSWORD_HERE"
C:\nssm\nssm-2.24\win64\nssm.exe set "LogVault Agent" Start SERVICE_AUTO_START
C:\nssm\nssm-2.24\win64\nssm.exe start "LogVault Agent"
```

> Примечание: NSSM с учётной записью пользователя (не SYSTEM) позволяет
> обойти проблему доступа к AppData.

---

#### Способ C: Убрать кириллику из пути к проекту

Переместить проект из `C:\Users\Kordon\VSCode\Хак\Test1111\`
в `C:\logvault\` или `C:\projects\ursus\`:

```powershell
xcopy "C:\Users\Kordon\VSCode\Хак\Test1111" "C:\logvault" /E /I /H
[Environment]::SetEnvironmentVariable("PYTHONPATH", "C:\logvault", "Machine")
```

После этого Task Scheduler с SYSTEM и bat-обёрткой заработает корректно,
так как кодировка пути перестаёт быть проблемой.

---

### Что уже работает (ручной запуск)

Агент полностью функционален при ручном запуске:

```powershell
$env:PYTHONPATH = "C:\Users\Kordon\VSCode\Хак\Test1111"
cd "C:\Users\Kordon\VSCode\Хак\Test1111"
python -m agent.src.main "C:\ProgramData\logvault-agent\config.yaml"
```

Собирает логи с каналов:
- `System` (5000+ событий)
- `Application` (3000+ событий)
- `Security` — только от Admin/SYSTEM (канал недоступен без прав)

Деduplication, offline-буфер, chunked-отправка — всё работает.

### Что уже настроено

- `PYTHONPATH` задан на уровне Machine (HKLM) через `[Environment]::SetEnvironmentVariable`
- `auditpol` для Event ID 4688 (Process Creation) включён
- `pywin32` установлен, DLL зарегистрированы
- Конфиг записан в `C:\ProgramData\logvault-agent\config.yaml`
