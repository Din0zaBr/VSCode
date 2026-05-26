use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;

// IP address extraction
static IP_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b").unwrap());

// Process ID patterns
static PROC_PID: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"pid[=:\s]+(\d{1,7})|\S+\[(\d{1,7})\]:").unwrap());
static PROC_PPID: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"ppid[=:\s]+(\d{1,7})|parent[\s_-]*pid[=:\s]+(\d{1,7})").unwrap());
static PROC_CPID: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"child[\s_-]*pid[=:\s]+(\d{1,7})|spawned[\s_-]*pid[=:\s]+(\d{1,7})").unwrap()
});

// Account UID
static ACCT_UID: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\bau?id[=:\s]+(\d{1,7})").unwrap());

/// Event type detection patterns (ordered by specificity)
static EVENT_PATTERNS: Lazy<Vec<(&'static str, &'static str, Regex)>> = Lazy::new(|| {
    vec![
        // Authentication
        ("auth_failure", "authentication", Regex::new(r"(?i)Failed password|authentication failure|Login incorrect|FAILED LOGIN|Invalid user|auth failed").unwrap()),
        ("auth_success", "authentication", Regex::new(r"(?i)Accepted password|Accepted publickey|session opened|login:\s+ROOT|Successful login").unwrap()),
        ("sudo_exec", "privilege", Regex::new(r"(?i)sudo:|sudo\s+").unwrap()),
        ("su_exec", "privilege", Regex::new(r"(?i)\bsu\b.*succeed|su\[").unwrap()),
        ("user_created", "user_management", Regex::new(r"(?i)useradd|new user:|account created|user was created|EventID.*4720").unwrap()),
        ("user_deleted", "user_management", Regex::new(r"(?i)userdel|user deleted|account deleted|EventID.*4726").unwrap()),
        ("account_locked", "user_management", Regex::new(r"(?i)account locked|account disabled|too many authentication failures|EventID.*4740").unwrap()),
        ("passwd_change", "user_management", Regex::new(r"(?i)passwd|password changed|password reset").unwrap()),
        // Attacks
        ("bruteforce", "brute_force", Regex::new(r"(?i)brute.?force|too many attempts|rate.?limit|repeated.*fail").unwrap()),
        ("port_scan", "reconnaissance", Regex::new(r"(?i)port.?scan|nmap|masscan|port sweep").unwrap()),
        ("sqli", "web_attack", Regex::new(r"(?i)sql.?inject|union\s+select|' or '1'='1|drop\s+table").unwrap()),
        ("xss", "web_attack", Regex::new(r"(?i)xss|cross.?site.?script|<script>|javascript:alert").unwrap()),
        ("ddos", "ddos", Regex::new(r"(?i)ddos|distributed denial|syn flood|volumetric attack").unwrap()),
        ("malware", "malware", Regex::new(r"(?i)malware|virus|trojan|worm|ransomware|botnet|backdoor|rootkit|miner|cryptominer").unwrap()),
        ("ids_alert", "ids", Regex::new(r"(?i)snort|suricata|ids alert|intrusion detected|signature matched").unwrap()),
        // Network
        ("fw_drop", "firewall", Regex::new(r"(?i)DROP|BLOCK|DENY|iptables.*DROP|ufw.*DENY|firewall.*block").unwrap()),
        ("fw_allow", "firewall", Regex::new(r"(?i)ALLOW|ACCEPT|PASS|iptables.*ACCEPT|firewall.*allow").unwrap()),
        ("vpn_connect", "vpn", Regex::new(r"(?i)vpn.*connect|peer.*connected|tunnel.*up|openvpn.*connected").unwrap()),
        ("vpn_disconnect", "vpn", Regex::new(r"(?i)vpn.*disconnect|peer.*disconnected|tunnel.*down").unwrap()),
        // System
        ("service_start", "service", Regex::new(r"(?i)service.*start|systemd.*start|daemon.*start|started successfully").unwrap()),
        ("service_stop", "service", Regex::new(r"(?i)service.*stop|systemd.*stop|daemon.*stop|shut down").unwrap()),
        ("service_crash", "service", Regex::new(r"(?i)crash|segfault|core dump|oom kill|out of memory|killed.*process").unwrap()),
        ("rdp_failure", "rdp", Regex::new(r"(?i)rdp.*fail|remote desktop.*fail|EventID.*4625.*RemoteInteractive").unwrap()),
        ("rdp_success", "rdp", Regex::new(r"(?i)rdp.*success|remote desktop.*logon|EventID.*4624.*RemoteInteractive|LogonType.*10").unwrap()),
        ("privilege_escalation", "privilege", Regex::new(r"(?i)privilege.*escalat|SeTcbPrivilege|SeDebugPrivilege|token.*impersonat").unwrap()),
        ("mimikatz", "credential_dump", Regex::new(r"(?i)mimikatz|sekurlsa|lsadump|dcsync|procdump.*lsass").unwrap()),
        ("lateral_psexec", "lateral_movement", Regex::new(r"(?i)PSEXESVC|psexec|lateral.*movement").unwrap()),
        ("pass_the_hash", "lateral_movement", Regex::new(r"(?i)pass.the.hash|NTLM.*logon.*type.*3|NtLmSsp").unwrap()),
    ]
});

