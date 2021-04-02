#!/usr/bin/python3

import gi
gi.require_version('Libosinfo', '1.0')
from gi.repository import Libosinfo
import json


def _getInstallScriptProfile(installScriptList):
    profiles = []
    for i in range(installScriptList.get_length()):
        script = installScriptList.get_nth(i)
        profiles.append(script.get_profile())

    return profiles


loader = Libosinfo.Loader()
loader.process_default_path()
db = loader.get_db()

oses = db.get_os_list()
res = []
for i in range(oses.get_length()):
    os = oses.get_nth(i)

    osObj = {}
    osObj['id'] = os.get_id() or ""
    osObj['shortId'] = os.get_short_id() or ""
    osObj['name'] = os.get_name() or ""
    osObj['version'] = os.get_version() or ""
    osObj['family'] = os.get_family() or ""
    osObj['vendor'] = os.get_vendor() or ""
    osObj['releaseDate'] = os.get_release_date_string() or ""
    osObj['eolDate'] = os.get_eol_date_string() or ""
    osObj['codename'] = os.get_codename() or ""
    osObj['recommendedResources'] = {}
    recommendedResources = os.get_recommended_resources()
    if recommendedResources.get_length():
        ram = recommendedResources.get_nth(0).get_ram()
        if ram != -1:
            osObj['recommendedResources']['ram'] = ram
        storage = recommendedResources.get_nth(0).get_storage()
        if storage != -1:
            osObj['recommendedResources']['storage'] = storage
    osObj['minimumResources'] = {}
    minimumResources = os.get_minimum_resources()
    if minimumResources.get_length():
        ram = minimumResources.get_nth(0).get_ram()
        if ram != -1:
            osObj['minimumResources']['ram'] = ram
        storage = minimumResources.get_nth(0).get_storage()
        if storage != -1:
            osObj['minimumResources']['storage'] = storage

    osObj['profiles'] = []
    osInstallScripts = os.get_install_script_list()
    osObj['profiles'].extend(_getInstallScriptProfile(osInstallScripts))

    osObj['unattendedInstallable'] = False
    if osInstallScripts.get_length() > 0:
        osObj['unattendedInstallable'] = True

    osObj['medias'] = {}
    osMedias = os.get_media_list()
    for j in range(osMedias.get_length()):
        media = osMedias.get_nth(j)
        mediaId = media.get_id()

        osObj['medias'][mediaId] = {}
        osObj['medias'][mediaId]['unattendedInstallable'] = False
        osObj['medias'][mediaId]['profiles'] = []

        if (osObj['unattendedInstallable'] and
           hasattr(media, 'supports_installer_script')):
            supports = media.supports_installer_script()
            osObj['medias'][mediaId]['unattendedInstallable'] = supports

            mediaInstallScripts = media.get_install_script_list()
            osObj['medias'][mediaId]['profiles'].extend(
                     _getInstallScriptProfile(mediaInstallScripts))

            if supports and not osObj['medias'][mediaId]['profiles']:
                osObj['medias'][mediaId]['profiles'].extend(osObj['profiles'])

    osObj['treeInstallable'] = False
    trees = os.get_tree_list()
    for j in range(trees.get_length()):
        tree = trees.get_nth(j)

        if (tree.get_url() and
           ((hasattr(tree, 'has_treeinfo') and tree.has_treeinfo()) or
           (tree.get_kernel_path() and tree.get_initrd_path()))):
            osObj['treeInstallable'] = True

    res.append(osObj)

print(json.dumps(res))
