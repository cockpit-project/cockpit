import json

from tracer.query import Query

q = Query()
applications = q.affected_applications().get()


def filter_by_type(apps, type_str):
    return [app.name for app in apps if app.type == type_str]


dump_obj = {}
# ignore type "session" for cockpit use case
dump_obj["reboot"] = filter_by_type(applications, "static")
dump_obj["daemons"] = filter_by_type(applications, "daemon")
dump_obj["manual"] = filter_by_type(applications, "application")

print(json.dumps(dump_obj))
