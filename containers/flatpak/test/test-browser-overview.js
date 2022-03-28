async function test() {
    try {
        await ph_wait_present("#topnav");

        // switch to overview frame
        await ph_switch_to_frame("system");
        await ph_wait_present(".system-information");

        // click on "Show fingerprints", one action that unpriv users can do
        ph_mouse("#system-ssh-keys-link", "click");
        await ph_wait_present("#system_information_ssh_keys");
        // close the dialog again; delay this a bit, so that humans can actually see the dialog
        window.setTimeout(() => ph_mouse("#system_information_ssh_keys button.pf-m-secondary", "click"), 500);
        // FIXME: works fine in Fedora 35, but fails with older webkit in Ubuntu 20.04: the dialog does go away, but querySelector() still sees it!?
        // await ph_wait_not_present("#system_information_ssh_keys");

        ph_set_result("PASS");
    } catch(e) {
        ph_set_result(e);
    }
}

test();
