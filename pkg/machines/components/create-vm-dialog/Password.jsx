import React from "react";
import PropTypes from "prop-types";
import cockpit from "cockpit";
import { FormGroup } from "patternfly-react";

import './Password.css';

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
            displayWarningQual: false
        };
        this.handleChangePassword = this.handleChangePassword.bind(this);
        this.handleWarnings = this.handleWarnings.bind(this);
        this.validateQuality = this.validateQuality.bind(this);
        this.passwordQualityFail = this.passwordQualityFail.bind(this);
        this.passwordQualityPass = this.passwordQualityPass.bind(this);
    }

    handleChangePassword(event) {
        this.setState({
            displayWarningQual: false
        });
        this.props.onValueChanged(event.target.value);

        if (event.target.value !== "") {
            this.validateQuality(event.target.value);
        } else {
            this.setState({
                passwordQuality: "",
                warningQuality: ""
            });
        }
    }

    handleWarnings() {
        setTimeout(() => {
            if (this.props.password) {
                this.setState({ displayWarningQual: true });
            }
        }, 300);
    }

    validateQuality(password) {
        const dfd = cockpit.defer();
        cockpit
                .spawn("/usr/bin/pwscore", { err: "message" })
                .input(password)
                .done(content => {
                    const quality = parseInt(content, 10);
                    if (quality === 0) {
                        this.passwordQualityFail(messages.weakPassword);
                        dfd.reject(new Error(messages.weakPassword));
                    } else if (quality <= 33) {
                        this.passwordQualityPass("weak", password);
                        dfd.resolve("weak");
                    } else if (quality <= 66) {
                        this.passwordQualityPass("okay", password);
                        dfd.resolve("okay");
                    } else if (quality <= 99) {
                        this.passwordQualityPass("good", password);
                        dfd.resolve("good");
                    } else {
                        this.passwordQualityPass("excellent", password);
                        dfd.resolve("excellent");
                    }
                })
                .fail(ex => {
                    this.passwordQualityFail(ex.message || messages.rejectedPassword);
                });
        return dfd.promise();
    }

    passwordQualityFail(message) {
        this.setState({ passwordQuality: "weak", warningQuality: message });
        this.props.onValueChanged(undefined);
    }

    passwordQualityPass(quality, password) {
        this.setState({ passwordQuality: quality, warningQuality: "" });
        this.props.onValueChanged(password);
    }

    render() {
        const passwordInvalid = this.state.warningQuality && this.state.displayWarningQual;

        return (
            <React.Fragment>
                <FormGroup validationState={passwordInvalid ? "error" : undefined}>
                    <input
                        type="password"
                        className="form-control"
                        value={this.props.password}
                        onChange={e => this.handleChangePassword(e)}
                        onBlur={() => this.handleWarnings()}
                    />
                </FormGroup>
                <div
                    className={`progress password-strength-meter ${this.state.passwordQuality}`}
                >
                    <div className="progress-bar" />
                    <div className="progress-bar" />
                    <div className="progress-bar" />
                    <div className="progress-bar" />
                </div>
                {this.state.warningQuality !== "" && this.state.displayWarningQual && (
                    <span className="help-block">
                        {this.state.warningQuality}
                    </span>
                )}
            </React.Fragment>
        );
    }
}

Password.propTypes = {
    password: PropTypes.string,
    onValueChanged: PropTypes.func.isRequired,
};
