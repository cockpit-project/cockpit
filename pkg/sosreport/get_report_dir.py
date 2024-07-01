import configparser

c = configparser.ConfigParser()
c.read("/etc/sos/sos.conf")
try:
    print(c["global"]["tmp-dir"])
except KeyError:
    print("/var/tmp")
