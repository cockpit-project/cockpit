// SPDX-License-Identifier: LGPL-2.1-or-later
const s_bus = {
    BUS_NAME: "org.freedesktop.systemd1",
    O_MANAGER: "/org/freedesktop/systemd1",
    I_MANAGER: "org.freedesktop.systemd1.Manager",
    I_PROPS: "org.freedesktop.DBus.Properties",
    I_UNIT: "org.freedesktop.systemd1.Unit",
    I_TIMER: "org.freedesktop.systemd1.Timer",
    I_SOCKET: "org.freedesktop.systemd1.Socket",
};

export default s_bus;
