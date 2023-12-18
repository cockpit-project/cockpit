from yaml import safe_load
from testinsp.base import TestInspector
from testinsp.constants import YAML


class DiskInfo(TestInspector):
    store_type = YAML
    _get_data_command = "udisksctl dump"

    def get_data(self):
        yaml_data = safe_load(
            self.run(self._get_data_command).replace("(", "[").replace(")", "]")
        )
        return yaml_data
