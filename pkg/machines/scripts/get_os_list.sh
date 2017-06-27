#!/bin/sh

# sed strips spaces at the end, the beginning and spaces around '|'
osinfo-query os --fields=short-id,name,version,family,vendor,release-date,eol-date,codename | tail -n +3 | sed -e 's/\s*|\s*/|/g; s/^\s*//g; s/\s*$//g'
