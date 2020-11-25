import React, { useState } from 'react';
import cockpit from 'cockpit';
import { Button, Form, FormGroup, FormSelect, FormSelectOption, FormSelectOptionGroup, Modal } from '@patternfly/react-core';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { setCpuMode as setCpuModeLibvirt } from '../../../libvirt-dbus.js';

const _ = cockpit.gettext;

export const CPUTypeModal = ({ vm, models, close }) => {
    const [error, setError] = useState({});
    const [cpuMode, setCpuMode] = useState(vm.cpu.mode);
    const [cpuModel, setCpuModel] = useState(vm.cpu.model);

    function save() {
        setCpuModeLibvirt({
            name: vm.name,
            id: vm.id,
            connectionName: vm.connectionName,
            mode: cpuMode,
            model: cpuModel
        }).then(close, exc => setError({ dialogError: _("CPU configuration could not be saved"), dialogErrorDetail: exc.message }));
    }

    const defaultBody = (
        <Form isHorizontal>
            <FormGroup id="cpu-model-select-group" label={_("Mode")}>
                <FormSelect value={cpuModel || cpuMode}
                            aria-label={_("Mode")}
                            onChange={value => {
                                if ((value == "host-model" || value == "host-passthrough")) {
                                    setCpuMode(value);
                                    setCpuModel(undefined);
                                } else {
                                    setCpuModel(value);
                                    setCpuMode("custom");
                                }
                            }}>
                    <FormSelectOption key="host-model"
                                      data-value="host-model"
                                      value="host-model"
                                      label="host-model" />
                    <FormSelectOption key="host-passthrough"
                                      data-value="host-passthrough"
                                      value="host-passthrough"
                                      label="host-passthrough" />
                    <FormSelectOptionGroup key="custom" label={_("custom")}>
                        {models.map(model => <FormSelectOption key={model} data-value={model} value={model} label={model} />)}
                    </FormSelectOptionGroup>
                </FormSelect>
            </FormGroup>
        </Form>
    );

    return (
        <Modal position="top" variant="small" isOpen onClose={close}
               title={cockpit.format(_("$0 CPU configuration"), vm.name)}
               footer={
                   <>
                       {error && error.dialogError && <ModalError dialogError={error.dialogError} dialogErrorDetail={error.dialogErrorDetail} />}
                       <Button variant='primary' id="cpu-config-dialog-apply" onClick={save}>
                           {_("Apply")}
                       </Button>
                       <Button variant='link' onClick={close}>
                           {_("Cancel")}
                       </Button>
                   </>
               }>
            <>
                { defaultBody }
            </>
        </Modal>
    );
};
