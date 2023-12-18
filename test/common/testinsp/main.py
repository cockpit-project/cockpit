from testinsp.network import NetworkInterfaces, FirewallStatus
from testinsp.storage import DiskInfo
from testinsp.etc import ListEtcDir
from testinsp.cockpit_config_files import CockpitPAM, CockpitConf
from testinsp.services import ServiceInfo


class RunChecks:
    def __init__(self, external_executor=None):
        self.all = [
            NetworkInterfaces(external_executor=external_executor),
            DiskInfo(external_executor=external_executor),
            ListEtcDir(external_executor=external_executor),
            CockpitConf(external_executor=external_executor),
            CockpitPAM(external_executor=external_executor),
            ServiceInfo(external_executor=external_executor),
            FirewallStatus(external_executor=external_executor),
        ]

    def init(self):
        for item in self.all:
            item.init()

    def load(self):
        for item in self.all:
            item.load()

    def store(self):
        for item in self.all:
            item.store()

    def check(self):
        results = dict()
        for item in self.all:
            results[item.module_name] = item.check()
        return results
