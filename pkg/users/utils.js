import cockpit from 'cockpit';

export const get_locked = name =>
    cockpit.spawn(["passwd", "-S", name], { environ: ["LC_ALL=C"], superuser: "require" })
            .then(content => {
                const status = content.split(" ")[1];
                // libuser uses "LK", shadow-utils use "L".
                return status == "LK" || status == "L";
            })
            .catch(exc => {
                if (exc.problem !== "access-denied") {
                    console.warn(`Failed to obtain account lock information for ${name}`, exc);
                }
            });

export async function getUtmpPath() {
    try {
        await cockpit.spawn(["test", "-e", "/var/run/utmp"], { err: "ignore" });
        return "/var/run/utmp";
    } catch (err1) {
        try {
            await cockpit.spawn(["test", "-e", "/var/lib/wtmpdb/wtmp.db"], { err: "ignore" });
            return "/var/lib/wtmpdb/wtmp.db";
        } catch (err2) {
            return null;
        }
    }
}
