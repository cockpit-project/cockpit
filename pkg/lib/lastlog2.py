# Print lastlog2 database as JSON; used in ./login.js
import json
import os
import sqlite3
import sys

DB = "/var/lib/lastlog/lastlog2.db"

if not os.path.exists(DB):
    sys.exit(f"{DB} does not exist")

con = sqlite3.connect(DB)
cur = con.cursor()
query = "SELECT Name, Time, TTY, RemoteHost FROM Lastlog2"
if len(sys.argv) == 2:
    res = cur.execute(query + " WHERE Name = ?", [sys.argv[1]])
else:
    res = cur.execute(query)
users = {}
for [name, time, tty, host] in res:
    users[name] = {"time": time, "tty": tty, "host": host}
print(json.dumps(users))
