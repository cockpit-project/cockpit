#!/bin/sh
# Script to listen on a tcp port via netcat, echo a message on the first connection and terminate

# In the background, wait for the port to become available and echo the same message to the terminal
# If the port isn't open after roughly 10 seconds, the message "port not open" is printed instead
# background: wait for the port to become available and echo message

# netcat has to run in the main process, otherwise docker might kill the container prematurely
# busybox netcat has reduced functionality (no --send-only or -c parameters)

port=$1
message=$2

x=0
while netstat -lnt | awk "\$4 ~ /:$port\$/ {exit 1}" && [ $x -lt 10 ]; do
  sleep 1
  x=$((x+1))
done && \
if netstat -lnt | awk "\$4 ~ /:$port\$/ {exit 1}"; then
  echo 'port not open'
else
  echo "$message"
fi &
echo "$message" | nc -l -p $port
