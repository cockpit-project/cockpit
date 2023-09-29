/* global ph_mouse ph_set_result ph_wait_present ph_wait_visible ph_wait_in_text */

async function assert_conversation(match) {
    await ph_wait_present("#conversation-prompt");
    await ph_wait_visible("#conversation-prompt");
    await ph_wait_in_text("#conversation-prompt", match);
}

async function test() {
    try {
        await ph_wait_present("#server-field");
        document.getElementById("server-field").value = "%HOST%";
        ph_mouse("#login-button", "click");

        // unknown host key
        await assert_conversation("authenticity of host");
        document.getElementById("conversation-input").value = "yes";
        ph_mouse("#login-button", "click");

        await ph_wait_present("#conversation-prompt");
        await assert_conversation("password");
        document.getElementById("conversation-input").value = "%PASS%";

        // this will cause a page load, ending the test
        ph_mouse("#login-button", "click");
    } catch (e) {
        ph_set_result(e);
    }
}

test();
