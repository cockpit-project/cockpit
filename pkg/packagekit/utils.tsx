import cockpit from "cockpit";

export function debug(...args: unknown[]) {
    if (window.debugging == 'all' || window.debugging?.includes('packagekit'))
        console.debug('packagekit:', ...args);
}

/**
 * Check Red Hat subscription-manager if if this is an unregistered RHEL
 * system. If subscription-manager is not installed or required (not a
 * Red Hat product), nothing happens.
 *
 * callback: Called with a boolean (true: registered, false: not registered)
 *           after querying subscription-manager once, and whenever the value
 *           changes.
 */
export function watchRedHatSubscription(callback: (registered: boolean) => void) {
    const sm = cockpit.dbus("com.redhat.RHSM1");

    function check() {
        sm.call(
            "/com/redhat/RHSM1/Entitlement", "com.redhat.RHSM1.Entitlement", "GetStatus", ["", ""])
                .then(([reply]) => {
                    const result = reply as string;
                    const status = JSON.parse(result);
                    callback(status.valid);
                })
                .catch(ex => console.warn("Failed to query RHEL subscription status:", JSON.stringify(ex)));
    }

    // check if subscription is required on this system, i.e. whether there are any installed products
    sm.call("/com/redhat/RHSM1/Products", "com.redhat.RHSM1.Products", "ListInstalledProducts", ["", {}, ""])
            .then(([reply]) => {
                const result = reply as string;
                const products = JSON.parse(result);
                if (products.length === 0)
                    return;

                // check if this is an unregistered RHEL system
                sm.subscribe(
                    {
                        path: "/com/redhat/RHSM1/Entitlement",
                        interface: "com.redhat.RHSM1.Entitlement",
                        member: "EntitlementChanged"
                    },
                    () => check()
                );

                check();
            })
            .catch(ex => {
                if (ex.problem != "not-found")
                    console.warn("Failed to query RHSM products:", JSON.stringify(ex));
            });
}
