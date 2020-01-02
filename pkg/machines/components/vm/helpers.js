/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

export function labelForFirmwarePath(path, guest_arch) {
    /* Copied from virt-manager code:
     * Mapping of UEFI binary names to their associated architectures.
     */
    const uefi_arch_patterns = {
        i686: [
            ".*ovmf-ia32.*", // fedora, gerd's firmware repo
        ],
        x86_64: [
            ".*OVMF_CODE.fd", // RHEL
            ".*ovmf-x64/OVMF.*.fd", // gerd's firmware repo
            ".*ovmf-x86_64-.*", // SUSE
            ".*ovmf.*", ".*OVMF.*", // generic attempt at a catchall
        ],
        aarch64: [
            ".*AAVMF_CODE.fd", // RHEL
            ".*aarch64/QEMU_EFI.*", // gerd's firmware repo
            ".*aarch64.*", // generic attempt at a catchall
        ],
        armv7l: [
            ".*arm/QEMU_EFI.*", // fedora, gerd's firmware repo
        ],
    };
    if (!path) {
        if (["i686", "x86_64"].includes(guest_arch))
            return "bios";
        else
            return "unknown";
    } else {
        for (var arch in uefi_arch_patterns) {
            for (let i = 0; i < uefi_arch_patterns[arch].length; i++) {
                const pathRegExp = uefi_arch_patterns[arch][i];
                if (path.match(pathRegExp))
                    return "efi";
            }
        }
        return "custom";
    }
}

export function supportsUefiXml(loaderElem) {
    /* Return True if libvirt advertises support for proper UEFI setup  */
    const enums = loaderElem.getElementsByTagName("enum");
    const readonly = Array.prototype.filter.call(enums, enm => enm.getAttribute("name") == "readonly");

    return Array.prototype.filter.call(readonly[0].getElementsByTagName("value"), value => value.textContent == "yes").length > 0;
}