/// Category hierarchy: (generic, high, low)
static CATEGORY_MAP: &[(&str, &str, &str, &str)] = &[
    // event_type, generic, high, low
    ("auth_failure", "Access", "Authentication", "Remote"),
    ("auth_success", "Access", "Authentication", "Remote"),
    ("sudo_exec", "Access", "Authorization", "Host"),
    ("su_exec", "Access", "Authorization", "Host"),
    ("user_created", "System", "User Management", "Account Create"),
    ("user_deleted", "System", "User Management", "Account Delete"),
    ("account_locked", "Access", "Authentication", "Account Lockout"),
    ("passwd_change", "System", "User Management", "Account Modify"),
    ("bruteforce", "Attacks & Recon", "Attack", "Bruteforce"),
    ("port_scan", "Attacks & Recon", "Recon", "Port Scanning"),
    ("sqli", "Attacks & Recon", "Attack", "SQL Injection"),
    ("xss", "Attacks & Recon", "Attack", "XSS"),
    ("ddos", "Attacks & Recon", "Attack", "DDoS"),
    ("malware", "Malware", "Malware", "Unknown"),
    ("ids_alert", "Attacks & Recon", "Attack", "IDS Alert"),
    ("fw_drop", "Network", "Firewall", "Drop"),
    ("fw_allow", "Network", "Firewall", "Allow"),
    ("vpn_connect", "Network", "VPN", "Connected"),
    ("vpn_disconnect", "Network", "VPN", "Disconnected"),
    ("service_start", "System", "Service", "Start"),
    ("service_stop", "System", "Service", "Stop"),
    ("service_crash", "System", "Service", "Crash"),
    ("rdp_failure", "Access", "Authentication", "Remote"),
    ("rdp_success", "Access", "Authentication", "Remote"),
    ("privilege_escalation", "System", "Process", "Privilege Escalation"),
    ("mimikatz", "Malware", "Malware", "Credential Dumping"),
    ("lateral_psexec", "Attacks & Recon", "Attack", "Lateral Movement"),
    ("pass_the_hash", "Attacks & Recon", "Attack", "Pass-the-Hash"),
];

/// Enrich a log message with category, event type, IPs, and process IDs
pub fn enrich(message: &str, source: &str, host: &str) -> HashMap<String, Value> {
    let mut meta = HashMap::new();

    // Detect event type
    let event_type = detect_event_type(message);
    if let Some(et) = &event_type {
        meta.insert("event_type".into(), Value::String(et.clone()));

        // Set category based on event type
        if let Some(cat) = CATEGORY_MAP.iter().find(|(et2, _, _, _)| *et2 == et.as_str()) {
            meta.insert(
                "category".into(),
                serde_json::json!({
                    "generic": cat.1,
                    "high": cat.2,
                    "low": cat.3,
                }),
            );
        }
    }

    // Extract IPs
    let ips: Vec<String> = IP_REGEX
        .captures_iter(message)
        .map(|c| c[1].to_string())
        .filter(|ip| !is_loopback(ip))
        .collect();

    if let Some(first_ip) = ips.first() {
        meta.insert("src.ip".into(), Value::String(first_ip.clone()));
    }
    if ips.len() > 1 {
        meta.insert("dst.ip".into(), Value::String(ips[1].clone()));
    }
    if !ips.is_empty() {
        meta.insert(
            "source_ips".into(),
            Value::Array(ips.iter().map(|ip| Value::String(ip.clone())).collect()),
        );
    }

    // Extract event source from source path
    if !source.is_empty() {
        let subsys = extract_subsystem(source);
        meta.insert("event_src.host".into(), Value::String(host.to_string()));
        meta.insert("event_src.subsys".into(), Value::String(subsys));
    }

    // Extract process IDs
    if let Some(cap) = PROC_PID.captures(message) {
        let pid = cap.get(1).or_else(|| cap.get(2)).map(|m| m.as_str());
        if let Some(pid) = pid {
            meta.insert("subject.process.id".into(), Value::String(pid.to_string()));
        }
    }
    if let Some(cap) = PROC_PPID.captures(message) {
        let ppid = cap.get(1).or_else(|| cap.get(2)).map(|m| m.as_str());
        if let Some(ppid) = ppid {
            meta.insert(
                "subject.process.parent.id".into(),
                Value::String(ppid.to_string()),
            );
        }
    }
    if let Some(cap) = PROC_CPID.captures(message) {
        let cpid = cap.get(1).or_else(|| cap.get(2)).map(|m| m.as_str());
        if let Some(cpid) = cpid {
            meta.insert(
                "object.process.id".into(),
                Value::String(cpid.to_string()),
            );
        }
    }

    // Extract account UID
    if let Some(cap) = ACCT_UID.captures(message) {
        meta.insert(
            "subject.account.id".into(),
            Value::String(cap[1].to_string()),
        );
    }

    meta
}

fn detect_event_type(message: &str) -> Option<String> {
    for (event_type, _category, re) in EVENT_PATTERNS.iter() {
        if re.is_match(message) {
            return Some(event_type.to_string());
        }
    }
    None
}

fn is_loopback(ip: &str) -> bool {
    ip.starts_with("127.") || ip == "0.0.0.0" || ip == "255.255.255.255"
}

fn extract_subsystem(source: &str) -> String {
    // /var/log/nginx/access.log -> nginx
    // /var/log/auth.log -> auth
    // C:\Windows\System32\winevt\Logs\Security.evtx -> Security
    let path = source.replace('\\', "/");
    let filename = path.split('/').last().unwrap_or(source);
    let name = filename.split('.').next().unwrap_or(filename);
    name.to_string()
}
