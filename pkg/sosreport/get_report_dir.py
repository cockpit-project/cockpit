import configparser
import sys

c = configparser.ConfigParser()
c.read("/etc/sos/sos.conf")
try:
    print(c["global"]["tmp-dir"])
except KeyError:
    # very expensive and internal API, but there is no official way to get the tmp-dir
    # https://github.com/sosreport/sos/issues/4074
    try:
        import sos.policies
        print(sos.policies.load().get_tmp_dir(None))
    except Exception as e:
        # in case the API changes, sane fallback
        print("Failed to get policy tmp-dir:", e, file=sys.stderr)
        print("/var/tmp")
