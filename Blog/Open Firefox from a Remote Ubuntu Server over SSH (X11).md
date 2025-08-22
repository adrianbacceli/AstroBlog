# Open Firefox from a Remote Ubuntu Server over SSH (X11) — with a Handy `remote-firefox` Launcher

**Works from Linux (Kali) and, with alternatives, from Windows without admin rights.**  
Covers X11 forwarding quirks, corporate MITM certificates, and fallbacks (RDP / Xpra HTML5).

---

## TL;DR

- Create a tiny launcher: `remote-firefox` (prompts server, user, port; opens Firefox remotely with X11).
    
- Fix X11 cookie access with an XAUTHORITY shim (so Firefox can connect even in sandboxed setups).
    
- If your company does TLS interception, import the corporate root CA so Firefox stops blocking pages.
    
- On Windows with no admin rights: use **RDP** to the VM or **Xpra HTML5** (no installs on Windows).
    

---

## Environment Used in This Guide

- **Client:** Kali Linux (zsh), no admin on Windows.
    
- **Server:** Ubuntu Server VM on VMware Workstation (`ens33` at `192.168.159.10`).
    
- **User:** `adrian`.
    

> Adjust IP/username for your setup where needed.

---

## 1) Test X11 Forwarding from Client to Server

On your client (Kali):

```bash
ssh -Y adrian@192.168.159.10 xeyes
```

If `xeyes` opens, X11 forwarding is fine.

[Image 1 – xeyes displayed on the client]  
_Alt: A small xeyes window on the client desktop confirming X11 forwarding works._

---

## 2) Create the `remote-firefox` Helper (Client)

Create the script at `~/bin/remote-firefox`:

```bash
mkdir -p ~/bin
nano ~/bin/remote-firefox
```

Paste:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Prompt for destination, allow empty input to use default IP
read -rp "Server (IP/hostname or user@host) [192.168.159.10]: " dest

# If no input is given, set default IP with user
if [[ -z "$dest" ]]; then
  dest="adrian@192.168.159.10"
fi

# If the destination is just an IP or hostname without a user, prompt for a user
if [[ "$dest" != *@* ]]; then
  read -rp "User: " user
  dest="${user}@${dest}"
fi

# Prompt for SSH port
read -rp "SSH port [22]: " port
port=${port:-22}

