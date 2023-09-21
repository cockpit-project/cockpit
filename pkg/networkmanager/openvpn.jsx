import React, { useContext, useEffect, useState } from 'react';
import { Name, NetworkModal, dialogSave } from "./dialogs-common";
import { FileUpload } from '@patternfly/react-core/dist/esm/components/FileUpload/index.js';
import { FormFieldGroup, FormFieldGroupExpandable, FormFieldGroupHeader, FormGroup } from '@patternfly/react-core/dist/esm/components/Form/index.js';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput/index.js';
import cockpit from 'cockpit';
import { ModelContext } from './model-context';
import { useDialogs } from 'dialogs.jsx';
import * as python from "python.js";

const _ = cockpit.gettext;

// TODO: clean it
async function ovpnToJSON(ovpn) {
    const configFile = "/tmp/temp.ovpn"; // TODO: use a random name for temporary files
    const pythonScript =
`import configparser
import json
import subprocess
import os

with open("${configFile}", "w") as ovpn_file:
    ovpn_file.write("""${ovpn}""")

subprocess.run(["nmcli", "con", "import", "--temporary", "type", "openvpn", "file", "${configFile}"], stdout=subprocess.DEVNULL)

config_object = configparser.ConfigParser()
file = open("/run/NetworkManager/system-connections/temp.nmconnection","r")
config_object.read_file(file)
output_dict=dict()
sections=config_object.sections()
for section in sections:
    items=config_object.items(section)
    output_dict[section]=dict(items)

json_string=json.dumps(output_dict)
print(json_string)
file.close()

# clean up the temporary file
os.remove("/tmp/temp.ovpn")
subprocess.run(["nmcli", "con", "del", "temp"], stdout=subprocess.DEVNULL)
`;
    const json = await python.spawn(pythonScript, null, { error: 'message', superuser: 'try' });
    return json;
}

