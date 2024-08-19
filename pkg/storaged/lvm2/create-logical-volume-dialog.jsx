/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import * as PK from "packagekit.js";

import { dialog_open, TextInput, SelectOne, Message, SelectSpaces, SelectOneRadio, SizeSlider, CheckBoxes } from "../dialog.jsx";
import { validate_lvm2_name } from "../utils.js";

import { pvs_to_spaces, next_default_logical_volume_name } from "./utils.jsx";

const _ = cockpit.gettext;

function install_package(name, progress) {
    return PK.check_missing_packages([name], p => progress(_("Checking installed software"), p.cancel))
            .then(data => {
                if (data.unavailable_names.length > 0)
                    return Promise.reject(new Error(
                        cockpit.format(_("$0 is not available from any repository."), data.unavailable_names[0])));
                // let's be cautious here, we really don't expect removals
                if (data.remove_names.length > 0)
                    return Promise.reject(new Error(
                        cockpit.format(_("Installing $0 would remove $1."), name, data.remove_names[0])));

                return PK.install_missing_packages(data, p => progress(_("Installing packages"), p.cancel));
            });
}

export function create_logical_volume(client, vgroup) {
    if (vgroup.FreeSize == 0)
        return;

    const pvs_as_spaces = pvs_to_spaces(client, client.vgroups_pvols[vgroup.path].filter(pvol => pvol.FreeSize > 0));

    const can_do_layouts = !!vgroup.CreatePlainVolumeWithLayout && pvs_as_spaces.length > 1;

    const purposes = [
        {
            value: "block",
            title: _("Block device for filesystems"),
        },
        { value: "pool", title: _("Pool for thinly provisioned volumes") }
        /* Not implemented
           { value: "cache", Title: _("Cache") }
        */
    ];

    const layouts = [
        {
            value: "linear",
            title: _("Linear"),
            min_pvs: 1,
        },
        {
            value: "raid0",
            title: _("Striped (RAID 0)"),
            min_pvs: 2,
        },
        {
            value: "raid1",
            title: _("Mirrored (RAID 1)"),
            min_pvs: 2,
        },
        {
            value: "raid10",
            title: _("Striped and mirrored (RAID 10)"),
            min_pvs: 4,
        },
        {
            value: "raid5",
            title: _("Distributed parity (RAID 5)"),
            min_pvs: 3,
        },
        {
            value: "raid6",
            title: _("Double distributed parity (RAID 6)"),
            min_pvs: 5,
        }
    ];

    const vdo_package = client.get_config("vdo_package", null);
    const need_vdo_install = vdo_package && !(client.features.lvm_create_vdo || client.features.legacy_vdo);

    if (client.features.lvm_create_vdo || client.features.legacy_vdo || vdo_package)
        purposes.push({ value: "vdo", title: _("VDO filesystem volume (compression/deduplication)") });

    /* For layouts with redundancy, CreatePlainVolumeWithLayout will
     * create as many subvolumes as there are selected PVs.  This has
     * the nice effect of making the calculation of the maximum size of
     * such a volume trivial.
     */

    function max_size(vals) {
        const layout = vals.layout;
        const pvs = vals.pvs.map(s => s.pvol);
        const n_pvs = pvs.length;
        const sum = pvs.reduce((sum, pv) => sum + pv.FreeSize, 0);
        const min = Math.min.apply(null, pvs.map(pv => pv.FreeSize));

        function metasize(datasize) {
            const default_regionsize = 2 * 1024 * 1024;
            const regions = Math.ceil(datasize / default_regionsize);
            const bytes = 2 * 4096 + Math.ceil(regions / 8);
            return vgroup.ExtentSize * Math.ceil(bytes / vgroup.ExtentSize);
        }

        if (layout == "linear") {
            return sum;
        } else if (layout == "raid0" && n_pvs >= 2) {
            return n_pvs * min;
        } else if (layout == "raid1" && n_pvs >= 2) {
            return min - metasize(min);
        } else if (layout == "raid10" && n_pvs >= 4) {
            return Math.floor(n_pvs / 2) * (min - metasize(min));
        } else if ((layout == "raid4" || layout == "raid5") && n_pvs >= 3) {
            return (n_pvs - 1) * (min - metasize(min));
        } else if (layout == "raid6" && n_pvs >= 5) {
            return (n_pvs - 2) * (min - metasize(min));
        } else
            return 0; // not-covered: internal error
    }

    const layout_descriptions = {
        linear: _("Data will be stored on the selected physical volumes without any additional redundancy or performance improvements."),
        raid0: _("Data will be stored on the selected physical volumes in an alternating fashion to improve performance. At least two volumes need to be selected."),
        raid1: _("Data will be stored as two or more copies on the selected physical volumes, to improve reliability. At least two volumes need to be selected."),
        raid10: _("Data will be stored as two copies and also in an alternating fashion on the selected physical volumes, to improve both reliability and performance. At least four volumes need to be selected."),
        raid4: _("Data will be stored on the selected physical volumes so that one of them can be lost without affecting the data. At least three volumes need to be selected."),
        raid5: _("Data will be stored on the selected physical volumes so that one of them can be lost without affecting the data. Data is also stored in an alternating fashion to improve performance. At least three volumes need to be selected."),
        raid6: _("Data will be stored on the selected physical volumes so that up to two of them can be lost at the same time without affecting the data. Data is also stored in an alternating fashion to improve performance. At least five volumes need to be selected."),
    };

    function compute_layout_choices(pvs) {
        return layouts.filter(l => l.min_pvs <= pvs.length);
    }

    for (const lay of layouts)
        lay.disabled = pvs_as_spaces.length < lay.min_pvs;

    function min_pvs_explanation(pvs, min) {
        if (pvs.length <= min)
            return cockpit.format(_("All $0 selected physical volumes are needed for the chosen layout."),
                                  pvs.length);
        return null;
    }

    dialog_open({
        Title: _("Create logical volume"),
        Fields: [
            TextInput("name", _("Name"),
                      {
                          value: next_default_logical_volume_name(client, vgroup, "lvol"),
                          validate: validate_lvm2_name
                      }),
            SelectOne("purpose", _("Purpose"),
                      {
                          value: "block",
                          choices: purposes
                      }),
            Message(cockpit.format(_("The $0 package will be installed to create VDO devices."), vdo_package),
                    {
                        visible: vals => vals.purpose === 'vdo' && need_vdo_install,
                    }),
            SelectSpaces("pvs", _("Physical Volumes"),
                         {
                             spaces: pvs_as_spaces,
                             value: pvs_as_spaces,
                             visible: vals => can_do_layouts && vals.purpose === 'block',
                             min_selected: 1,
                             validate: (val, vals) => {
                                 if (vals.layout == "raid10" && (vals.pvs.length % 2) !== 0)
                                     return _("RAID10 needs an even number of physical volumes");
                             },
                             explanation: min_pvs_explanation(pvs_as_spaces, 1)
                         }),
            SelectOneRadio("layout", _("Layout"),
                           {
                               vertical: true,
                               value: "linear",
                               choices: compute_layout_choices(pvs_as_spaces),
                               visible: vals => can_do_layouts && vals.purpose === 'block',
                               explanation: layout_descriptions.linear
                           }),
            SizeSlider("size", _("Size"),
                       {
                           visible: vals => vals.purpose !== 'vdo',
                           max: vgroup.FreeSize,
                           round: vgroup.ExtentSize
                       }),
            /* VDO parameters */
            SizeSlider("vdo_psize", _("Size"),
                       {
                           visible: vals => vals.purpose === 'vdo',
                           min: 5 * 1024 * 1024 * 1024,
                           max: vgroup.FreeSize,
                           round: vgroup.ExtentSize
                       }),
            SizeSlider("vdo_lsize", _("Logical size"),
                       {
                           visible: vals => vals.purpose === 'vdo',
                           value: vgroup.FreeSize,
                           // visually point out that this can be over-provisioned
                           max: vgroup.FreeSize * 3,
                           allow_infinite: true,
                           round: vgroup.ExtentSize
                       }),

            CheckBoxes("vdo_options", _("Options"),
                       {
                           visible: vals => vals.purpose === 'vdo',
                           fields: [
                               {
                                   tag: "compression",
                                   title: _("Compression"),
                                   tooltip: _("Save space by compressing individual blocks with LZ4")
                               },
                               {
                                   tag: "deduplication",
                                   title: _("Deduplication"),
                                   tooltip: _("Save space by storing identical data blocks just once")
                               },
                           ],
                           value: {
                               compression: true,
                               deduplication: true,
                           }
                       }),
        ],
        update: (dlg, vals, trigger) => {
            if (vals.purpose == 'block' && (trigger == "layout" || trigger == "pvs" || trigger == "purpose")) {
                for (const lay of layouts) {
                    if (lay.value == vals.layout) {
                        dlg.set_options("pvs", {
                            min_selected: lay.min_pvs,
                            explanation: min_pvs_explanation(vals.pvs, lay.min_pvs)
                        });
                    }
                }
                dlg.set_options("layout",
                                {
                                    choices: compute_layout_choices(vals.pvs),
                                    explanation: layout_descriptions[vals.layout]
                                });
                const max = max_size(vals);
                const old_max = dlg.get_options("size").max;
                if (vals.size > max || vals.size == old_max)
                    dlg.set_values({ size: max });
                dlg.set_options("size", { max });
            } else if (trigger == "purpose") {
                dlg.set_options("size", { max: vgroup.FreeSize });
            }
        },
        Action: {
            Title: _("Create"),
            action: (vals, progress) => {
                if (vals.purpose == "block") {
                    if (!can_do_layouts)
                        return vgroup.CreatePlainVolume(vals.name, vals.size, { });
                    else {
                        return vgroup.CreatePlainVolumeWithLayout(vals.name, vals.size, vals.layout,
                                                                  vals.pvs.map(spc => spc.block.path),
                                                                  { });
                    }
                } else if (vals.purpose == "pool")
                    return vgroup.CreateThinPoolVolume(vals.name, vals.size, { });
                else if (vals.purpose == "vdo") {
                    return (need_vdo_install ? install_package(vdo_package, progress) : Promise.resolve())
                            .then(() => {
                                progress(_("Creating VDO device")); // not cancellable any more
                                return vgroup.CreateVDOVolume(
                                // HACK: emulate lvcreate's automatic pool name creation until
                                // https://github.com/storaged-project/udisks/issues/939
                                    vals.name, next_default_logical_volume_name(client, vgroup, "vpool"),
                                    vals.vdo_psize, vals.vdo_lsize,
                                    0, // default index memory
                                    vals.vdo_options.compression, vals.vdo_options.deduplication,
                                    "auto", { });
                            });
                }
            }
        }
    });
}
