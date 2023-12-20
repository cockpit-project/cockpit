from testinsp.base import TestInspector
from testinsp.constants import YAML, STORE_PATH


class NetworkInterfaces(TestInspector):
    store_type = YAML
    _get_data_command = "ip -j a"

    def __init__(self, filename=None, pathname=STORE_PATH, external_executor=None):
        super().__init__(
            filename=filename, pathname=pathname, external_executor=external_executor
        )
        self.exclude_list += ["preferred_life_time", "valid_life_time"]

    def get_data(self):
        # because of original data are so big for every interface, gather some basic
        raw_data = self._get_json_from_process(self._get_data_command)
        data = dict()
        for item in raw_data:
            interface = item["ifname"]
            adresses = list()
            addrinfo_list = ["local", "prefixlen", "family", "label", "scope"]
            for item_inner in item["addr_info"]:
                new_item = dict()
                for key in addrinfo_list:
                    new_item[key] = item_inner.get(key)
                adresses.append(new_item)
            state = item.get("operstate")
            data[interface] = {
                "ifname": interface,
                "adresses": adresses,
                "state": state,
            }
        return data


class FirewallStatus(TestInspector):
    store_type = YAML
    _get_data_command = "firewall-cmd --list-all || true"

    def get_data(self):
        raw_data = self.run(self._get_data_command)
        data = dict()
        key = "Unknown"
        for raw_item in raw_data.splitlines():
            if not raw_item.startswith(" "):
                key = raw_item.strip()
                data[key] = dict()
                continue
            inner_key, value = raw_item.strip().split(":", 1)
            data[key][inner_key.strip()] = value.strip()
        return data
