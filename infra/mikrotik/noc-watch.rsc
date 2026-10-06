# M35 self-monitoring (ADR-0010): the CCR2116 checks sbc-ubuntu and the NOC itself every 30 s and
# posts to a Discord channel webhook directly, so an alert still goes out when sbc-noc, Zabbix or
# the server is down. RouterOS 7. Paste into the router terminal, then put the webhook URL into the
# script on the router only (System > Scripts > noc-watch): never into git (ADR-0005) — anyone with
# the URL can post to the channel.
#
# The Discord post is written out at both call sites (no local function): it logs
# "noc-watch: discord sent" or "noc-watch: discord failed", so a silent no-op cannot hide.
#
# Alerts: after 2 failed checks in a row (about 1 minute), once per outage; one message on recovery.
# - server: 3 pings to 192.168.1.6 all lost
# - noc: http://noc.sbc.lan/api/health/ready does not answer 200 with "status":"ok"

/system script
add name=noc-watch dont-require-permissions=no policy=read,write,test source={
  :local webhook "PASTE_DISCORD_WEBHOOK_URL"
  :local server 192.168.1.6
  :local url "http://noc.sbc.lan/api/health/ready"

  :global nocWatchFails
  :global nocWatchAlerted
  :if ([:typeof $nocWatchFails] != "num") do={ :set nocWatchFails 0 }
  :if ([:typeof $nocWatchAlerted] != "bool") do={ :set nocWatchAlerted false }

  :local problem ""
  :if ([/ping $server count=3] = 0) do={
    :set problem ("SBC NOC: server " . $server . " does not answer ping")
  } else={
    :local healthy false
    :do {
      :local r [/tool fetch url=$url output=user as-value]
      :if ([:typeof [:find ($r->"data") "\"status\":\"ok\""]] = "num") do={ :set healthy true }
    } on-error={}
    :if (!$healthy) do={ :set problem ("SBC NOC: " . $url . " is failing (NOC down)") }
  }

  :if ($problem = "") do={
    :if ($nocWatchAlerted) do={
      :do {
        /tool fetch url=$webhook http-method=post http-header-field="Content-Type: application/json" \
          http-data="{\"content\":\"SBC NOC: back to normal\"}" output=none check-certificate=yes
        :log info "noc-watch: discord sent (back to normal)"
      } on-error={ :log error "noc-watch: discord failed" }
    }
    :set nocWatchFails 0
    :set nocWatchAlerted false
  } else={
    :set nocWatchFails ($nocWatchFails + 1)
    :log warning ("noc-watch: " . $problem)
    :if (($nocWatchFails >= 2) && (!$nocWatchAlerted)) do={
      :do {
        /tool fetch url=$webhook http-method=post http-header-field="Content-Type: application/json" \
          http-data=("{\"content\":\"" . $problem . "\"}") output=none check-certificate=yes
        :set nocWatchAlerted true
        :log info "noc-watch: discord sent"
      } on-error={ :log error "noc-watch: discord failed" }
    }
  }
}

# No start-time: it defaults to now, so the first run is 30 s after adding and the schedule also
# survives a reboot (start-time=startup would wait for the next reboot before running at all).
/system scheduler
add name=noc-watch interval=30s on-event="/system script run noc-watch" policy=read,write,test \
  comment="M35 sbc-noc self-monitoring (ADR-0010)"
