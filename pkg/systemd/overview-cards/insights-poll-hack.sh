#! /bin/sh

# Poll until /var/lib/insights/insights-details.json is 5 minutes
# older than /etc/insights-client/.lastupload, then exit.

# Calling "insights-details --check-results" only returns results
# corresponding to the most recent upload some time after the upload,
# but we don't know when exactly.  We assume that it will not take
# more than 5 minutes.  However, we also want the results as soon as
# they are available so we poll a couple of time before the 5 minutes
# are up.

# We poll fast for the first minute, and then slow down.  Also, there
# is a absolute limit on how often we poll, in case something is wrong
# with the time stamps (such as .lastupload being from 5 years in
# future).

set -eu

details_out_of_date ()
{
    if ! [ -f /etc/insights-client/.lastupload ]; then
        return 1
    fi
    if ! [ -f /var/lib/insights/insights-details.json ]; then
        return 0
    fi
    last_upload=$(stat -c "%Y" /etc/insights-client/.lastupload)
    details=$(stat -c "%Y" /var/lib/insights/insights-details.json)
    [ $details -lt $(expr $last_upload + 300) ]
}

tries=0
while [ $tries -lt 20 ] && details_out_of_date; do
    # We let insights-client write to /dev/null so that it doesn't
    # crash should our stdout be closed.
    insights-client --check-results >/dev/null
    if [ $tries -lt 5 ]; then
        sleep 10
    else
        sleep 60
    fi
    tries=$(expr $tries + 1)
done
