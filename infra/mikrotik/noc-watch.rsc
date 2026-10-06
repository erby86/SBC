# M35 self-monitoring (ADR-0010): the CCR2116 checks sbc-ubuntu and the NOC every 30 s and posts
# to a Discord channel webhook directly, so an alert still goes out when sbc-noc, Zabbix or the
# server is down. RouterOS 7.
#
# Install with /import (Winbox Files, then /import file-name=noc-watch.rsc verbose=yes) rather
# than pasting the source into the terminal. Re-importing replaces the script and the scheduler;
# the webhook URL lives in a separate script "noc-watch-url" (created by hand, never in git,
# ADR-0005: anyone with the URL can post to the channel), so a re-import keeps it.
#
# Alerts: on the 2nd failed check in a row (about 1 minute), once per outage; one message on
# recovery. The failure count is kept in the comment of the noc-watch script (a global variable
# set from the scheduler did not survive between runs on this router). Every failed check logs
# why: "does not answer ping", "fetch error" (no HTTP answer, 403 from the NPM access list, DNS)
# or "not ok" with the start of the body. Every post logs "discord sent" or "discord failed".

/system scheduler remove [find where on-event~"noc-watch"]
/system script remove [find where name=noc-watch]
/system script environment remove [find where name=nocWatchFails]

/system script add name=noc-watch dont-require-permissions=no policy=read,write,test comment=0 source={
:local server 192.168.1.6
:local url "http://noc.sbc.lan/api/health/ready"
:local self [/system script find where name=noc-watch]
:local fails [:tonum [/system script get $self comment]]
:if ([:typeof $fails] != "num") do={ :set fails 0 }
:local before $fails
:local problem ""
:local detail ""
:if ([/ping $server count=3] = 0) do={ :set problem ("SBC NOC: server " . $server . " does not answer ping"); :set detail "ping lost" }
:if ($problem = "") do={
  :local body ""
  :local fetched false
  :do { :set body ([/tool fetch url=$url output=user as-value]->"data"); :set fetched true } on-error={}
  :if ($fetched = false) do={ :set detail "fetch error" } else={
    :if ([:typeof [:find $body "\"status\":\"ok\""]] != "num") do={ :set detail ("not ok: " . [:pick $body 0 80]) }
  }
  :if ($detail != "") do={ :set problem ("SBC NOC: " . $url . " is failing (NOC down)") }
}
:local message ""
:if ($problem = "") do={
  :if ($fails >= 2) do={ :set message "SBC NOC: back to normal" }
  :set fails 0
} else={
  :set fails ($fails + 1)
  :log warning ("noc-watch: check " . $fails . ": " . $problem . " - " . $detail)
  :if ($fails = 2) do={ :set message $problem }
  :if ($fails > 3) do={ :set fails 3 }
}
:if ($fails != $before) do={ /system script set $self comment=[:tostr $fails] }
:if ($message != "") do={
  :local cfg [/system script find where name=noc-watch-url]
  :if ([:len $cfg] = 0) do={ :log error "noc-watch: script noc-watch-url missing, nothing sent" } else={
    :local webhook [/system script get $cfg source]
    :do {
      /tool fetch url=$webhook http-method=post http-header-field="Content-Type: application/json" http-data=("{\"content\":\"" . $message . "\"}") output=none check-certificate=yes
      :log info ("noc-watch: discord sent: " . $message)
    } on-error={ :log error ("noc-watch: discord failed: " . $message) }
  }
}
}

/system scheduler add name=noc-watch interval=30s on-event="/system script run noc-watch" policy=read,write,test comment="M35 sbc-noc self-monitoring (ADR-0010)"