# Collect any additional arguments for firefox
args=""
if (( $# )); then
  printf -v args ' %q' "$@"
fi

# Run the SSH command with X11 forwarding and launch Firefox
ssh -Y -p "$port" -o ForwardX11=yes -o ForwardX11Trusted=yes -C "$dest" \
  "xauth extract ~/.Xauthority-ssh \"\$DISPLAY\" >/dev/null 2>&1 || true; \
   chmod 600 ~/.Xauthority-ssh >/dev/null 2>&1 || true; \
   XAUTHORITY=~/.Xauthority-ssh MOZ_ENABLE_WAYLAND=0 firefox$args"
```

Make it executable and add to your PATH (zsh):

```bash
chmod +x ~/bin/remote-firefox
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc
exec zsh -l
```

Run it:

```bash
remote-firefox
```

[Image 2 – Terminal running `remote-firefox` with prompts]  
_Alt: Terminal prompts asking for server, user, and port, then SSHing and launching Firefox remotely._

**Why the XAUTHORITY shim?**  
Firefox (especially sandboxed builds) may not read `~/.Xauthority`. Copying the current cookie into `~/.Xauthority-ssh` and pointing `XAUTHORITY` at it sidesteps “wrong authentication” failures.

---

## 3) If Firefox Opens but Sites Fail (Corporate MITM)

If you see “Software is Preventing Firefox From Safely Connecting…” your network is intercepting TLS. Fix by trusting your org’s root CA **on the server** (the Ubuntu VM):

### 3.1 Extract the Proxy Chain (Server)

```bash
site=translate.google.com
openssl s_client -connect ${site}:443 -servername ${site} -showcerts </dev/null 2>/dev/null \
| awk '/BEGIN CERTIFICATE/{n++} {print > ("/tmp/mitm-" n ".crt")} /END CERTIFICATE/{ }'

# Inspect; find the self-signed root (Subject == Issuer, CA:TRUE)
for f in /tmp/mitm-*.crt; do
  echo "=== $f ==="
  openssl x509 -in "$f" -noout -subject -issuer -text | sed -n '1,30p' | grep -E 'Subject:|Issuer:|CA:TRUE'
done
```

Identify the **root** (e.g., `Dell Technologies Root Certificate Authority 2018`).

[Image 3 – Terminal showing `openssl s_client` output with chain]  
_Alt: Shell output listing Subject/Issuer fields for each certificate in the intercepted chain._

### 3.2 Install the Root (and Optional Intermediate) System-Wide (Server)

```bash
sudo mkdir -p /usr/local/share/ca-certificates
sudo cp /tmp/mitm-4.crt /usr/local/share/ca-certificates/Dell-Root-2018.crt
sudo cp /tmp/mitm-3.crt /usr/local/share/ca-certificates/Dell-Issuing-CA-101.crt  # optional, if present
sudo update-ca-certificates
```

Verify system trust:

```bash
openssl s_client -connect translate.google.com:443 -servername translate.google.com </dev/null 2>/dev/null \
| grep -i 'Verify return code'
# Expect: Verify return code: 0 (ok)
```

[Image 4 – Terminal showing “Verify return code: 0 (ok)”]  
_Alt: Successful OpenSSL verification confirming system trusts the corporate root._

### 3.3 Make Firefox Trust the System CA (Server)

**Option A — Policy file (system-wide):**

```bash
sudo mkdir -p /usr/lib/firefox/distribution
sudo tee /usr/lib/firefox/distribution/policies.json >/dev/null <<'JSON'
{
  "policies": {
    "Certificates": {
      "ImportEnterpriseRoots": true,
      "Install": [
        "/usr/local/share/ca-certificates/Dell-Root-2018.crt",
        "/usr/local/share/ca-certificates/Dell-Issuing-CA-101.crt"
      ]
    }
  }
}
JSON
```

Restart Firefox and check `about:policies#active`.

**Option B — About:config toggle (per-profile):**

- Go to `about:config` → set `security.enterprise_roots.enabled = true` → restart Firefox.
    

[Image 5 – Firefox about:policies active page]  
_Alt: Firefox policies page showing Certificates policy active with enterprise roots import enabled._

---

## 4) (Optional) Make the Server’s IP Stable

On the Ubuntu VM, set a static IP for `ens33` so your script’s default always works:

```yaml
# /etc/netplan/10-ens33-static.yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    ens33:
      dhcp4: no
      addresses: [192.168.159.10/24]
      routes:
        - to: default
          via: 192.168.159.2
      nameservers:
        addresses: [192.168.159.2, 1.1.1.1]
```

Apply:

```bash
sudo netplan try   # press Enter to accept
# or
sudo netplan apply
```

[Image 6 – Netplan YAML in editor]  
_Alt: A text editor showing the netplan file setting a static IP for ens33._

---

## 5) Windows Without Admin? Two Good Alternatives

### 5.1 RDP into the Ubuntu VM (Recommended)

On the server:

```bash
sudo apt update
sudo apt install -y xrdp xfce4 xfce4-goodies dbus-x11 xorgxrdp
echo xfce4-session | sudo tee /home/adrian/.xsession >/dev/null
sudo chown adrian:adrian /home/adrian/.xsession
sudo adduser xrdp ssl-cert
sudo systemctl enable --now xrdp
# ufw users: sudo ufw allow 3389/tcp
```

On Windows (no installs needed): use **mRemoteNG** or **mstsc** → RDP to `192.168.159.10` → login as `adrian` → open Firefox.

[Image 7 – mRemoteNG RDP session into Ubuntu XFCE desktop]  
_Alt: Windows mRemoteNG showing an RDP session with the Ubuntu XFCE desktop and Firefox open._

### 5.2 Xpra HTML5 (View Firefox in Your Browser)

On the server:

```bash
sudo apt update && sudo apt install -y xpra
xpra start :100 \
  --start=firefox \
  --bind-tcp=0.0.0.0:10000 \
  --html=on --exit-with-children --daemon=no
```

Then on Windows: open `http://192.168.159.10:10000/`.

[Image 8 – Firefox running inside an Xpra HTML5 tab]  
_Alt: Web browser tab on Windows showing the Xpra HTML5 session with Firefox running remotely._

---

## 6) Troubleshooting Checklist

- **“X11 connection rejected / wrong authentication”**  
    Ensure `xauth` on server; the script’s XAUTHORITY shim usually fixes this.
    
    ```bash
    sudo apt install -y xauth dbus-x11
    ```
    
- **Snap Firefox weirdness**  
    The shim helps; otherwise use Mozilla’s `.deb` build.
    
- **Firefox still flags MITM**  
    Verify the root CA is installed system-wide **and** Firefox is using Enterprise Roots (policy or about:config).  
    Import CA directly into the profile if needed:
    
    ```bash
    sudo apt install -y libnss3-tools
    PROF=$(grep -E '^Path=' ~/.mozilla/firefox/profiles.ini | head -n1 | cut -d= -f2)
    certutil -d sql:$HOME/.mozilla/firefox/$PROF -A -t "C,," -n "Corp Root CA" -i /usr/local/share/ca-certificates/Dell-Root-2018.crt
    ```
    
- **Dual addresses on `ens33` (static + DHCP)**  
    Disable DHCP in netplan, `dhclient -r ens33`, and delete the old lease IP:
    
    ```bash
    sudo ip addr del 192.168.159.128/24 dev ens33
    ```
    

[Image 9 – Terminal removing secondary DHCP address from ens33]  
_Alt: Shell command deleting the old DHCP address from ens33, leaving only the static IP._

---

## 7) Security Notes

- Only import **trusted** corporate roots. Never disable TLS verification globally.
    
- If exposing Xpra beyond localhost or your LAN, add authentication and TLS.
    
- X11 forwarding is convenient but not a full desktop protocol; for heavy GUIs, prefer RDP.
    

---

## 8) Reusable Snippets

**Quick run:**

```bash
remote-firefox -- --new-window "https://translate.google.com"
```

**Set a fixed default (edit script):**

```bash
# change the default inside the script
#  dest="adrian@192.168.159.10"
```

[Image 10 – Editing the script to change the default server line]  
_Alt: Code editor highlighting the line setting the default server in the remote-firefox script._