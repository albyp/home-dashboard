#!/usr/bin/env bash
# Install the host agent on this machine (run with sudo from the repo root):
#   sudo ./host-agent/install.sh
set -euo pipefail
cd "$(dirname "$0")"

command -v jq >/dev/null || apt-get install -y jq
command -v smartctl >/dev/null || apt-get install -y smartmontools

install -m 755 health-check.sh /usr/local/bin/home-dashboard-agent
install -m 644 home-dashboard-agent.service home-dashboard-agent.timer /etc/systemd/system/
install -d -m 755 /var/lib/home-dashboard
systemctl daemon-reload
systemctl enable --now home-dashboard-agent.timer
systemctl start home-dashboard-agent.service
echo "Wrote $(jq -r '.checks | length' /var/lib/home-dashboard/health.json) checks to /var/lib/home-dashboard/health.json"
