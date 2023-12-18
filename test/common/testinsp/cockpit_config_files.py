from pathlib import Path

from testinsp.base import TestInspector
from testinsp.constants import YAML, PLAIN


class CockpitPAM(TestInspector):
    store_type = PLAIN
    _file = "/etc/pam.d/cockpit"
    _get_data_command = f"cat {_file}"

    def get_data(self):
        return self.run(self._get_data_command)


class CockpitConf(TestInspector):
    store_type = YAML
    _base_file_name_file = "cockpit/cockpit.conf"
    _base_path = Path("/etc")

    def get_data(self):
        data = dict()
        confdata = ""
        xdg_conf_paths = self.run("printenv XDG_CONFIG_DIRS || true")
        if xdg_conf_paths:
            for item_tmp in xdg_conf_paths.split(":"):
                item = item_tmp.strip()
                current_file = Path(item) / self._base_file_name_file
                if self.run(f"ls {current_file} 2>/dev/null || true").strip():
                    confdata = self.run(f"cat {current_file}")
                    data["XDG_CONFIG_DIRS"] = str(current_file)
                    data["config"] = confdata
                    return data
        current_file = self._base_path / self._base_file_name_file
        if self.run(f"ls {current_file} 2>/dev/null || true").strip():
            confdata = self.run(f"cat {current_file}")
            data["XDG_CONFIG_DIRS"] = str(current_file)
            data["config"] = confdata
            return data
        return {}
