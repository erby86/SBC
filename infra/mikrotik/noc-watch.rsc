# M35 self-monitoring (ADR-0010): the CCR2116 checks sbc-ubuntu and the NOC itself every 30 s and
# posts to a Discord channel webhook directly, so an alert still goes out when sbc-noc, Zabbix or
# the server is down. RouterOS 7. Paste into the router terminal, then put the webhook URL into the
# script on the router only (System > Scripts > noc-watch): never into git (ADR-0005) — anyone with
# the URL can post to the channel.
#
# Alerts: on the 2nd failed check in a row (about 1 minute), once per outage; one message on
# recovery. The failure count is kept in the comment of the noc-watch script itself: a global
# variable set from the scheduler did not survive between runs on this router (always
# "check 1"). Every command is on one line: a pasted
# "\" continuation followed by a Windows CR breaks silently. Each post logs "discord sent" or
# "discord failed".
# - server: 3 pings to 192.168.1.6 all lost
# - noc: http://noc.sbc.lan/api/health/ready does not answer 200 with "status":"ok"

/system script
add name=noc-watch dont-require-permissions=no policy=read,write,test source={
  :local webhook "PASTE_DISCORD_WEBHOOK_URL"
  :local server 192.168.1.6
  :local url "http://noc.sbc.lan/api/health/ready"
  :local self [/system script find name=noc-watch]
  :local fails [:tonum [/system script get $self comment]]
  :if ([:typeof $fails] != "num") do={ :set fails 0 }
  :local before $fails

  :local problem ""
  :if ([/ping $server count=3] = 0) do={ :set problem ("SBC NOC: server " . $server . " does not answer ping") }
  :if ($problem = "") do={
    :local healthy false
    :do {
      :local r [/tool fetch url=$url output=user as-value]
      :if ([:typeof [:find ($r->"data") "\"status\":\"ok\""]] = "num") do={ :set healthy true }
    } on-error={}
    :if ($healthy = false) do={ :set problem ("SBC NOC: " . $url . " is failing (NOC down)") }
  }

  :local message ""
  :if ($problem = "") do={
    :if ($fails >= 2) do={ :set message "SBC NOC: back to normal" }
    :set fails 0
  } else={
    :set fails ($fails + 1)
    :log warning ("noc-watch: " . $problem . " (check " . $fails . ")")
    :if ($fails = 2) do={ :set message $problem }
  }
  # Write only on change: every write is a config change in the router log.
  :if ($fails != $before) do={ /system script set $self comment=[:tostr $fails] }

  :if ($message != "") do={
    :do {
      /tool fetch url=$webhook http-method=post http-header-field="Content-Type: application/json" http-data=("{\"content\":\"" . $message . "\"}") output=none check-certificate=yes
      :log info ("noc-watch: discord sent: " . $message)
    } on-error={ :log error ("noc-watch: discord failed: " . $message) }
  }
}

/system scheduler
add name=noc-watch interval=30s on-event="/system script run noc-watch" policy=read,write,test comment="M35 sbc-noc self-monitoring (ADR-0010)"