export function OpenVPNDialog({ settings, connection, dev }) {
    const Dialogs = useDialogs();
    const idPrefix = "network-openvpn-settings";
    const model = useContext(ModelContext);

    const [iface, setIface] = useState(settings.connection.interface_name);
    const [configFileName, setConfigFileName] = useState("");
    const [configVal, setConfigVal] = useState("");
    const [caFileName, setCaFileName] = useState("");
    const [caVal, setCaVal] = useState("");
    const [certFileName, setCertFileName] = useState("");
    const [certVal, setCertVal] = useState("");
    const [keyFileName, setKeyFileName] = useState("");
    const [keyVal, setKeyVal] = useState("");
    const [dialogError, setDialogError] = useState("");
    const [vpnSettings, setVpnSettings] = useState(settings.openvpn.data); // TODO: eventually there should a list of proper defaults instead of an empty object

    useEffect(() => {
        if (!configVal) return;

        async function getConfigJSON() {
            try {
                const json = await ovpnToJSON(configVal);
                const vpnObj = JSON.parse(json).vpn;
                setVpnSettings(vpnObj);
            } catch (e) {
                setDialogError(e.message);
            }
        }
        getConfigJSON();
    }, [configFileName, configVal]);

    useEffect(() => {
        async function readKeys() {
            try {
                const [ca, cert, key] = await Promise.all([
                    cockpit.file(vpnSettings.ca, { superuser: 'try' }).read(),
                    cockpit.file(vpnSettings.cert, { superuser: 'try' }).read(),
                    cockpit.file(vpnSettings.key, { superuser: 'try' }).read(),
                ]);
                setCaVal(ca);
                setCertVal(cert);
                setKeyVal(key);

                setCaFileName(vpnSettings.ca.split("/").at(-1));
                setCertFileName(vpnSettings.cert.split("/").at(-1));
                setKeyFileName(vpnSettings.key.split("/").at(-1));
            } catch (e) {
                setDialogError(e.message);
            }
        }

        readKeys();
    }, [vpnSettings]);

    async function onSubmit() {
        const user = await cockpit.user();
        const caPath = `${user.home}/.cert/${caFileName}`;
        const userCertPath = `${user.home}/.cert/${certFileName}`;
        const userKeyPath = `${user.home}/.cert/${keyFileName}`;

        try {
            // check if remote or certificates are empty
            if (!vpnSettings.remote.trim())
                throw new Error(_("Remote cannot be empty."));
            if (!caVal?.trim())
                throw new Error(_("CA certificate is empty."));
            if (!certVal?.trim())
                throw new Error(_("User certificate is empty."));
            if (!keyVal?.trim())
                throw new Error(_("User private key is empty."));

            await cockpit.spawn(["mkdir", "-p", `${user.home}/.cert/nm-openvpn`]);
            await Promise.all([cockpit.file(caPath).replace(caVal),
                cockpit.file(userCertPath).replace(certVal),
                cockpit.file(userKeyPath).replace(keyVal)
            ]);
        } catch (e) {
            setDialogError(e.message);
            return;
        }

        function createSettingsObject() {
            return {
                ...settings,
                connection: {
                    ...settings.connection,
                    type: 'vpn',
                },
                vpn: {
                    data: {
                        ...vpnSettings,
                        ca: caPath,
                        cert: userCertPath,
                        key: userKeyPath,
                        'connection-type': 'tls', // this is not an openvpn option, rather specific to NM
                    },
                    'service-type': 'org.freedesktop.NetworkManager.openvpn'
                }
            };
        }

        dialogSave({
            connection,
            dev,
            model,
            settings: createSettingsObject(),
            onClose: Dialogs.close,
            setDialogError,
        });
    }

    return (
        <NetworkModal
            title={!connection ? _("Add OpenVPN") : _("Edit OpenVPN settings")}
            isCreateDialog={!connection}
            onSubmit={onSubmit}
            dialogError={dialogError}
            idPrefix={idPrefix}
        >
            <Name idPrefix={idPrefix} iface={iface} setIface={setIface} />
            <FormFieldGroup
                header={
                    <FormFieldGroupHeader titleText={{ text: _("Import") }}
                    titleDescription={_("Upload a .ovpn file to automatically fill in the details in the next (Manual) section")}
                    />
                }
            >
                <FormGroup label={_("OpenVPN config")} id={idPrefix + '-config-group'}>
                    <FileUpload id={idPrefix + '-config'} filename={configFileName} onFileInputChange={(_, file) => setConfigFileName(file.name)} type='text' onDataChange={(_, val) => setConfigVal(val)} hideDefaultPreview onClearClick={() => { setConfigFileName(''); setConfigVal('') }} />
                </FormGroup>
            </FormFieldGroup>
            <FormFieldGroup header={ <FormFieldGroupHeader titleText={{ text: _("Manual") }} /> }>
                <FormGroup label={_("Remote")}>
                    <TextInput id={idPrefix + '-remote-input'} value={vpnSettings.remote} onChange={(_, val) => setVpnSettings(settings => ({ ...settings, remote: val }))} />
                </FormGroup>
                <FormGroup label={_("CA certificate")} id={idPrefix + '-ca-group'}>
                    <FileUpload id={idPrefix + '-ca'} filename={caFileName} onFileInputChange={(_, file) => setCaFileName(file.name)} type='text' onDataChange={(_, val) => setCaVal(val)} hideDefaultPreview onClearClick={() => { setCaFileName(''); setCaVal('') }} />
                </FormGroup>
                <FormGroup label={_("User certificate")} id={idPrefix + '-user-cert-group'}>
                    <FileUpload id={idPrefix + '-user-cert'} filename={certFileName} onFileInputChange={(_, file) => setCertFileName(file.name)} type='text' onDataChange={(_, val) => setCertVal(val)} hideDefaultPreview onClearClick={() => { setCertFileName(''); setCertVal('') }} />
                </FormGroup>
                <FormGroup label={_("User private key")} id={idPrefix + '-private-key-group'}>
                    <FileUpload id={idPrefix + '-user-key'} filename={keyFileName} onFileInputChange={(_, file) => setKeyFileName(file.name)} type='text' onDataChange={(_, val) => setKeyVal(val)} hideDefaultPreview onClearClick={() => { setKeyFileName(''); setKeyVal('') }} />
                </FormGroup>
            </FormFieldGroup>
            <FormFieldGroupExpandable header={ <FormFieldGroupHeader titleText={{ text: _("Advanced options") }} /> }>
                <FormGroup />
            </FormFieldGroupExpandable>
        </NetworkModal>
    );
}

export function getOpenVPNGhostSettings({ newIfaceName }) {
    return {
        connection: {
            id: `con-${newIfaceName}`,
            interface_name: newIfaceName,
        },
        openvpn: {
            data: {
                remote: '',
                ca: '',
                cert: '',
                key: '',
            }
        }
    };
}
