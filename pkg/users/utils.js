import cockpit from 'cockpit';

export const get_locked = name =>
    cockpit.spawn(["passwd", "-S", name], { environ: ["LC_ALL=C"], superuser: "require" })
            .then(content => {
                const status = content.split(" ")[1];
                // libuser uses "LK", shadow-utils use "L".
                return status == "LK" || status == "L";
            })
            .catch(() => null);
