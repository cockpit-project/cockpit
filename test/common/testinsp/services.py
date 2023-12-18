from testinsp.base import TestInspector
from testinsp.constants import PLAIN, STORE_PATH


class ServiceInfo(TestInspector):
    store_type = PLAIN
    _get_data_command = "systemctl --type=service --state=running"

    def __init__(self, filename=None, pathname=STORE_PATH, external_executor=None):
        super().__init__(
            filename=filename, pathname=pathname, external_executor=external_executor
        )
        self.exclude_list = ["NetworkManager-dispatcher"]

    def get_data(self):
        raw_data = self.run(self._get_data_command).splitlines()
        removed_header_footer = [item.strip() for item in raw_data[1:-5]]
        removed_header_footer.sort()
        data = "\n".join(removed_header_footer)
        return data
