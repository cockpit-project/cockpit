import React from "react";
import PropTypes from "prop-types";
import cockpit from "cockpit";
import { FormGroup, TextInput } from '@patternfly/react-core';
import { debounce } from 'throttle-debounce';

import './password.css';

const _ = cockpit.gettext;

const messages = {
    weakPassword: _("Password is too weak"),
    rejectedPassword: _("Password is not acceptable")
};

export class Password extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            passwordQuality: "",
            warningQuality: "",
            displayWarningQual: false,
            pwscoreAvailable: undefined,
        };
        this.handleChangePassword = this.handleChangePassword.bind(this);
        this.handleChangePasswordDebounced = debounce(300, false, this.handleChangePassword);
        this.handleWarnings = this.handleWarnings.bind(this);
        this.validateQuality = this.validateQuality.bind(this);
        this.passwordQualityFail = this.passwordQualityFail.bind(this);
        this.passwordQualityPass = this.passwordQualityPass.bind(this);
    }

    componentDidMount() {
        cockpit.spawn(["which", "pwscore"], { err: "message" })
                .then(() => this.setState({ pwscoreAvailable: true }),
                      () => this.setState({ pwscoreAvailable: false }));
    }

    handleChangePassword(value) {
        this.setState({
            displayWarningQual: false
        });
        this.props.onValueChanged(value);

        if (value !== "") {
            this.validateQuality(value);
        } else {
            this.setState({
                passwordQuality: "",
                warningQuality: ""
            });
        }
    }

    handleWarnings() {
        this.setState({ displayWarningQual: true });
    }

    validateQuality(password) {
        if (!this.state.pwscoreAvailable)
            return;

        return new Promise((resolve, reject) => cockpit.spawn("pwscore", { err: "message" })
                .input(password)
                .then(content => {
                    const quality = parseInt(content, 10);
                    if (quality === 0) {
                        this.passwordQualityFail(messages.weakPassword);
                        reject(new Error(messages.weakPassword));
                    } else if (quality <= 33) {
                        this.passwordQualityPass("weak", password);
                        resolve("weak");
                    } else if (quality <= 66) {
                        this.passwordQualityPass("okay", password);
                        resolve("okay");
                    } else if (quality <= 99) {
                        this.passwordQualityPass("good", password);
                        resolve("good");
                    } else {
                        this.passwordQualityPass("excellent", password);
                        resolve("excellent");
                    }
                }, ex => {
                    this.passwordQualityFail(ex.message || messages.rejectedPassword);
                }));
    }

    passwordQualityFail(message) {
        this.setState({ passwordQuality: "weak", warningQuality: message });
    }

    passwordQualityPass(quality, password) {
        this.setState({ passwordQuality: quality, warningQuality: "" });
        this.props.onValueChanged(password);
    }

    render() {
        const passwordInvalid = this.state.warningQuality && this.state.displayWarningQual;

        return (
            <>
                <FormGroup validationState={passwordInvalid ? "error" : "default"}>
                    <TextInput id={this.props.id}
                               type="password"
                               onChange={e => this.handleChangePassword(e.target.value)}
                               onBlur={() => this.handleWarnings()}
                    />
                </FormGroup>
                {this.state.pwscoreAvailable && <>
                    <div className={`progress password-strength-meter ${this.state.passwordQuality}`}>
                        <div className="progress-bar" />
                        <div className="progress-bar" />
                        <div className="progress-bar" />
                        <div className="progress-bar" />
                    </div>
                    {passwordInvalid &&
                        <span className="help-block">
                            {this.state.warningQuality}
                        </span>
                    }
                </>}
            </>
        );
    }
}

Password.propTypes = {
    onValueChanged: PropTypes.func.isRequired,
    id: PropTypes.string.isRequired,
};
